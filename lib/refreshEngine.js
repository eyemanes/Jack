const SolanaTrackerService = require('./solanaTracker');
const { FirebaseService } = require('./firebase');

class RefreshEngine {
  constructor() {
    this.solanaTracker = new SolanaTrackerService();
    this.firebase = new FirebaseService();
    this.isRefreshing = false;
    this.lastRefreshTime = 0;
    this.refreshInterval = 30000; // 30 seconds
  }

  // Main refresh method
  async refreshAllCalls() {
    if (this.isRefreshing) {
      console.log('Refresh already in progress, skipping...');
      return { success: false, error: 'Refresh already in progress' };
    }

    this.isRefreshing = true;
    this.lastRefreshTime = Date.now();

    try {
      console.log('Starting batch refresh of all active calls...');
      
      // Get all active calls
      const activeCalls = await this.firebase.getActiveCalls();
      
      if (activeCalls.length === 0) {
        console.log('No active calls to refresh');
        return { success: true, processed: 0 };
      }

      console.log(`Found ${activeCalls.length} active calls to refresh`);

      // Group calls by token for efficient API usage
      const tokenGroups = {};
      for (const call of activeCalls) {
        if (!tokenGroups[call.token]) {
          tokenGroups[call.token] = [];
        }
        tokenGroups[call.token].push(call);
      }

      const results = [];
      const updates = {};

      // Process each token group
      for (const [token, calls] of Object.entries(tokenGroups)) {
        try {
          console.log(`Processing ${calls.length} calls for token ${token}`);
          
          // Get post-call data for this token
          const postCallData = await this.solanaTracker.getPostCallData(
            token, 
            Math.min(...calls.map(c => c.tsCall)), // Use earliest call time
            Date.now()
          );

          // Process each call for this token
          for (const call of calls) {
            try {
              const updatedCall = await this.processCall(call, postCallData);
              updates[call.id] = updatedCall;
              results.push({
                callId: call.id,
                token: call.token,
                success: true,
                multiplier: updatedCall.progress.multiplier,
                milestones: updatedCall.milestones
              });
            } catch (error) {
              console.error(`Error processing call ${call.id}:`, error.message);
              results.push({
                callId: call.id,
                token: call.token,
                success: false,
                error: error.message
              });
            }
          }
        } catch (error) {
          console.error(`Error processing token ${token}:`, error.message);
          // Mark all calls for this token as failed
          for (const call of calls) {
            results.push({
              callId: call.id,
              token: call.token,
              success: false,
              error: error.message
            });
          }
        }
      }

      // Batch update all calls
      if (Object.keys(updates).length > 0) {
        await this.firebase.batchUpdateCalls(updates);
        console.log(`Updated ${Object.keys(updates).length} calls`);
      }

      // Update caller stats
      await this.updateCallerStats(activeCalls);

      const successCount = results.filter(r => r.success).length;
      const failureCount = results.filter(r => !r.success).length;

      console.log(`Refresh completed: ${successCount} successful, ${failureCount} failed`);

      return {
        success: true,
        processed: results.length,
        successful: successCount,
        failed: failureCount,
        results
      };

    } catch (error) {
      console.error('Error in refresh all calls:', error);
      return { success: false, error: error.message };
    } finally {
      this.isRefreshing = false;
    }
  }

  // Process individual call with ATH-after-call guard
  async processCall(call, postCallData) {
    const { token, tsCall, entry, progress = {}, milestones = {} } = call;
    
    // Determine basis (marketCap or price)
    const basis = entry.marketCap ? 'marketCap' : 'price';
    const entryValue = entry[basis];
    
    if (!entryValue || entryValue <= 0) {
      return {
        progress,
        milestones,
        updatedAt: Date.now(),
        skipped: true,
        reason: 'no-entry-basis'
      };
    }

    try {
      // 1) Try to get ATH with timestamp
      const ath = await this.solanaTracker.getAthWithTimestamp(token);
      
      // 2) Decide post-call max using ATH logic
      let postMaxVal = 0, postMaxTs = 0, postBasis = basis;
      const preferMC = basis === 'marketCap';

      if (ath.ts && ath.ts >= tsCall) {
        // ATH happened after the call → use ATH
        postMaxVal = ath.value;
        postMaxTs = ath.ts;
        postBasis = ath.basis === 'marketCap' ? 'marketCap' : (preferMC ? 'marketCap' : 'price');
        
        console.log(`Using ATH for ${token}: ${postMaxVal} (${postBasis}) at ${new Date(postMaxTs * 1000).toISOString()}`);
      } else {
        // ATH before call or timestamp unknown → use local post-call high
        const local = await this.solanaTracker.getLocalPostCallHigh(
          token,
          tsCall,
          Math.floor(Date.now() / 1000),
          preferMC
        );
        postMaxVal = local.value;
        postMaxTs = local.ts;
        postBasis = local.basis;
        
        console.log(`Using local high for ${token}: ${postMaxVal} (${postBasis}) at ${new Date(postMaxTs * 1000).toISOString()}`);
      }

      // 3) Calculate multiplier on the call's basis
      const multiplier = postMaxVal / entryValue;
      const currentMultiplier = progress.multiplier || 1;

      // Only update if multiplier increased
      if (multiplier <= currentMultiplier) {
        return {
          progress,
          milestones,
          updatedAt: Date.now(),
          skipped: true,
          reason: 'no-improvement'
        };
      }

      // 4) Update progress
      const updatedProgress = {
        ...progress,
        max: {
          price: postBasis === 'price' ? postMaxVal : (progress.max?.price || null),
          marketCap: postBasis === 'marketCap' ? postMaxVal : (progress.max?.marketCap || null),
          ts: postMaxTs
        },
        multiplier: Math.max(multiplier, currentMultiplier)
      };

      // 5) Lock milestones using first-cross detection
      const { MilestoneService } = require('./milestones');
      const milestoneService = new MilestoneService();
      
      const milestoneResult = await milestoneService.lockMilestones(
        call.id,
        token,
        tsCall,
        entryValue,
        basis,
        postMaxTs || Math.floor(Date.now() / 1000),
        preferMC
      );

      return {
        progress: updatedProgress,
        milestones: milestoneResult.milestones,
        updatedAt: Date.now(),
        athUsed: ath.ts && ath.ts >= tsCall,
        basisUsed: postBasis
      };

    } catch (error) {
      console.error(`Error processing call ${call.id} with ATH guard:`, error);
      
      // Fallback to original logic if ATH resolution fails
      const currentValue = postCallData[`current${basis.charAt(0).toUpperCase() + basis.slice(1)}`] || 0;
      const maxValue = postCallData[`max${basis.charAt(0).toUpperCase() + basis.slice(1)}`] || 0;
      const multiplier = entryValue > 0 ? maxValue / entryValue : 1;

      const updatedProgress = {
        ...progress,
        max: {
          price: postCallData.maxPrice || null,
          marketCap: postCallData.maxMarketCap || null,
          ts: postCallData[`max${basis.charAt(0).toUpperCase() + basis.slice(1)}Timestamp`] || null
        },
        multiplier: Math.max(multiplier, progress.multiplier || 1)
      };

      // Check and update milestones (fallback logic)
      const updatedMilestones = { ...milestones };
      const milestonesToCheck = [
        { key: 'x2', value: 2 },
        { key: 'x5', value: 5 },
        { key: 'x10', value: 10 },
        { key: 'x25', value: 25 },
        { key: 'x50', value: 50 },
        { key: 'x100', value: 100 }
      ];

      for (const milestone of milestonesToCheck) {
        if (multiplier >= milestone.value && !updatedMilestones[milestone.key]?.hit) {
          updatedMilestones[milestone.key] = {
            hit: true,
            ts: Date.now()
          };
        }
      }

      return {
        progress: updatedProgress,
        milestones: updatedMilestones,
        updatedAt: Date.now(),
        fallback: true,
        error: error.message
      };
    }
  }

  // Update caller statistics
  async updateCallerStats(calls) {
    try {
      const callerStats = {};

      for (const call of calls) {
        const callerId = call.callerId;
        if (!callerStats[callerId]) {
          callerStats[callerId] = await this.firebase.getCallerStats(callerId);
        }

        const stats = callerStats[callerId];
        const multiplier = call.progress?.multiplier || 1;
        const milestones = call.milestones || {};

        // Update totals
        stats.totals.calls = (stats.totals.calls || 0) + 1;

        // Update milestone counts
        for (const [key, milestone] of Object.entries(milestones)) {
          if (milestone.hit && !stats.totals[key]) {
            stats.totals[key] = (stats.totals[key] || 0) + 1;
          }
        }

        // Update best multiplier
        if (multiplier > (stats.bestMultiplier || 0)) {
          stats.bestMultiplier = multiplier;
        }
      }

      // Update all caller stats
      for (const [callerId, stats] of Object.entries(callerStats)) {
        await this.firebase.updateCallerStats(callerId, stats);
      }

      console.log(`Updated stats for ${Object.keys(callerStats).length} callers`);
    } catch (error) {
      console.error('Error updating caller stats:', error);
    }
  }

  // Refresh specific call
  async refreshCall(callId) {
    try {
      const call = await this.firebase.getCall(callId);
      if (!call) {
        throw new Error('Call not found');
      }

      const postCallData = await this.solanaTracker.getPostCallData(
        call.token,
        call.tsCall,
        Date.now()
      );

      const updatedCall = await this.processCall(call, postCallData);
      await this.firebase.updateCall(callId, updatedCall);

      return {
        success: true,
        callId,
        multiplier: updatedCall.progress.multiplier,
        milestones: updatedCall.milestones
      };
    } catch (error) {
      console.error(`Error refreshing call ${callId}:`, error);
      return {
        success: false,
        callId,
        error: error.message
      };
    }
  }

  // Get refresh status
  getRefreshStatus() {
    return {
      isRefreshing: this.isRefreshing,
      lastRefreshTime: this.lastRefreshTime,
      nextRefreshIn: Math.max(0, this.refreshInterval - (Date.now() - this.lastRefreshTime))
    };
  }

  // Start auto-refresh
  startAutoRefresh() {
    if (this.autoRefreshInterval) {
      clearInterval(this.autoRefreshInterval);
    }

    this.autoRefreshInterval = setInterval(async () => {
      try {
        await this.refreshAllCalls();
      } catch (error) {
        console.error('Error in auto-refresh:', error);
      }
    }, this.refreshInterval);

    console.log(`Auto-refresh started with ${this.refreshInterval}ms interval`);
  }

  // Stop auto-refresh
  stopAutoRefresh() {
    if (this.autoRefreshInterval) {
      clearInterval(this.autoRefreshInterval);
      this.autoRefreshInterval = null;
      console.log('Auto-refresh stopped');
    }
  }
}

module.exports = RefreshEngine;
