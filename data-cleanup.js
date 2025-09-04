/**
 * Data Cleanup Script - Fix Corrupted PnL Data
 * Run this script to identify and fix all corrupted maxPnl values in the database
 * 
 * Usage:
 *   node data-cleanup.js                    # Dry run (safe, no changes)
 *   node data-cleanup.js --live             # Apply fixes to database
 *   node data-cleanup.js --live --backup    # Create backup before fixing
 *   node data-cleanup.js --identify-only    # Just identify suspicious calls
 *   node data-cleanup.js --validate-only    # Validate current data quality
 */

const FirebaseService = require('./services/FirebaseService');
const SolanaTrackerService = require('./services/SolanaTrackerService');
const ImprovedPnlCalculationService = require('./services/ImprovedPnlCalculationService');

class DataCleanupService {
  constructor() {
    this.db = new FirebaseService();
    this.solanaService = new SolanaTrackerService();
    this.pnlService = new ImprovedPnlCalculationService();
    this.stats = {
      totalCalls: 0,
      processedCalls: 0,
      corruptedCalls: 0,
      fixedCalls: 0,
      failedCalls: 0,
      skippedCalls: 0
    };
  }

  /**
   * MAIN CLEANUP METHOD - Fix all corrupted data
   */
  async runFullCleanup(dryRun = true) {
    console.log(`🧹 Starting ${dryRun ? 'DRY RUN' : 'LIVE'} data cleanup...`);
    
    try {
      // Step 1: Get all active calls
      console.log('📊 Step 1: Fetching all active calls...');
      const calls = await this.db.getAllActiveCalls();
      this.stats.totalCalls = calls.length;
      console.log(`Found ${calls.length} active calls to process`);

      if (calls.length === 0) {
        console.log('✅ No calls to process');
        return this.stats;
      }

      // Step 2: Get token data for all calls
      console.log('📊 Step 2: Fetching token data...');
      const tokenDataMap = await this.fetchTokenDataBatch(calls);
      console.log(`Fetched token data for ${Object.keys(tokenDataMap).length} tokens`);

      // Step 3: Generate corruption report
      console.log('📊 Step 3: Generating corruption report...');
      const corruptionReport = await this.pnlService.generateCorruptionReport(calls, tokenDataMap);
      this.stats.corruptedCalls = corruptionReport.corruptedCount;
      
      console.log(`\n🚨 CORRUPTION REPORT:`);
      console.log(`Total Calls: ${corruptionReport.totalCalls}`);
      console.log(`Corrupted Calls: ${corruptionReport.corruptedCount}`);
      console.log(`Corruption Rate: ${corruptionReport.corruptionRate}%\n`);

      if (corruptionReport.corruptedCalls.length > 0) {
        console.log('📋 Corrupted Calls Details:');
        corruptionReport.corruptedCalls.forEach((corrupted, index) => {
          console.log(`${index + 1}. ${corrupted.tokenSymbol} (${corrupted.callId})`);
          console.log(`   Current maxPnl: ${corrupted.currentMaxPnl}%`);
          console.log(`   Max Possible: ${corrupted.maxPossiblePnl.toFixed(2)}%`);
          console.log(`   Reason: ${corrupted.reason}`);
          console.log('');
        });
      }

      // Step 4: Fix corrupted data
      if (!dryRun && corruptionReport.corruptedCalls.length > 0) {
        console.log('🔧 Step 4: Fixing corrupted data...');
        await this.fixCorruptedCalls(corruptionReport.corruptedCalls, tokenDataMap);
      } else if (dryRun) {
        console.log('🔍 DRY RUN: Would fix these corrupted calls in live mode');
      } else {
        console.log('✅ No corrupted calls to fix');
      }

      // Step 5: Recalculate all PnL values with improved service
      if (!dryRun) {
        console.log('🔄 Step 5: Recalculating all PnL values...');
        await this.recalculateAllPnl(calls, tokenDataMap);
      }

      console.log('\n📊 CLEANUP SUMMARY:');
      this.printStats();

      return this.stats;

    } catch (error) {
      console.error('❌ Cleanup process failed:', error);
      throw error;
    }
  }

  /**
   * FETCH TOKEN DATA IN BATCHES - Efficient data fetching
   */
  async fetchTokenDataBatch(calls) {
    const uniqueAddresses = [...new Set(calls.map(call => call.contractAddress))];
    console.log(`Fetching token data for ${uniqueAddresses.length} unique contracts...`);

    const tokenDataMap = {};
    const batchSize = 10; // Process in batches to avoid rate limits

    for (let i = 0; i < uniqueAddresses.length; i += batchSize) {
      const batch = uniqueAddresses.slice(i, i + batchSize);
      console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(uniqueAddresses.length / batchSize)}...`);

      await Promise.all(
        batch.map(async (address) => {
          try {
            const tokenData = await this.solanaService.getTokenData(address);
            if (tokenData) {
              tokenDataMap[address] = tokenData;
            } else {
              console.warn(`⚠️ No token data for ${address}`);
            }
          } catch (error) {
            console.error(`❌ Failed to fetch data for ${address}:`, error.message);
          }
        })
      );

      // Rate limiting delay
      if (i + batchSize < uniqueAddresses.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    return tokenDataMap;
  }

  /**
   * FIX CORRUPTED CALLS - Reset corrupted maxPnl values
   */
  async fixCorruptedCalls(corruptedCalls, tokenDataMap) {
    console.log(`🔧 Fixing ${corruptedCalls.length} corrupted calls...`);

    for (const corrupted of corruptedCalls) {
      try {
        console.log(`Fixing call ${corrupted.callId} (${corrupted.tokenSymbol})...`);
        
        // Reset maxPnl to 0 and add metadata about the fix
        await this.db.updateCall(corrupted.callId, {
          maxPnl: 0,
          corruptionFixed: true,
          corruptionFixedAt: new Date().toISOString(),
          previousCorruptedMaxPnl: corrupted.currentMaxPnl,
          corruptionReason: corrupted.reason
        });

        this.stats.fixedCalls++;
        console.log(`✅ Fixed: Reset maxPnl from ${corrupted.currentMaxPnl}% to 0%`);

      } catch (error) {
        console.error(`❌ Failed to fix call ${corrupted.callId}:`, error);
        this.stats.failedCalls++;
      }
    }
  }

  /**
   * RECALCULATE ALL PNL VALUES - Using improved service
   */
  async recalculateAllPnl(calls, tokenDataMap) {
    console.log(`🧮 Recalculating PnL for ${calls.length} calls...`);

    const batchResult = await this.pnlService.calculateBatchPnl(calls, tokenDataMap);
    
    console.log(`\n🧮 BATCH CALCULATION RESULTS:`);
    console.log(`Success Rate: ${batchResult.summary.successRate}%`);
    console.log(`Valid: ${batchResult.summary.valid}`);
    console.log(`Errors: ${batchResult.summary.errors}`);
    console.log(`Corrupted: ${batchResult.summary.corrupted}`);

    // Update database with new PnL values
    let updateCount = 0;
    let updateErrors = 0;

    for (const result of batchResult.results) {
      if (result.isValid) {
        try {
          await this.db.updateCall(result.callId, {
            pnlPercent: result.pnlPercent,
            maxPnl: result.maxPnl,
            pnlCalculationType: result.calculationType,
            lastPnlRecalculation: new Date().toISOString(),
            pnlValidationErrors: result.validationErrors.length > 0 ? result.validationErrors : undefined
          });
          updateCount++;
          this.stats.processedCalls++;
        } catch (error) {
          console.error(`❌ Failed to update call ${result.callId}:`, error);
          updateErrors++;
          this.stats.failedCalls++;
        }
      } else {
        this.stats.skippedCalls++;
      }
    }

    console.log(`✅ Updated ${updateCount} calls, ${updateErrors} update errors`);
  }

  /**
   * IDENTIFY SUSPICIOUS CALLS - Find calls that might have issues
   */
  async identifySuspiciousCalls() {
    console.log('🔍 Identifying suspicious calls...');

    const calls = await this.db.getAllActiveCalls();
    const suspicious = [];

    for (const call of calls) {
      const issues = [];

      // Check for extreme PnL values
      const pnl = parseFloat(call.pnlPercent) || 0;
      const maxPnl = parseFloat(call.maxPnl) || 0;

      if (Math.abs(pnl) > 10000) {
        issues.push(`Extreme PnL: ${pnl}%`);
      }

      if (Math.abs(maxPnl) > 10000) {
        issues.push(`Extreme maxPnL: ${maxPnl}%`);
      }

      // Check for impossible ratios
      const entryMc = parseFloat(call.entryMarketCap) || 0;
      const currentMc = parseFloat(call.currentMarketCap) || 0;
      
      if (entryMc > 0 && currentMc > 0) {
        const ratio = currentMc / entryMc;
        if (ratio > 10000 || ratio < 0.0001) {
          issues.push(`Suspicious MC ratio: ${ratio.toFixed(4)}x`);
        }
      }

      // Check for invalid timestamps
      const callTime = new Date(call.createdAt);
      const now = new Date();
      const daysDiff = (now - callTime) / (1000 * 60 * 60 * 24);
      
      if (daysDiff > 365) {
        issues.push(`Very old call: ${daysDiff.toFixed(0)} days`);
      }

      // Check for NaN or null values
      if (isNaN(pnl) && call.pnlPercent !== null && call.pnlPercent !== undefined) {
        issues.push('PnL is NaN');
      }

      if (issues.length > 0) {
        suspicious.push({
          callId: call.id,
          tokenSymbol: call.tokenSymbol,
          contractAddress: call.contractAddress,
          issues: issues,
          pnl: pnl,
          maxPnl: maxPnl,
          entryMarketCap: entryMc,
          currentMarketCap: currentMc
        });
      }
    }

    console.log(`🔍 Found ${suspicious.length} suspicious calls:`);
    suspicious.forEach((call, index) => {
      console.log(`${index + 1}. ${call.tokenSymbol} (${call.callId})`);
      call.issues.forEach(issue => console.log(`   - ${issue}`));
    });

    return suspicious;
  }

  /**
   * BACKUP DATA - Create backup before cleanup
   */
  async createBackup() {
    console.log('💾 Creating data backup...');
    
    try {
      const calls = await this.db.getAllActiveCalls();
      const backup = {
        timestamp: new Date().toISOString(),
        totalCalls: calls.length,
        calls: calls.map(call => ({
          id: call.id,
          contractAddress: call.contractAddress,
          tokenSymbol: call.tokenSymbol,
          pnlPercent: call.pnlPercent,
          maxPnl: call.maxPnl,
          entryMarketCap: call.entryMarketCap,
          currentMarketCap: call.currentMarketCap,
          createdAt: call.createdAt
        }))
      };

      // Write backup to file
      const fs = require('fs');
      const backupPath = `./backup_${Date.now()}.json`;
      fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
      
      console.log(`✅ Backup created: ${backupPath}`);
      return backupPath;
    } catch (error) {
      console.error('❌ Backup creation failed:', error);
      throw error;
    }
  }

  /**
   * VALIDATE CLEANUP RESULTS - Verify cleanup was successful
   */
  async validateCleanupResults() {
    console.log('✅ Validating cleanup results...');
    
    const calls = await this.db.getAllActiveCalls();
    const tokenDataMap = await this.fetchTokenDataBatch(calls.slice(0, 10)); // Sample check
    
    let validCount = 0;
    let invalidCount = 0;
    const issues = [];

    for (const call of calls.slice(0, 10)) { // Check first 10 calls
      const tokenData = tokenDataMap[call.contractAddress];
      if (!tokenData) continue;

      const result = this.pnlService.calculatePnl(call, tokenData);
      
      if (result.isValid) {
        validCount++;
      } else {
        invalidCount++;
        issues.push({
          callId: call.id,
          tokenSymbol: call.tokenSymbol,
          errors: result.validationErrors
        });
      }
    }

    console.log(`Validation Results: ${validCount} valid, ${invalidCount} invalid`);
    
    if (issues.length > 0) {
      console.log('Remaining issues:');
      issues.forEach(issue => {
        console.log(`- ${issue.tokenSymbol}: ${issue.errors.join(', ')}`);
      });
    }

    return {
      valid: validCount,
      invalid: invalidCount,
      issues: issues
    };
  }

  /**
   * PRINT STATISTICS
   */
  printStats() {
    console.log(`Total Calls: ${this.stats.totalCalls}`);
    console.log(`Processed: ${this.stats.processedCalls}`);
    console.log(`Corrupted Found: ${this.stats.corruptedCalls}`);
    console.log(`Fixed: ${this.stats.fixedCalls}`);
    console.log(`Failed: ${this.stats.failedCalls}`);
    console.log(`Skipped: ${this.stats.skippedCalls}`);
    
    if (this.stats.totalCalls > 0) {
      const successRate = ((this.stats.processedCalls / this.stats.totalCalls) * 100).toFixed(1);
      console.log(`Success Rate: ${successRate}%`);
    }
  }
}

// CLI Interface
async function runCleanup() {
  const args = process.argv.slice(2);
  const isDryRun = !args.includes('--live');
  const createBackup = args.includes('--backup');
  const onlyValidate = args.includes('--validate-only');
  const identifyOnly = args.includes('--identify-only');

  console.log('🚀 Data Cleanup Tool Started');
  console.log('Arguments:', args);
  
  const cleanup = new DataCleanupService();

  try {
    // Only identify suspicious calls
    if (identifyOnly) {
      await cleanup.identifySuspiciousCalls();
      return;
    }

    // Only validate current state
    if (onlyValidate) {
      await cleanup.validateCleanupResults();
      return;
    }

    // Create backup if requested
    if (createBackup) {
      await cleanup.createBackup();
    }

    // Run main cleanup
    const stats = await cleanup.runFullCleanup(isDryRun);
    
    console.log('\n🎯 CLEANUP COMPLETED SUCCESSFULLY!');
    
    if (isDryRun) {
      console.log('\n💡 To apply changes, run: node data-cleanup.js --live');
    }

  } catch (error) {
    console.error('\n❌ CLEANUP FAILED:', error.message);
    process.exit(1);
  }
}

// Export for use as module
module.exports = DataCleanupService;

// Run if called directly
if (require.main === module) {
  runCleanup();
}
