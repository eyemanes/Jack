require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { ref, set, get, update } = require('firebase/database');
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

// Get leaderboard
app.get('/api/leaderboard', async (req, res) => {
  try {
    const leaderboard = await db.getLeaderboard();
    
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
    
    const leaderboardWithStats = await Promise.all(leaderboard.map(async (user, index) => {
      try {
        const userStats = await recalculateUserTotalScore(user.id);
        
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
        return {
          ...user,
          rank: index + 1,
          successfulCalls: 0,
          winRate: 0,
          totalCalls: user.totalCalls || 0,
          totalScore: user.totalScore || 0,
          displayName: user.username ? `@${user.username}` : user.firstName || 'Anonymous',
          twitterUsername: null,
          isLinked: false
        };
      }
    }));
    
    const activeUsersOnly = leaderboardWithStats.filter(user => (user.totalCalls || 0) > 0);
    activeUsersOnly.sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));
    activeUsersOnly.forEach((user, index) => {
      user.rank = index + 1;
    });
    
    res.json({ success: true, data: activeUsersOnly });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Generate linking code for Twitter users
app.post('/api/generate-linking-code', async (req, res) => {
  try {
    const { twitterId, twitterUsername, twitterName, linkingCode, profilePictureUrl } = req.body;
    
    if (!twitterId || !linkingCode || !twitterUsername) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields'
      });
    }

    const linkingData = {
      twitterId,
      twitterUsername,
      twitterName: twitterName || twitterUsername,
      profilePictureUrl: profilePictureUrl || null,
      linkingCode,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      isUsed: false
    };

    const linkingCodesRef = ref(database, `linkingCodes/${linkingCode}`);
    await set(linkingCodesRef, linkingData);
    
    res.json({ success: true, data: { linkingCode } });
  } catch (error) {
    console.error('Error generating linking code:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Refresh all tokens endpoint
app.post('/api/refresh-all', async (req, res) => {
  try {
    const calls = await db.getAllActiveCalls();
    
    if (calls.length === 0) {
      return res.json({
        success: true,
        message: 'No calls to refresh',
        data: { totalCalls: 0, refreshedCount: 0, skippedCount: 0, errorCount: 0 }
      });
    }
    
    const uniqueAddresses = [...new Set(calls.map(call => call.contractAddress))];
    const batchResults = await solanaService.getMultipleTokensData(uniqueAddresses);
    
    let refreshedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    for (const call of calls) {
      try {
        const batchResult = batchResults.find(result => result.address === call.contractAddress);
        
        if (!batchResult || !batchResult.data) {
          errorCount++;
          continue;
        }
        
        const tokenData = batchResult.data;
        
        await db.updateCall(call.id, {
          currentPrice: tokenData.price,
          currentMarketCap: tokenData.marketCap,
          currentLiquidity: tokenData.liquidity,
          current24hVolume: tokenData.volume24h
        });
        
        const pnlResult = pnlService.calculatePnl(call, tokenData);
        
        if (!pnlResult.isValid) {
          errorCount++;
          continue;
        }
        
        const pnlPercent = pnlResult.pnlPercent;
        const currentPnL = call.pnlPercent || 0;
        const pnlDifference = Math.abs(pnlPercent - currentPnL);
        
        if (pnlDifference < 5) {
          skippedCount++;
          continue;
        }
        
        const score = calculateScore(pnlPercent, call.entryMarketCap, call.callRank || 1);
        
        await db.updateCall(call.id, {
          pnlPercent: pnlPercent,
          maxPnl: Math.max(parseFloat(call.maxPnl) || 0, pnlPercent),
          score: score
        });
        
        refreshedCount++;
        
      } catch (error) {
        errorCount++;
      }
    }
    
    const responseData = {
      success: true,
      message: `Refresh completed! ${refreshedCount} updated, ${skippedCount} skipped, ${errorCount} errors`,
      data: {
        totalCalls: calls.length,
        refreshedCount,
        skippedCount,
        errorCount
      }
    };
    
    res.json(responseData);
    
  } catch (error) {
    console.error('Error in refresh:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Refresh single token
app.post('/api/refresh/:contractAddress', async (req, res) => {
  try {
    const { contractAddress } = req.params;
    
    const call = await db.findCallByContractAddress(contractAddress);
    if (!call) {
      return res.status(404).json({ success: false, error: 'Call not found' });
    }
    
    const tokenData = await solanaService.getTokenData(contractAddress);
    if (!tokenData) {
      return res.status(404).json({ success: false, error: 'Token data not found' });
    }
    
    await db.updateCall(call.id, {
      currentPrice: tokenData.price,
      currentMarketCap: tokenData.marketCap,
      currentLiquidity: tokenData.liquidity,
      current24hVolume: tokenData.volume24h
    });
    
    const pnlResult = pnlService.calculatePnl(call, tokenData);
    
    if (!pnlResult.isValid) {
      return res.status(400).json({ 
        success: false, 
        error: 'PnL calculation failed', 
        validationErrors: pnlResult.validationErrors 
      });
    }
    
    const pnlPercent = pnlResult.pnlPercent;
    const score = calculateScore(pnlPercent, call.entryMarketCap, call.callRank || 1);
    
    await db.updateCall(call.id, {
      pnlPercent: pnlResult.pnlPercent,
      maxPnl: pnlResult.maxPnl,
      score: score,
      lastPnlUpdate: new Date().toISOString()
    });
    
    await recalculateUserTotalScore(call.userId);
    
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
    
    res.json(responseData);
  } catch (error) {
    console.error('Error refreshing token data:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PnL system endpoints
app.get('/api/pnl-system-status', async (req, res) => {
  try {
    const calls = await db.getAllActiveCalls();
    const totalCalls = calls.length;
    
    const nullPrices = calls.filter(c => !c.currentPrice || c.currentPrice === null).length;
    const extremePnL = calls.filter(c => Math.abs(c.pnlPercent || 0) > 10000).length;
    
    const healthMetrics = {
      totalCalls: totalCalls,
      nullPrices: nullPrices,
      extremePnLValues: extremePnL,
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
      recommendations.push(`${extremePnL} calls have extreme PnL values`);
    }
    if (recommendations.length === 0) {
      recommendations.push('System is healthy');
    }

    res.json({
      success: true,
      overallHealth: overallHealth,
      healthScore: healthMetrics.dataQualityScore + '%',
      metrics: healthMetrics,
      recommendations: recommendations
    });

  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/auto-fix-pnl', async (req, res) => {
  try {
    const calls = await db.getAllActiveCalls();
    const corruptedCalls = calls.filter(c => 
      Math.abs(parseFloat(c.pnlPercent) || 0) > 10000 || 
      Math.abs(parseFloat(c.maxPnl) || 0) > 10000
    );
    
    let fixedCount = 0;
    
    for (const call of corruptedCalls.slice(0, 10)) {
      try {
        await db.updateCall(call.id, {
          pnlPercent: 0,
          maxPnl: 0,
          fixedAt: new Date().toISOString(),
          wasCorrupted: true
        });
        fixedCount++;
      } catch (err) {
        console.error(`Failed to fix call ${call.id}:`, err);
      }
    }
    
    res.json({
      success: true,
      message: `Fixed ${fixedCount} corrupted calls`,
      results: {
        summary: {
          fixedCalls: fixedCount,
          totalCorrupted: corruptedCalls.length
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/validate-pnl', async (req, res) => {
  try {
    const calls = await db.getAllActiveCalls();
    const sampleCalls = calls.slice(0, 5);
    
    let valid = 0;
    let invalid = 0;
    let corrupted = 0;

    for (const call of sampleCalls) {
      try {
        const tokenData = await solanaService.getTokenData(call.contractAddress);
        if (!tokenData) continue;

        const result = pnlService.calculatePnl(call, tokenData);
        
        if (result.isValid) {
          valid++;
          
          if (result.debugInfo?.corruption?.isCorrupted) {
            corrupted++;
          }
        } else {
          invalid++;
        }
      } catch (error) {
        invalid++;
      }
    }

    const healthScore = sampleCalls.length > 0 ? 
      Math.round((valid / sampleCalls.length) * 100) : 100;

    res.json({
      success: true,
      healthScore: healthScore + '%',
      results: { valid, invalid, sampleSize: sampleCalls.length }
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

app.use('*', (req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint not found' });
});

module.exports = app;
});

// Enhanced Backend Dashboard with Live Refresh Monitoring
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Jack of all Scans - Backend Dashboard</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh; padding: 20px;
        }
        .container {
            max-width: 1400px; margin: 0 auto;
            background: rgba(255, 255, 255, 0.95);
            border-radius: 20px; padding: 30px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
        }
        h1 {
            text-align: center; color: #333; margin-bottom: 10px; font-size: 2.5em;
            background: linear-gradient(135deg, #667eea, #764ba2);
            -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        }
        .subtitle { text-align: center; color: #666; margin-bottom: 30px; font-size: 1.2em; }
        .action-grid {
            display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
            gap: 20px; margin: 30px 0;
        }
        .action-card {
            background: white; border-radius: 15px; padding: 25px; text-align: center;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
            transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        .action-card:hover { transform: translateY(-5px); box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15); }
        .btn {
            background: linear-gradient(135deg, #667eea, #764ba2); color: white; border: none;
            padding: 15px 30px; border-radius: 50px; font-size: 16px; font-weight: 600;
            cursor: pointer; transition: all 0.3s ease; text-transform: uppercase;
            letter-spacing: 1px; min-width: 200px; margin: 5px;
        }
        .btn:hover { transform: translateY(-2px); box-shadow: 0 10px 20px rgba(102, 126, 234, 0.3); }
        .btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
        .btn-danger { background: linear-gradient(135deg, #ff6b6b, #ee5a52); }
        .btn-success { background: linear-gradient(135deg, #51cf66, #40c057); }
        .btn-warning { background: linear-gradient(135deg, #ffd43b, #fab005); }
        .btn-info { background: linear-gradient(135deg, #339af0, #228be6); }
        .live-log {
            background: #1a1a1a; color: #00ff41; border-radius: 10px; padding: 20px; margin-top: 20px;
            font-family: 'Courier New', monospace; font-size: 13px; max-height: 500px;
            overflow-y: auto; border: 2px solid #333; white-space: pre-wrap;
            display: none;
        }
        .log-entry {
            margin: 2px 0; opacity: 0; animation: fadeIn 0.3s ease-in forwards;
        }
        .log-success { color: #00ff41; }
        .log-error { color: #ff4444; }
        .log-warning { color: #ffaa00; }
        .log-info { color: #4488ff; }
        .log-debug { color: #888888; }
        @keyframes fadeIn { to { opacity: 1; } }
        .progress-bar {
            width: 100%; height: 25px; background: #f0f0f0; border-radius: 15px; overflow: hidden; margin: 15px 0;
            border: 2px solid #ddd;
        }
        .progress-fill {
            height: 100%; background: linear-gradient(135deg, #667eea, #764ba2); width: 0%; 
            transition: width 0.3s ease; display: flex; align-items: center; justify-content: center;
            color: white; font-weight: bold; font-size: 12px;
        }
        .input-field {
            width: 100%; margin: 10px 0; padding: 12px; border: 2px solid #ddd; 
            border-radius: 8px; font-size: 14px;
        }
        .loading {
            display: inline-block; width: 20px; height: 20px; border: 2px solid #ffffff;
            border-radius: 50%; border-top-color: transparent;
            animation: spin 1s ease-in-out infinite; margin-right: 10px;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
    </style>
</head>
<body>
    <div class="container">
        <h1>Jack of all Scans</h1>
        <div class="subtitle">Backend Dashboard & Live Token Monitor</div>
        
        <div class="action-grid">
            <div class="action-card">
                <h3>🟢 Live Refresh All</h3>
                <p>Refresh all tokens with live streaming logs and progress tracking.</p>
                <button class="btn btn-success" onclick="refreshAllTokensLive()">Start Live Refresh</button>
            </div>
            
            <div class="action-card">
                <h3>🔍 Single Token Test</h3>
                <p>Test refresh on a specific token with detailed logging.</p>
                <input type="text" id="contractInput" class="input-field" placeholder="Enter contract address">
                <button class="btn btn-warning" onclick="refreshSingleToken()">Test Refresh</button>
            </div>
            
            <div class="action-card">
                <h3>📊 System Status</h3>
                <p>Check system health and identify issues.</p>
                <button class="btn" onclick="checkSystemHealth()">Check Status</button>
            </div>
            
            <div class="action-card">
                <h3>🔧 Auto-Fix</h3>
                <p>Automatically detect and fix corrupted data.</p>
                <button class="btn btn-danger" onclick="autoFixPnL()">Fix Issues</button>
            </div>
            
            <div class="action-card">
                <h3>📺 Live Monitor</h3>
                <p>Toggle real-time logging display.</p>
                <button class="btn btn-info" onclick="toggleLiveMonitor()" id="monitorBtn">Start Monitor</button>
            </div>
            
            <div class="action-card">
                <h3>✅ Validate PnL</h3>
                <p>Test PnL calculation quality.</p>
                <button class="btn" onclick="validatePnL()">Validate</button>
            </div>
        </div>
        
        <div class="live-log" id="liveLog">
            <h4 style="color: #00ff41; margin-bottom: 15px;">🔴 LIVE TOKEN REFRESH MONITOR</h4>
            <div class="progress-bar" id="progressBar" style="display: none;">
                <div class="progress-fill" id="progressFill">0%</div>
            </div>
            <div id="logContent"></div>
        </div>
    </div>

    <script>
        const API_BASE = window.location.origin;
        let isMonitoring = false;
        let logCount = 0;
        
        function addLog(message, type = 'info') {
            const logContent = document.getElementById('logContent');
            const timestamp = new Date().toLocaleTimeString();
            const logEntry = document.createElement('div');
            logEntry.className = 'log-entry log-' + type;
            logEntry.textContent = '[' + timestamp + '] ' + message;
            logContent.appendChild(logEntry);
            
            logCount++;
            if (logCount > 100) {
                logContent.removeChild(logContent.firstChild);
                logCount--;
            }
            
            logContent.scrollTop = logContent.scrollHeight;
        }
        
        function updateProgress(current, total, message = '') {
            const progressBar = document.getElementById('progressBar');
            const progressFill = document.getElementById('progressFill');
            
            if (total > 0) {
                progressBar.style.display = 'block';
                const percentage = Math.round((current / total) * 100);
                progressFill.style.width = percentage + '%';
                progressFill.textContent = message || percentage + '% (' + current + '/' + total + ')';
            } else {
                progressBar.style.display = 'none';
            }
        }
        
        function toggleLiveMonitor() {
            const liveLog = document.getElementById('liveLog');
            const monitorBtn = document.getElementById('monitorBtn');
            
            isMonitoring = !isMonitoring;
            
            if (isMonitoring) {
                liveLog.style.display = 'block';
                monitorBtn.textContent = 'Stop Monitor';
                monitorBtn.className = 'btn btn-danger';
                addLog('🟢 Live monitor started - Ready for operations', 'success');
                liveLog.scrollIntoView({ behavior: 'smooth' });
            } else {
                liveLog.style.display = 'none';
                monitorBtn.textContent = 'Start Monitor';
                monitorBtn.className = 'btn btn-info';
                updateProgress(0, 0);
            }
        }
        
        function setButtonLoading(buttonText, isLoading) {
            const buttons = document.querySelectorAll('button');
            buttons.forEach(btn => {
                if (btn.textContent.includes(buttonText)) {
                    if (isLoading) {
                        btn.innerHTML = '<span class="loading"></span>Processing...';
                        btn.disabled = true;
                    } else {
                        btn.innerHTML = buttonText;
                        btn.disabled = false;
                    }
                }
            });
        }
        
        async function refreshAllTokensLive() {
            if (!isMonitoring) {
                toggleLiveMonitor();
            }
            
            setButtonLoading('Start Live Refresh', true);
            addLog('🚀 Starting LIVE token refresh with streaming logs...', 'info');
            
            try {
                const response = await fetch(API_BASE + '/api/refresh-all-live', {
                    method: 'POST'
                });
                
                if (!response.ok) {
                    throw new Error('HTTP ' + response.status + ': ' + response.statusText);
                }
                
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\\n');
                    buffer = lines.pop();
                    
                    for (const line of lines) {
                        if (line.trim()) {
                            try {
                                const logData = JSON.parse(line);
                                
                                if (logData.type === 'progress') {
                                    updateProgress(logData.current, logData.total, logData.message);
                                } else if (logData.type === 'log') {
                                    addLog(logData.message, logData.level);
                                } else if (logData.type === 'complete') {
                                    addLog('✅ ' + logData.message, 'success');
                                }
                            } catch (e) {
                                addLog(line, 'debug');
                            }
                        }
                    }
                }
                
            } catch (error) {
                addLog('❌ Live refresh failed: ' + error.message, 'error');
            } finally {
                setButtonLoading('Start Live Refresh', false);
                updateProgress(0, 0);
            }
        }
        
        async function refreshSingleToken() {
            const contractAddress = document.getElementById('contractInput').value.trim();
            if (!contractAddress) {
                alert('Please enter a contract address');
                return;
            }
            
            if (!isMonitoring) {
                toggleLiveMonitor();
            }
            
            setButtonLoading('Test Refresh', true);
            addLog('🔍 Testing single token: ' + contractAddress, 'info');
            
            try {
                const response = await fetch(API_BASE + '/api/refresh/' + contractAddress, {
                    method: 'POST'
                });
                
                const data = await response.json();
                
                if (data.success) {
                    addLog('✅ Single test completed for ' + contractAddress, 'success');
                } else {
                    addLog('❌ Single test failed: ' + data.error, 'error');
                }
            } catch (error) {
                addLog('❌ Test error: ' + error.message, 'error');
            } finally {
                setButtonLoading('Test Refresh', false);
            }
        }
        
        async function checkSystemHealth() {
            if (isMonitoring) {
                addLog('📊 Running system health check...', 'info');
            }
            
            try {
                const response = await fetch(API_BASE + '/api/pnl-system-status');
                const data = await response.json();
                
                if (isMonitoring) {
                    addLog('📊 Health: ' + data.overallHealth + ' | ' + data.metrics.totalCalls + ' calls, ' + data.metrics.extremePnLValues + ' corrupted', 'info');
                }
            } catch (error) {
                if (isMonitoring) {
                    addLog('❌ Health check failed: ' + error.message, 'error');
                }
            }
        }
        
        async function autoFixPnL() {
            if (!confirm('Fix corrupted PnL data?')) return;
            
            if (!isMonitoring) {
                toggleLiveMonitor();
            }
            
            setButtonLoading('Fix Issues', true);
            addLog('🔧 Starting auto-fix process...', 'warning');
            
            try {
                const response = await fetch(API_BASE + '/api/auto-fix-pnl', {
                    method: 'POST'
                });
                
                const data = await response.json();
                
                if (data.success) {
                    addLog('✅ Auto-fix completed: ' + data.message, 'success');
                } else {
                    addLog('❌ Auto-fix failed: ' + data.error, 'error');
                }
            } catch (error) {
                addLog('❌ Auto-fix error: ' + error.message, 'error');
            } finally {
                setButtonLoading('Fix Issues', false);
            }
        }
        
        async function validatePnL() {
            if (isMonitoring) {
                addLog('🔍 Running PnL validation...', 'info');
            }
            
            try {
                const response = await fetch(API_BASE + '/api/validate-pnl');
                const data = await response.json();
                
                if (isMonitoring) {
                    addLog('✅ Validation: ' + (data.healthScore || 'Unknown') + ' health score', 'info');
                }
            } catch (error) {
                if (isMonitoring) {
                    addLog('❌ Validation failed: ' + error.message, 'error');
                }
            }
        }
    </script>
</body>
</html>
  `);
});

// 🔴 NEW: Live refresh endpoint with streaming logs
app.post('/api/refresh-all-live', async (req, res) => {
  console.log('🔴 LIVE: Starting live refresh with streaming logs...');
  
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  function sendLog(message, level = 'info') {
    const logData = { type: 'log', message, level, timestamp: Date.now() };
    res.write(JSON.stringify(logData) + '\\n');
    console.log(`🔴 [${level.toUpperCase()}]: ${message}`);
  }

  function sendProgress(current, total, message = '') {
    const progressData = { type: 'progress', current, total, message };
    res.write(JSON.stringify(progressData) + '\\n');
  }

  try {
    sendLog('📊 Fetching all active calls...', 'info');
    const calls = await db.getAllActiveCalls();
    
    if (calls.length === 0) {
      sendLog('No calls found', 'warning');
      res.write(JSON.stringify({ type: 'complete', message: 'No calls to refresh' }) + '\\n');
      res.end();
      return;
    }

    sendLog(`Found ${calls.length} calls to process`, 'info');
    sendProgress(0, calls.length, 'Starting...');

    const uniqueAddresses = [...new Set(calls.map(call => call.contractAddress))];
    sendLog(`Processing ${uniqueAddresses.length} unique tokens`, 'info');

    sendLog('🔄 Batch fetching token data...', 'info');
    const batchResults = await solanaService.getMultipleTokensData(uniqueAddresses);
    sendLog(`Retrieved ${batchResults.length} token results`, 'success');

    let refreshedCount = 0;
    let errorCount = 0;

    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      const progress = i + 1;
      
      try {
        sendProgress(progress, calls.length, `Processing ${call.tokenSymbol || 'Unknown'}...`);
        
        const batchResult = batchResults.find(result => result.address === call.contractAddress);
        
        if (!batchResult || !batchResult.data) {
          sendLog(`⚠️ No data for ${call.contractAddress}`, 'warning');
          errorCount++;
          continue;
        }

        const tokenData = batchResult.data;
        sendLog(`💰 ${call.tokenSymbol}: $${tokenData.price?.toFixed(8)}`, 'debug');

        await db.updateCall(call.id, {
          currentPrice: tokenData.price,
          currentMarketCap: tokenData.marketCap,
          currentLiquidity: tokenData.liquidity,
          current24hVolume: tokenData.volume24h
        });

        const pnlResult = pnlService.calculatePnl(call, tokenData);
        
        if (!pnlResult.isValid) {
          sendLog(`❌ PnL failed for ${call.tokenSymbol}`, 'error');
          errorCount++;
          continue;
        }

        const pnlPercent = pnlResult.pnlPercent;
        const score = calculateScore(pnlPercent, call.entryMarketCap, call.callRank || 1);

        await db.updateCall(call.id, {
          pnlPercent: pnlPercent,
          maxPnl: Math.max(parseFloat(call.maxPnl) || 0, pnlPercent),
          score: score,
          lastPnlUpdate: new Date().toISOString()
        });

        refreshedCount++;
        const multiplier = ((pnlPercent / 100) + 1).toFixed(2);
        sendLog(`✅ ${call.tokenSymbol}: ${multiplier}x | Score: ${score.toFixed(1)}`, 'success');

      } catch (error) {
        sendLog(`❌ Error: ${call.contractAddress}: ${error.message}`, 'error');
        errorCount++;
      }
    }

    const resultData = {
      totalCalls: calls.length,
      refreshedCount,
      errorCount
    };

    sendLog(`🎯 Completed! Updated: ${refreshedCount}, Errors: ${errorCount}`, 'success');
    res.write(JSON.stringify({ type: 'complete', message: `Processed ${calls.length} calls`, data: resultData }) + '\\n');
    res.end();

  } catch (error) {
    sendLog(`💥 Critical error: ${error.message}`, 'error');
    res.write(JSON.stringify({ type: 'error', message: error.message }) + '\\n');
    res.end();
  }
});

// All other endpoints from the original broken file follow...
// Helper function to recalculate user total score
async function recalculateUserTotalScore(userId) {
  try {
    const userCalls = await db.getCallsByUser(userId);
    
    const totalScore = userCalls.reduce((sum, call) => {
      return sum + (parseFloat(call.score) || 0);
    }, 0);
    
    const successfulCalls = userCalls.filter(call => 
      (call.pnlPercent && call.pnlPercent > 0) || (call.score && call.score > 0)
    ).length;
    
    const winRate = userCalls.length > 0 ? (successfulCalls / userCalls.length) * 100 : 0;
    
    await db.updateUser(userId, {
      totalScore: totalScore,
      totalCalls: userCalls.length,
      successfulCalls: successfulCalls,
      winRate: winRate
    });
    
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

// Get all active calls
app.get('/api/calls', async (req, res) => {
  try {
    const calls = await db.getAllActiveCalls();
    
    // Auto-refresh calls with null prices
    for (const call of calls) {
      if (!call.currentPrice || call.currentPrice === null) {
        try {
          const tokenData = await solanaService.getTokenData(call.contractAddress);
          if (tokenData) {
            await db.updateCall(call.id, {
              currentPrice: tokenData.price,
              currentMarketCap: tokenData.marketCap,
              currentLiquidity: tokenData.liquidity,
              current24hVolume: tokenData.volume24h
            });
            
            const pnlResult = pnlService.calculatePnl(call, tokenData);
            
            if (pnlResult.isValid) {
              const pnlPercent = pnlResult.pnlPercent;
              const score = calculateScore(pnlPercent, call.entryMarketCap, call.callRank || 1);
              
              await db.updateCall(call.id, {
                pnlPercent: pnlResult.pnlPercent,
                maxPnl: pnlResult.maxPnl,
                score: score,
                pnlCalculationType: pnlResult.calculationType,
                lastPnlUpdate: new Date().toISOString()
              });
              
              await recalculateUserTotalScore(call.userId);
              
              call.currentPrice = tokenData.price;
              call.currentMarketCap = tokenData.marketCap;
              call.pnlPercent = pnlPercent;
              call.score = score;
            }
          }
        } catch (error) {
          console.error(`Error auto-refreshing call ${call.id}:`, error.message);
        }
      }
    }
    
    calls.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    // Get linking codes for Twitter mapping
    const linkingCodesRef = ref(database, 'linkingCodes');
    const linkingSnapshot = await get(linkingCodesRef);
    const linkingCodes = linkingSnapshot.exists() ? linkingSnapshot.val() : {};
    
    const telegramToTwitterMap = {};
    for (const [code, data] of Object.entries(linkingCodes)) {
      if (data.isUsed === true) {
        const telegramUsername = data.telegramUsername || data.telegramUserId || data.username;
        const twitterUsername = data.twitterUsername;
        
        if (telegramUsername && twitterUsername) {
          telegramToTwitterMap[telegramUsername] = {
            twitterUsername: data.twitterUsername,
            twitterName: data.twitterName,
            twitterId: data.twitterId,
            profilePictureUrl: data.profilePictureUrl
          };
        }
      }
    }

    const transformedCalls = calls.map(call => {
      const twitterInfo = telegramToTwitterMap[call.username];
      
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
          contractAddress: call.contractAddress,
          image: call.image
        },
        user: {
          id: call.userId,
          username: call.username,
          firstName: call.firstName,
          lastName: call.lastName,
          displayName: displayName,
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
