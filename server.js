require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const { ref, set, get, onValue, push } = require('firebase/database');
const FirebaseService = require('./services/FirebaseService');
const SolanaTrackerService = require('./services/SolanaTrackerService');
const { database } = require('./config/firebase');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Firebase database and service
const db = new FirebaseService();
const solanaService = new SolanaTrackerService();
// Use the deterministic PnL calculation service (race-safe, drift-free)
const DeterministicPnlCalculationService = require('./services/DeterministicPnlCalculationService');
const pnlService = new DeterministicPnlCalculationService();

// Real-time data cache
let cachedCalls = [];
let cachedStats = {};

// Set up real-time Firebase listeners
function setupRealtimeListeners() {
  // Listen to calls changes
  const callsRef = ref(database, 'calls');
  onValue(callsRef, (snapshot) => {
    if (snapshot.exists()) {
      const calls = [];
      snapshot.forEach((childSnapshot) => {
        const call = { id: childSnapshot.key, ...childSnapshot.val() };
        calls.push(call);
      });
      cachedCalls = calls;
      addLog('info', `Real-time update: ${calls.length} calls loaded`);
      
      // Emit to connected clients
      io.emit('calls_updated', calls);
    }
  });

  // Listen to stats changes
  const statsRef = ref(database, 'stats');
  onValue(statsRef, (snapshot) => {
    if (snapshot.exists()) {
      cachedStats = snapshot.val();
      addLog('info', 'Real-time stats update received');
      
      // Emit to connected clients
      io.emit('stats_updated', cachedStats);
    }
  });
}

// Logging system
const logs = [];
function addLog(type, message, data = null) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    type,
    message,
    data: data ? JSON.stringify(data, null, 2) : null
  };
  
  logs.push(logEntry);
  
  // Keep only last 1000 logs
  if (logs.length > 1000) {
    logs.splice(0, logs.length - 1000);
  }
  
  console.log(`[${logEntry.timestamp}] ${type.toUpperCase()}: ${message}`);
  if (data) {
    console.log('Data:', data);
  }
}

// Auto-recalculate scores on startup
async function autoRecalculateScores() {
  try {
    addLog('info', 'Starting auto-recalculation of user scores...');
    
    const calls = await db.getAllActiveCalls();
    const userScores = {};
    
    // Calculate scores for each user
    for (const call of calls) {
      if (call.user && call.user.username) {
        const username = call.user.username;
        if (!userScores[username]) {
          userScores[username] = {
            totalCalls: 0,
            totalScore: 0,
            wins: 0,
            calls: []
          };
        }
        
        userScores[username].totalCalls++;
        userScores[username].calls.push(call);
        
        const pnl = parseFloat(call.pnlPercent) || 0;
        if (pnl > 0) {
          userScores[username].wins++;
        }
        
        // Calculate score based on PnL
        const score = Math.max(0, pnl); // Only positive PnL counts
        userScores[username].totalScore += score;
      }
    }
    
    // Update user scores in database
    for (const [username, data] of Object.entries(userScores)) {
      const winRate = data.totalCalls > 0 ? (data.wins / data.totalCalls) * 100 : 0;
      
      await db.updateUser(username, {
        totalCalls: data.totalCalls,
        totalScore: data.totalScore,
        winRate: winRate,
        lastUpdated: new Date().toISOString()
      });
    }
    
    addLog('success', `Auto-recalculation completed. Updated ${Object.keys(userScores).length} users.`);
  } catch (error) {
    addLog('error', 'Auto-recalculation failed', error.message);
  }
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// Dashboard stats endpoint
app.get('/api/dashboard/stats', async (req, res) => {
  try {
    addLog('info', 'Fetching dashboard stats');
    
    // Always fetch fresh data from Firebase
    const calls = await db.getAllActiveCalls();
    const users = await db.getAllUsers();
    
    const totalCalls = calls.length;
    const activeCalls = calls.filter(call => {
      const createdAt = new Date(call.createdAt || call.callTime);
      const hoursSinceCall = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);
      return hoursSinceCall < 24; // Active if less than 24 hours old
    }).length;
    
    const totalUsers = users.length;
    
    // Calculate average PnL
    const validPnls = calls
      .map(call => parseFloat(call.pnlPercent))
      .filter(pnl => !isNaN(pnl) && isFinite(pnl));
    
    const avgPnL = validPnls.length > 0 
      ? validPnls.reduce((sum, pnl) => sum + pnl, 0) / validPnls.length 
      : 0;
    
    // Find best call
    const bestCall = validPnls.length > 0 ? Math.max(...validPnls) : 0;
    
    const stats = {
      totalCalls,
      activeCalls,
      totalUsers,
      avgPnL: parseFloat(avgPnL.toFixed(2)),
      bestCall: parseFloat(bestCall.toFixed(2)),
      lastUpdated: new Date().toISOString()
    };
    
    cachedStats = stats;
    addLog('success', 'Dashboard stats fetched successfully', stats);
    res.json({ success: true, data: stats });
  } catch (error) {
    addLog('error', 'Failed to fetch dashboard stats', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Dashboard calls endpoint
app.get('/api/dashboard/calls', async (req, res) => {
  try {
    addLog('info', 'Fetching dashboard calls');
    
    // Always fetch fresh data from Firebase
    const calls = await db.getAllActiveCalls();
    
    // Sort by PnL (highest first)
    const sortedCalls = calls.sort((a, b) => {
      const pnlA = parseFloat(a.pnlPercent) || 0;
      const pnlB = parseFloat(b.pnlPercent) || 0;
      return pnlB - pnlA;
    });
    
    addLog('success', `Fetched ${sortedCalls.length} calls`);
    res.json({ success: true, data: sortedCalls });
  } catch (error) {
    addLog('error', 'Failed to fetch dashboard calls', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Dashboard logs endpoint
app.get('/api/dashboard/logs', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const logsToReturn = logs.slice(-limit).reverse();
    res.json({ success: true, data: logsToReturn });
  } catch (error) {
    addLog('error', 'Failed to fetch logs', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Single token refresh endpoint
app.post('/api/dashboard/refresh/:contractAddress', async (req, res) => {
  try {
    const { contractAddress } = req.params;
    addLog('info', `Manual refresh requested for token: ${contractAddress}`);
    
    // Add 3-second delay for PnL calculation processing
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Find the call in the database
    const calls = await db.getAllActiveCalls();
    const call = calls.find(c => c.contractAddress === contractAddress);
    
    if (!call) {
      addLog('error', `Call not found for contract: ${contractAddress}`);
      return res.status(404).json({ success: false, error: 'Call not found' });
    }

    // Use deterministic calculation method
    const result = await pnlService.refreshCall(call);
    
    if (result && result.success && result.pnlPercent !== undefined && !isNaN(result.pnlPercent)) {
      // Update the call in the database with deterministic data
      await db.updateCall(call.id, {
        pnlPercent: result.pnlPercent,
        maxPnl: result.maxPnl,
        currentMarketCap: result.data?.currentMcap || call.currentMarketCap,
        maxMcapSinceCall: result.data?.maxMcapSinceCall,
        maxMcapTimestamp: result.data?.maxMcapTimestamp,
        milestones: result.data?.milestones || call.milestones || {},
        updatedAt: new Date().toISOString(),
        sourceStamp: result.data?.sourceStamp,
        calculationType: result.calculationType
      });
      
      addLog('success', `Token refreshed successfully: ${contractAddress}`, result);
      res.json({ success: true, data: result });
    } else {
      addLog('error', `Invalid PnL result for ${contractAddress}:`, result);
      res.status(400).json({ success: false, error: `PnL calculation failed: ${result?.error || 'Unknown error'}` });
    }
  } catch (error) {
    addLog('error', `Error refreshing token: ${req.params.contractAddress}`, error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Queue-driven refresh all endpoint
app.post('/api/dashboard/refresh-all', async (req, res) => {
  try {
    addLog('info', 'Starting queue-driven refresh-all process');
    
    const calls = await db.getAllActiveCalls();
    const batchId = `refresh_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Create queue in Firebase
    const queueRef = `queues/refreshAll/${batchId}`;
    await db.set(queueRef, {
      batchId,
      status: 'pending',
      totalItems: calls.length,
      processedItems: 0,
      createdAt: new Date().toISOString()
    });
    
    // Add items to queue
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      await db.set(`${queueRef}/items/${i}`, {
        contractAddress: call.contractAddress,
        callId: call.id,
        status: 'pending',
        createdAt: new Date().toISOString()
      });
    }
    
    // Process queue items sequentially to avoid race conditions
    const results = [];
    for (let i = 0; i < calls.length; i++) {
      try {
        const call = calls[i];
        addLog('info', `Processing queue item ${i + 1}/${calls.length}: ${call.contractAddress}`);
        
        // Update queue item status
        await db.set(`${queueRef}/items/${i}/status`, 'processing');
        
        // Refresh call with deterministic calculation
        const result = await pnlService.refreshCall(call);
        
        if (result && result.success) {
          // Update call in database
          await db.updateCall(call.id, {
            pnlPercent: result.pnlPercent,
            maxPnl: result.maxPnl,
            currentMarketCap: result.data?.currentMcap || call.currentMarketCap,
            maxMcapSinceCall: result.data?.maxMcapSinceCall,
            maxMcapTimestamp: result.data?.maxMcapTimestamp,
            milestones: result.data?.milestones || call.milestones || {},
            updatedAt: new Date().toISOString(),
            sourceStamp: result.data?.sourceStamp,
            calculationType: result.calculationType
          });
          
          await db.set(`${queueRef}/items/${i}/status`, 'completed');
          results.push({
            contractAddress: call.contractAddress,
            success: true,
            pnlPercent: result.pnlPercent,
            calculationType: result.calculationType
          });
        } else {
          await db.set(`${queueRef}/items/${i}/status`, 'failed');
          results.push({
            contractAddress: call.contractAddress,
            success: false,
            error: result?.error || 'Unknown error'
          });
        }
        
        // Add delay between items to avoid rate limiting
        if (i < calls.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 4000));
        }
        
      } catch (error) {
        addLog('error', `Error processing queue item ${i + 1}: ${calls[i].contractAddress}`, error.message);
        await db.set(`${queueRef}/items/${i}/status`, 'failed');
        results.push({
          contractAddress: calls[i].contractAddress,
          success: false,
          error: error.message
        });
      }
    }
    
    // Update queue status
    await db.set(`${queueRef}/status`, 'completed');
    await db.set(`${queueRef}/completedAt`, new Date().toISOString());
    
    addLog('success', `Queue-driven refresh-all completed. Processed ${results.length} items`);
    res.json({ success: true, data: results, batchId });
    
  } catch (error) {
    addLog('error', 'Queue-driven refresh-all failed', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Alias for refresh-all
app.post('/api/refresh-all', async (req, res) => {
  // Redirect to dashboard refresh-all
  req.url = '/api/dashboard/refresh-all';
  app._router.handle(req, res);
});

// Recalculate all endpoint
app.post('/api/dashboard/recalculate-all', async (req, res) => {
  try {
    addLog('info', 'Starting recalculation process');
    
    const calls = await db.getAllActiveCalls();
    const results = [];
    
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      
      try {
        addLog('info', `Recalculating ${i + 1}/${calls.length}: ${call.contractAddress}`);
        
        // Use deterministic calculation method
        const result = await pnlService.refreshCall(call);
        
        if (result && result.success) {
          // Update call in database
          await db.updateCall(call.id, {
            pnlPercent: result.pnlPercent,
            maxPnl: result.maxPnl,
            currentMarketCap: result.data?.currentMcap || call.currentMarketCap,
            maxMcapSinceCall: result.data?.maxMcapSinceCall,
            maxMcapTimestamp: result.data?.maxMcapTimestamp,
            milestones: result.data?.milestones || call.milestones || {},
            updatedAt: new Date().toISOString(),
            sourceStamp: result.data?.sourceStamp,
            calculationType: result.calculationType
          });
          
          results.push({
            contractAddress: call.contractAddress,
            success: true,
            pnlPercent: result.pnlPercent,
            calculationType: result.calculationType
          });
        } else {
          results.push({
            contractAddress: call.contractAddress,
            success: false,
            error: result?.error || 'Unknown error'
          });
        }
        
        // Add delay between calculations
        if (i < calls.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
        
      } catch (error) {
        addLog('error', `Error recalculating ${call.contractAddress}`, error.message);
        results.push({
          contractAddress: call.contractAddress,
          success: false,
          error: error.message
        });
      }
    }
    
    addLog('success', `Recalculation completed. Processed ${results.length} calls`);
    res.json({ success: true, data: results });
    
  } catch (error) {
    addLog('error', 'Recalculation failed', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Fix errors endpoint (now uses anomaly detection)
app.post('/api/dashboard/fix-errors', async (req, res) => {
  try {
    addLog('info', 'Starting anomaly detection and fixing process');
    
    const calls = await db.getAllActiveCalls();
    const fixedCalls = [];
    
    for (const call of calls) {
      try {
        // Get fresh token data for anomaly detection
        const tokenData = await solanaService.getTokenData(call.contractAddress);
        
        if (tokenData) {
          // Use deterministic calculation to detect anomalies
          const result = await pnlService.calculateDeterministicPnl(call, tokenData);
          
          if (result && result.success) {
            // Check if there were anomalies detected
            if (result.data?.anomalyCheck?.isAnomaly) {
              addLog('info', `Anomaly detected for ${call.contractAddress}: ${result.data.anomalyCheck.reason}`);
              
              // Reset max mcap to current mcap to clear anomaly
              await db.updateCall(call.id, {
                maxMcapSinceCall: result.data.currentMcap,
                maxMcapTimestamp: Date.now(),
                anomalyDetected: true,
                anomalyReason: result.data.anomalyCheck.reason,
                anomalyFixedAt: new Date().toISOString()
              });
              
              fixedCalls.push({
                contractAddress: call.contractAddress,
                fixed: 'anomaly_detected',
                reason: result.data.anomalyCheck.reason,
                zScore: result.data.anomalyCheck.zScore
              });
            }
          }
        }
      } catch (error) {
        addLog('error', `Error checking anomalies for ${call.contractAddress}`, error.message);
      }
    }
    
    addLog('success', `Anomaly detection completed. Fixed ${fixedCalls.length} calls`);
    res.json({ success: true, data: fixedCalls });
  } catch (error) {
    addLog('error', 'Anomaly detection process failed', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Main dashboard route
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Jack of all Scans - Backend Dashboard</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #1a1a1a; color: #fff; }
        .container { max-width: 1200px; margin: 0 auto; }
        .header { text-align: center; margin-bottom: 30px; }
        .header h1 { color: #00ff88; margin: 0; }
        .header p { color: #888; margin: 10px 0; }
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .stat-card { background: #2a2a2a; padding: 20px; border-radius: 8px; border-left: 4px solid #00ff88; }
        .stat-card h3 { margin: 0 0 10px 0; color: #00ff88; }
        .stat-card .value { font-size: 24px; font-weight: bold; color: #fff; }
        .actions { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .action-card { background: #2a2a2a; padding: 20px; border-radius: 8px; border: 1px solid #444; }
        .action-card h3 { margin: 0 0 15px 0; color: #00ff88; }
        .btn { background: #00ff88; color: #000; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; font-weight: bold; margin: 5px; }
        .btn:hover { background: #00cc6a; }
        .btn.danger { background: #ff4444; color: #fff; }
        .btn.danger:hover { background: #cc3333; }
        .logs { background: #1a1a1a; border: 1px solid #444; border-radius: 8px; padding: 20px; max-height: 400px; overflow-y: auto; }
        .log-entry { margin: 5px 0; padding: 5px; border-radius: 4px; }
        .log-info { background: #2a2a2a; }
        .log-success { background: #1a4a1a; }
        .log-error { background: #4a1a1a; }
        .status { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
        .status.healthy { background: #1a4a1a; color: #00ff88; }
        .status.error { background: #4a1a1a; color: #ff4444; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚀 Jack of all Scans - Backend Dashboard</h1>
            <p>Deterministic PnL Calculation System - Race-safe & Drift-free</p>
            <div class="status healthy">SYSTEM HEALTHY</div>
        </div>
        
        <div class="stats">
            <div class="stat-card">
                <h3>Total Calls</h3>
                <div class="value" id="totalCalls">Loading...</div>
            </div>
            <div class="stat-card">
                <h3>Active Calls</h3>
                <div class="value" id="activeCalls">Loading...</div>
            </div>
            <div class="stat-card">
                <h3>Total Users</h3>
                <div class="value" id="totalUsers">Loading...</div>
            </div>
            <div class="stat-card">
                <h3>Avg PnL</h3>
                <div class="value" id="avgPnL">Loading...</div>
            </div>
        </div>
        
        <div class="actions">
            <div class="action-card">
                <h3>🔄 Refresh Operations</h3>
                <button class="btn" onclick="refreshAll()">Refresh All Tokens</button>
                <button class="btn" onclick="recalculateAll()">Recalculate All PnL</button>
                <button class="btn" onclick="fixErrors()">Fix Anomalies</button>
            </div>
            <div class="action-card">
                <h3>📊 Data Management</h3>
                <button class="btn" onclick="loadStats()">Load Stats</button>
                <button class="btn" onclick="loadCalls()">Load Calls</button>
                <button class="btn" onclick="loadLogs()">Load Logs</button>
            </div>
            <div class="action-card">
                <h3>🔧 System</h3>
                <button class="btn" onclick="checkHealth()">Health Check</button>
                <button class="btn danger" onclick="clearLogs()">Clear Logs</button>
            </div>
        </div>
        
        <div class="logs">
            <h3>📋 System Logs</h3>
            <div id="logContainer">Loading logs...</div>
        </div>
    </div>

    <script>
        const API_BASE = window.location.origin;
        
        async function loadStats() {
            try {
                const response = await fetch(API_BASE + '/api/dashboard/stats');
                const data = await response.json();
                
                if (data.success) {
                    document.getElementById('totalCalls').textContent = data.data.totalCalls;
                    document.getElementById('activeCalls').textContent = data.data.activeCalls;
                    document.getElementById('totalUsers').textContent = data.data.totalUsers;
                    document.getElementById('avgPnL').textContent = data.data.avgPnL + '%';
                }
            } catch (error) {
                console.error('Error loading stats:', error);
            }
        }
        
        async function refreshAll() {
            try {
                const response = await fetch(API_BASE + '/api/dashboard/refresh-all', { method: 'POST' });
                const data = await response.json();
                alert('Refresh All: ' + (data.success ? 'Success' : 'Failed'));
                loadStats();
            } catch (error) {
                console.error('Error refreshing all:', error);
                alert('Error refreshing all tokens');
            }
        }
        
        async function recalculateAll() {
            try {
                const response = await fetch(API_BASE + '/api/dashboard/recalculate-all', { method: 'POST' });
                const data = await response.json();
                alert('Recalculate All: ' + (data.success ? 'Success' : 'Failed'));
                loadStats();
            } catch (error) {
                console.error('Error recalculating all:', error);
                alert('Error recalculating all PnL');
            }
        }
        
        async function fixErrors() {
            try {
                const response = await fetch(API_BASE + '/api/dashboard/fix-errors', { method: 'POST' });
                const data = await response.json();
                alert('Fix Errors: ' + (data.success ? 'Success' : 'Failed'));
                loadStats();
            } catch (error) {
                console.error('Error fixing errors:', error);
                alert('Error fixing anomalies');
            }
        }
        
        async function loadCalls() {
            try {
                const response = await fetch(API_BASE + '/api/dashboard/calls');
                const data = await response.json();
                console.log('Calls data:', data);
                alert('Calls loaded. Check console for details.');
            } catch (error) {
                console.error('Error loading calls:', error);
                alert('Error loading calls');
            }
        }
        
        async function loadLogs() {
            try {
                const response = await fetch(API_BASE + '/api/dashboard/logs');
                const data = await response.json();
                
                if (data.success) {
                    const logContainer = document.getElementById('logContainer');
                    logContainer.innerHTML = data.data.map(log => 
                        '<div class="log-entry log-' + log.type + '">' +
                        '[' + log.timestamp + '] ' + log.type.toUpperCase() + ': ' + log.message +
                        '</div>'
                    ).join('');
                }
            } catch (error) {
                console.error('Error loading logs:', error);
            }
        }
        
        async function checkHealth() {
            try {
                const response = await fetch(API_BASE + '/api/health');
                const data = await response.json();
                alert('Health Check: ' + data.status);
            } catch (error) {
                console.error('Error checking health:', error);
                alert('Error checking health');
            }
        }
        
        function clearLogs() {
            if (confirm('Are you sure you want to clear all logs?')) {
                document.getElementById('logContainer').innerHTML = 'Logs cleared.';
            }
        }
        
        // Load initial data
        loadStats();
        loadLogs();
        
        // Auto-refresh every 30 seconds
        setInterval(() => {
            loadStats();
            loadLogs();
        }, 30000);
    </script>
</body>
</html>
  `);
});

// Calls endpoint for frontend
app.get('/api/calls', async (req, res) => {
  try {
    addLog('info', 'Fetching calls for frontend');
    
    // Always fetch fresh data from Firebase
    const calls = await db.getAllActiveCalls();
    
    // Add Twitter linking information for each call
    const callsWithTwitter = calls.map(call => {
      const twitterInfo = call.user?.twitterInfo || {};
      return {
        ...call,
        user: {
          ...call.user,
          username: call.user?.username || twitterInfo.twitterUsername,
          twitterId: twitterInfo.twitterId,
          profilePictureUrl: twitterInfo.profilePictureUrl
        }
      };
    });
    
    addLog('success', `Fetched ${callsWithTwitter.length} calls with Twitter data`);
    res.json({ success: true, data: callsWithTwitter });
  } catch (error) {
    addLog('error', 'Failed to fetch calls for frontend', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// User profile endpoint
app.get('/api/user-profile/:twitterId', async (req, res) => {
  try {
    const { twitterId } = req.params;
    addLog('info', `Fetching user profile for Twitter ID: ${twitterId}`);
    
    const user = await db.getUserByTwitterId(twitterId);
    
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    // Get user's calls
    const calls = await db.getCallsByUser(twitterId);
    
    const profile = {
      ...user,
      calls: calls,
      totalCalls: calls.length,
      avgPnL: calls.length > 0 ? calls.reduce((sum, call) => sum + (parseFloat(call.pnlPercent) || 0), 0) / calls.length : 0,
      bestCall: calls.length > 0 ? Math.max(...calls.map(call => parseFloat(call.pnlPercent) || 0)) : 0
    };
    
    addLog('success', `User profile fetched for ${twitterId}`);
    res.json({ success: true, data: profile });
  } catch (error) {
    addLog('error', `Failed to fetch user profile for ${req.params.twitterId}`, error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Leaderboard endpoint
app.get('/api/leaderboard', async (req, res) => {
  try {
    addLog('info', 'Fetching leaderboard');
    
    const users = await db.getAllUsers();
    
    // Calculate leaderboard data
    const leaderboard = users.map(user => {
      const totalCalls = user.totalCalls || 0;
      const wins = user.wins || 0;
      const winRate = totalCalls > 0 ? (wins / totalCalls) * 100 : 0;
      
      return {
        username: user.username,
        totalCalls: totalCalls,
        totalScore: user.totalScore || 0,
        winRate: parseFloat(winRate.toFixed(1)),
        twitterId: user.twitterId,
        profilePictureUrl: user.profilePictureUrl
      };
    }).sort((a, b) => b.totalScore - a.totalScore);
    
    addLog('success', `Leaderboard calculated with ${leaderboard.length} users`);
    res.json({ success: true, data: leaderboard });
  } catch (error) {
    addLog('error', 'Failed to fetch leaderboard', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Generate linking code endpoint
app.post('/api/generate-linking-code', async (req, res) => {
  try {
    const { twitterId, twitterUsername, twitterName, profilePictureUrl } = req.body;
    
    if (!twitterId || !twitterUsername) {
      return res.status(400).json({ success: false, error: 'Twitter ID and username are required' });
    }
    
    // Generate a 6-digit linking code
    const linkingCode = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Store the linking code with expiration (24 hours)
    const linkingData = {
      twitterId,
      twitterUsername,
      twitterName,
      profilePictureUrl,
      linkingCode,
      expiresAt: Date.now() + (24 * 60 * 60 * 1000), // 24 hours
      createdAt: new Date().toISOString()
    };
    
    await db.set(`linkingCodes/${linkingCode}`, linkingData);
    
    addLog('success', `Linking code generated for ${twitterUsername}: ${linkingCode}`);
    res.json({ 
      success: true, 
      data: { 
        linkingCode, 
        expiresIn: 24 * 60 * 60 * 1000 
      } 
    });
  } catch (error) {
    addLog('error', 'Failed to generate linking code', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Initialize real-time listeners (disabled for Vercel)
if (process.env.NODE_ENV !== 'production') {
  setupRealtimeListeners();
  addLog('info', 'Real-time listeners initialized');
} else {
  addLog('info', 'Real-time listeners disabled for Vercel deployment');
}

// Auto-recalculate scores on startup
autoRecalculateScores();

// Start server (only if not in production for Vercel)
if (process.env.NODE_ENV !== 'production') {
  server.listen(PORT, () => {
    addLog('success', `Server running on port ${PORT}`);
    console.log(`🚀 Jack of all Scans Backend running on port ${PORT}`);
  });
} else {
  addLog('info', 'Server initialized for Vercel deployment');
}

module.exports = app;
