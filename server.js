require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const FirebaseService = require('./services/FirebaseService');
const SolanaTrackerService = require('./services/SolanaTrackerService');

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
    console.log(`Debug: Market cap $${entryMarketCap} = ${marketCapMultiplier}x multiplier`);
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

// Get leaderboard
app.get('/api/leaderboard', async (req, res) => {
  try {
    const leaderboard = await db.getLeaderboard();
    
    // Add rank to each user
    const leaderboardWithRank = leaderboard.map((user, index) => ({
      ...user,
      rank: index + 1
    }));
    
    res.json({ success: true, data: leaderboardWithRank });
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

// Refresh token data and update PnL/score
app.post('/api/refresh/:contractAddress', async (req, res) => {
  try {
    const { contractAddress } = req.params;
    console.log(`Refreshing token data for: ${contractAddress}`);
    
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
    
    console.log(`Score calculated: ${score.toFixed(1)} points`);
    
    res.json({ 
      success: true, 
      data: {
        contractAddress,
        currentPrice: tokenData.price,
        currentMarketCap: tokenData.marketCap,
        pnlPercent,
        score,
        updatedAt: new Date().toISOString()
      }
    });
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

// Start server (only in development)
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, async () => {
    console.log(`🚀 Solana Tracker API server running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
    console.log(`📈 API endpoints available at: http://localhost:${PORT}/api/`);
    
    // Auto-recalculate scores on startup
    await autoRecalculateScores();
  });
}

module.exports = app;
