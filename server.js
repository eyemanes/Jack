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
const pnlService = new (require('./services/PnlCalculationService'))();

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
            // 🔥 NEW PnL CALCULATION SYSTEM
            const pnlPercent = pnlService.calculatePnlForCall(call, tokenData);
            console.log(`🔥 NEW PnL calculated: ${pnlPercent.toFixed(2)}%`);
            
            // Calculate and update score
            const score = calculateScore(pnlPercent, call.entryMarketCap, call.callRank || 1);
            
            // Update PnL and score in database with maxPnl tracking
            const currentMaxPnl = parseFloat(call.maxPnl) || 0;
            const newMaxPnl = Math.max(currentMaxPnl, pnlPercent);
            
            await db.updateCall(call.id, {
              pnlPercent: pnlPercent,
              maxPnl: newMaxPnl,
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
      
      return {
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
        contractAddress: call.contractAddress
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
    const recentCalls = userCalls
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 10)
      .map(call => ({
        id: call.id,
        contractAddress: call.contractAddress,
        tokenName: call.tokenName,
        tokenSymbol: call.tokenSymbol,
        pnlPercent: call.pnlPercent || 0,
        score: call.score || 0,
        createdAt: call.createdAt,
        entryMarketCap: call.entryMarketCap,
        currentMarketCap: call.currentMarketCap
      }));
    
    console.log(`✅ Profile data calculated for @${linkingData.twitterUsername}:`, {
      totalCalls,
      winRate: winRate.toFixed(1),
      totalScore: totalScore.toFixed(1),
      successfulCalls,
      bestCall: bestCall.toFixed(1)
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
          symbol: call.tokenSymbol
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
    
    // Get batch token data
    const batchResults = await solanaService.getMultipleTokensData(uniqueAddresses);
    console.log(`📊 Batch API returned ${batchResults.length} results`);
    
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
        // 🔥 NEW PnL CALCULATION SYSTEM
        const pnlPercent = pnlService.calculatePnlForCall(call, tokenData);
        
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
    
    // 🔥 FIXED ATH RULE: Lock in highest multiplier if token hits 2x+
    // Calculate PnL with YOUR RULE: Never go backwards once 2x+ is hit
    let pnlPercent = 0;
    let bestMarketCap = tokenData.marketCap; // Default to current market cap
    
    if (call.entryMarketCap && tokenData.marketCap) {
      // Check if token ever reached 2x (200% gain) - YOUR RULE!
      const twoXMarketCap = call.entryMarketCap * 2;
      const currentMultiplier = tokenData.marketCap / call.entryMarketCap;
      const athMultiplier = (tokenData.ath || 0) / call.entryMarketCap;
      
      console.log(`📊 Multiplier check: Current ${currentMultiplier.toFixed(1)}x, ATH ${athMultiplier.toFixed(1)}x, Entry ${call.entryMarketCap}`);
      
      // 🚀 YOUR RULE: If token hit 2x+, ALWAYS use the highest multiplier (ATH)
      if (athMultiplier >= 2.0) {
        // Check if ATH was reached AFTER our call
        if (tokenData.athTimestamp) {
          const callTime = new Date(call.createdAt).getTime();
          const athTime = new Date(tokenData.athTimestamp).getTime();
          
          if (athTime > callTime) {
            // ATH reached AFTER call - LOCK IT IN! 🔒
            bestMarketCap = tokenData.ath;
            console.log(`🔥 LOCKED IN ATH: ${athMultiplier.toFixed(1)}x (ATH reached after call) - Token hit ${athMultiplier.toFixed(1)}x, current ${currentMultiplier.toFixed(1)}x`);
          } else {
            // ATH was before our call - use current
            bestMarketCap = tokenData.marketCap;
            console.log(`⚠️ ATH was before call, using current: ${currentMultiplier.toFixed(1)}x`);
          }
        } else {
          // No timestamp, be safe - use current
          bestMarketCap = tokenData.marketCap;
          console.log(`⚠️ No ATH timestamp, using current: ${currentMultiplier.toFixed(1)}x`);
        }
      } else {
        // Token never reached 2x - track current price (can go negative)
        bestMarketCap = tokenData.marketCap;
        console.log(`📉 Token never hit 2x, tracking current: ${currentMultiplier.toFixed(1)}x`);
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
