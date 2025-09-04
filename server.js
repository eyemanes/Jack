require('dotenv').config();
const express = require('express');
const cors = require('cors');
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

// Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Solana Tracker API is running' });
});

// Homepage: PnL Management Dashboard
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>Jack of all Scans - PnL Management</title>
    <style>
        body { font-family: Arial, sans-serif; background: #f0f2f5; margin: 0; padding: 20px; }
        .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #333; text-align: center; margin-bottom: 30px; }
        .status { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #007bff; }
        .btn { background: #007bff; color: white; border: none; padding: 12px 24px; border-radius: 5px; cursor: pointer; margin: 10px; }
        .btn:hover { background: #0056b3; }
        .btn-danger { background: #dc3545; }
        .btn-danger:hover { background: #c82333; }
        .result { background: #f8f9fa; padding: 15px; border-radius: 5px; margin-top: 20px; white-space: pre-wrap; font-family: monospace; display: none; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Jack of all Scans - PnL Management</h1>
        
        <div class="status" id="status">
            <h3>System Status</h3>
            <p id="statusText">Click "Check Status" to see current health...</p>
        </div>
        
        <div style="text-align: center;">
            <button class="btn" onclick="checkStatus()">Check Status</button>
            <button class="btn btn-danger" onclick="fixIssues()">Fix Corrupted Data</button>
        </div>
        
        <div class="result" id="result"></div>
    </div>

    <script>
        async function checkStatus() {
            try {
                const response = await fetch('/api/status');
                const data = await response.json();
                document.getElementById('statusText').innerHTML = \`
                    <strong>Total Calls:</strong> \${data.totalCalls}<br>
                    <strong>Corrupted Calls:</strong> \${data.corruptedCalls}<br>
                    <strong>Health:</strong> \${data.health}
                \`;
                showResult(data, 'System Status');
            } catch (error) {
                showResult({error: error.message}, 'Error');
            }
        }
        
        async function fixIssues() {
            if (!confirm('Fix corrupted PnL data? This will reset extreme values.')) return;
            try {
                const response = await fetch('/api/fix', {method: 'POST'});
                const data = await response.json();
                showResult(data, 'Fix Results');
                if (data.success) {
                    alert(\`Success! Fixed \${data.fixedCount} corrupted calls.\`);
                    checkStatus();
                }
            } catch (error) {
                showResult({error: error.message}, 'Error');
            }
        }
        
        function showResult(data, title) {
            const result = document.getElementById('result');
            result.textContent = title + ':\n\n' + JSON.stringify(data, null, 2);
            result.style.display = 'block';
        }
        
        // Auto-check on load
        window.onload = checkStatus;
    </script>
</body>
</html>
  `);
});

// Status endpoint
app.get('/api/status', async (req, res) => {
  try {
    const calls = await db.getAllActiveCalls();
    const corruptedCalls = calls.filter(c => 
      Math.abs(parseFloat(c.pnlPercent) || 0) > 10000 || 
      Math.abs(parseFloat(c.maxPnl) || 0) > 10000
    );
    
    res.json({
      success: true,
      totalCalls: calls.length,
      corruptedCalls: corruptedCalls.length,
      health: corruptedCalls.length === 0 ? 'Good' : 'Issues Found',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Fix endpoint
app.post('/api/fix', async (req, res) => {
  try {
    const calls = await db.getAllActiveCalls();
    const corruptedCalls = calls.filter(c => 
      Math.abs(parseFloat(c.pnlPercent) || 0) > 10000 || 
      Math.abs(parseFloat(c.maxPnl) || 0) > 10000
    );
    
    let fixedCount = 0;
    
    for (const call of corruptedCalls.slice(0, 10)) { // Fix first 10 to avoid timeout
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
      fixedCount,
      totalCorrupted: corruptedCalls.length
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all active calls (basic version)
app.get('/api/calls', async (req, res) => {
  try {
    const calls = await db.getAllActiveCalls();
    res.json({ success: true, data: calls });
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

// Export for Vercel
module.exports = app;
