const { FirebaseService } = require('./firebase');
const SolanaTrackerService = require('./solanaTracker');
const { MilestoneService } = require('./milestones');

class ATHBackfillService {
  constructor() {
    this.firebase = new FirebaseService();
    this.solanaTracker = new SolanaTrackerService();
    this.milestoneService = new MilestoneService();
  }

  // Resolve post-call max using ATH logic
  async resolvePostCallMax(token, tsCall, basis, entry, now) {
    try {
      // 1) Try to get ATH with timestamp
      let ath = await this.solanaTracker.getAthWithTimestamp(token);
      
      // 2) Decide post-call max
      let postMaxVal = 0, postMaxTs = 0, postBasis = basis;
      const preferMC = basis === 'marketCap';

      if (ath.ts && ath.ts >= tsCall) {
        // ATH happened after the call → use ATH
        postMaxVal = ath.value;
        postMaxTs = ath.ts;
        postBasis = ath.basis === 'marketCap' ? 'marketCap' : (preferMC ? 'marketCap' : 'price');
        
        console.log(`Using ATH for ${token}: ${postMaxVal} (${postBasis}) at ${new Date(postMaxTs * 1000).toISOString()}`);
      } else {
        // ATH before call or timestamp unknown → compute local post-call high
        const local = await this.solanaTracker.getLocalPostCallHigh(
          token,
          tsCall,
          now,
          preferMC
        );
        postMaxVal = local.value;
        postMaxTs = local.ts;
        postBasis = local.basis;
        
        console.log(`Using local high for ${token}: ${postMaxVal} (${postBasis}) at ${new Date(postMaxTs * 1000).toISOString()}`);
      }

      return {
        postCallMax: postMaxVal,
        postCallMaxTs: postMaxTs,
        basisUsed: postBasis,
        athUsed: ath.ts && ath.ts >= tsCall
      };
    } catch (error) {
      console.error(`Error resolving post-call max for ${token}:`, error);
      throw error;
    }
  }

  // Process a single call for backfill
  async processCall(call, runId, now) {
    try {
      const { token, tsCall, basis, entry, progress = {}, milestones = {} } = call;
      
      // Determine entry basis value
      const entryBasisValue = basis === 'marketCap' 
        ? (entry.marketCap || null)
        : (entry.price || null);

      if (!entryBasisValue || entryBasisValue <= 0) {
        return {
          callId: call.id,
          skipped: true,
          reason: 'no-entry-basis',
          migration: {
            appliedAt: now,
            reason: 'skipped',
            notes: 'No valid entry basis value'
          }
        };
      }

      // Resolve post-call max
      const { postCallMax, postCallMaxTs, basisUsed, athUsed } = await this.resolvePostCallMax(
        token,
        tsCall,
        basis,
        entry,
        now
      );

      // Calculate new multiplier
      const newMultiplier = postCallMax / entryBasisValue;
      const currentMultiplier = progress.multiplier || 1;

      // Only update if multiplier increased
      if (newMultiplier <= currentMultiplier) {
        return {
          callId: call.id,
          skipped: true,
          reason: 'no-improvement',
          migration: {
            appliedAt: now,
            reason: 'no-change',
            notes: `Current: ${currentMultiplier.toFixed(4)}x, New: ${newMultiplier.toFixed(4)}x`
          }
        };
      }

      // Prepare updates
      const updates = {
        [`calls/${call.id}/progress/multiplier`]: newMultiplier,
        [`calls/${call.id}/progress/max/ts`]: postMaxTs,
        [`calls/${call.id}/updatedAt`]: now
      };

      // Update max values based on basis used
      if (postBasis === 'marketCap') {
        updates[`calls/${call.id}/progress/max/marketCap`] = postCallMax;
      } else {
        updates[`calls/${call.id}/progress/max/price`] = postCallMax;
      }

      // Lock milestones
      const milestoneResult = await this.milestoneService.lockMilestones(
        call.id,
        token,
        tsCall,
        entryBasisValue,
        basis,
        postMaxTs || now,
        basis === 'marketCap'
      );

      // Add milestone updates
      Object.assign(updates, milestoneResult.updates);

      // Apply updates
      await this.firebase.update('', updates);

      // Record migration audit
      const migration = {
        appliedAt: now,
        reason: athUsed ? 'ath-after-call' : 'no-change',
        notes: `Basis: ${basisUsed}, Multiplier: ${currentMultiplier.toFixed(4)}x → ${newMultiplier.toFixed(4)}x`
      };

      await this.firebase.set(`calls/${call.id}/_migrations/${runId}`, migration);

      return {
        callId: call.id,
        updated: true,
        oldMultiplier: currentMultiplier,
        newMultiplier,
        milestones: milestoneResult.milestones,
        migration
      };

    } catch (error) {
      console.error(`Error processing call ${call.id}:`, error);
      return {
        callId: call.id,
        error: error.message,
        migration: {
          appliedAt: now,
          reason: 'skipped',
          notes: `Error: ${error.message}`
        }
      };
    }
  }

  // Get calls to process with pagination
  async getCallsToProcess(filters, limit, cursor = null) {
    try {
      const { groupId, token, fromTs, toTs } = filters;
      
      let calls = [];
      
      if (token) {
        calls = await this.firebase.getCallsByToken(token);
      } else if (groupId) {
        calls = await this.firebase.getCallsByGroup(groupId);
      } else {
        calls = await this.firebase.getActiveCalls();
      }

      // Apply time filters
      if (fromTs || toTs) {
        calls = calls.filter(call => {
          const callTime = call.tsCall;
          if (fromTs && callTime < fromTs) return false;
          if (toTs && callTime > toTs) return false;
          return true;
        });
      }

      // Sort by tsCall for consistent pagination
      calls.sort((a, b) => a.tsCall - b.tsCall);

      // Apply pagination
      const startIndex = cursor ? parseInt(cursor) : 0;
      const endIndex = startIndex + limit;
      const pageCalls = calls.slice(startIndex, endIndex);
      const nextCursor = endIndex < calls.length ? endIndex.toString() : null;

      return {
        calls: pageCalls,
        total: calls.length,
        nextCursor,
        hasMore: nextCursor !== null
      };
    } catch (error) {
      console.error('Error getting calls to process:', error);
      throw error;
    }
  }

  // Run backfill process
  async runBackfill(options) {
    const {
      runId,
      groupId,
      token,
      fromTs,
      toTs,
      limit = 500,
      dryRun = false
    } = options;

    const now = Math.floor(Date.now() / 1000);
    const startTime = Date.now();

    console.log(`Starting ATH backfill run ${runId}`, {
      groupId,
      token,
      fromTs,
      toTs,
      limit,
      dryRun
    });

    try {
      // Get calls to process
      const { calls, total, nextCursor, hasMore } = await this.getCallsToProcess(
        { groupId, token, fromTs, toTs },
        limit
      );

      const results = {
        runId,
        scanned: calls.length,
        updated: 0,
        skipped: 0,
        errors: 0,
        dryRun,
        page: {
          processed: calls.length,
          nextCursor,
          hasMore
        },
        startTime,
        endTime: null,
        duration: null
      };

      // Process calls
      for (const call of calls) {
        try {
          const result = await this.processCall(call, runId, now);
          
          if (result.updated) {
            results.updated++;
          } else if (result.skipped) {
            results.skipped++;
          } else if (result.error) {
            results.errors++;
          }
        } catch (error) {
          console.error(`Error processing call ${call.id}:`, error);
          results.errors++;
        }
      }

      results.endTime = Date.now();
      results.duration = results.endTime - results.startTime;

      // Store run status
      if (!dryRun) {
        await this.firebase.set(`_admin/backfillRuns/${runId}`, {
          ...results,
          status: hasMore ? 'in_progress' : 'completed',
          lastUpdated: now
        });
      }

      console.log(`Backfill run ${runId} completed`, results);
      return results;

    } catch (error) {
      console.error(`Error in backfill run ${runId}:`, error);
      
      const errorResult = {
        runId,
        error: error.message,
        dryRun,
        startTime,
        endTime: Date.now(),
        duration: Date.now() - startTime
      };

      if (!dryRun) {
        await this.firebase.set(`_admin/backfillRuns/${runId}`, {
          ...errorResult,
          status: 'failed',
          lastUpdated: now
        });
      }

      throw error;
    }
  }

  // Get backfill run status
  async getRunStatus(runId) {
    try {
      const status = await this.firebase.get(`_admin/backfillRuns/${runId}`);
      return status || { error: 'Run not found' };
    } catch (error) {
      console.error(`Error getting run status for ${runId}:`, error);
      return { error: error.message };
    }
  }

  // List all backfill runs
  async listRuns(limit = 50) {
    try {
      const runs = await this.firebase.get('_admin/backfillRuns');
      if (!runs) return [];

      const runList = Object.entries(runs)
        .map(([runId, data]) => ({ runId, ...data }))
        .sort((a, b) => (b.startTime || 0) - (a.startTime || 0))
        .slice(0, limit);

      return runList;
    } catch (error) {
      console.error('Error listing backfill runs:', error);
      return [];
    }
  }

  // Clean up old runs
  async cleanupOldRuns(olderThanDays = 30) {
    try {
      const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
      const runs = await this.listRuns(1000);
      
      const oldRuns = runs.filter(run => 
        run.startTime && run.startTime < cutoffTime
      );

      for (const run of oldRuns) {
        await this.firebase.remove(`_admin/backfillRuns/${run.runId}`);
      }

      return { cleaned: oldRuns.length };
    } catch (error) {
      console.error('Error cleaning up old runs:', error);
      throw error;
    }
  }
}

module.exports = ATHBackfillService;
