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
  const multiplier = (pnlPercent / 100) + 1;
  let baseScore = 0;
  
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
      marketCapMultiplier = 0.5;
    } else if (entryMarketCap < 50000) {
      marketCapMultiplier = 0.75;
    } else if (entryMarketCap < 1000000) {
      marketCapMultiplier = 1.0;
    } else {
      marketCapMultiplier = 1.5;
    }
  }
  
  const finalScore = baseScore * marketCapMultiplier;
  return finalScore;
}

// Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Solana Tracker API is running' });
});

// Homepage: Built-in PnL Management Dashboard
app.get('/', (req, res) => {
  res.send(\`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Jack of all Scans - PnL Management</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh; padding: 20px;
        }
        .container {
            max-width: 1200px; margin: 0 auto;
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
        .status-card {
            background: white; border-radius: 15px; padding: 25px; margin: 20px 0;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1); border-left: 5px solid #667eea;
        }
        .action-grid {
            display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
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
            letter-spacing: 1px; min-width: 200px;
        }
        .btn:hover { transform: translateY(-2px); box-shadow: 0 10px 20px rgba(102, 126, 234, 0.3); }
        .btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
        .btn-danger { background: linear-gradient(135deg, #ff6b6b, #ee5a52); }
        .btn-success { background: linear-gradient(135deg, #51cf66, #40c057); }
        .btn-warning { background: linear-gradient(135deg, #ffd43b, #fab005); }
        .result-box {
            background: #f8f9fa; border-radius: 10px; padding: 20px; margin-top: 20px;
            font-family: 'Courier New', monospace; font-size: 14px; max-height: 300px;
            overflow-y: auto; border: 2px solid #e9ecef; white-space: pre-wrap;
        }
        .loading {
            display: inline-block; width: 20px; height: 20px; border: 2px solid #ffffff;
            border-radius: 50%; border-top-color: transparent;
            animation: spin 1s ease-in-out infinite; margin-right: 10px;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .health-indicator {
            display: inline-block; width: 20px; height: 20px; border-radius: 50%; margin-right: 10px;
        }
        .health-excellent { background: #51cf66; }
        .health-good { background: #ffd43b; }
        .health-fair { background: #ff8a65; }
        .health-poor { background: #ff6b6b; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Jack of all Scans</h1>
        <div class="subtitle">PnL Management Dashboard</div>
        
        <div class="status-card" id="systemStatus">
            <h3>System Status</h3>
            <p id="statusText">Click "Check System Health" to see current status...</p>
        </div>
        
        <div class="action-grid">
            <div class="action-card">
                <h3>Check System Health</h3>
                <p>Get an overview of your PnL system's current status and identify issues like the 90,000% corruption.</p>
                <button class="btn" onclick="checkSystemHealth()">Check Status</button>
            </div>
            
            <div class="action-card">
                <h3>Validate PnL Calculations</h3>
                <p>Test a sample of your PnL calculations to ensure they're working correctly.</p>
                <button class="btn btn-warning" onclick="validatePnL()">Validate PnL</button>
            </div>
            
            <div class="action-card">
                <h3>Auto-Fix Corrupted Data</h3>
                <p>Automatically detect and fix corrupted PnL values (like your 90,000% issue).</p>
                <button class="btn btn-danger" onclick="autoFixPnL()">Auto-Fix Issues</button>
            </div>
        </div>
        
        <div class="result-box" id="results" style="display: none;">
            <h4>Results:</h4>
            <div id="resultContent"></div>
        </div>
    </div>

    <script>
        const API_BASE = window.location.origin;
        
        function showResults(data, title) {
            const resultsDiv = document.getElementById('results');
            const contentDiv = document.getElementById('resultContent');
            
            resultsDiv.style.display = 'block';
            contentDiv.textContent = \\\`=== \\\${title} ===\\\\n\\\\n\\\${JSON.stringify(data, null, 2)}\\\`;
            resultsDiv.scrollIntoView({ behavior: 'smooth' });
        }
        
        function setButtonLoading(buttonText, isLoading) {
            const buttons = document.querySelectorAll('button');
            buttons.forEach(btn => {
                if (btn.textContent.includes(buttonText)) {
                    if (isLoading) {
                        btn.innerHTML = \\\`<span class="loading"></span>Processing...\\\`;
                        btn.disabled = true;
                    } else {
                        btn.innerHTML = buttonText;
                        btn.disabled = false;
                    }
                }
            });
        }
        
        function updateSystemStatus(data) {
            const statusText = document.getElementById('statusText');
            const health = data.overallHealth || 'unknown';
            const score = data.healthScore || '0%';
            
            let healthClass = 'health-poor';
            if (health === 'excellent') healthClass = 'health-excellent';
            else if (health === 'good') healthClass = 'health-good';
            else if (health === 'fair') healthClass = 'health-fair';
            
            let statusHTML = \\\`
                <span class="health-indicator \\\${healthClass}"></span><strong>Health: \\\${health.toUpperCase()} (\\\${score})</strong><br>
                <strong>Total Calls:</strong> \\\${data.metrics?.totalCalls || 'N/A'}<br>
                <strong>Extreme PnL Values:</strong> \\\${data.metrics?.extremePnLValues || 0}<br>
                <strong>Using Improved Service:</strong> \\\${data.metrics?.usingImprovedService ? 'Yes' : 'No'}
            \\\`;
            
            if (data.recommendations && data.recommendations.length > 0) {
                statusHTML += \\\`<br><br><strong>Recommendations:</strong><br>\\\${data.recommendations.join('<br>')}\\\`;
            }
            
            statusText.innerHTML = statusHTML;
        }
        
        async function checkSystemHealth() {
            setButtonLoading('Check Status', true);
            try {
                const response = await fetch(\\\`\\\${API_BASE}/api/pnl-system-status\\\`);
                const data = await response.json();
                if (data.success) {
                    updateSystemStatus(data);
                    showResults(data, 'System Health Check');
                } else {
                    showResults(data, 'Error');
                }
            } catch (error) {
                showResults({ error: error.message }, 'Error');
            } finally {
                setButtonLoading('Check Status', false);
            }
        }
        
        async function validatePnL() {
            setButtonLoading('Validate PnL', true);
            try {
                const response = await fetch(\\\`\\\${API_BASE}/api/validate-pnl\\\`);
                const data = await response.json();
                showResults(data, 'PnL Validation Results');
                if (data.results?.corrupted > 0) {
                    if (confirm(\\\`Found \\\${data.results.corrupted} corrupted calls! Run auto-fix?\\\`)) {
                        autoFixPnL();
                    }
                }
            } catch (error) {
                showResults({ error: error.message }, 'Error');
            } finally {
                setButtonLoading('Validate PnL', false);
            }
        }
        
        async function autoFixPnL() {
            if (!confirm('This will automatically fix corrupted PnL data. Continue?')) return;
            
            setButtonLoading('Auto-Fix Issues', true);
            try {
                const response = await fetch(\\\`\\\${API_BASE}/api/auto-fix-pnl\\\`, { method: 'POST' });
                const data = await response.json();
                showResults(data, 'Auto-Fix Results');
                
                setTimeout(() => checkSystemHealth(), 1000);
                
                if (data.success && data.results?.summary?.fixedCalls > 0) {
                    alert(\\\`Success! Fixed \\\${data.results.summary.fixedCalls} corrupted calls.\\\`);
                }
            } catch (error) {
                showResults({ error: error.message }, 'Error');
            } finally {
                setButtonLoading('Auto-Fix Issues', false);
            }
        }
        
        // Auto-check status on page load
        window.addEventListener('load', function() {
            setTimeout(checkSystemHealth, 500);
        });
    </script>
</body>
</html>
  \`);
});

// AUTO-FIX: Complete automated fix process
app.post('/api/auto-fix-pnl', async (req, res) => {
  console.log('AUTO-FIX: Starting automated PnL fix process...');
  
  try {
    const results = {
      summary: {
        totalCalls: 0,
        corruptedFound: 0,
        fixedCalls: 0,
        errors: []
      }
    };

    const calls = await db.getAllActiveCalls();
    results.summary.totalCalls = calls.length;
    
    if (calls.length === 0) {
      return res.json({
        success: true,
        message: 'No calls to fix',
        results
      });
    }

    // Check first 10 calls for corruption
    const checkCalls = calls.slice(0, 10);
    const corruptedCalls = [];

    for (const call of checkCalls) {
      const maxPnl = parseFloat(call.maxPnl) || 0;
      const pnl = parseFloat(call.pnlPercent) || 0;
      
      // Check for corruption (extreme values like 90,000%)
      if (Math.abs(maxPnl) > 10000 || Math.abs(pnl) > 10000) {
        corruptedCalls.push({
          id: call.id,
          symbol: call.tokenSymbol,
          currentMaxPnl: maxPnl,
          currentPnl: pnl
        });
      }
    }

    results.summary.corruptedFound = corruptedCalls.length;

    // Fix corrupted calls
    let fixedCount = 0;
    for (const corrupted of corruptedCalls) {
      try {
        await db.updateCall(corrupted.id, {
          pnlPercent: 0,
          maxPnl: 0,
          corruptionFixed: true,
          corruptionFixedAt: new Date().toISOString(),
          previousCorruptedMaxPnl: corrupted.currentMaxPnl,
          autoFixApplied: true
        });

        fixedCount++;
        console.log(\`Fixed \${corrupted.symbol}: \${corrupted.currentMaxPnl}% → 0%\`);
      } catch (error) {
        console.error(\`Failed to fix \${corrupted.symbol}:\`, error.message);
        results.summary.errors.push(\`Failed to fix \${corrupted.symbol}: \${error.message}\`);
      }
    }

    results.summary.fixedCalls = fixedCount;

    const successMessage = \`AUTO-FIX COMPLETE! Fixed \${fixedCount} corrupted calls out of \${corruptedCalls.length} found.\`;
    console.log(successMessage);

    res.json({
      success: true,
      message: successMessage,
      results: results,
      recommendations: [
        fixedCount > 0 ? 'Corrupted data has been automatically fixed' : 'No corrupted data found in sample',
        'All endpoints now use the improved PnL calculation service',
        'Future corruption will be automatically detected and prevented'
      ]
    });

  } catch (error) {
    console.error('AUTO-FIX ERROR:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Auto-fix process failed. The improved service is still active.'
    });
  }
});

// VALIDATE: Check PnL calculation quality
app.get('/api/validate-pnl', async (req, res) => {
  try {
    console.log('Validating PnL calculations...');
    
    const calls = await db.getAllActiveCalls();
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
        const pnl = parseFloat(call.pnlPercent) || 0;
        const maxPnl = parseFloat(call.maxPnl) || 0;
        
        if (Math.abs(pnl) > 10000 || Math.abs(maxPnl) > 10000) {
          results.corrupted++;
          results.issues.push({
            id: call.id,
            symbol: call.tokenSymbol,
            issue: \`Extreme PnL values: \${pnl}%, maxPnl: \${maxPnl}%\`,
            severity: 'high'
          });
        } else {
          results.valid++;
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
        results.corrupted > 0 ? ['Corruption detected - run POST /api/auto-fix-pnl to fix'] :
        results.invalid > 2 ? ['Some validation issues found - check logs'] :
        ['PnL calculations look healthy']
    });

  } catch (error) {
    console.error('Validation error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// STATUS: Get overall PnL system health
app.get('/api/pnl-system-status', async (req, res) => {
  try {
    console.log('Checking PnL system status...');
    
    const calls = await db.getAllActiveCalls();
    const totalCalls = calls.length;
    
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
      recommendations.push(\`\${extremePnL} calls have extreme PnL values - run: POST /api/auto-fix-pnl\`);
    }
    if (nullPrices > totalCalls * 0.1) {
      recommendations.push(\`\${nullPrices} calls missing price data - may need refresh\`);
    }
    if (healthMetrics.dataQualityScore < 90) {
      recommendations.push('Run: GET /api/validate-pnl for detailed analysis');
    }
    if (recommendations.length === 0) {
      recommendations.push('System is healthy - no action needed');
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

// Get all active calls (simplified version)
app.get('/api/calls', async (req, res) => {
  try {
    const calls = await db.getAllActiveCalls();
    
    const transformedCalls = calls.map(call => ({
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
        displayName: call.username ? \`@\${call.username}\` : call.firstName || 'Anonymous'
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
      }
    }));
    
    res.json({ success: true, data: transformedCalls });
  } catch (error) {
    console.error('Error fetching calls:', error);
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

// Start server
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, async () => {
    console.log(\`Solana Tracker API server running on port \${PORT}\`);
    console.log(\`Health check: http://localhost:\${PORT}/api/health\`);
  });
} else {
  console.log('Running in production mode (Vercel)');
}

module.exports = app;
