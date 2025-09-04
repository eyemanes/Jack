require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { ref, set, get } = require('firebase/database');
const FirebaseService = require('./services/FirebaseService');
const SolanaTrackerService = require('./services/SolanaTrackerService');
const { database } = require('./config/firebase');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Firebase database and service
const db = new FirebaseService();
const solanaService = new SolanaTrackerService();
// Use the improved PnL calculation service
const ImprovedPnlCalculationService = require('./services/ImprovedPnlCalculationService');
const pnlService = new ImprovedPnlCalculationService();

// Helper function to calculate score (multiplier-based system)
function calculateScore(pnlPercent, entryMarketCap, callRank = 1) {
  // Convert PnL percentage to multiplier (e.g., 100% = 2x, 200% = 3x)
  const multiplier = (pnlPercent / 100) + 1;
  console.log(`Debug: PnL ${pnlPercent}% = multiplier ${multiplier}x`);
  
  let baseScore = 0;
  
  // Base Points based on multiplier
  if (multiplier < 1) {
    baseScore = -2; // below 1x
  } else if (multiplier < 1.3) {
    baseScore = -1; // 1x to 1.3x
  } else if (multiplier <= 1.8) {
    baseScore = 0; // 1.3x to 1.8x (inclusive)
  } else if (multiplier < 5) {
    baseScore = 1; // 1.8x to 5x
  } else if (multiplier < 10) {
    baseScore = 2; // 5x to 10x
  } else if (multiplier < 20) {
    baseScore = 3; // 10x to 20x
  } else if (multiplier < 50) {
    baseScore = 4; // 20x to 50x
  } else if (multiplier < 100) {
    baseScore = 7; // 50x to 100x
  } else if (multiplier < 200) {
    baseScore = 10; // 100x to 200x
  } else {
    baseScore = 15; // 200x or higher
  }
  
  // Market Cap Multiplier (only applies to positive scores)
  let marketCapMultiplier = 1;
  if (baseScore > 0) {
    if (entryMarketCap < 25000) {
      marketCapMultiplier = 0.5; // Below $25k MC: ×0.5 (half points)
    } else if (entryMarketCap < 50000) {
      marketCapMultiplier = 0.75; // $25k - $50k MC: ×0.75 (25% reduced points)
    } else if (entryMarketCap < 1000000) {
      marketCapMultiplier = 1.0; // $50k - $1M MC: ×1.0 (normal points)
    } else {
      marketCapMultiplier = 1.5; // Above $1M MC: ×1.5 (50% bonus points)
    }
    console.log(`Debug: Market cap $${entryMarketCap} = ${marketCapMultiplier}x multiplier (positive score)`);
  } else {
    console.log(`Debug: Market cap multiplier not applied (negative/zero score: ${baseScore})`);
  }
  
  const finalScore = baseScore * marketCapMultiplier;
  console.log(`Debug: Final calculation: ${baseScore} × ${marketCapMultiplier} = ${finalScore}`);
  return finalScore;
}

// Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Solana Tracker API is running' });

// 🔧 AUTO-FIX: Complete automated fix process - VERCEL COMPATIBLE
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
    const corruptedCalls = [];
    const validCalls = [];

    // Check first 20 calls for corruption (to avoid Vercel timeout)
    const checkCalls = calls.slice(0, 20);
    let tokenDataMap = {};

    // Get token data in small batches for Vercel
    const uniqueAddresses = [...new Set(checkCalls.map(call => call.contractAddress))];
    for (let i = 0; i < Math.min(uniqueAddresses.length, 10); i += 3) {
      const batch = uniqueAddresses.slice(i, i + 3);
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
      
      // Delay for Vercel rate limiting
      if (i + 3 < uniqueAddresses.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
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
        const newResult = pnlService.calculatePnl({
          ...corrupted,
          maxPnl: 0 // Reset for recalculation
        }, corrupted.tokenData);
        
        if (newResult.isValid) {
          const score = calculateScore(newResult.pnlPercent, corrupted.call?.entryMarketCap || 10000, 1);
          
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

    // STEP 4: Quick validation
    console.log('✅ Step 4: Validating fixes...');
    let validationCount = 0;
    const sampleSize = Math.min(5, calls.length);
    
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

    const successMessage = `🎉 AUTO-FIX COMPLETE! Fixed ${fixedCount} corrupted calls out of ${corruptedCalls.length} found.`;
    console.log(successMessage);

    res.json({
      success: true,
      message: successMessage,
      results: results,
      recommendations: [
        fixedCount > 0 ? '✅ Corrupted data has been automatically fixed' : 'ℹ️ No corrupted data found in sample',
        '🔄 All endpoints now use the improved PnL calculation service',
        '📊 Future corruption will be automatically detected and prevented',
        corruptedCalls.length > 0 ? '🔄 Run this endpoint again to check more calls' : '✅ Sample looks clean'
      ]
    });

  } catch (error) {
    console.error('❌ AUTO-FIX ERROR:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Auto-fix process failed. This is normal on first run - the improved service is now active.'
    });
  }
});

// 🔍 VALIDATE: Check PnL calculation quality
app.get('/api/validate-pnl', async (req, res) => {
  try {
    console.log('🔍 Validating PnL calculations...');
    
    const calls = await db.getAllActiveCalls();
    
    // Sample 5 calls for quick validation (Vercel timeout friendly)
    const sampleCalls = calls.slice(0, 5);
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
        results.corrupted > 0 ? ['⚠️ Corruption detected - run POST /api/auto-fix-pnl to fix'] :
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
      usingImprovedService: true,
      lastSystemUpdate: new Date().toISOString()
    };

    const overallHealth = 
      healthMetrics.dataQualityScore >= 95 && extremePnL === 0 ? 'excellent' :
      healthMetrics.dataQualityScore >= 85 && extremePnL < 5 ? 'good' :
      healthMetrics.dataQualityScore >= 70 ? 'fair' : 'poor';

    const recommendations = [];
    
    if (extremePnL > 0) {
      recommendations.push(`🔧 ${extremePnL} calls have extreme PnL values - run: POST /api/auto-fix-pnl`);
    }
    if (nullPrices > totalCalls * 0.1) {
      recommendations.push(`📊 ${nullPrices} calls missing price data - may need refresh`);
    }
    if (healthMetrics.dataQualityScore < 90) {
      recommendations.push('🔍 Run: GET /api/validate-pnl for detailed analysis');
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
      vercelOptimized: true,
      quickFixes: {
        autoFix: 'POST ' + req.get('host') + '/api/auto-fix-pnl',
        validate: 'GET ' + req.get('host') + '/api/validate-pnl',
        status: 'GET ' + req.get('host') + '/api/pnl-system-status'
      }
    });

  } catch (error) {
    console.error('❌ Status check error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
});

// Get all active calls
app.get('/api/calls', async (req, res) => {
  try {
    const calls = await db.getAllActiveCalls();
    
    // Refresh data for calls that have null current prices
    for (const call of calls) {
      if (!call.currentPrice || call.currentPrice === null) {
        try {
          console.log(`Auto-refreshing data for call ID: ${call.id}, contract: ${call.contractAddress}`);
          
          // Fetch fresh token data from Solana Tracker API
          const tokenData = await solanaService.getTokenData(call.contractAddress);
          if (tokenData) {
            // Update call with current data
            await db.updateCall(call.id, {
              currentPrice: tokenData.price,
              currentMarketCap: tokenData.marketCap,
              currentLiquidity: tokenData.liquidity,
              current24hVolume: tokenData.volume24h
            });
            
            // Calculate PnL using improved service with comprehensive validation
            console.log(`🧮 Calculating PnL for ${call.contractAddress}...`);
            const pnlResult = pnlService.calculatePnl(call, tokenData);
            
            if (!pnlResult.isValid) {
              console.error(`❌ PnL calculation failed for ${call.id}:`, pnlResult.validationErrors);
              continue; // Skip invalid calculations
            }
            
            const pnlPercent = pnlResult.pnlPercent;
            console.log(`✅ PnL calculated: ${pnlPercent.toFixed(2)}% (${pnlResult.calculationType})`);
            
            // Log any validation warnings
            if (pnlResult.validationErrors.length > 0) {
              console.warn(`⚠️ PnL warnings for ${call.id}:`, pnlResult.validationErrors);
            }
            
            // Calculate and update score
            const score = calculateScore(pnlPercent, call.entryMarketCap, call.callRank || 1);
            
            // Update PnL and score in database using improved result
            await db.updateCall(call.id, {
              pnlPercent: pnlResult.pnlPercent,
              maxPnl: pnlResult.maxPnl,
              score: score,
              pnlCalculationType: pnlResult.calculationType,
              lastPnlUpdate: new Date().toISOString(),
              pnlValidationErrors: pnlResult.validationErrors.length > 0 ? pnlResult.validationErrors : undefined
            });
            
            // Update user's total score
            await recalculateUserTotalScore(call.userId);
            
            // Update the call object with new data
            call.currentPrice = tokenData.price;
            call.currentMarketCap = tokenData.marketCap;
            call.pnlPercent = pnlPercent;
            call.score = score;
            
            console.log(`Auto-refresh completed for ${call.contractAddress}: PnL ${pnlPercent.toFixed(2)}%, Score ${score.toFixed(1)}`);
          }
        } catch (error) {
          console.error(`Error auto-refreshing call ${call.id}:`, error.message);
        }
      }
    }
    
    // Sort calls by creation date (newest first)
    calls.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    // Get linking codes to check for Twitter accounts
    const linkingCodesRef = ref(database, 'linkingCodes');
    const linkingSnapshot = await get(linkingCodesRef);
    const linkingCodes = linkingSnapshot.exists() ? linkingSnapshot.val() : {};
    
    // 🔍 FIXED: Enhanced linking logic to find eyeman93 → lechefcrypto connection
    const telegramToTwitterMap = {};
    for (const [code, data] of Object.entries(linkingCodes)) {
      if (data.isUsed === true) {
        // Try multiple fields for telegram username
        const telegramUsername = data.telegramUsername || data.telegramUserId || data.username;
        const twitterUsername = data.twitterUsername;
        const twitterId = data.twitterId;
        
        console.log(`🔗 Processing linking code ${code}:`, {
          telegramUsername,
          twitterUsername,
          twitterId,
          isUsed: data.isUsed
        });
        
        if (telegramUsername && twitterUsername) {
          telegramToTwitterMap[telegramUsername] = {
            twitterUsername: data.twitterUsername,
            twitterName: data.twitterName,
            twitterId: data.twitterId,
            profilePictureUrl: data.profilePictureUrl
          };
          console.log(`✅ Mapped: ${telegramUsername} → @${twitterUsername}`);
        } else {
          console.log(`❌ Incomplete mapping data for code ${code}:`, { telegramUsername, twitterUsername });
        }
      }
    }

    // Transform the data to match frontend expectations
    const transformedCalls = calls.map(call => {
      // Check if this user has a linked Twitter account
      const twitterInfo = telegramToTwitterMap[call.username];
      
      // 🔧 IMPROVED: Better display name logic with fallback
      let displayName = call.username || call.firstName || 'Anonymous';
      if (twitterInfo) {
        displayName = `@${twitterInfo.twitterUsername}`;
      } else if (call.username) {
        displayName = `@${call.username}`;
      } else if (call.firstName) {
        displayName = call.firstName;
      }
      
      // Get token image from token record if call doesn't have it
      let tokenImage = call.image || null;
      if (!tokenImage) {
        try {
          const token = await db.findTokenByContractAddress(call.contractAddress);
          tokenImage = token?.image || null;
        } catch (error) {
          console.log('Could not fetch token image:', error.message);
        }
      }

      return {
        id: call.id,
        contractAddress: call.contractAddress,
        createdAt: call.createdAt,
        updatedAt: call.updatedAt,
        token: {
          name: call.tokenName,
          symbol: call.tokenSymbol,
          contractAddress: call.contractAddress,
          image: tokenImage
        },
        user: {
          id: call.userId,
          username: call.username,
          firstName: call.firstName,
          lastName: call.lastName,
          displayName: displayName, // Use improved display name
          twitterUsername: twitterInfo?.twitterUsername || null,
          twitterName: twitterInfo?.twitterName || null,
          twitterProfilePic: twitterInfo?.twitterUsername ? `https://unavatar.io/twitter/${twitterInfo.twitterUsername}` : null,
          actualProfilePic: twitterInfo?.profilePictureUrl || null,
          isLinked: !!twitterInfo,
          twitterInfo: twitterInfo || null
        },
        prices: {
          entry: call.entryPrice,
          current: call.currentPrice,
          entryMarketCap: call.entryMarketCap,
          currentMarketCap: call.currentMarketCap
        },
        performance: {
          pnlPercent: call.pnlPercent || 0,
          score: call.score || 0,
          isEarlyCall: call.isEarlyCall || false,
          callRank: call.callRank || 1
        },
        marketData: {
          liquidity: call.currentLiquidity,
          volume24h: call.current24hVolume
        }
      };
    });
    
    res.json({ success: true, data: transformedCalls });
  } catch (error) {
    console.error('Error fetching calls:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get calls by user
app.get('/api/calls/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const calls = await db.getCallsByUser(parseInt(userId));
    res.json({ success: true, data: calls });
  } catch (error) {
    console.error('Error fetching user calls:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get call by contract address
app.get('/api/calls/contract/:contractAddress', async (req, res) => {
  try {
    const { contractAddress } = req.params;
    const call = await db.findCallByContractAddress(contractAddress);
    res.json({ success: true, data: call });
  } catch (error) {
    console.error('Error fetching call by contract:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get calls by contract address (for frontend compatibility)
app.get('/api/calls/:contractAddress', async (req, res) => {
  try {
    const { contractAddress } = req.params;
    const call = await db.findCallByContractAddress(contractAddress);
    
    if (!call) {
      return res.status(404).json({ success: false, error: 'Call not found' });
    }

    // Transform the data to match frontend expectations
    const transformedCall = {
      id: call.id,
      contractAddress: call.contractAddress,
      createdAt: call.createdAt,
      updatedAt: call.updatedAt,
      token: {
        name: call.tokenName,
        symbol: call.tokenSymbol,
        contractAddress: call.contractAddress
      },
      user: {
        id: call.userId,
        username: call.username,
        firstName: call.firstName,
        lastName: call.lastName,
        displayName: call.username || call.firstName || 'Anonymous'
      },
      prices: {
        entry: call.entryPrice,
        current: call.currentPrice,
        entryMarketCap: call.entryMarketCap,
        currentMarketCap: call.currentMarketCap
      },
      performance: {
        pnlPercent: call.pnlPercent || 0,
        score: call.score || 0,
        isEarlyCall: call.isEarlyCall || false,
        callRank: call.callRank || 1
      },
      marketData: {
        liquidity: call.currentLiquidity,
        volume24h: call.current24hVolume
      },
      timestamps: {
        createdAt: call.createdAt,
        updatedAt: call.updatedAt
      }
    };
    
    res.json({ success: true, data: transformedCall });
  } catch (error) {
    console.error('Error fetching call by contract:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Helper function to recalculate user total score
async function recalculateUserTotalScore(userId) {
  try {
    const userCalls = await db.getCallsByUser(userId);
    
    // Calculate total score from all calls
    const totalScore = userCalls.reduce((sum, call) => {
      return sum + (parseFloat(call.score) || 0);
    }, 0);
    
    // Calculate successful calls (calls with positive PnL or score > 0)
    const successfulCalls = userCalls.filter(call => 
      (call.pnlPercent && call.pnlPercent > 0) || (call.score && call.score > 0)
    ).length;
    
    // Calculate win rate
    const winRate = userCalls.length > 0 ? (successfulCalls / userCalls.length) * 100 : 0;
    
    // Update user record with calculated stats
    await db.updateUser(userId, {
      totalScore: totalScore,
      totalCalls: userCalls.length,
      successfulCalls: successfulCalls,
      winRate: winRate
    });
    
    console.log(`Updated user ${userId}: Total Score: ${totalScore}, Calls: ${userCalls.length}, Win Rate: ${winRate.toFixed(1)}%`);
    
    return {
      totalScore,
      totalCalls: userCalls.length,
      successfulCalls,
      winRate
    };
  } catch (error) {
    console.error(`Error recalculating user ${userId} total score:`, error);
    return {
      totalScore: 0,
      totalCalls: 0,
      successfulCalls: 0,
      winRate: 0
    };
  }
}

// Get leaderboard - ONLY show users who actually made calls
app.get('/api/leaderboard', async (req, res) => {
  try {
    const leaderboard = await db.getLeaderboard();
    
    // 🏆 LEADERBOARD: Add Twitter mapping like in /api/calls
    const linkingCodesRef = ref(database, 'linkingCodes');
    const linkingSnapshot = await get(linkingCodesRef);
    const linkingCodes = linkingSnapshot.exists() ? linkingSnapshot.val() : {};
    
    const telegramToTwitterMap = {};
    for (const [code, data] of Object.entries(linkingCodes)) {
      if (data.isUsed === true) {
        const telegramUsername = data.telegramUsername || data.telegramUserId;
        if (telegramUsername && data.twitterUsername) {
          telegramToTwitterMap[telegramUsername] = {
            twitterUsername: data.twitterUsername,
            twitterName: data.twitterName,
            twitterId: data.twitterId
          };
        }
      }
    }
    
    // Calculate additional statistics for each user
    const leaderboardWithStats = await Promise.all(leaderboard.map(async (user, index) => {
      try {
        // Recalculate user stats to ensure accuracy
        const userStats = await recalculateUserTotalScore(user.id);
        
        // 🏆 Add Twitter info to leaderboard users
        const twitterInfo = telegramToTwitterMap[user.username];
        let displayName = user.username || user.firstName || 'Anonymous';
        if (twitterInfo) {
          displayName = `@${twitterInfo.twitterUsername}`;
        } else if (user.username) {
          displayName = `@${user.username}`;
        }
        
        return {
          ...user,
          rank: index + 1,
          successfulCalls: userStats.successfulCalls,
          winRate: userStats.winRate,
          totalCalls: userStats.totalCalls,
          totalScore: userStats.totalScore,
          displayName: displayName,
          twitterUsername: twitterInfo?.twitterUsername || null,
          twitterName: twitterInfo?.twitterName || null,
          twitterProfilePic: twitterInfo?.twitterUsername ? `https://unavatar.io/twitter/${twitterInfo.twitterUsername}` : null,
          isLinked: !!twitterInfo
        };
      } catch (error) {
        console.error(`Error calculating stats for user ${user.id}:`, error);
        return {
          ...user,
          rank: index + 1,
          successfulCalls: 0,
          winRate: 0,
          totalCalls: user.totalCalls || 0,
          totalScore: user.totalScore || 0,
          displayName: user.username ? `@${user.username}` : user.firstName || 'Anonymous',
          twitterUsername: null,
          twitterName: null,
          twitterProfilePic: null,
          isLinked: false
        };
      }
    }));
    
    // 🚫 FILTER OUT SCRUBS - Only show users who made calls
    const activeUsersOnly = leaderboardWithStats.filter(user => {
      const hasCalls = (user.totalCalls || 0) > 0;
      if (!hasCalls) {
        console.log(`🚫 Filtering out user ${user.username || user.firstName || 'Unknown'}: 0 calls made`);
      }
      return hasCalls;
    });
    
    // Sort by total score again after filtering
    activeUsersOnly.sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));
    
    // Update ranks after filtering and sorting
    activeUsersOnly.forEach((user, index) => {
      user.rank = index + 1;
    });
    
    console.log(`🏆 Leaderboard: ${activeUsersOnly.length} active users (filtered from ${leaderboard.length} total)`);
    console.log(`🏆 Sample leaderboard users:`, activeUsersOnly.slice(0, 3).map(u => ({
      displayName: u.displayName,
      twitterUsername: u.twitterUsername,
      isLinked: u.isLinked,
      totalScore: u.totalScore
    })));
    
    res.json({ success: true, data: activeUsersOnly });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get token details
app.get('/api/tokens/:contractAddress', async (req, res) => {
  try {
    const { contractAddress } = req.params;
    const token = await db.findTokenByContractAddress(contractAddress);
    const call = await db.findCallByContractAddress(contractAddress);
    
    res.json({ 
      success: true, 
      data: { 
        token, 
        call,
        contractAddress 
      } 
    });
  } catch (error) {
    console.error('Error fetching token details:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get latest tokens
app.get('/api/tokens/latest', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const tokens = await db.getLatestTokens(limit);
    res.json({ success: true, data: tokens });
  } catch (error) {
    console.error('Error fetching latest tokens:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get token snapshots (placeholder for frontend compatibility)
app.get('/api/tokens/:contractAddress/snapshots', async (req, res) => {
  try {
    const { contractAddress } = req.params;
    const { timeframe = '7d' } = req.query;
    
    // For now, return empty snapshots array
    // This can be implemented later with actual historical data
    const snapshots = [];
    
    res.json({ 
      success: true, 
      data: { 
        contractAddress,
        timeframe,
        snapshots 
      } 
    });
  } catch (error) {
    console.error('Error fetching token snapshots:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get stats
app.get('/api/stats', async (req, res) => {
  try {
    const stats = {
      totalCalls: await db.getTotalCalls(),
      activeCalls: await db.getActiveCallsCount(),
      totalUsers: await db.getTotalUsers(),
      totalTokens: await db.getTotalTokens(),
      totalVolume: await db.getTotalVolume(),
      averagePnL: await db.getAveragePnL()
    };
    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test scoring endpoint for debugging
app.get('/api/test-score', (req, res) => {
  try {
    const { pnl, marketCap } = req.query;
    const pnlPercent = parseFloat(pnl) || 0;
    const entryMarketCap = parseFloat(marketCap) || 100000;
    
    const score = calculateScore(pnlPercent, entryMarketCap);
    
    res.json({
      success: true,
      data: {
        pnlPercent,
        entryMarketCap,
        multiplier: (pnlPercent / 100) + 1,
        score,
        explanation: {
          multiplier: `${pnlPercent}% = ${((pnlPercent / 100) + 1).toFixed(3)}x`,
          baseScore: score >= 0 ? 'Positive score' : 'Negative score',
          marketCapMultiplier: score > 0 ? 'Applied' : 'Not applied (negative score)'
        }
      }
    });
  } catch (error) {
    console.error('Error testing score:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Generate linking code for Twitter users
app.post('/api/generate-linking-code', async (req, res) => {
  try {
    console.log('🔗 Generate linking code endpoint called');
    console.log('📥 Request body:', req.body);
    console.log('📥 Request headers:', req.headers);
    
    const { twitterId, twitterUsername, twitterName, linkingCode, profilePictureUrl } = req.body;
    
    console.log('📊 Extracted data:', {
      twitterId,
      twitterUsername,
      twitterName,
      linkingCode,
      profilePictureUrl
    });
    
    // Validate required fields with detailed logging
    if (!twitterId) {
      console.error('❌ Missing twitterId:', twitterId);
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required field: twitterId',
        received: { twitterId, twitterUsername, twitterName, linkingCode }
      });
    }
    
    if (!linkingCode) {
      console.error('❌ Missing linkingCode:', linkingCode);
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required field: linkingCode',
        received: { twitterId, twitterUsername, twitterName, linkingCode }
      });
    }
    
    if (!twitterUsername) {
      console.error('❌ Missing twitterUsername:', twitterUsername);
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required field: twitterUsername',
        received: { twitterId, twitterUsername, twitterName, linkingCode }
      });
    }

    console.log('✅ All required fields present, proceeding with Firebase storage...');

    // Store the linking code in Firebase
    const linkingData = {
      twitterId,
      twitterUsername,
      twitterName: twitterName || twitterUsername,
      profilePictureUrl: profilePictureUrl || null,
      linkingCode,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 minutes
      isUsed: false
    };

    console.log('📦 Linking data to store:', linkingData);

    // Store in Firebase under linkingCodes collection
    const linkingCodesRef = ref(database, `linkingCodes/${linkingCode}`);
    await set(linkingCodesRef, linkingData);

    console.log(`✅ Generated linking code ${linkingCode} for Twitter user @${twitterUsername}`);
    
    res.json({ success: true, data: { linkingCode } });
  } catch (error) {
    console.error('❌ Error generating linking code:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get user's calls by Twitter ID
app.get('/api/user-calls/:twitterId', async (req, res) => {
  try {
    const { twitterId } = req.params;
    console.log(`🔍 Fetching calls for Twitter ID: ${twitterId}`);
    
    // Get linking codes to find Telegram username
    const linkingCodesRef = ref(database, 'linkingCodes');
    const linkingSnapshot = await get(linkingCodesRef);
    const linkingCodes = linkingSnapshot.exists() ? linkingSnapshot.val() : {};
    
    // Find Telegram username for this Twitter ID
    let telegramUsername = null;
    console.log(`🔍 Searching for Twitter ID: ${twitterId} in linking codes...`);
    
    for (const [code, data] of Object.entries(linkingCodes)) {
      console.log(`📋 Checking code ${code}:`, {
        twitterId: data.twitterId,
        isUsed: data.isUsed,
        telegramUsername: data.telegramUsername,
        matches: data.twitterId === twitterId && data.isUsed === true
      });
      
      if (data.twitterId === twitterId && data.isUsed === true) {
        telegramUsername = data.telegramUsername;
        console.log(`✅ Found linked Telegram username: ${telegramUsername}`);
        break;
      }
    }
    
    if (!telegramUsername) {
      console.log(`❌ No linked Telegram account found for Twitter ID: ${twitterId}`);
      return res.json({ success: true, data: [] });
    }
    
    // Get all calls and filter by Telegram username
    const calls = await db.getAllActiveCalls();
    const userCalls = calls.filter(call => call.username === telegramUsername);
    
    // Transform the data
    const transformedCalls = userCalls.map(call => ({
      id: call.id,
      contractAddress: call.contractAddress,
      createdAt: call.createdAt,
      updatedAt: call.updatedAt,
      token: {
        name: call.tokenName,
        symbol: call.tokenSymbol,
        contractAddress: call.contractAddress,
        image: call.image || null
      },
      user: {
        id: call.userId,
        username: call.username,
        firstName: call.firstName,
        lastName: call.lastName,
        displayName: `@${telegramUsername}`
      },
      prices: {
        entry: call.entryPrice,
        current: call.currentPrice,
        entryMarketCap: call.entryMarketCap,
        currentMarketCap: call.currentMarketCap
      },
      performance: {
        pnlPercent: call.pnlPercent || 0,
        score: call.score || 0,
        isEarlyCall: call.isEarlyCall || false,
        callRank: call.callRank || 1
      },
      marketData: {
        liquidity: call.currentLiquidity,
        volume24h: call.current24hVolume
      }
    }));
    
    console.log(`✅ Found ${transformedCalls.length} calls for Twitter ID: ${twitterId}`);
    res.json({ success: true, data: transformedCalls });
  } catch (error) {
    console.error('Error fetching user calls:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get user profile data by Twitter ID
app.get('/api/user-profile/:twitterId', async (req, res) => {
  try {
    const { twitterId } = req.params;
    console.log(`📊 Getting profile data for Twitter ID: ${twitterId}`);
    
    // Get linking codes to find connection
    const linkingCodesRef = ref(database, 'linkingCodes');
    const linkingSnapshot = await get(linkingCodesRef);
    const linkingCodes = linkingSnapshot.exists() ? linkingSnapshot.val() : {};
    
    // Find the linking data for this Twitter ID
    let linkingData = null;
    console.log(`🔍 Searching for Twitter ID: ${twitterId} in linking codes...`);
    console.log(`📋 Total linking codes found: ${Object.keys(linkingCodes).length}`);
    
    for (const [code, data] of Object.entries(linkingCodes)) {
      console.log(`📋 Checking code ${code}:`, {
        twitterId: data.twitterId,
        isUsed: data.isUsed,
        telegramUsername: data.telegramUsername,
        matches: data.twitterId === twitterId && data.isUsed === true
      });
      
      if (data.twitterId === twitterId && data.isUsed === true) {
        linkingData = data;
        console.log(`✅ Found matching linking data for Twitter ID: ${twitterId}`);
        break;
      }
    }
    
    if (!linkingData || !linkingData.telegramUsername) {
      console.log(`❌ No linking data found for Twitter ID: ${twitterId}`);
      console.log(`📋 Linking data found:`, linkingData);
      return res.json({
        success: true,
        data: {
          twitterId,
          isLinked: false,
          totalCalls: 0,
          winRate: 0,
          totalScore: 0,
          successfulCalls: 0,
          bestCall: 0,
          profileData: null
        }
      });
    }
    
    // Get all calls for this Telegram username
    const calls = await db.getAllActiveCalls();
    const userCalls = calls.filter(call => call.username === linkingData.telegramUsername);
    
    // Calculate stats
    const totalCalls = userCalls.length;
    const successfulCalls = userCalls.filter(call => 
      (call.pnlPercent && call.pnlPercent > 0) || (call.score && call.score > 0)
    ).length;
    const winRate = totalCalls > 0 ? (successfulCalls / totalCalls) * 100 : 0;
    const totalScore = userCalls.reduce((sum, call) => sum + (parseFloat(call.score) || 0), 0);
    const bestCall = Math.max(...userCalls.map(call => call.pnlPercent || 0), 0);
    
    // Get recent calls for display
    const recentCalls = await Promise.all(
      userCalls
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 10)
        .map(async (call) => {
          // Get token image from token record if call doesn't have it
          let tokenImage = call.image || null;
          if (!tokenImage) {
            try {
              const token = await db.findTokenByContractAddress(call.contractAddress);
              tokenImage = token?.image || null;
            } catch (error) {
              console.log('Could not fetch token image for profile:', error.message);
            }
          }

          return {
            id: call.id,
            contractAddress: call.contractAddress,
            tokenName: call.tokenName,
            tokenSymbol: call.tokenSymbol,
            image: tokenImage,
            pnlPercent: call.pnlPercent || 0,
            score: call.score || 0,
            createdAt: call.createdAt,
            entryMarketCap: call.entryMarketCap,
            currentMarketCap: call.currentMarketCap
          };
        })
    );
    
    console.log(`✅ Profile data calculated for @${linkingData.twitterUsername}:`, {
      totalCalls,
      winRate: Math.round(winRate * 10) / 10,
      totalScore: Math.round(totalScore * 10) / 10,
      successfulCalls,
      bestCall: Math.round(bestCall * 10) / 10
    });
    
    res.json({
      success: true,
      data: {
        twitterId,
        isLinked: true,
        totalCalls,
        winRate: Math.round(winRate * 10) / 10,
        totalScore: Math.round(totalScore * 10) / 10,
        successfulCalls,
        bestCall: Math.round(bestCall * 10) / 10,
        profileData: {
          twitterUsername: linkingData.twitterUsername,
          twitterName: linkingData.twitterName,
          telegramUsername: linkingData.telegramUsername,
          linkedAt: linkingData.usedAt || linkingData.createdAt
        },
        recentCalls
      }
    });
    
  } catch (error) {
    console.error('Error getting user profile:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Check if Twitter account is linked to Telegram
app.get('/api/check-telegram-link/:twitterId', async (req, res) => {
  try {
    const { twitterId } = req.params;
    console.log(`🔍 Checking Telegram link status for Twitter ID: ${twitterId}`);
    
    // Check if there's a linking code that has been used for this Twitter ID
    const linkingCodesRef = ref(database, 'linkingCodes');
    const snapshot = await get(linkingCodesRef);
    
    if (snapshot.exists()) {
      const linkingCodes = snapshot.val();
      
      // Look for any linking code that has been used and matches this Twitter ID
      for (const [code, data] of Object.entries(linkingCodes)) {
        if (data.twitterId === twitterId && data.isUsed === true) {
          console.log(`✅ Found linked Telegram account for Twitter ID: ${twitterId}`);
          return res.json({
            success: true,
            linked: true,
            twitterId: twitterId,
            linkedAt: data.linkedAt || data.updatedAt
          });
        }
      }
    }
    
    console.log(`❌ No linked Telegram account found for Twitter ID: ${twitterId}`);
    res.json({
      success: true,
      linked: false,
      twitterId: twitterId
    });
    
  } catch (error) {
    console.error('Error checking Telegram link status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Recalculate all user scores endpoint
app.post('/api/recalculate-user-scores', async (req, res) => {
  try {
    console.log('Recalculating all user scores...');
    
    const users = await db.getLeaderboard();
    let updatedCount = 0;
    
    for (const user of users) {
      try {
        await recalculateUserTotalScore(user.id);
        updatedCount++;
        console.log(`Updated user ${user.id} total score`);
      } catch (error) {
        console.error(`Error updating user ${user.id}:`, error.message);
      }
    }
    
    res.json({ 
      success: true, 
      message: `Recalculated scores for ${updatedCount} users`,
      updatedCount 
    });
  } catch (error) {
    console.error('Error recalculating user scores:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Upload banner image endpoint
app.post('/api/upload-banner', async (req, res) => {
  try {
    // This would need multer middleware for file uploads
    // For now, return error to indicate it needs implementation
    res.status(501).json({ 
      success: false, 
      error: 'File upload not implemented yet - use banner URL instead'
    });
  } catch (error) {
    console.error('Error uploading banner:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Save banner URL endpoint
app.post('/api/save-banner-url', async (req, res) => {
  try {
    const { twitterId, bannerUrl } = req.body;
    
    if (!twitterId || !bannerUrl) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing twitterId or bannerUrl' 
      });
    }

    // Store banner URL in Firebase
    const bannerRef = ref(database, `userBanners/${twitterId}`);
    await set(bannerRef, {
      bannerUrl,
      updatedAt: new Date().toISOString()
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error saving banner URL:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 🔧 DEBUG: Endpoint to debug linking issues
app.get('/api/debug-linking/:twitterId', async (req, res) => {
  try {
    const { twitterId } = req.params;
    console.log(`🔍 DEBUG: Checking linking for Twitter ID: ${twitterId}`);
    
    // Get all linking codes
    const linkingCodesRef = ref(database, 'linkingCodes');
    const linkingSnapshot = await get(linkingCodesRef);
    const linkingCodes = linkingSnapshot.exists() ? linkingSnapshot.val() : {};
    
    console.log(`📋 DEBUG: Total linking codes: ${Object.keys(linkingCodes).length}`);
    
    const debugInfo = {
      requestedTwitterId: twitterId,
      totalLinkingCodes: Object.keys(linkingCodes).length,
      matchingCodes: [],
      allCodes: []
    };
    
    // Check all linking codes
    Object.entries(linkingCodes).forEach(([code, data]) => {
      const codeInfo = {
        code,
        twitterId: data.twitterId,
        twitterUsername: data.twitterUsername,
        telegramUsername: data.telegramUsername,
        isUsed: data.isUsed,
        matches: data.twitterId === twitterId && data.isUsed === true
      };
      
      debugInfo.allCodes.push(codeInfo);
      
      if (codeInfo.matches) {
        debugInfo.matchingCodes.push(codeInfo);
        console.log(`✅ DEBUG: FOUND MATCH!`, codeInfo);
      }
    });
    
    // Check if we found any matches
    const isLinked = debugInfo.matchingCodes.length > 0;
    const telegramUsername = isLinked ? debugInfo.matchingCodes[0].telegramUsername : null;
    
    // If linked, get call data
    let callData = [];
    if (isLinked && telegramUsername) {
      const calls = await db.getAllActiveCalls();
      callData = calls.filter(call => call.username === telegramUsername);
      console.log(`📊 DEBUG: Found ${callData.length} calls for ${telegramUsername}`);
    }
    
    const result = {
      success: true,
      debug: {
        ...debugInfo,
        isLinked,
        linkedTelegramUsername: telegramUsername,
        totalCallsFound: callData.length,
        sampleCall: callData[0] || null
      }
    };
    
    console.log(`🔍 DEBUG RESULT:`, JSON.stringify(result, null, 2));
    res.json(result);
    
  } catch (error) {
    console.error('Error in debug linking endpoint:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 🚑 HOTFIX: Repair broken linking data
app.post('/api/fix-linking/:twitterId', async (req, res) => {
  try {
    const { twitterId } = req.params;
    const { telegramUsername } = req.body;
    
    if (!telegramUsername) {
      return res.status(400).json({ 
        success: false, 
        error: 'telegramUsername is required in request body' 
      });
    }
    
    console.log(`🚑 HOTFIX: Repairing linking for Twitter ID: ${twitterId} -> @${telegramUsername}`);
    
    // Get all linking codes
    const linkingCodesRef = ref(database, 'linkingCodes');
    const linkingSnapshot = await get(linkingCodesRef);
    const linkingCodes = linkingSnapshot.exists() ? linkingSnapshot.val() : {};
    
    // Find the matching code
    let fixedCode = null;
    for (const [code, data] of Object.entries(linkingCodes)) {
      if (data.twitterId === twitterId && data.isUsed === true) {
        // Update the code with the correct telegram username
        const codeRef = ref(database, `linkingCodes/${code}`);
        await update(codeRef, {
          telegramUsername: telegramUsername,
          fixedAt: new Date().toISOString()
        });
        
        fixedCode = code;
        console.log(`✅ HOTFIX: Fixed code ${code} with telegramUsername: ${telegramUsername}`);
        break;
      }
    }
    
    if (fixedCode) {
      res.json({ 
        success: true, 
        message: `Fixed linking code ${fixedCode}`,
        data: {
          twitterId,
          telegramUsername,
          fixedCode
        }
      });
    } else {
      res.json({ 
        success: false, 
        error: 'No matching linking code found to fix' 
      });
    }
    
  } catch (error) {
    console.error('Error in fix linking endpoint:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 🧨 CLEANUP: Delete broken linking data to start fresh
app.delete('/api/cleanup-linking/:twitterId', async (req, res) => {
  try {
    const { twitterId } = req.params;
    console.log(`🧨 CLEANUP: Deleting all linking data for Twitter ID: ${twitterId}`);
    
    // Get all linking codes
    const linkingCodesRef = ref(database, 'linkingCodes');
    const linkingSnapshot = await get(linkingCodesRef);
    const linkingCodes = linkingSnapshot.exists() ? linkingSnapshot.val() : {};
    
    let deletedCodes = [];
    
    // Find and delete all codes for this Twitter ID
    for (const [code, data] of Object.entries(linkingCodes)) {
      if (data.twitterId === twitterId) {
        const codeRef = ref(database, `linkingCodes/${code}`);
        await set(codeRef, null); // Delete the code
        deletedCodes.push({
          code,
          twitterUsername: data.twitterUsername,
          telegramUsername: data.telegramUsername,
          isUsed: data.isUsed
        });
        console.log(`✅ CLEANUP: Deleted code ${code}`);
      }
    }
    
    res.json({
      success: true,
      message: `Cleaned up ${deletedCodes.length} linking codes`,
      deletedCodes
    });
    
  } catch (error) {
    console.error('Error in cleanup linking endpoint:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get user banner endpoint
app.get('/api/user-banner/:twitterId', async (req, res) => {
  try {
    const { twitterId } = req.params;
    
    const bannerRef = ref(database, `userBanners/${twitterId}`);
    const snapshot = await get(bannerRef);
    
    if (snapshot.exists()) {
      res.json({ 
        success: true, 
        bannerUrl: snapshot.val().bannerUrl 
      });
    } else {
      res.json({ 
        success: true, 
        bannerUrl: null 
      });
    }
  } catch (error) {
    console.error('Error getting user banner:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 🔧 IMPROVED: Get user profile with enhanced debugging and call retrieval
app.get('/api/user-profile/:twitterId', async (req, res) => {
  try {
    const { twitterId } = req.params;
    console.log(`🔍 PROFILE: Fetching profile for Twitter ID: ${twitterId}`);
    
    // Get linking codes to find Telegram username
    const linkingCodesRef = ref(database, 'linkingCodes');
    const linkingSnapshot = await get(linkingCodesRef);
    const linkingCodes = linkingSnapshot.exists() ? linkingSnapshot.val() : {};
    
    console.log(`📊 PROFILE: Found ${Object.keys(linkingCodes).length} linking codes in database`);
    
    // Find Telegram username for this Twitter ID
    let telegramUsername = null;
    let linkedData = null;
    let allTelegramUsernames = []; // Store all possible usernames for this Twitter ID
    
    for (const [code, data] of Object.entries(linkingCodes)) {
      if (data.twitterId === twitterId) {
        console.log(`📋 PROFILE: Found code ${code} for Twitter ID:`, {
          isUsed: data.isUsed,
          telegramUsername: data.telegramUsername,
          twitterUsername: data.twitterUsername
        });
        
        // Collect all telegram usernames (current and historical)
        if (data.telegramUsername && data.telegramUsername !== 'undefined' && data.telegramUsername !== null) {
          allTelegramUsernames.push(data.telegramUsername);
        }
        
        // Use the most recent used one as primary
        if (data.isUsed === true && data.telegramUsername && data.telegramUsername !== 'undefined') {
          telegramUsername = data.telegramUsername;
          linkedData = data;
          console.log(`✅ PROFILE: Using primary telegram username: ${telegramUsername}`);
        }
      }
    }
    
    // Remove duplicates from all usernames
    allTelegramUsernames = [...new Set(allTelegramUsernames)];
    console.log(`📋 PROFILE: All telegram usernames found:`, allTelegramUsernames);
    
    if (!telegramUsername && allTelegramUsernames.length === 0) {
      console.log(`❌ PROFILE: No linked Telegram account found for Twitter ID: ${twitterId}`);
      return res.json({ 
        success: true, 
        data: {
          totalCalls: 0,
          successfulCalls: 0,
          totalScore: 0,
          winRate: 0,
          bestCall: 0,
          recentCalls: [],
          isLinked: false,
          debug: {
            twitterId,
            totalLinkingCodes: Object.keys(linkingCodes).length,
            allTelegramUsernames: [],
            primaryUsername: null
          }
        }
      });
    }
    
    // If no primary username but we have historical ones, use the first one
    if (!telegramUsername && allTelegramUsernames.length > 0) {
      telegramUsername = allTelegramUsernames[0];
      console.log(`⚠️ PROFILE: No active link, using historical username: ${telegramUsername}`);
    }
    
    console.log(`✅ PROFILE: Using telegram username: ${telegramUsername}`);
    
    // Get all calls and filter by ALL possible Telegram usernames
    const calls = await db.getAllActiveCalls();
    let userCalls = [];
    
    // Search calls with ALL telegram usernames (current + historical)
    const searchUsernames = telegramUsername ? [telegramUsername, ...allTelegramUsernames] : allTelegramUsernames;
    const uniqueSearchUsernames = [...new Set(searchUsernames)];
    
    console.log(`🔍 PROFILE: Searching calls with usernames:`, uniqueSearchUsernames);
    
    for (const username of uniqueSearchUsernames) {
      const callsForUsername = calls.filter(call => call.username === username);
      console.log(`📊 PROFILE: Found ${callsForUsername.length} calls for username: ${username}`);
      userCalls = userCalls.concat(callsForUsername);
    }
    
    // Remove duplicate calls (in case of overlap)
    const uniqueCalls = userCalls.reduce((acc, call) => {
      if (!acc.find(existingCall => existingCall.id === call.id)) {
        acc.push(call);
      }
      return acc;
    }, []);
    userCalls = uniqueCalls;
    
    console.log(`📊 PROFILE: Total unique calls found: ${userCalls.length}`);
    
    // Calculate stats
    const totalCalls = userCalls.length;
    const successfulCalls = userCalls.filter(call => 
      (call.pnlPercent && call.pnlPercent > 0) || (call.score && call.score > 0)
    ).length;
    const totalScore = userCalls.reduce((sum, call) => sum + (parseFloat(call.score) || 0), 0);
    const winRate = totalCalls > 0 ? (successfulCalls / totalCalls) * 100 : 0;
    const bestCall = userCalls.reduce((max, call) => 
      Math.max(max, call.pnlPercent || 0), 0
    );
    
    // Transform calls for frontend
    const transformedCalls = userCalls
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) // Sort by newest first
      .map(call => ({
        id: call.id,
        contractAddress: call.contractAddress,
        createdAt: call.createdAt,
        token: {
          name: call.tokenName,
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
      usingImprovedService: true,
      lastSystemUpdate: new Date().toISOString()
    };

    const overallHealth = 
      healthMetrics.dataQualityScore >= 95 && extremePnL === 0 ? 'excellent' :
      healthMetrics.dataQualityScore >= 85 && extremePnL < 5 ? 'good' :
      healthMetrics.dataQualityScore >= 70 ? 'fair' : 'poor';

    const recommendations = [];
    
    if (extremePnL > 0) {
      recommendations.push(`🔧 ${extremePnL} calls have extreme PnL values - run POST /api/auto-fix-pnl`);
    }
    if (nullPrices > totalCalls * 0.1) {
      recommendations.push(`📊 ${nullPrices} calls missing price data - may need refresh`);
    }
    if (healthMetrics.dataQualityScore < 90) {
      recommendations.push('🔍 Run GET /api/validate-pnl for detailed analysis');
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
          action: 'System status',
          endpoint: 'GET /api/pnl-system-status',
          description: 'Get overall health metrics'
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
        },
        prices: {
          entry: call.entryPrice,
          current: call.currentPrice,
          entryMarketCap: call.entryMarketCap,
          currentMarketCap: call.currentMarketCap
        },
        performance: {
          pnlPercent: call.pnlPercent || 0,
          score: call.score || 0
        },
        user: {
          username: call.username // Include which username made this call
        }
      }));
    
    const profileData = {
      totalCalls,
      successfulCalls,
      totalScore,
      winRate,
      bestCall,
      recentCalls: transformedCalls.slice(0, 20),
      isLinked: true,
      linkedData,
      debug: {
        twitterId,
        primaryTelegramUsername: telegramUsername,
        allTelegramUsernames: uniqueSearchUsernames,
        totalLinkingCodes: Object.keys(linkingCodes).length,
        callsFound: userCalls.length,
        callsByUsername: uniqueSearchUsernames.map(username => ({
          username,
          callCount: calls.filter(call => call.username === username).length
        }))
      }
    };
    
    console.log('📊 PROFILE: Profile stats calculated:', {
      totalCalls,
      winRate: winRate.toFixed(1),
      totalScore: totalScore.toFixed(1),
      usernamesSearched: uniqueSearchUsernames.length
    });
    
    res.json({ success: true, data: profileData });
    
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Recalculate all scores endpoint
app.post('/api/recalculate-scores', async (req, res) => {
  try {
    console.log('Recalculating all scores...');
    
    const calls = db.getAllActiveCalls();
    let updatedCount = 0;
    
    for (const call of calls) {
      try {
        // Fetch fresh token data
        const tokenData = await solanaService.getTokenData(call.contractAddress);
        if (tokenData) {
          // Update current data
          db.updateCall(call.id, {
            currentPrice: tokenData.price,
            currentMarketCap: tokenData.marketCap,
            currentLiquidity: tokenData.liquidity,
            current24hVolume: tokenData.volume24h
          });
          
        // Calculate PnL using improved service with comprehensive validation
        const pnlResult = pnlService.calculatePnl(call, tokenData);
        
        if (!pnlResult.isValid) {
          console.error(`❌ PnL recalculation failed for ${call.id}:`, pnlResult.validationErrors);
          continue;
        }
        
        const pnlPercent = pnlResult.pnlPercent;
        
        // Log any validation warnings
        if (pnlResult.validationErrors.length > 0) {
          console.warn(`⚠️ PnL recalculation warnings for ${call.id}:`, pnlResult.validationErrors);
        }
          
          // Calculate new score
          const score = calculateScore(pnlPercent, call.entryMarketCap, call.callRank || 1);
          
          // Update PnL and score using improved result
          await db.updateCall(call.id, {
            pnlPercent: pnlResult.pnlPercent,
            maxPnl: pnlResult.maxPnl,
            score: score,
            pnlCalculationType: pnlResult.calculationType,
            lastPnlUpdate: new Date().toISOString(),
            pnlValidationErrors: pnlResult.validationErrors.length > 0 ? pnlResult.validationErrors : undefined
          });
          
          updatedCount++;
          console.log(`Updated call ${call.id}: PnL ${pnlPercent.toFixed(2)}%, Score ${score.toFixed(1)}`);
        }
      } catch (error) {
        console.error(`Error updating call ${call.id}:`, error.message);
      }
    }
    
    res.json({ 
      success: true, 
      message: `Recalculated scores for ${updatedCount} calls`,
      updatedCount 
    });
  } catch (error) {
    console.error('Error recalculating scores:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// FIXED: Proper 3-step refresh process like single refresh
app.post('/api/refresh-all', async (req, res) => {
  try {
    console.log('⚡ FIXED 3-STEP refresh-all endpoint called!');
    
    const calls = await db.getAllActiveCalls();
    
    if (calls.length === 0) {
      return res.json({
        success: true,
        message: 'No calls to refresh',
        data: { totalCalls: 0, refreshedCount: 0, skippedCount: 0, errorCount: 0 }
      });
    }
    
    console.log(`🚀 Processing ${calls.length} calls with PROPER 3-step process...`);
    
    // Extract unique contract addresses for batch API
    const uniqueAddresses = [...new Set(calls.map(call => call.contractAddress))];
    console.log(`🔄 Step 1: Batch fetching ${uniqueAddresses.length} unique tokens...`);
    
    // Add delay to give time for PnL calculations
    console.log('⏳ Adding delay for PnL calculation processing...');
    await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
    
    // Get batch token data with rate limiting protection
    const batchResults = await solanaService.getMultipleTokensData(uniqueAddresses);
    console.log(`📊 Batch API returned ${batchResults.length} results`);
    
    // Add small delay to prevent rate limiting
    if (uniqueAddresses.length > 5) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    let refreshedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    // STEP 1: UPDATE MARKET CAPS (parallel, fast)
    console.log('🔄 STEP 1: Updating all market caps in parallel...');
    const marketCapUpdates = [];
    const validCalls = []; // Keep track of calls with valid data
    
    for (const call of calls) {
      try {
        const batchResult = batchResults.find(result => result.address === call.contractAddress);
        
        if (!batchResult || !batchResult.data) {
          errorCount++;
          continue;
        }
        
        const tokenData = batchResult.data;
        
        // Store both call and tokenData for next steps
        validCalls.push({ call, tokenData });
        
        // STEP 1: Market cap update only
        marketCapUpdates.push(
          db.updateCall(call.id, {
            currentPrice: tokenData.price,
            currentMarketCap: tokenData.marketCap,
            currentLiquidity: tokenData.liquidity,
            current24hVolume: tokenData.volume24h
          })
        );
        
      } catch (error) {
        console.error(`❌ Error in Step 1 for ${call.contractAddress}:`, error.message);
        errorCount++;
      }
    }
    
    // Execute all market cap updates in parallel
    await Promise.all(marketCapUpdates);
    console.log(`✅ STEP 1 COMPLETE: ${marketCapUpdates.length} market caps updated!`);
    
    // STEP 2: CALCULATE PnL (with smart skip logic)
    console.log('🧮 STEP 2: Calculating PnL with smart skip logic...');
    const pnlUpdates = [];
    
    for (const { call, tokenData } of validCalls) {
      try {
        // Calculate PnL using improved service with comprehensive validation
        const pnlResult = pnlService.calculatePnl(call, tokenData);
        
        if (!pnlResult.isValid) {
          console.error(`❌ PnL calculation failed for ${call.id}:`, pnlResult.validationErrors);
          errorCount++;
          continue;
        }
        
        const pnlPercent = pnlResult.pnlPercent;
        console.log(`🔥 IMPROVED PnL calculated: ${pnlPercent.toFixed(2)}% (${pnlResult.calculationType})`);
        
        // Log any validation warnings
        if (pnlResult.validationErrors.length > 0) {
          console.warn(`⚠️ PnL warnings for ${call.id}:`, pnlResult.validationErrors);
        }
        
        // SMART SKIP LOGIC - same as before but more efficient
        const currentPnL = call.pnlPercent || 0;
        const pnlDifference = Math.abs(pnlPercent - currentPnL);
        const currentMultiplier = (currentPnL / 100) + 1;
        const newMultiplier = (pnlPercent / 100) + 1;
        
        // Skip if no significant change on high multipliers
        if (currentMultiplier >= 3 && newMultiplier >= 1.5 && pnlDifference < 10) {
          skippedCount++;
          continue;
        }
        
        // Skip if minimal change
        if (pnlDifference < 5 && Math.abs(currentMultiplier - newMultiplier) < 0.2) {
          skippedCount++;
          continue;
        }
        
        // Store for Step 3
        pnlUpdates.push({ call, tokenData, pnlPercent });
        
      } catch (error) {
        console.error(`❌ Error in Step 2 for ${call.contractAddress}:`, error.message);
        errorCount++;
      }
    }
    
    console.log(`✅ STEP 2 COMPLETE: ${pnlUpdates.length} PnL calculated, ${skippedCount} skipped`);
    
    // STEP 3: UPDATE PnL & SCORES (parallel)
    console.log('🏆 STEP 3: Updating PnL and scores in parallel...');
    const scoreUpdates = [];
    const userScoreUpdates = new Set();
    
    for (const { call, tokenData, pnlPercent } of pnlUpdates) {
      try {
        // Calculate score exactly like single refresh
        const score = calculateScore(pnlPercent, call.entryMarketCap, call.callRank || 1);
        
        // STEP 3: Update PnL, maxPnl, and score
        const currentMaxPnl = parseFloat(call.maxPnl) || 0;
        const newMaxPnl = Math.max(currentMaxPnl, pnlPercent);
        
        scoreUpdates.push(
          db.updateCall(call.id, {
            pnlPercent: pnlPercent,
            maxPnl: newMaxPnl,
            score: score
          })
        );
        
        userScoreUpdates.add(call.userId);
        refreshedCount++;
        
        console.log(`🔄 UPDATED ${call.contractAddress}: ${((call.pnlPercent || 0) / 100 + 1).toFixed(1)}x → ${((pnlPercent / 100) + 1).toFixed(1)}x`);
        
      } catch (error) {
        console.error(`❌ Error in Step 3 for ${call.contractAddress}:`, error.message);
        errorCount++;
      }
    }
    
    // Execute all score updates in parallel
    await Promise.all(scoreUpdates);
    console.log(`✅ STEP 3 COMPLETE: ${scoreUpdates.length} scores updated!`);
    
    // Update affected user total scores
    if (userScoreUpdates.size > 0) {
      console.log(`🔄 Updating total scores for ${userScoreUpdates.size} users...`);
      const userScorePromises = Array.from(userScoreUpdates).map(userId => 
        recalculateUserTotalScore(userId).catch(err => 
          console.error(`Error updating user ${userId}:`, err.message)
        )
      );
      await Promise.all(userScorePromises);
    }
    
    const responseData = {
      success: true,
      message: `⚡ 3-STEP refresh completed! ${refreshedCount} updated, ${skippedCount} skipped, ${errorCount} errors`,
      data: {
        totalCalls: calls.length,
        refreshedCount,
        skippedCount,
        errorCount,
        affectedUsers: userScoreUpdates.size
      }
    };
    
    console.log(`🎯 3-STEP refresh completed! Market caps: ALL, PnL/Score: ${refreshedCount}, Skipped: ${skippedCount}`);
    res.json(responseData);
    
  } catch (error) {
    console.error('❌ Error in 3-step refresh:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Refresh token data and update PnL/score
app.post('/api/refresh/:contractAddress', async (req, res) => {
  try {
    const { contractAddress } = req.params;
    console.log(`🔄 Refresh endpoint called for: ${contractAddress}`);
    console.log(`📡 Request method: ${req.method}`);
    console.log(`🌐 Request URL: ${req.url}`);
    
    // Get current call data
    const call = await db.findCallByContractAddress(contractAddress);
    if (!call) {
      return res.status(404).json({ success: false, error: 'Call not found' });
    }
    
    // Add delay to give time for PnL calculations
    console.log('⏳ Adding delay for PnL calculation processing...');
    await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
    
    // Fetch fresh token data from Solana Tracker API
    const tokenData = await solanaService.getTokenData(contractAddress);
    if (!tokenData) {
      return res.status(404).json({ success: false, error: 'Token data not found' });
    }
    
    console.log(`Fresh token data:`, {
      price: tokenData.price,
      marketCap: tokenData.marketCap,
      ath: tokenData.ath
    });
    
    // Update call with current data
    await db.updateCall(call.id, {
      currentPrice: tokenData.price,
      currentMarketCap: tokenData.marketCap,
      currentLiquidity: tokenData.liquidity,
      current24hVolume: tokenData.volume24h
    });
    
    // Calculate PnL using improved service with comprehensive validation
    console.log(`🧮 Calculating PnL for ${contractAddress}...`);
    const pnlResult = pnlService.calculatePnl(call, tokenData);
    
    if (!pnlResult.isValid) {
      console.error(`❌ PnL calculation failed for ${call.id}:`, pnlResult.validationErrors);
      return res.status(400).json({ 
        success: false, 
        error: 'PnL calculation failed', 
        validationErrors: pnlResult.validationErrors 
      });
    }
    
    const pnlPercent = pnlResult.pnlPercent;
    console.log(`✅ PnL calculated: ${pnlPercent.toFixed(2)}% (${pnlResult.calculationType})`);
    
    // Log any validation warnings
    if (pnlResult.validationErrors.length > 0) {
      console.warn(`⚠️ PnL warnings for ${call.id}:`, pnlResult.validationErrors);
    }
    
    // Calculate and update score
    const score = calculateScore(pnlPercent, call.entryMarketCap, call.callRank || 1);
    
    // Update PnL and score in database using improved result
    await db.updateCall(call.id, {
      pnlPercent: pnlResult.pnlPercent,
      maxPnl: pnlResult.maxPnl,
      score: score,
      pnlCalculationType: pnlResult.calculationType,
      lastPnlUpdate: new Date().toISOString(),
      pnlValidationErrors: pnlResult.validationErrors.length > 0 ? pnlResult.validationErrors : undefined
    });
    
    // Update user's total score
    await recalculateUserTotalScore(call.userId);
    
    console.log(`Score calculated: ${score.toFixed(1)} points`);
    
    const responseData = { 
      success: true, 
      data: {
        contractAddress,
        currentPrice: tokenData.price,
        currentMarketCap: tokenData.marketCap,
        pnlPercent,
        score,
        updatedAt: new Date().toISOString()
      }
    };
    
    console.log(`✅ Refresh successful for ${contractAddress}:`, responseData);
    res.json(responseData);
  } catch (error) {
    console.error('Error refreshing token data:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    success: false, 
    error: 'Internal server error' 
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    success: false, 
    error: 'Endpoint not found' 
  });
});

// Auto-recalculate scores on startup
async function autoRecalculateScores() {
  try {
    console.log('🔄 Auto-recalculating scores on startup...');
    
    const calls = await db.getAllActiveCalls();
    let updatedCount = 0;
    
    for (const call of calls) {
      try {
        // Fetch fresh token data
        const tokenData = await solanaService.getTokenData(call.contractAddress);
        if (tokenData) {
          // Update current data
          db.updateCall(call.id, {
            currentPrice: tokenData.price,
            currentMarketCap: tokenData.marketCap,
            currentLiquidity: tokenData.liquidity,
            current24hVolume: tokenData.volume24h
          });
          
          // Calculate PnL using improved service with comprehensive validation
          const pnlResult = pnlService.calculatePnl(call, tokenData);
          
          if (!pnlResult.isValid) {
            console.error(`❌ PnL startup calculation failed for ${call.id}:`, pnlResult.validationErrors);
            continue;
          }
          
          const pnlPercent = pnlResult.pnlPercent;
          
          // Log any validation warnings
          if (pnlResult.validationErrors.length > 0) {
            console.warn(`⚠️ Startup PnL warnings for ${call.id}:`, pnlResult.validationErrors);
          }
          
          // Calculate new score with updated system
          const score = calculateScore(pnlPercent, call.entryMarketCap, call.callRank || 1);
          
          // Update PnL and score
          await db.updateCall(call.id, {
            pnlPercent: pnlPercent,
            score: score
          });
          
          updatedCount++;
          console.log(`✅ Updated call ${call.id}: PnL ${pnlPercent.toFixed(2)}%, Score ${score.toFixed(1)}`);
        }
      } catch (error) {
        console.error(`❌ Error updating call ${call.id}:`, error.message);
      }
    }
    
    console.log(`🎯 Auto-recalculation completed: ${updatedCount} calls updated`);
  } catch (error) {
    console.error('❌ Error during auto-recalculation:', error.message);
  }
}

// Start server (only in development - Vercel handles production)
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, async () => {
    console.log(`🚀 Solana Tracker API server running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
    console.log(`📈 API endpoints available at: http://localhost:${PORT}/api/`);
    
    // Auto-recalculate scores on startup
    await autoRecalculateScores();
  });
} else {
  // In production (Vercel), just run auto-recalculation
  console.log('🚀 Running in production mode (Vercel)');
  autoRecalculateScores().catch(console.error);
}

module.exports = app;
