require('dotenv').config();
const express = require('express');
const cors = require('cors');

// Import API modules
const callsAPI = require('./api/calls');
const refreshAPI = require('./api/refresh');
const leaderboardAPI = require('./api/leaderboard');
const simulateAPI = require('./api/dev/simulate');
const adminAPI = require('./api/admin/backfill-ath');
const simulateAdminAPI = require('./api/dev/simulate-admin');

// Import services
const RefreshEngine = require('./lib/refreshEngine');

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize refresh engine
const refreshEngine = new RefreshEngine();

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// API Routes

// Calls endpoints
app.post('/api/calls', callsAPI.createCall);
app.get('/api/calls/:id', callsAPI.getCall);
app.get('/api/token/:token/calls', callsAPI.getCallsByToken);
app.get('/api/group/:groupId/calls', callsAPI.getCallsByGroup);
app.put('/api/calls/:id', callsAPI.updateCall);
app.delete('/api/calls/:id', callsAPI.deleteCall);

// Refresh endpoints
app.post('/api/refresh', refreshAPI.refreshAll);
app.post('/api/refresh/:callId', refreshAPI.refreshCall);
app.get('/api/refresh/status', refreshAPI.getRefreshStatus);
app.post('/api/refresh/start', refreshAPI.startAutoRefresh);
app.post('/api/refresh/stop', refreshAPI.stopAutoRefresh);
app.post('/api/refresh/tokens', refreshAPI.refreshTokens);

// Leaderboard endpoints
app.get('/api/leaderboard', leaderboardAPI.getLeaderboard);
app.get('/api/caller/:callerId/stats', leaderboardAPI.getCallerStats);
app.get('/api/callers', leaderboardAPI.getAllCallerStats);
app.get('/api/group/:groupId/stats', leaderboardAPI.getGroupStats);

// Development endpoints
app.get('/api/dev/simulate', simulateAPI.simulateScenarios);
app.post('/api/dev/cleanup', simulateAPI.cleanupTestData);

// Admin endpoints
app.post('/api/admin/backfill-ath', adminAPI.requireAdmin, adminAPI.startBackfill);
app.get('/api/admin/backfill-ath/status', adminAPI.requireAdmin, adminAPI.getBackfillStatus);
app.get('/api/admin/backfill-ath/runs', adminAPI.requireAdmin, adminAPI.listBackfillRuns);
app.post('/api/admin/backfill-ath/cleanup', adminAPI.requireAdmin, adminAPI.cleanupBackfillRuns);

// Admin simulation endpoints
app.get('/api/dev/simulate-ath', simulateAdminAPI.simulateATHScenarios);
app.post('/api/dev/cleanup-ath', simulateAdminAPI.cleanupTestData);

// Main dashboard route
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Token Call PnL Backend</title>
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            margin: 0; 
            padding: 20px; 
            background: #0a0a0a; 
            color: #fff; 
        }
        .container { max-width: 1200px; margin: 0 auto; }
        .header { text-align: center; margin-bottom: 40px; }
        .header h1 { color: #00ff88; margin: 0; font-size: 2.5rem; }
        .header p { color: #888; margin: 10px 0; font-size: 1.1rem; }
        .status { 
            display: inline-block; 
            padding: 8px 16px; 
            border-radius: 20px; 
            font-size: 14px; 
            font-weight: bold; 
            background: #1a4a1a; 
            color: #00ff88; 
        }
        .grid { 
            display: grid; 
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); 
            gap: 20px; 
            margin-bottom: 40px; 
        }
        .card { 
            background: #1a1a1a; 
            padding: 24px; 
            border-radius: 12px; 
            border: 1px solid #333; 
        }
        .card h3 { 
            margin: 0 0 16px 0; 
            color: #00ff88; 
            font-size: 1.2rem; 
        }
        .endpoint { 
            margin: 8px 0; 
            padding: 8px 12px; 
            background: #2a2a2a; 
            border-radius: 6px; 
            font-family: 'Monaco', 'Menlo', monospace; 
            font-size: 13px; 
        }
        .method { 
            display: inline-block; 
            padding: 2px 6px; 
            border-radius: 4px; 
            font-size: 11px; 
            font-weight: bold; 
            margin-right: 8px; 
        }
        .get { background: #1a4a1a; color: #00ff88; }
        .post { background: #4a1a1a; color: #ff4444; }
        .put { background: #4a4a1a; color: #ffff44; }
        .delete { background: #4a1a1a; color: #ff4444; }
        .description { color: #aaa; font-size: 12px; margin-top: 4px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚀 Token Call PnL Backend</h1>
            <p>Production-ready Phanes-style token call tracking system</p>
            <div class="status">SYSTEM HEALTHY</div>
        </div>
        
        <div class="grid">
            <div class="card">
                <h3>📞 Call Management</h3>
                <div class="endpoint">
                    <span class="method post">POST</span>/api/calls
                    <div class="description">Create new token call entry</div>
                </div>
                <div class="endpoint">
                    <span class="method get">GET</span>/api/calls/:id
                    <div class="description">Get call by ID</div>
                </div>
                <div class="endpoint">
                    <span class="method get">GET</span>/api/token/:token/calls
                    <div class="description">Get calls by token address</div>
                </div>
                <div class="endpoint">
                    <span class="method get">GET</span>/api/group/:groupId/calls
                    <div class="description">Get calls by group ID</div>
                </div>
                <div class="endpoint">
                    <span class="method put">PUT</span>/api/calls/:id
                    <div class="description">Update call data</div>
                </div>
                <div class="endpoint">
                    <span class="method delete">DELETE</span>/api/calls/:id
                    <div class="description">Delete call</div>
                </div>
            </div>

            <div class="card">
                <h3>🔄 Refresh Operations</h3>
                <div class="endpoint">
                    <span class="method post">POST</span>/api/refresh
                    <div class="description">Refresh all active calls</div>
                </div>
                <div class="endpoint">
                    <span class="method post">POST</span>/api/refresh/:callId
                    <div class="description">Refresh specific call</div>
                </div>
                <div class="endpoint">
                    <span class="method get">GET</span>/api/refresh/status
                    <div class="description">Get refresh status</div>
                </div>
                <div class="endpoint">
                    <span class="method post">POST</span>/api/refresh/start
                    <div class="description">Start auto-refresh</div>
                </div>
                <div class="endpoint">
                    <span class="method post">POST</span>/api/refresh/stop
                    <div class="description">Stop auto-refresh</div>
                </div>
                <div class="endpoint">
                    <span class="method post">POST</span>/api/refresh/tokens
                    <div class="description">Refresh specific tokens</div>
                </div>
            </div>

            <div class="card">
                <h3>🏆 Leaderboards</h3>
                <div class="endpoint">
                    <span class="method get">GET</span>/api/leaderboard
                    <div class="description">Get leaderboard data</div>
                </div>
                <div class="endpoint">
                    <span class="method get">GET</span>/api/caller/:callerId/stats
                    <div class="description">Get caller statistics</div>
                </div>
                <div class="endpoint">
                    <span class="method get">GET</span>/api/callers
                    <div class="description">Get all caller stats</div>
                </div>
                <div class="endpoint">
                    <span class="method get">GET</span>/api/group/:groupId/stats
                    <div class="description">Get group statistics</div>
                </div>
            </div>

            <div class="card">
                <h3>🧪 Development</h3>
                <div class="endpoint">
                    <span class="method get">GET</span>/api/dev/simulate
                    <div class="description">Run test scenarios</div>
                </div>
                <div class="endpoint">
                    <span class="method post">POST</span>/api/dev/cleanup
                    <div class="description">Clean up test data</div>
                </div>
            </div>
        </div>

        <div class="card">
            <h3>📊 System Features</h3>
            <ul style="color: #aaa; line-height: 1.6;">
                <li><strong>Phanes-style Logic:</strong> Tracks token call performance with milestone locking</li>
                <li><strong>Firebase Realtime Database:</strong> Single source of truth with live updates</li>
                <li><strong>Solana Tracker Integration:</strong> Real-time price and market cap data</li>
                <li><strong>Batch Processing:</strong> Efficient refresh of 100-200 calls per day</li>
                <li><strong>Milestone Tracking:</strong> 2x, 5x, 10x, 25x, 50x, 100x multipliers</li>
                <li><strong>ATH Protection:</strong> Ignores peaks before call timestamp</li>
                <li><strong>Fallback Support:</strong> Price-based tracking when market cap unavailable</li>
                <li><strong>Vercel Ready:</strong> Deployable on serverless functions</li>
            </ul>
        </div>
    </div>
</body>
</html>
  `);
});

// Start auto-refresh in production
if (process.env.NODE_ENV === 'production') {
  refreshEngine.startAutoRefresh();
}

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Token Call PnL Backend running on port ${PORT}`);
  console.log(`📊 Dashboard available at http://localhost:${PORT}`);
  console.log(`🔄 Auto-refresh: ${process.env.NODE_ENV === 'production' ? 'Enabled' : 'Disabled'}`);
});

module.exports = app;
