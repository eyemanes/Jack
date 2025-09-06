const RefreshEngine = require('../lib/refreshEngine');
const { FirebaseService } = require('../lib/firebase');

const refreshEngine = new RefreshEngine();
const firebase = new FirebaseService();

// Refresh all active calls
async function refreshAll(req, res) {
  try {
    console.log('Manual refresh all requested');
    
    const result = await refreshEngine.refreshAllCalls();
    
    res.json({
      success: result.success,
      data: result,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in refresh all:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

// Refresh specific call
async function refreshCall(req, res) {
  try {
    const { callId } = req.params;
    
    console.log(`Manual refresh requested for call ${callId}`);
    
    const result = await refreshEngine.refreshCall(callId);
    
    res.json({
      success: result.success,
      data: result,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error(`Error refreshing call ${req.params.callId}:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

// Get refresh status
async function getRefreshStatus(req, res) {
  try {
    const status = refreshEngine.getRefreshStatus();
    
    res.json({
      success: true,
      data: status,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting refresh status:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

// Start auto-refresh
async function startAutoRefresh(req, res) {
  try {
    refreshEngine.startAutoRefresh();
    
    res.json({
      success: true,
      message: 'Auto-refresh started',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error starting auto-refresh:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

// Stop auto-refresh
async function stopAutoRefresh(req, res) {
  try {
    refreshEngine.stopAutoRefresh();
    
    res.json({
      success: true,
      message: 'Auto-refresh stopped',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error stopping auto-refresh:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

// Batch refresh specific tokens
async function refreshTokens(req, res) {
  try {
    const { tokens } = req.body;
    
    if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Tokens array is required'
      });
    }

    console.log(`Batch refresh requested for ${tokens.length} tokens:`, tokens);
    
    // Get all active calls for these tokens
    const allCalls = await firebase.getActiveCalls();
    const relevantCalls = allCalls.filter(call => tokens.includes(call.token));
    
    if (relevantCalls.length === 0) {
      return res.json({
        success: true,
        message: 'No active calls found for specified tokens',
        data: { processed: 0 }
      });
    }

    // Group calls by token
    const tokenGroups = {};
    for (const call of relevantCalls) {
      if (!tokenGroups[call.token]) {
        tokenGroups[call.token] = [];
      }
      tokenGroups[call.token].push(call);
    }

    const results = [];
    const updates = {};

    // Process each token group
    for (const [token, calls] of Object.entries(tokenGroups)) {
      try {
        console.log(`Processing ${calls.length} calls for token ${token}`);
        
        // Get post-call data for this token
        const SolanaTrackerService = require('../lib/solanaTracker');
        const solanaTracker = new SolanaTrackerService();
        
        const postCallData = await solanaTracker.getPostCallData(
          token, 
          Math.min(...calls.map(c => c.tsCall)),
          Date.now()
        );

        // Process each call for this token
        for (const call of calls) {
          try {
            const updatedCall = await refreshEngine.processCall(call, postCallData);
            updates[call.id] = updatedCall;
            results.push({
              callId: call.id,
              token: call.token,
              success: true,
              multiplier: updatedCall.progress.multiplier,
              milestones: updatedCall.milestones
            });
          } catch (error) {
            console.error(`Error processing call ${call.id}:`, error.message);
            results.push({
              callId: call.id,
              token: call.token,
              success: false,
              error: error.message
            });
          }
        }
      } catch (error) {
        console.error(`Error processing token ${token}:`, error.message);
        for (const call of calls) {
          results.push({
            callId: call.id,
            token: call.token,
            success: false,
            error: error.message
          });
        }
      }
    }

    // Batch update all calls
    if (Object.keys(updates).length > 0) {
      await firebase.batchUpdateCalls(updates);
      console.log(`Updated ${Object.keys(updates).length} calls`);
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    res.json({
      success: true,
      data: {
        processed: results.length,
        successful: successCount,
        failed: failureCount,
        results
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in batch refresh tokens:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

module.exports = {
  refreshAll,
  refreshCall,
  getRefreshStatus,
  startAutoRefresh,
  stopAutoRefresh,
  refreshTokens
};
