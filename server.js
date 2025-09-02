require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { ref, set } = require('firebase/database');
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
            
            // Calculate PnL - use ATH only if it was reached AFTER the call
            let pnlPercent = 0;
            let bestMarketCap = tokenData.marketCap; // Default to current market cap
            
            if (call.entryMarketCap && tokenData.marketCap) {
              // Check if ATH is available and higher than current market cap
              if (tokenData.ath && tokenData.ath > tokenData.marketCap) {
                // Check if ATH timestamp is available
                if (tokenData.athTimestamp) {
                  const callTime = new Date(call.createdAt).getTime();
                  const athTime = new Date(tokenData.athTimestamp).getTime();
                  
                  if (athTime > callTime) {
                    // ATH reached AFTER call - use ATH for PnL
                    bestMarketCap = tokenData.ath;
                    console.log(`Using ATH for PnL calculation: $${tokenData.ath} (ATH reached after call)`);
                  } else {
                    // ATH reached BEFORE call - use current market cap for PnL
                    console.log(`ATH was reached before call, using current market cap: $${tokenData.marketCap}`);
                  }
                } else {
                  // If no timestamp, use current market cap to be safe
                  console.log(`No ATH timestamp available, using current market cap: $${tokenData.marketCap}`);
                }
              }
              
              pnlPercent = ((bestMarketCap - call.entryMarketCap) / call.entryMarketCap) * 100;
            }
            console.log(`PnL calculated: ${pnlPercent.toFixed(2)}% (using market cap: $${bestMarketCap})`);
            
            // Calculate and update score
            const score = calculateScore(pnlPercent, call.entryMarketCap, call.callRank || 1);
            
            // Update PnL and score in database
            await db.updateCall(call.id, {
              pnlPercent: pnlPercent,
              score: score
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
    
    // Transform the data to match frontend expectations
    const transformedCalls = calls.map(call => ({
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
      }
    }));
    
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

// Get leaderboard
app.get('/api/leaderboard', async (req, res) => {
  try {
    const leaderboard = await db.getLeaderboard();
    
    // Calculate additional statistics for each user
    const leaderboardWithStats = await Promise.all(leaderboard.map(async (user, index) => {
      try {
        // Recalculate user stats to ensure accuracy
        const userStats = await recalculateUserTotalScore(user.id);
        
        return {
          ...user,
          rank: index + 1,
          successfulCalls: userStats.successfulCalls,
          winRate: userStats.winRate,
          totalCalls: userStats.totalCalls,
          totalScore: userStats.totalScore
        };
      } catch (error) {
        console.error(`Error calculating stats for user ${user.id}:`, error);
        return {
          ...user,
          rank: index + 1,
          successfulCalls: 0,
          winRate: 0,
          totalCalls: user.totalCalls || 0,
          totalScore: user.totalScore || 0
        };
      }
    }));
    
    // Sort by total score again after recalculation
    leaderboardWithStats.sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));
    
    // Update ranks after sorting
    leaderboardWithStats.forEach((user, index) => {
      user.rank = index + 1;
    });
    
    res.json({ success: true, data: leaderboardWithStats });
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
    
    const { twitterId, twitterUsername, twitterName, linkingCode } = req.body;
    
    console.log('📊 Extracted data:', {
      twitterId,
      twitterUsername,
      twitterName,
      linkingCode
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
          
          // Calculate PnL with new logic
          let pnlPercent = 0;
          let bestMarketCap = tokenData.marketCap;
          
          if (call.entryMarketCap && tokenData.marketCap) {
            // Check if token ever reached 2x (200% gain)
            const twoXMarketCap = call.entryMarketCap * 2;
            const maxMarketCap = Math.max(tokenData.marketCap, tokenData.ath || 0);
            
            if (maxMarketCap >= twoXMarketCap) {
              // Token reached 2x+ - use existing ATH timestamp system (don't touch)
              if (tokenData.ath && tokenData.ath > tokenData.marketCap) {
                if (tokenData.athTimestamp) {
                  const callTime = new Date(call.createdAt).getTime();
                  const athTime = new Date(tokenData.athTimestamp).getTime();
                  
                  if (athTime > callTime) {
                    bestMarketCap = tokenData.ath;
                  }
                }
              }
            } else {
              // Token never reached 2x - use current market cap (track downside)
              bestMarketCap = tokenData.marketCap;
            }
            
            pnlPercent = ((bestMarketCap - call.entryMarketCap) / call.entryMarketCap) * 100;
          }
          
          // Calculate new score
          const score = calculateScore(pnlPercent, call.entryMarketCap, call.callRank || 1);
          
          // Update PnL and score
          await db.updateCall(call.id, {
            pnlPercent: pnlPercent,
            score: score
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

// Refresh all token data and update PnL/score using batch API
app.post('/api/refresh-all', async (req, res) => {
  try {
    console.log('🔄 Refresh all endpoint called - using batch API for speed');
    
    const calls = await db.getAllActiveCalls();
    
    if (calls.length === 0) {
      return res.json({
        success: true,
        message: 'No calls to refresh',
        data: {
          totalCalls: 0,
          refreshedCount: 0,
          errorCount: 0,
          results: [],
          errors: []
        }
      });
    }
    
    console.log(`📊 Fetching data for ${calls.length} tokens using batch API...`);
    
    // Extract contract addresses
    const contractAddresses = calls.map(call => call.contractAddress);
    
    // Use batch API for much faster data fetching
    console.log(`🔍 Calling batch API for ${contractAddresses.length} tokens:`, contractAddresses);
    const batchResults = await solanaService.getMultipleTokensData(contractAddresses);
    
    console.log(`📈 Batch API returned data for ${batchResults.length} tokens`);
    console.log(`📊 Batch results:`, batchResults.map(r => ({ 
      address: r.address, 
      hasData: !!r.data, 
      error: r.error 
    })));
    
    let refreshedCount = 0;
    let errorCount = 0;
    const results = [];
    
    // Step 1: Update market cap data immediately from batch results
    console.log(`📊 Step 1: Updating market cap data for all tokens...`);
    for (const call of calls) {
      try {
        // Find the corresponding batch result
        const batchResult = batchResults.find(result => result.address === call.contractAddress);
        
        if (!batchResult || !batchResult.data) {
          console.log(`❌ No batch data found for: ${call.contractAddress}`);
          results.push({
            success: false,
            contractAddress: call.contractAddress,
            error: batchResult?.error || 'Token data not found in batch'
          });
          errorCount++;
          continue;
        }
        
        const tokenData = batchResult.data;
        console.log(`🔄 Updating market data for ${call.contractAddress}: ${tokenData.name} (${tokenData.symbol})`);
        
        // Update call with current market data only (no PnL/score calculation yet)
        await db.updateCall(call.id, {
          currentPrice: tokenData.price,
          currentMarketCap: tokenData.marketCap,
          currentLiquidity: tokenData.liquidity,
          current24hVolume: tokenData.volume24h
        });
        
        console.log(`✅ Updated market data for ${call.contractAddress}: Price $${tokenData.price}, MCap $${tokenData.marketCap}`);
        
      } catch (error) {
        console.error(`❌ Error updating market data for ${call.contractAddress}:`, error.message);
        results.push({
          success: false,
          contractAddress: call.contractAddress,
          error: error.message
        });
        errorCount++;
      }
    }
    
    // Step 2: Calculate PnL and score individually with proper ATH logic
    console.log(`🧮 Step 2: Calculating PnL and scores individually with ATH logic...`);
    for (const call of calls) {
      try {
        // Skip if this call already failed in step 1
        const existingResult = results.find(r => r.contractAddress === call.contractAddress && !r.success);
        if (existingResult) {
          continue;
        }
        
        console.log(`🧮 Calculating PnL/Score for ${call.contractAddress}...`);
        
        // Fetch fresh token data individually to get proper ATH data
        const tokenData = await solanaService.getTokenData(call.contractAddress);
        if (!tokenData) {
          console.log(`❌ Could not fetch individual token data for: ${call.contractAddress}`);
          continue;
        }
        
        // Calculate PnL - use ATH only if it was reached AFTER the call
        let pnlPercent = 0;
        let bestMarketCap = tokenData.marketCap; // Default to current market cap
        
        if (call.entryMarketCap && tokenData.marketCap) {
          // Check if ATH is available and higher than current market cap
          if (tokenData.ath && tokenData.ath > tokenData.marketCap) {
            // Check if ATH timestamp is available
            if (tokenData.athTimestamp) {
              const callTime = new Date(call.createdAt).getTime();
              const athTime = new Date(tokenData.athTimestamp).getTime();
              
              if (athTime > callTime) {
                // ATH reached AFTER call - use ATH for PnL
                bestMarketCap = tokenData.ath;
                console.log(`Using ATH for PnL calculation: $${tokenData.ath} (ATH reached after call)`);
              } else {
                // ATH reached BEFORE call - use current market cap for PnL
                console.log(`ATH was reached before call, using current market cap: $${tokenData.marketCap}`);
              }
            } else {
              // If no timestamp, use current market cap to be safe
              console.log(`No ATH timestamp available, using current market cap: $${tokenData.marketCap}`);
            }
          }
          
          pnlPercent = ((bestMarketCap - call.entryMarketCap) / call.entryMarketCap) * 100;
        }
        
        // Calculate and update score
        const score = calculateScore(pnlPercent, call.entryMarketCap, call.callRank || 1);
        
        // Update PnL and score in database
        await db.updateCall(call.id, {
          pnlPercent: pnlPercent,
          score: score
        });
        
        // Update user's total score
        await recalculateUserTotalScore(call.userId);
        
        console.log(`✅ Calculated PnL/Score for ${call.contractAddress}: PnL ${pnlPercent.toFixed(2)}%, Score ${score.toFixed(1)}`);
        
        // Update the result to show success
        const resultIndex = results.findIndex(r => r.contractAddress === call.contractAddress);
        if (resultIndex !== -1) {
          results[resultIndex] = {
            success: true,
            contractAddress: call.contractAddress,
            pnlPercent,
            score,
            currentPrice: tokenData.price,
            currentMarketCap: tokenData.marketCap
          };
        }
        
        refreshedCount++;
        
        // Add small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        console.error(`❌ Error calculating PnL/Score for ${call.contractAddress}:`, error.message);
        // Don't increment errorCount here as market data was already updated
      }
    }
    
    const responseData = {
      success: true,
      message: `Refreshed market data for all tokens, calculated PnL/Score for ${refreshedCount} tokens successfully, ${errorCount} failed (using hybrid batch + individual approach)`,
      data: {
        totalCalls: calls.length,
        refreshedCount,
        errorCount,
        results: results.filter(r => r.success),
        errors: results.filter(r => !r.success)
      }
    };
    
    console.log(`🎯 Hybrid refresh completed: Market data updated for all, PnL/Score calculated for ${refreshedCount} tokens, ${errorCount} failed`);
    res.json(responseData);
    
  } catch (error) {
    console.error('Error refreshing all tokens:', error);
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
    
    // Calculate PnL - use ATH only if it was reached AFTER the call
    let pnlPercent = 0;
    let bestMarketCap = tokenData.marketCap; // Default to current market cap
    
    if (call.entryMarketCap && tokenData.marketCap) {
      // Check if ATH is available and higher than current market cap
      if (tokenData.ath && tokenData.ath > tokenData.marketCap) {
        // Check if ATH timestamp is available
        if (tokenData.athTimestamp) {
          const callTime = new Date(call.createdAt).getTime();
          const athTime = new Date(tokenData.athTimestamp).getTime();
          
          if (athTime > callTime) {
            // ATH reached AFTER call - use ATH for PnL
            bestMarketCap = tokenData.ath;
            console.log(`Using ATH for PnL calculation: $${tokenData.ath} (ATH reached after call)`);
          } else {
            // ATH reached BEFORE call - use current market cap for PnL
            console.log(`ATH was reached before call, using current market cap: $${tokenData.marketCap}`);
          }
        } else {
          // If no timestamp, use current market cap to be safe
          console.log(`No ATH timestamp available, using current market cap: $${tokenData.marketCap}`);
        }
      }
      
      pnlPercent = ((bestMarketCap - call.entryMarketCap) / call.entryMarketCap) * 100;
    }
    console.log(`PnL calculated: ${pnlPercent.toFixed(2)}% (using market cap: $${bestMarketCap})`);
    
    // Calculate and update score
    const score = calculateScore(pnlPercent, call.entryMarketCap, call.callRank || 1);
    
    // Update PnL and score in database
    await db.updateCall(call.id, {
      pnlPercent: pnlPercent,
      score: score
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
          
          // Calculate PnL with new logic
          let pnlPercent = 0;
          let bestMarketCap = tokenData.marketCap;
          
          if (call.entryMarketCap && tokenData.marketCap) {
            // Check if token ever reached 2x (200% gain)
            const twoXMarketCap = call.entryMarketCap * 2;
            const maxMarketCap = Math.max(tokenData.marketCap, tokenData.ath || 0);
            
            if (maxMarketCap >= twoXMarketCap) {
              // Token reached 2x+ - use existing ATH timestamp system (don't touch)
              if (tokenData.ath && tokenData.ath > tokenData.marketCap) {
                if (tokenData.athTimestamp) {
                  const callTime = new Date(call.createdAt).getTime();
                  const athTime = new Date(tokenData.athTimestamp).getTime();
                  
                  if (athTime > callTime) {
                    bestMarketCap = tokenData.ath;
                  }
                }
              }
            } else {
              // Token never reached 2x - use current market cap (track downside)
              bestMarketCap = tokenData.marketCap;
            }
            
            pnlPercent = ((bestMarketCap - call.entryMarketCap) / call.entryMarketCap) * 100;
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
