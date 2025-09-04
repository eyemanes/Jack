/**
 * Validation and Testing Utility
 * Test and validate PnL calculations, run diagnostics, and verify data quality
 */

const FirebaseService = require('./services/FirebaseService');
const SolanaTrackerService = require('./services/SolanaTrackerService');
const ImprovedPnlCalculationService = require('./services/ImprovedPnlCalculationService');
const DataCleanupService = require('./data-cleanup');

class ValidationUtility {
  constructor() {
    this.db = new FirebaseService();
    this.solanaService = new SolanaTrackerService();
    this.pnlService = new ImprovedPnlCalculationService();
    this.cleanup = new DataCleanupService();
  }

  /**
   * VALIDATE CURRENT PNL CALCULATIONS - Test all calls
   */
  async validateCurrentCalculations() {
    console.log('🔍 Validating current PnL calculations...');
    
    const calls = await this.db.getAllActiveCalls();
    console.log(`Testing ${calls.length} calls...`);

    let validCount = 0;
    let invalidCount = 0;
    let corruptedCount = 0;
    const issues = [];

    // Test first 10 calls in detail
    const testCalls = calls.slice(0, 10);
    
    for (const call of testCalls) {
      try {
        const tokenData = await this.solanaService.getTokenData(call.contractAddress);
        if (!tokenData) {
          issues.push({
            callId: call.id,
            tokenSymbol: call.tokenSymbol,
            issue: 'No token data available',
            severity: 'high'
          });
          continue;
        }

        // Test with improved service
        const result = this.pnlService.calculatePnl(call, tokenData);
        
        console.log(`\n📋 Call: ${call.tokenSymbol} (${call.id})`);
        console.log(`   Current DB PnL: ${call.pnlPercent || 0}%`);
        console.log(`   Current DB maxPnL: ${call.maxPnl || 0}%`);
        console.log(`   Calculated PnL: ${result.pnlPercent.toFixed(2)}%`);
        console.log(`   Calculated maxPnL: ${result.maxPnl.toFixed(2)}%`);
        console.log(`   Calculation Type: ${result.calculationType}`);
        console.log(`   Valid: ${result.isValid}`);

        if (result.isValid) {
          validCount++;
          
          // Check for significant differences
          const currentPnL = parseFloat(call.pnlPercent) || 0;
          const difference = Math.abs(result.pnlPercent - currentPnL);
          
          if (difference > 50) { // More than 50% difference
            issues.push({
              callId: call.id,
              tokenSymbol: call.tokenSymbol,
              issue: `Large difference: DB has ${currentPnL}%, calculated ${result.pnlPercent.toFixed(2)}%`,
              severity: 'medium',
              difference: difference
            });
          }
        } else {
          invalidCount++;
          issues.push({
            callId: call.id,
            tokenSymbol: call.tokenSymbol,
            issue: `Invalid calculation: ${result.validationErrors.join(', ')}`,
            severity: 'high'
          });
        }

        if (result.debugInfo?.corruption?.isCorrupted) {
          corruptedCount++;
          console.log(`   ⚠️ CORRUPTION DETECTED: ${result.debugInfo.corruption.reason}`);
        }

        console.log(`   Validation Errors: ${result.validationErrors.length}`);
        if (result.validationErrors.length > 0) {
          result.validationErrors.forEach(error => console.log(`     - ${error}`));
        }

      } catch (error) {
        console.error(`❌ Error testing call ${call.id}:`, error.message);
        issues.push({
          callId: call.id,
          tokenSymbol: call.tokenSymbol || 'Unknown',
          issue: `Calculation error: ${error.message}`,
          severity: 'high'
        });
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`\n📊 VALIDATION SUMMARY:`);
    console.log(`Valid: ${validCount}`);
    console.log(`Invalid: ${invalidCount}`);
    console.log(`Corrupted: ${corruptedCount}`);
    console.log(`Issues found: ${issues.length}`);

    if (issues.length > 0) {
      console.log(`\n⚠️ ISSUES FOUND:`);
      issues.forEach((issue, index) => {
        console.log(`${index + 1}. ${issue.tokenSymbol}: ${issue.issue} [${issue.severity}]`);
      });
    }

    return {
      totalTested: testCalls.length,
      valid: validCount,
      invalid: invalidCount,
      corrupted: corruptedCount,
      issues: issues
    };
  }

  /**
   * COMPARE OLD VS NEW CALCULATION METHODS
   */
  async compareCalculationMethods() {
    console.log('⚖️ Comparing old vs new calculation methods...');
    
    const calls = await this.db.getAllActiveCalls();
    const testCalls = calls.slice(0, 5); // Test 5 calls

    const comparisons = [];

    for (const call of testCalls) {
      try {
        const tokenData = await this.solanaService.getTokenData(call.contractAddress);
        if (!tokenData) continue;

        // New method
        const newResult = this.pnlService.calculatePnl(call, tokenData);
        
        // Current database value
        const currentPnL = parseFloat(call.pnlPercent) || 0;

        const comparison = {
          tokenSymbol: call.tokenSymbol,
          callId: call.id,
          database: currentPnL,
          improved: newResult.pnlPercent,
          difference: Math.abs(newResult.pnlPercent - currentPnL),
          percentChange: currentPnL !== 0 ? ((newResult.pnlPercent - currentPnL) / Math.abs(currentPnL)) * 100 : 0,
          calculationType: newResult.calculationType,
          isValid: newResult.isValid,
          issues: newResult.validationErrors
        };

        comparisons.push(comparison);

        console.log(`\n📊 ${call.tokenSymbol}:`);
        console.log(`   Database: ${currentPnL.toFixed(2)}%`);
        console.log(`   Improved: ${newResult.pnlPercent.toFixed(2)}%`);
        console.log(`   Difference: ${comparison.difference.toFixed(2)}%`);
        console.log(`   Type: ${newResult.calculationType}`);
        console.log(`   Valid: ${newResult.isValid}`);

      } catch (error) {
        console.error(`❌ Error comparing ${call.tokenSymbol}:`, error.message);
      }

      await new Promise(resolve => setTimeout(resolve, 200));
    }

    console.log(`\n📈 COMPARISON SUMMARY:`);
    const avgDifference = comparisons.reduce((sum, c) => sum + c.difference, 0) / comparisons.length;
    const significantDifferences = comparisons.filter(c => c.difference > 10);
    
    console.log(`Average difference: ${avgDifference.toFixed(2)}%`);
    console.log(`Significant differences (>10%): ${significantDifferences.length}`);
    console.log(`Valid calculations: ${comparisons.filter(c => c.isValid).length}/${comparisons.length}`);

    return comparisons;
  }

  /**
   * TEST EDGE CASES - Test specific problematic scenarios
   */
  async testEdgeCases() {
    console.log('🧪 Testing edge cases...');

    const edgeCases = [
      {
        name: 'Extreme maxPnl corruption',
        call: {
          id: 'test-1',
          tokenSymbol: 'TEST1',
          entryMarketCap: 10000,
          maxPnl: 90000, // Corrupted value like in your logs
          createdAt: new Date().toISOString()
        },
        tokenData: {
          marketCap: 12000,
          ath: 15000,
          athTimestamp: new Date(Date.now() + 3600000).toISOString() // 1 hour later
        }
      },
      {
        name: 'Negative PnL token',
        call: {
          id: 'test-2',
          tokenSymbol: 'TEST2',
          entryMarketCap: 100000,
          maxPnl: 0,
          createdAt: new Date().toISOString()
        },
        tokenData: {
          marketCap: 25000, // Down 75%
          ath: 120000,
          athTimestamp: new Date(Date.now() - 3600000).toISOString() // 1 hour before
        }
      },
      {
        name: 'Moon shot token',
        call: {
          id: 'test-3',
          tokenSymbol: 'MOON',
          entryMarketCap: 1000,
          maxPnl: 0,
          createdAt: new Date().toISOString()
        },
        tokenData: {
          marketCap: 50000, // 50x gain
          ath: 100000, // 100x ATH
          athTimestamp: new Date(Date.now() + 7200000).toISOString() // 2 hours later
        }
      }
    ];

    for (const testCase of edgeCases) {
      console.log(`\n🧪 Testing: ${testCase.name}`);
      
      try {
        const result = this.pnlService.calculatePnl(testCase.call, testCase.tokenData);
        
        console.log(`   Result: ${result.pnlPercent.toFixed(2)}% (${result.calculationType})`);
        console.log(`   Max PnL: ${result.maxPnl.toFixed(2)}%`);
        console.log(`   Valid: ${result.isValid}`);
        console.log(`   Corruption detected: ${result.debugInfo?.corruption?.isCorrupted || false}`);
        
        if (result.validationErrors.length > 0) {
          console.log(`   Validation errors:`);
          result.validationErrors.forEach(error => console.log(`     - ${error}`));
        }
      } catch (error) {
        console.error(`   ❌ Error: ${error.message}`);
      }
    }
  }

  /**
   * RUN ALL DIAGNOSTICS
   */
  async runFullDiagnostics() {
    console.log('🚀 Running full diagnostics suite...');
    
    try {
      console.log('\n' + '='.repeat(50));
      const validation = await this.validateCurrentCalculations();
      
      console.log('\n' + '='.repeat(50));
      await this.compareCalculationMethods();
      
      console.log('\n' + '='.repeat(50));
      await this.testEdgeCases();
      
      console.log('\n' + '='.repeat(50));
      console.log('🎯 DIAGNOSTICS COMPLETE!');
      console.log(`Validation: ${validation.valid}/${validation.totalTested} valid`);
      
      return { validation };
    } catch (error) {
      console.error('❌ Diagnostics failed:', error);
      throw error;
    }
  }
}

// CLI Interface
async function runValidation() {
  const args = process.argv.slice(2);
  const validator = new ValidationUtility();

  console.log('🧪 PnL Validation Tool Started');
  console.log('Arguments:', args);

  try {
    if (args.includes('--validate')) {
      await validator.validateCurrentCalculations();
    } else if (args.includes('--compare')) {
      await validator.compareCalculationMethods();
    } else if (args.includes('--edge-cases')) {
      await validator.testEdgeCases();
    } else if (args.includes('--full')) {
      await validator.runFullDiagnostics();
    } else {
      console.log('\nAvailable options:');
      console.log('  --validate       Validate current PnL calculations');
      console.log('  --compare        Compare old vs new methods');
      console.log('  --edge-cases     Test edge cases');
      console.log('  --full           Run all diagnostics');
      
      // Run basic validation by default
      await validator.validateCurrentCalculations();
    }
  } catch (error) {
    console.error('❌ Validation failed:', error.message);
    process.exit(1);
  }
}

// Export for use as module
module.exports = ValidationUtility;

// Run if called directly
if (require.main === module) {
  runValidation();
}
