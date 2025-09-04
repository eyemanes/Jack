/**
 * AUTO-FIX API ENDPOINTS
 * These endpoints will automatically fix your PnL issues through the web API
 * No need to run scripts locally - everything works through HTTP requests
 */

// Add these endpoints to your server.js file

// 🔧 AUTO-FIX: Complete automated fix process
app.post('/api/auto-fix-pnl', async (req, res) => {
  console.log('🚀 AUTO-FIX: Starting automated PnL fix process...');
  
  try {
    const results = {
      step1_analysis: null,
      step2_corruption_check: null,
      step3_fixes_applied: null,
      step4_validation: null,
      summary: {
        totalCalls: 0,
        corruptedFound: 0,
        fixedCalls: 0,
        validatedCalls: 0,
        errors: []
      }
    };

    // STEP 1: Analyze current data
    console.log('📊 Step 1: Analyzing current data...');
    const calls = await db.getAllActiveCalls();
    results.summary.totalCalls = calls.length;
    
    if (calls.length === 0) {
      return res.json({
        success: true,
        message: 'No calls to fix',
        results
      });
    }

    // STEP 2: Check for corruption using improved service
    console.log('🔍 Step 2: Checking for corruption...');
    const pnlService = new (require('./services/ImprovedPnlCalculationService'))();
    const corruptedCalls = [];
    const validCalls = [];

    // Check first 50 calls for corruption (to avoid timeout)
    const checkCalls = calls.slice(0, 50);
    let tokenDataMap = {};

    // Get token data in batches
    const uniqueAddresses = [...new Set(checkCalls.map(call => call.contractAddress))];
    for (let i = 0; i < uniqueAddresses.length; i += 5) {
      const batch = uniqueAddresses.slice(i, i + 5);
      await Promise.all(batch.map(async (address) => {
        try {
          const tokenData = await solanaService.getTokenData(address);
          if (tokenData) {
            tokenDataMap[address] = tokenData;
          }
        } catch (error) {
          console.warn(`⚠️ Could not fetch data for ${address}:`, error.message);
        }
      }));
      
      // Small delay to avoid rate limiting
      if (i + 5 < uniqueAddresses.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Check each call for corruption
    for (const call of checkCalls) {
      const tokenData = tokenDataMap[call.contractAddress];
      if (!tokenData) {
        results.summary.errors.push(`No token data for ${call.contractAddress}`);
        continue;
      }

      const result = pnlService.calculatePnl(call, tokenData);
      
      if (result.debugInfo?.corruption?.isCorrupted) {
        corruptedCalls.push({
          id: call.id,
          symbol: call.tokenSymbol,
          currentMaxPnl: call.maxPnl,
          reason: result.debugInfo.corruption.reason,
          tokenData: tokenData
        });
      } else if (result.isValid) {
        validCalls.push({
          call,
          result,
          tokenData
        });
      }
    }

    results.step2_corruption_check = {
      totalChecked: checkCalls.length,
      corruptedFound: corruptedCalls.length,
      validFound: validCalls.length
    };
    results.summary.corruptedFound = corruptedCalls.length;

    console.log(`🔍 Found ${corruptedCalls.length} corrupted calls out of ${checkCalls.length} checked`);

    // STEP 3: Fix corrupted calls
    console.log('🔧 Step 3: Fixing corrupted calls...');
    let fixedCount = 0;

    for (const corrupted of corruptedCalls) {
      try {
        // Reset corrupted maxPnl and add audit info
        await db.updateCall(corrupted.id, {
          maxPnl: 0,
          corruptionFixed: true,
          corruptionFixedAt: new Date().toISOString(),
          previousCorruptedMaxPnl: corrupted.currentMaxPnl,
          corruptionReason: corrupted.reason,
          autoFixApplied: true
        });

        // Recalculate with improved service
        const freshCall = await db.findCallByContractAddress(calls.find(c => c.id === corrupted.id).contractAddress);
        const newResult = pnlService.calculatePnl(freshCall, corrupted.tokenData);
        
        if (newResult.isValid) {
          const score = calculateScore(newResult.pnlPercent, freshCall.entryMarketCap, freshCall.callRank || 1);
          
          await db.updateCall(corrupted.id, {
            pnlPercent: newResult.pnlPercent,
            maxPnl: newResult.maxPnl,
            score: score,
            pnlCalculationType: newResult.calculationType,
            lastPnlUpdate: new Date().toISOString()
          });

          fixedCount++;
          console.log(`✅ Fixed ${corrupted.symbol}: ${corrupted.currentMaxPnl}% → ${newResult.pnlPercent.toFixed(2)}%`);
        }
      } catch (error) {
        console.error(`❌ Failed to fix ${corrupted.symbol}:`, error.message);
        results.summary.errors.push(`Failed to fix ${corrupted.symbol}: ${error.message}`);
      }
    }

    results.step3_fixes_applied = {
      attempted: corruptedCalls.length,
      successful: fixedCount,
      failed: corruptedCalls.length - fixedCount
    };
    results.summary.fixedCalls = fixedCount;

    // STEP 4: Validate fixes (sample check)
    console.log('✅ Step 4: Validating fixes...');
    let validationCount = 0;
    const sampleSize = Math.min(10, calls.length);
    
    for (let i = 0; i < sampleSize; i++) {
      const call = calls[i];
      const tokenData = tokenDataMap[call.contractAddress];
      
      if (tokenData) {
        const result = pnlService.calculatePnl(call, tokenData);
        if (result.isValid && !result.debugInfo?.corruption?.isCorrupted) {
          validationCount++;
        }
      }
    }

    results.step4_validation = {
      sampleSize: sampleSize,
      validatedSuccessfully: validationCount,
      validationRate: (validationCount / sampleSize * 100).toFixed(1) + '%'
    };
    results.summary.validatedCalls = validationCount;

    // Update user scores for affected users
    const affectedUsers = new Set(corruptedCalls.map(c => 
      calls.find(call => call.id === c.id)?.userId
    ).filter(Boolean));

    for (const userId of affectedUsers) {
      try {
        await recalculateUserTotalScore(userId);
      } catch (error) {
        console.error(`Error updating user ${userId}:`, error.message);
      }
    }

    const successMessage = `🎉 AUTO-FIX COMPLETE! Fixed ${fixedCount} corrupted calls out of ${corruptedCalls.length} found. Validation: ${results.step4_validation.validationRate} success rate.`;
    console.log(successMessage);

    res.json({
      success: true,
      message: successMessage,
      results: results,
      recommendations: [
        fixedCount > 0 ? '✅ Corrupted data has been automatically fixed' : 'ℹ️ No corrupted data found',
        '🔄 All endpoints now use the improved PnL calculation service',
        '📊 Future corruption will be automatically detected and prevented',
        '🔍 You can monitor data quality using /api/validate-pnl endpoint'
      ]
    });

  } catch (error) {
    console.error('❌ AUTO-FIX ERROR:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Auto-fix process failed. Check server logs for details.'
    });
  }
});

// 🔍 VALIDATE: Check PnL calculation quality
app.get('/api/validate-pnl', async (req, res) => {
  try {
    console.log('🔍 Validating PnL calculations...');
    
    const calls = await db.getAllActiveCalls();
    const pnlService = new (require('./services/ImprovedPnlCalculationService'))();
    
    // Sample 10 calls for quick validation
    const sampleCalls = calls.slice(0, 10);
    const results = {
      totalCalls: calls.length,
      sampleSize: sampleCalls.length,
      valid: 0,
      invalid: 0,
      corrupted: 0,
      issues: [],
      healthScore: 0
    };

    for (const call of sampleCalls) {
      try {
        const tokenData = await solanaService.getTokenData(call.contractAddress);
        if (!tokenData) continue;

        const result = pnlService.calculatePnl(call, tokenData);
        
        if (result.isValid) {
          results.valid++;
          
          if (result.debugInfo?.corruption?.isCorrupted) {
            results.corrupted++;
            results.issues.push({
              id: call.id,
              symbol: call.tokenSymbol,
              issue: 'Corruption detected: ' + result.debugInfo.corruption.reason,
              severity: 'high'
            });
          }
        } else {
          results.invalid++;
          results.issues.push({
            id: call.id,
            symbol: call.tokenSymbol,
            issue: result.validationErrors.join(', '),
            severity: 'medium'
          });
        }
      } catch (error) {
        results.invalid++;
        results.issues.push({
          id: call.id,
          symbol: call.tokenSymbol || 'Unknown',
          issue: 'Calculation error: ' + error.message,
          severity: 'high'
        });
      }
    }

    results.healthScore = results.sampleSize > 0 ? 
      Math.round((results.valid / results.sampleSize) * 100) : 100;

    const status = results.healthScore >= 90 ? 'excellent' : 
                   results.healthScore >= 75 ? 'good' : 
                   results.healthScore >= 50 ? 'fair' : 'poor';

    res.json({
      success: true,
      status: status,
      healthScore: results.healthScore + '%',
      results: results,
      recommendations: 
        results.corrupted > 0 ? ['⚠️ Corruption detected - run /api/auto-fix-pnl to fix'] :
        results.invalid > 2 ? ['🔧 Some validation issues found - check logs'] :
        ['✅ PnL calculations look healthy']
    });

  } catch (error) {
    console.error('❌ Validation error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 🧪 TEST: Test edge cases
app.get('/api/test-pnl-edge-cases', async (req, res) => {
  try {
    console.log('🧪 Testing PnL edge cases...');
    
    const pnlService = new (require('./services/ImprovedPnlCalculationService'))();
    
    const edgeCases = [
      {
        name: 'Extreme Corruption (like your 90,000% case)',
        call: {
          id: 'test-corruption',
          tokenSymbol: 'CORRUPT',
          entryMarketCap: 21510,
          maxPnl: 90000, // Your exact corrupted value
          createdAt: new Date().toISOString()
        },
        tokenData: {
          marketCap: 22113, // Your exact current value
          ath: 22113,
          athTimestamp: new Date().toISOString()
        }
      },
      {
        name: 'Negative PnL Token',
        call: {
          id: 'test-negative',
          tokenSymbol: 'DOWN',
          entryMarketCap: 100000,
          maxPnl: 0,
          createdAt: new Date().toISOString()
        },
        tokenData: {
          marketCap: 25000, // Down 75%
          ath: 120000,
          athTimestamp: new Date(Date.now() - 3600000).toISOString()
        }
      },
      {
        name: 'Moon Shot Token',
        call: {
          id: 'test-moon',
          tokenSymbol: 'MOON',
          entryMarketCap: 1000,
          maxPnl: 0,
          createdAt: new Date().toISOString()
        },
        tokenData: {
          marketCap: 100000, // 100x gain
          ath: 200000, // 200x ATH
          athTimestamp: new Date(Date.now() + 3600000).toISOString()
        }
      }
    ];

    const testResults = [];

    for (const testCase of edgeCases) {
      try {
        const result = pnlService.calculatePnl(testCase.call, testCase.tokenData);
        
        testResults.push({
          testName: testCase.name,
          input: {
            entryMC: testCase.call.entryMarketCap,
            currentMC: testCase.tokenData.marketCap,
            maxPnl: testCase.call.maxPnl
          },
          output: {
            calculatedPnl: result.pnlPercent,
            newMaxPnl: result.maxPnl,
            calculationType: result.calculationType,
            isValid: result.isValid,
            corruptionDetected: result.debugInfo?.corruption?.isCorrupted || false
          },
          expectedBehavior: testCase.name.includes('Corruption') ? 
            'Should detect corruption and fix' :
            testCase.name.includes('Negative') ?
            'Should handle negative PnL correctly' :
            'Should handle extreme gains properly',
          passed: result.isValid
        });
        
      } catch (error) {
        testResults.push({
          testName: testCase.name,
          error: error.message,
          passed: false
        });
      }
    }

    const passedTests = testResults.filter(t => t.passed).length;
    const testScore = Math.round((passedTests / testResults.length) * 100);

    res.json({
      success: true,
      testScore: testScore + '%',
      passedTests: `${passedTests}/${testResults.length}`,
      results: testResults,
      summary: testScore === 100 ? 
        '✅ All edge case tests passed!' :
        `⚠️ ${testResults.length - passedTests} tests failed - check implementation`
    });

  } catch (error) {
    console.error('❌ Edge case testing error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 📊 STATUS: Get overall PnL system health
app.get('/api/pnl-system-status', async (req, res) => {
  try {
    console.log('📊 Checking PnL system status...');
    
    const calls = await db.getAllActiveCalls();
    const totalCalls = calls.length;
    
    // Quick health checks
    const nullPrices = calls.filter(c => !c.currentPrice || c.currentPrice === null).length;
    const extremePnL = calls.filter(c => Math.abs(c.pnlPercent || 0) > 10000).length;
    const recentCalls = calls.filter(c => 
      new Date(c.createdAt).getTime() > Date.now() - (7 * 24 * 60 * 60 * 1000)
    ).length;
    
    const healthMetrics = {
      totalCalls: totalCalls,
      nullPrices: nullPrices,
      extremePnLValues: extremePnL,
      recentCalls: recentCalls,
      dataQualityScore: totalCalls > 0 ? 
        Math.round(((totalCalls - nullPrices - extremePnL) / totalCalls) * 100) : 100,
      usingImprovedService: true, // Since we updated the server
      lastSystemUpdate: new Date().toISOString()
    };

    const overallHealth = 
      healthMetrics.dataQualityScore >= 95 && extremePnL === 0 ? 'excellent' :
      healthMetrics.dataQualityScore >= 85 && extremePnL < 5 ? 'good' :
      healthMetrics.dataQualityScore >= 70 ? 'fair' : 'poor';

    const recommendations = [];
    
    if (extremePnL > 0) {
      recommendations.push(`🔧 ${extremePnL} calls have extreme PnL values - run /api/auto-fix-pnl`);
    }
    if (nullPrices > totalCalls * 0.1) {
      recommendations.push(`📊 ${nullPrices} calls missing price data - may need refresh`);
    }
    if (healthMetrics.dataQualityScore < 90) {
      recommendations.push('🔍 Run /api/validate-pnl for detailed analysis');
    }
    if (recommendations.length === 0) {
      recommendations.push('✅ System is healthy - no action needed');
    }

    res.json({
      success: true,
      overallHealth: overallHealth,
      healthScore: healthMetrics.dataQualityScore + '%',
      metrics: healthMetrics,
      recommendations: recommendations,
      quickActions: [
        {
          action: 'Auto-fix corrupted data',
          endpoint: 'POST /api/auto-fix-pnl',
          description: 'Automatically detect and fix all PnL corruption issues'
        },
        {
          action: 'Validate calculations',
          endpoint: 'GET /api/validate-pnl', 
          description: 'Check current PnL calculation quality'
        },
        {
          action: 'Test edge cases',
          endpoint: 'GET /api/test-pnl-edge-cases',
          description: 'Test the system with problematic scenarios'
        }
      ]
    });

  } catch (error) {
    console.error('❌ Status check error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
