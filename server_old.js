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
      
      // Emit to all connected clients
      io.emit('calls_updated', calls);
    } else {
      cachedCalls = [];
      addLog('warning', 'Real-time update: No calls found');
      io.emit('calls_updated', []);
    }
  }, (error) => {
    addLog('error', 'Real-time listener error:', error.message);
  });

  // Listen to tokens changes
  const tokensRef = ref(database, 'tokens');
  onValue(tokensRef, (snapshot) => {
    if (snapshot.exists()) {
      addLog('info', `Real-time update: ${snapshot.size} tokens loaded`);
      io.emit('tokens_updated', snapshot.size);
    }
  });

  addLog('success', 'Real-time Firebase listeners initialized');
}

// In-memory log storage for real-time dashboard
const logs = [];
const maxLogs = 1000;

// Helper function to add logs
function addLog(level, message, data = null) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    data: data ? JSON.stringify(data, null, 2) : null
  };
  logs.unshift(logEntry);
  if (logs.length > maxLogs) {
    logs.pop();
  }
  console.log(`[${logEntry.timestamp}] ${level.toUpperCase()}: ${message}`);
}

// Helper function to calculate score (multiplier-based system)
function calculateScore(pnlPercent, entryMarketCap, callRank = 1) {
  // Convert PnL percentage to multiplier (e.g., 100% = 2x, 200% = 3x)
  const multiplier = (pnlPercent / 100) + 1;
  
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
  }
  
  const finalScore = baseScore * marketCapMultiplier;
  return finalScore;
}

// Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Solana Tracker API is running' });
});

// Dashboard API endpoints
app.get('/api/dashboard/stats', async (req, res) => {
  try {
    addLog('info', 'Fetching dashboard stats');
    
    // Always fetch fresh data from database (don't rely on cache for Vercel)
    const calls = await db.getAllActiveCalls();
    addLog('info', `Fetched ${calls.length} calls from database`);
    
    // Get tokens count from Firebase
    let tokensCount = 0;
    try {
      const tokensRef = ref(database, 'tokens');
      const tokensSnapshot = await get(tokensRef);
      tokensCount = tokensSnapshot.exists() ? tokensSnapshot.size : 0;
      addLog('info', `Fetched ${tokensCount} tokens from database`);
        } catch (error) {
      addLog('warning', 'Could not fetch tokens count:', error.message);
    }
    
    const stats = {
      totalCalls: calls.length,
      totalTokens: tokensCount,
      activeCalls: calls.filter(call => call.status === 'active').length,
      completedCalls: calls.filter(call => call.status === 'completed').length,
      totalUsers: [...new Set(calls.map(call => call.userId))].length,
      averagePnl: calls.length > 0 ? calls.reduce((sum, call) => sum + (call.pnlPercent || 0), 0) / calls.length : 0,
      bestCall: calls.length > 0 ? Math.max(...calls.map(call => call.pnlPercent || 0)) : 0,
      worstCall: calls.length > 0 ? Math.min(...calls.map(call => call.pnlPercent || 0)) : 0,
      systemUptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      lastUpdated: new Date().toISOString()
    };
    
    addLog('success', 'Dashboard stats fetched successfully', stats);
    res.json({ success: true, data: stats });
  } catch (error) {
    addLog('error', 'Failed to fetch dashboard stats', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/dashboard/calls', async (req, res) => {
  try {
    addLog('info', 'Fetching dashboard calls');
    
    const calls = await db.getAllActiveCalls();
    addLog('info', `Fetched ${calls.length} calls from database`);
    
    const transformedCalls = calls.map(call => ({
        id: call.id,
        contractAddress: call.contractAddress,
      tokenName: call.tokenName,
      tokenSymbol: call.tokenSymbol,
      pnlPercent: call.pnlPercent || 0,
      score: call.score || 0,
      status: call.status || 'active',
        createdAt: call.createdAt,
        updatedAt: call.updatedAt,
      userId: call.userId,
          username: call.username,
          entryMarketCap: call.entryMarketCap,
      currentMarketCap: call.currentMarketCap,
      image: call.image || null
    }));
    
    addLog('info', `Fetched ${transformedCalls.length} calls for dashboard`);
    res.json({ success: true, data: transformedCalls });
  } catch (error) {
    addLog('error', 'Failed to fetch dashboard calls', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/dashboard/logs', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const level = req.query.level;
  
  let filteredLogs = logs;
  if (level) {
    filteredLogs = logs.filter(log => log.level === level);
  }
  
  res.json({ 
    success: true, 
    data: filteredLogs.slice(0, limit),
    total: logs.length
  });
});

app.post('/api/dashboard/refresh/:contractAddress', async (req, res) => {
  try {
    const { contractAddress } = req.params;
    addLog('info', `Manual refresh requested for token: ${contractAddress}`);
    
    // Add 3-second delay for PnL calculation processing (increased for better data)
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Find the call in the database
    const calls = await db.getAllActiveCalls();
    const call = calls.find(c => c.contractAddress === contractAddress);
    
    if (!call) {
      addLog('error', `Call not found for contract: ${contractAddress}`);
      return res.status(404).json({ success: false, error: 'Call not found' });
    }

    // Use correct calculation method
    const result = await pnlService.calculateAccuratePnl(call);
    
    if (result && result.pnlPercent !== undefined && !isNaN(result.pnlPercent)) {
      // Check for corruption and fix if needed
      const fixedCall = pnlService.fixCorruptedMaxPnl(call, result.data?.tokenData);
      
      // Update the call in the database with new PnL and maxPnl tracking
      const currentMaxPnl = parseFloat(fixedCall.maxPnl) || 0;
      const newMaxPnl = Math.max(currentMaxPnl, result.pnlPercent);
      
      await db.updateCall(call.id, {
        pnlPercent: result.pnlPercent,
        maxPnl: newMaxPnl,
        currentMarketCap: result.data?.currentMarketCap || call.currentMarketCap,
        updatedAt: new Date().toISOString(),
        ...(fixedCall.corruptionFixed && {
          corruptionFixed: true,
          corruptionFixedAt: fixedCall.corruptionFixedAt,
          previousCorruptedMaxPnl: fixedCall.previousCorruptedMaxPnl
        })
      });
      
      addLog('success', `Token refreshed successfully: ${contractAddress}`, result);
      res.json({ success: true, data: result });
    } else {
      addLog('error', `Invalid PnL result for ${contractAddress}:`, result);
      res.status(400).json({ success: false, error: `PnL calculation failed: ${result?.reason || 'Unknown error'}` });
    }
  } catch (error) {
    addLog('error', `Error refreshing token: ${req.params.contractAddress}`, error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/dashboard/refresh-all', async (req, res) => {
  try {
    addLog('info', 'Starting bulk refresh of all calls');
    
    const calls = await db.getAllActiveCalls();
    const results = [];
    
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      try {
        addLog('info', `Refreshing call ${i + 1}/${calls.length}: ${call.contractAddress}`);
        
        // Add 4-second delay between each refresh to avoid rate limiting
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 4000));
        }
        
        // Use improved calculation method
        const result = await pnlService.calculateAccuratePnl(call);
        
        if (result && result.pnlPercent !== undefined && !isNaN(result.pnlPercent)) {
          // Update the call in the database with new PnL and maxPnl tracking
          const currentMaxPnl = parseFloat(call.maxPnl) || 0;
          const newMaxPnl = Math.max(currentMaxPnl, result.pnlPercent);
          
          await db.updateCall(call.id, {
            pnlPercent: result.pnlPercent,
            maxPnl: newMaxPnl,
            currentMarketCap: result.data?.currentMarketCap || call.currentMarketCap,
            updatedAt: new Date().toISOString()
          });
          
          results.push({
            contractAddress: call.contractAddress,
            success: true,
            pnlPercent: result.pnlPercent,
            maxPnl: newMaxPnl,
            data: result
          });
          
          addLog('success', `Call refreshed: ${call.contractAddress}`, result);
        } else {
          addLog('error', `Invalid PnL result for ${call.contractAddress}:`, result);
          results.push({
            contractAddress: call.contractAddress,
            success: false,
            error: `PnL calculation failed: ${result?.reason || 'Unknown error'}`
          });
        }
      } catch (error) {
        addLog('error', `Error refreshing call: ${call.contractAddress}`, error.message);
        results.push({
          contractAddress: call.contractAddress,
          success: false,
          error: error.message
        });
      }
    }
    
    const successful = results.filter(r => r.success).length;
    addLog('success', `Bulk refresh completed. ${successful}/${results.length} successful`);
    res.json({ success: true, data: results });
  } catch (error) {
    addLog('error', 'Bulk refresh failed', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Alias for the frontend refresh-all endpoint (calls the same logic)
app.post('/api/refresh-all', async (req, res) => {
  try {
    addLog('info', 'Starting bulk refresh of all calls (frontend endpoint)');
    
    const calls = await db.getAllActiveCalls();
    const results = [];
    
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      try {
        addLog('info', `Refreshing call ${i + 1}/${calls.length}: ${call.contractAddress}`);
        
        // Add 4-second delay between each refresh to avoid rate limiting (same as dashboard)
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 4000));
        }
        
            // Use correct calculation method
    const result = await pnlService.calculateAccuratePnl(call);
    
    if (result && result.pnlPercent !== undefined && !isNaN(result.pnlPercent)) {
      // Check for corruption and fix if needed
      const fixedCall = pnlService.fixCorruptedMaxPnl(call, result.data?.tokenData);
      
      // Update the call in the database with new PnL and maxPnl tracking
      const currentMaxPnl = parseFloat(fixedCall.maxPnl) || 0;
      const newMaxPnl = Math.max(currentMaxPnl, result.pnlPercent);
      
      await db.updateCall(call.id, {
        pnlPercent: result.pnlPercent,
        maxPnl: newMaxPnl,
        currentMarketCap: result.data?.currentMarketCap || call.currentMarketCap,
        updatedAt: new Date().toISOString(),
        ...(fixedCall.corruptionFixed && {
          corruptionFixed: true,
          corruptionFixedAt: fixedCall.corruptionFixedAt,
          previousCorruptedMaxPnl: fixedCall.previousCorruptedMaxPnl
        })
      });
          
          results.push({
            contractAddress: call.contractAddress,
            success: true,
            pnlPercent: result.pnlPercent,
            maxPnl: newMaxPnl,
            data: result
          });
          
          addLog('success', `Call refreshed: ${call.contractAddress}`, result);
        } else {
          addLog('error', `Invalid PnL result for ${call.contractAddress}:`, result);
          results.push({
            contractAddress: call.contractAddress,
            success: false,
            error: `PnL calculation failed: ${result?.reason || 'Unknown error'}`
          });
        }
      } catch (error) {
        addLog('error', `Error refreshing call: ${call.contractAddress}`, error.message);
        results.push({
          contractAddress: call.contractAddress,
          success: false,
          error: error.message
        });
      }
    }
    
    const successful = results.filter(r => r.success).length;
    addLog('success', `Bulk refresh completed. ${successful}/${results.length} successful`);
    res.json({ success: true, data: results });
  } catch (error) {
    addLog('error', 'Bulk refresh failed', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/dashboard/recalculate-all', async (req, res) => {
  try {
    addLog('info', 'Starting bulk recalculation of all calls');
    
    const calls = await db.getAllActiveCalls();
    const results = [];
    
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      try {
        addLog('info', `Recalculating call ${i + 1}/${calls.length}: ${call.contractAddress}`);
        
        // Add 3-second delay between each recalculation to avoid rate limiting
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
        
        // Use improved calculation method
        const result = await pnlService.calculateAccuratePnl(call);
        
        if (result && result.pnlPercent !== undefined && !isNaN(result.pnlPercent)) {
          // Update the call in the database with new PnL and maxPnl tracking
          const currentMaxPnl = parseFloat(call.maxPnl) || 0;
          const newMaxPnl = Math.max(currentMaxPnl, result.pnlPercent);
          
          await db.updateCall(call.id, {
            pnlPercent: result.pnlPercent,
            maxPnl: newMaxPnl,
            currentMarketCap: result.data?.currentMarketCap || call.currentMarketCap,
            updatedAt: new Date().toISOString()
          });
          
          results.push({
            contractAddress: call.contractAddress,
            success: true,
            pnlPercent: result.pnlPercent,
            maxPnl: newMaxPnl,
            data: result
          });
        } else {
          results.push({
            contractAddress: call.contractAddress,
            success: false,
            error: `PnL calculation failed: ${result?.reason || 'Unknown error'}`
          });
        }
      } catch (error) {
        addLog('error', `Error recalculating call: ${call.contractAddress}`, error.message);
        results.push({
          contractAddress: call.contractAddress,
          success: false,
          error: error.message
        });
      }
    }
    
    const successful = results.filter(r => r.success).length;
    addLog('success', `Bulk recalculation completed. ${successful}/${results.length} successful`);
    res.json({ success: true, data: results });
  } catch (error) {
    addLog('error', 'Bulk recalculation failed', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/dashboard/fix-errors', async (req, res) => {
  try {
    addLog('info', 'Starting corruption fixing process');
    
    const calls = await db.getAllActiveCalls();
    const fixedCalls = [];
    
    for (const call of calls) {
      try {
        // Get fresh token data to check for corruption
        const SolanaTrackerService = require('./services/SolanaTrackerService');
        const solanaService = new SolanaTrackerService();
        const tokenData = await solanaService.getTokenData(call.contractAddress);
        
        if (tokenData) {
          // Check if maxPnl needs reset using corruption detection
          if (pnlService.shouldResetMaxPnl(call, tokenData)) {
            addLog('info', `Fixing corrupted maxPnl for call: ${call.contractAddress}`);
            
            // Fix corrupted maxPnl
            const fixedCall = pnlService.fixCorruptedMaxPnl(call, tokenData);
            
            await db.updateCall(call.id, {
              maxPnl: fixedCall.maxPnl,
              corruptionFixed: true,
              corruptionFixedAt: fixedCall.corruptionFixedAt,
              previousCorruptedMaxPnl: fixedCall.previousCorruptedMaxPnl
            });
            
            fixedCalls.push({
              contractAddress: call.contractAddress,
              fixed: 'maxPnl',
              oldValue: call.maxPnl,
              newValue: fixedCall.maxPnl,
              reason: 'Corruption detected and fixed'
            });
          }
        }
      } catch (error) {
        addLog('error', `Error fixing call: ${call.contractAddress}`, error.message);
      }
    }
    
    addLog('success', `Corruption fixing completed. Fixed ${fixedCalls.length} calls`);
    res.json({ success: true, data: fixedCalls });
  } catch (error) {
    addLog('error', 'Error fixing process failed', error.message);
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
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
            min-height: 100vh;
            color: #333;
        }
        .container {
            max-width: 1400px;
            margin: 0 auto;
            padding: 20px;
        }
        .header {
            background: rgba(255, 255, 255, 0.95);
            border-radius: 15px;
            padding: 30px;
            margin-bottom: 30px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
            text-align: center;
        }
        .header h1 {
            color: #2c3e50;
            font-size: 2.5em;
            margin-bottom: 10px;
        }
        .header p {
            color: #7f8c8d;
            font-size: 1.2em;
        }
        .dashboard-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 30px;
            margin-bottom: 30px;
        }
        .card {
            background: rgba(255, 255, 255, 0.95);
            border-radius: 15px;
            padding: 25px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
        }
        .card h2 {
            color: #2c3e50;
            margin-bottom: 20px;
            font-size: 1.5em;
            border-bottom: 2px solid #3498db;
            padding-bottom: 10px;
        }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .stat-card {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
            border-radius: 10px;
            text-align: center;
        }
        .stat-value {
            font-size: 2em;
            font-weight: bold;
            margin-bottom: 5px;
        }
        .stat-label {
            font-size: 0.9em;
            opacity: 0.9;
        }
        .controls {
            display: flex;
            gap: 15px;
            margin-bottom: 20px;
            flex-wrap: wrap;
        }
        .btn {
            background: linear-gradient(135deg, #3498db, #2980b9);
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            transition: all 0.3s ease;
        }
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(52, 152, 219, 0.4);
        }
        .btn-success { background: linear-gradient(135deg, #27ae60, #229954); }
        .btn-warning { background: linear-gradient(135deg, #f39c12, #e67e22); }
        .btn-danger { background: linear-gradient(135deg, #e74c3c, #c0392b); }
        .btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }
        .table-container {
            max-height: 400px;
            overflow-y: auto;
            border-radius: 10px;
            border: 1px solid #ddd;
        }
        table {
            width: 100%;
            border-collapse: collapse;
        }
        th, td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #eee;
        }
        th {
            background: #f8f9fa;
            font-weight: 600;
            position: sticky;
            top: 0;
        }
        tr:hover {
            background: #f8f9fa;
        }
        .status-active { color: #27ae60; font-weight: bold; }
        .status-completed { color: #3498db; font-weight: bold; }
        .status-error { color: #e74c3c; font-weight: bold; }
        .pnl-positive { color: #27ae60; font-weight: bold; }
        .pnl-negative { color: #e74c3c; font-weight: bold; }
        .logs-container {
            max-height: 300px;
            overflow-y: auto;
            background: #2c3e50;
            color: #ecf0f1;
            padding: 15px;
            border-radius: 10px;
            font-family: 'Courier New', monospace;
            font-size: 12px;
        }
        .log-entry {
            margin-bottom: 8px;
            padding: 5px;
            border-radius: 3px;
        }
        .log-info { background: rgba(52, 152, 219, 0.2); }
        .log-success { background: rgba(39, 174, 96, 0.2); }
        .log-warning { background: rgba(243, 156, 18, 0.2); }
        .log-error { background: rgba(231, 76, 60, 0.2); }
        .loading {
            text-align: center;
            padding: 20px;
            color: #7f8c8d;
        }
        .error {
            color: #e74c3c;
            background: #fdf2f2;
            padding: 10px;
            border-radius: 5px;
            margin: 10px 0;
        }
        .success {
            color: #27ae60;
            background: #f0f9f0;
            padding: 10px;
            border-radius: 5px;
            margin: 10px 0;
        }
        .refresh-indicator {
            display: inline-block;
            width: 12px;
            height: 12px;
            background: #27ae60;
            border-radius: 50%;
            margin-right: 8px;
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.5; }
            100% { opacity: 1; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚀 Jack of all Scans - Backend Dashboard</h1>
            <p>Real-time monitoring, management, and debugging</p>
            <div class="refresh-indicator"></div>
            <span>Auto-refreshing every 5 seconds</span>
        </div>

        <div class="stats-grid" id="statsGrid">
            <div class="loading">Loading statistics...</div>
        </div>

        <div class="dashboard-grid">
            <div class="card">
                <h2>📊 System Controls</h2>
                <div class="controls">
                    <button class="btn" onclick="refreshAll()">🔄 Refresh All Calls</button>
                    <button class="btn btn-success" onclick="recalculateAll()">🧮 Recalculate All PnL</button>
                    <button class="btn btn-warning" onclick="fixErrors()">🔧 Fix Errors</button>
                    <button class="btn btn-danger" onclick="clearLogs()">🗑️ Clear Logs</button>
                </div>
                <div id="controlStatus"></div>
            </div>

            <div class="card">
                <h2>📈 Recent Calls</h2>
                <div class="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Token</th>
                                <th>User</th>
                                <th>PnL</th>
                                <th>Score</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody id="callsTable">
                            <tr><td colspan="6" class="loading">Loading calls...</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <div class="card">
            <h2>📋 Real-time Logs</h2>
            <div class="controls">
                <button class="btn" onclick="filterLogs('all')">All</button>
                <button class="btn" onclick="filterLogs('info')">Info</button>
                <button class="btn" onclick="filterLogs('success')">Success</button>
                <button class="btn" onclick="filterLogs('warning')">Warning</button>
                <button class="btn" onclick="filterLogs('error')">Error</button>
            </div>
            <div class="logs-container" id="logsContainer">
                <div class="loading">Loading logs...</div>
            </div>
        </div>
    </div>

    <script>
        let autoRefreshInterval;
        let currentLogFilter = 'all';

        // Initialize dashboard
        document.addEventListener('DOMContentLoaded', function() {
            loadDashboard();
            autoRefreshInterval = setInterval(loadDashboard, 5000);
        });

        async function loadDashboard() {
            try {
                await Promise.all([
                    loadStats(),
                    loadCalls(),
                    loadLogs()
                ]);
  } catch (error) {
                console.error('Error loading dashboard:', error);
            }
        }

        async function loadStats() {
            try {
                const response = await fetch('/api/dashboard/stats');
                const result = await response.json();
                
                if (result.success) {
                    const stats = result.data;
                    document.getElementById('statsGrid').innerHTML = \`
                        <div class="stat-card">
                            <div class="stat-value">\${stats.totalCalls}</div>
                            <div class="stat-label">Total Calls</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-value">\${stats.activeCalls}</div>
                            <div class="stat-label">Active Calls</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-value">\${stats.totalUsers}</div>
                            <div class="stat-label">Total Users</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-value">\${stats.averagePnl.toFixed(1)}%</div>
                            <div class="stat-label">Avg PnL</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-value">\${stats.bestCall.toFixed(1)}%</div>
                            <div class="stat-label">Best Call</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-value">\${Math.round(stats.systemUptime / 3600)}h</div>
                            <div class="stat-label">Uptime</div>
                        </div>
                    \`;
                }
  } catch (error) {
                console.error('Error loading stats:', error);
            }
        }

        async function loadCalls() {
            try {
                const response = await fetch('/api/dashboard/calls');
                const result = await response.json();
                
                if (result.success) {
                    const calls = result.data.slice(0, 20); // Show only first 20
                    const tbody = document.getElementById('callsTable');
                    
                    if (calls.length === 0) {
                        tbody.innerHTML = '<tr><td colspan="6" class="loading">No calls found</td></tr>';
                        return;
                    }
                    
                    tbody.innerHTML = calls.map(call => \`
                        <tr>
                            <td>
                                <strong>\${call.tokenSymbol}</strong><br>
                                <small>\${call.contractAddress.substring(0, 8)}...</small>
                            </td>
                            <td>\${call.username || 'Unknown'}</td>
                            <td class="\${call.pnlPercent >= 0 ? 'pnl-positive' : 'pnl-negative'}">
                                \${call.pnlPercent.toFixed(2)}%
                            </td>
                            <td>\${call.score.toFixed(2)}</td>
                            <td class="status-\${call.status}">\${call.status}</td>
                            <td>
                                <button class="btn" onclick="refreshCall('\${call.contractAddress}')" style="padding: 5px 10px; font-size: 12px;">
                                    🔄
                                </button>
                            </td>
                        </tr>
                    \`).join('');
                }
  } catch (error) {
                console.error('Error loading calls:', error);
            }
        }

        async function loadLogs() {
            try {
                const response = await fetch(\`/api/dashboard/logs?level=\${currentLogFilter === 'all' ? '' : currentLogFilter}&limit=50\`);
                const result = await response.json();
                
                if (result.success) {
                    const logs = result.data;
                    const container = document.getElementById('logsContainer');
                    
                    if (logs.length === 0) {
                        container.innerHTML = '<div class="loading">No logs found</div>';
                        return;
                    }
                    
                    container.innerHTML = logs.map(log => \`
                        <div class="log-entry log-\${log.level}">
                            <strong>[\${new Date(log.timestamp).toLocaleTimeString()}] \${log.level.toUpperCase()}:</strong>
                            \${log.message}
                            \${log.data ? \`<br><pre style="margin-top: 5px; font-size: 10px;">\${log.data}</pre>\` : ''}
                        </div>
                    \`).join('');
                    
                    // Auto-scroll to top
                    container.scrollTop = 0;
                }
            } catch (error) {
                console.error('Error loading logs:', error);
            }
        }

        function filterLogs(level) {
            currentLogFilter = level;
            loadLogs();
        }

        async function refreshCall(contractAddress) {
            try {
                showControlStatus('Refreshing call...', 'info');
                const response = await fetch(\`/api/dashboard/refresh/\${contractAddress}\`, { method: 'POST' });
                const result = await response.json();
                
                if (result.success) {
                    showControlStatus(\`Call \${contractAddress} refreshed successfully\`, 'success');
    } else {
                    showControlStatus(\`Failed to refresh call: \${result.error}\`, 'error');
    }
    
                // Refresh dashboard after a short delay
                setTimeout(loadDashboard, 1000);
  } catch (error) {
                showControlStatus(\`Error refreshing call: \${error.message}\`, 'error');
            }
        }

        async function refreshAll() {
            try {
                showControlStatus('Refreshing all calls...', 'info');
                const response = await fetch('/api/dashboard/refresh-all', { method: 'POST' });
                const result = await response.json();
                
                if (result.success) {
                    showControlStatus(\`All calls refreshed successfully\`, 'success');
                } else {
                    showControlStatus(\`Failed to refresh calls: \${result.error}\`, 'error');
                }
                
                setTimeout(loadDashboard, 2000);
  } catch (error) {
                showControlStatus(\`Error refreshing calls: \${error.message}\`, 'error');
            }
        }

        async function recalculateAll() {
            try {
                showControlStatus('Recalculating all PnL...', 'info');
                const response = await fetch('/api/dashboard/recalculate-all', { method: 'POST' });
                const result = await response.json();
                
                if (result.success) {
                    const successful = result.data.filter(r => r.success).length;
                    const total = result.data.length;
                    showControlStatus(\`Recalculation completed: \${successful}/\${total} successful\`, 'success');
    } else {
                    showControlStatus(\`Failed to recalculate: \${result.error}\`, 'error');
    }
                
                setTimeout(loadDashboard, 2000);
  } catch (error) {
                showControlStatus(\`Error recalculating: \${error.message}\`, 'error');
            }
        }

        async function fixErrors() {
            try {
                showControlStatus('Fixing errors...', 'info');
                const response = await fetch('/api/dashboard/fix-errors', { method: 'POST' });
                const result = await response.json();
                
                if (result.success) {
                    showControlStatus(\`Fixed \${result.data.length} calls\`, 'success');
                } else {
                    showControlStatus(\`Failed to fix errors: \${result.error}\`, 'error');
                }
                
                setTimeout(loadDashboard, 1000);
            } catch (error) {
                showControlStatus(\`Error fixing: \${error.message}\`, 'error');
            }
        }

        function clearLogs() {
            if (confirm('Are you sure you want to clear all logs?')) {
                document.getElementById('logsContainer').innerHTML = '<div class="loading">Logs cleared</div>';
                // Note: This only clears the display, not the server logs
            }
        }

        function showControlStatus(message, type) {
            const statusDiv = document.getElementById('controlStatus');
            statusDiv.innerHTML = \`<div class="\${type}">\${message}</div>\`;
            
            // Clear status after 5 seconds
            setTimeout(() => {
                statusDiv.innerHTML = '';
            }, 5000);
        }

        // Cleanup on page unload
        window.addEventListener('beforeunload', function() {
            if (autoRefreshInterval) {
                clearInterval(autoRefreshInterval);
            }
        });
    </script>
</body>
</html>
  `);
});

// Existing API endpoints (simplified versions)
app.get('/api/calls', async (req, res) => {
  try {
    addLog('info', 'Fetching active calls');
    
    // Use cached data if available, otherwise fetch from database
    let calls = cachedCalls.length > 0 ? cachedCalls : await db.getAllActiveCalls();
    
    addLog('info', `Processing ${calls.length} calls`);
    
    const transformedCalls = await Promise.all(calls.map(async (call) => {
      let displayName = 'Unknown User';
      if (call.username) {
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
          addLog('info', 'Could not fetch token image:', error.message);
        }
      }

      // Check if user has linked Twitter account
      let twitterInfo = null;
      let isLinked = false;
      try {
        const linkingCodesRef = ref(database, 'linkingCodes');
        const linkingSnapshot = await get(linkingCodesRef);
        const linkingCodes = linkingSnapshot.exists() ? linkingSnapshot.val() : {};
        
        // Find linking data for this Telegram username
        for (const [code, data] of Object.entries(linkingCodes)) {
          if (data.telegramUsername === call.username && data.isUsed === true) {
            twitterInfo = {
              twitterId: data.twitterId,
              twitterUsername: data.twitterUsername,
              twitterName: data.twitterName,
              twitterProfilePic: data.profilePictureUrl
            };
            isLinked = true;
            break;
          }
        }
      } catch (error) {
        addLog('info', 'Could not check Twitter linking:', error.message);
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
          displayName,
          isLinked,
          twitterInfo
        },
        pnlPercent: call.pnlPercent || 0,
        score: call.score || 0,
        entryMarketCap: call.entryMarketCap || 0,
        currentMarketCap: call.currentMarketCap || 0,
        status: call.status || 'active'
      };
    }));

    // Sort by PnL performance (highest first), then by creation date
    transformedCalls.sort((a, b) => {
      if (b.pnlPercent !== a.pnlPercent) {
        return b.pnlPercent - a.pnlPercent;
      }
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    addLog('success', `Fetched ${transformedCalls.length} active calls`);
    res.json({ success: true, data: transformedCalls });
  } catch (error) {
    addLog('error', 'Failed to fetch active calls', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/user-profile/:twitterId', async (req, res) => {
  try {
    const { twitterId } = req.params;
    addLog('info', `Fetching profile for Twitter ID: ${twitterId}`);
    
    // Get linking codes to find Telegram username
    const linkingCodesRef = ref(database, 'linkingCodes');
    const linkingSnapshot = await get(linkingCodesRef);
    const linkingCodes = linkingSnapshot.exists() ? linkingSnapshot.val() : {};
    
    // Find the linking data for this Twitter ID
    let linkingData = null;
    for (const [code, data] of Object.entries(linkingCodes)) {
      if (data.twitterId === twitterId && data.isUsed === true) {
        linkingData = data;
        break;
      }
    }
    
    if (!linkingData) {
      addLog('warning', `No linked Telegram account found for Twitter ID: ${twitterId}`);
      return res.json({ success: true, data: [] });
    }
    
    // Get all calls and filter by Telegram username
    const calls = await db.getAllActiveCalls();
    const userCalls = calls.filter(call => call.username === linkingData.telegramUsername);
    
    // Calculate profile statistics
    const totalCalls = userCalls.length;
    const successfulCalls = userCalls.filter(call => (call.pnlPercent || 0) > 0).length;
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
              addLog('info', 'Could not fetch token image for profile:', error.message);
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
    
    const profileData = {
      twitterId: linkingData.twitterId,
      twitterUsername: linkingData.twitterUsername,
      telegramUsername: linkingData.telegramUsername,
      totalCalls,
      winRate: Math.round(winRate * 10) / 10,
      totalScore: Math.round(totalScore * 10) / 10,
      bestCall: Math.round(bestCall * 10) / 10,
      recentCalls
    };
    
    addLog('success', `Profile data calculated for @${linkingData.twitterUsername}:`, profileData);
    res.json({ success: true, data: profileData });
      } catch (error) {
    addLog('error', 'Failed to fetch user profile', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Missing API endpoints
app.get('/api/leaderboard', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    addLog('info', `Fetching leaderboard with limit: ${limit}`);
    
    const calls = await db.getAllActiveCalls();
    
    // Group calls by user and calculate stats
    const userStats = {};
    
    calls.forEach(call => {
      const userId = call.userId || call.username || 'unknown';
      if (!userStats[userId]) {
        userStats[userId] = {
          telegramId: userId,
          username: call.username || 'Unknown',
          totalCalls: 0,
          successfulCalls: 0,
          totalScore: 0,
          bestCall: 0,
          calls: []
        };
      }
      
      userStats[userId].totalCalls++;
      userStats[userId].totalScore += parseFloat(call.score || 0);
      userStats[userId].bestCall = Math.max(userStats[userId].bestCall, call.pnlPercent || 0);
      userStats[userId].calls.push(call);
      
      if ((call.pnlPercent || 0) > 0) {
        userStats[userId].successfulCalls++;
      }
    });
    
    // Calculate win rate and create leaderboard
    const leaderboard = Object.values(userStats)
      .map(user => ({
        ...user,
        winRate: user.totalCalls > 0 ? (user.successfulCalls / user.totalCalls) * 100 : 0,
        displayName: user.username,
        isLinked: false, // You can add linking logic here
        twitterUsername: null,
        twitterProfilePic: null
      }))
      .sort((a, b) => b.totalScore - a.totalScore)
      .slice(0, limit)
      .map((user, index) => ({
        ...user,
        rank: index + 1
      }));
    
    addLog('success', `Leaderboard generated with ${leaderboard.length} entries`);
    res.json({ success: true, data: leaderboard });
  } catch (error) {
    addLog('error', 'Failed to fetch leaderboard', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/generate-linking-code', async (req, res) => {
  try {
    const { twitterId, twitterUsername, twitterName, profilePictureUrl } = req.body;
    addLog('info', `Generating linking code for Twitter user: ${twitterUsername}`);
    
    // Generate a random 6-digit code
    const linkingCode = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Store the linking code in Firebase
    const linkingCodesRef = ref(database, 'linkingCodes');
    const newCodeRef = push(linkingCodesRef);
    
    const linkingData = {
      code: linkingCode,
      twitterId,
      twitterUsername,
      twitterName,
      profilePictureUrl,
      isUsed: false,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours
    };
    
    await set(newCodeRef, linkingData);
    
    addLog('success', `Linking code generated: ${linkingCode} for @${twitterUsername}`);
    res.json({ 
      success: true, 
      data: {
        linkingCode,
        expiresIn: 24 * 60 * 60 * 1000 // 24 hours in milliseconds
      } 
    });
  } catch (error) {
    addLog('error', 'Failed to generate linking code', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// WebSocket connection handling
io.on('connection', (socket) => {
  addLog('info', `Client connected: ${socket.id}`);
  
  // Send current data to newly connected client
  socket.emit('calls_updated', cachedCalls);
  
  socket.on('disconnect', () => {
    addLog('info', `Client disconnected: ${socket.id}`);
  });
});

// Initialize real-time listeners (disabled for Vercel deployment)
// setupRealtimeListeners();

// Start server
server.listen(PORT, () => {
  addLog('success', `🚀 Jack of all Scans Backend Dashboard running on port ${PORT}`);
  addLog('info', `Dashboard available at: http://localhost:${PORT}`);
  addLog('info', `WebSocket server running for real-time updates`);
  console.log(`🚀 Jack of all Scans Backend Dashboard running on port ${PORT}`);
  console.log(`📊 Dashboard available at: http://localhost:${PORT}`);
  console.log(`🔌 WebSocket server running for real-time updates`);
});
