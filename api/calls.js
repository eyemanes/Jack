const { FirebaseService } = require('../lib/firebase');
const SolanaTrackerService = require('../lib/solanaTracker');
const RefreshEngine = require('../lib/refreshEngine');

const firebase = new FirebaseService();
const solanaTracker = new SolanaTrackerService();
const refreshEngine = new RefreshEngine();

// Create new call entry
async function createCall(req, res) {
  try {
    const { token, callerId, groupId, tsCall } = req.body;

    // Validate required fields
    if (!token || !callerId || !groupId || !tsCall) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: token, callerId, groupId, tsCall'
      });
    }

    // Validate timestamp
    const callTimestamp = parseInt(tsCall);
    if (isNaN(callTimestamp) || callTimestamp > Date.now()) {
      return res.status(400).json({
        success: false,
        error: 'Invalid timestamp'
      });
    }

    console.log(`Creating call for token ${token} by caller ${callerId} in group ${groupId} at ${new Date(callTimestamp).toISOString()}`);

    // Get entry data at call time
    const entryData = await solanaTracker.getEntryData(token, callTimestamp);
    
    if (!entryData.price || entryData.price <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Could not retrieve valid price data at call time'
      });
    }

    // Determine basis (prefer marketCap, fallback to price)
    const basis = entryData.marketCap ? 'marketCap' : 'price';
    const entryValue = entryData[basis];

    // Create call data
    const callData = {
      token,
      callerId,
      groupId,
      tsCall: callTimestamp,
      basis,
      entry: {
        price: entryData.price,
        marketCap: entryData.marketCap
      },
      progress: {
        max: {
          price: entryData.price,
          marketCap: entryData.marketCap,
          ts: callTimestamp
        },
        multiplier: 1
      },
      milestones: {
        x2: { hit: false },
        x5: { hit: false },
        x10: { hit: false },
        x25: { hit: false },
        x50: { hit: false },
        x100: { hit: false }
      },
      status: 'active'
    };

    // Create call in database
    const call = await firebase.createCall(callData);

    // Update caller stats
    await updateCallerStats(callerId, 'call_created');

    console.log(`Call created successfully: ${call.id}`);

    res.json({
      success: true,
      data: call
    });

  } catch (error) {
    console.error('Error creating call:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// Get call by ID
async function getCall(req, res) {
  try {
    const { id } = req.params;
    const call = await firebase.getCall(id);

    if (!call) {
      return res.status(404).json({
        success: false,
        error: 'Call not found'
      });
    }

    res.json({
      success: true,
      data: call
    });

  } catch (error) {
    console.error('Error getting call:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// Get calls by token
async function getCallsByToken(req, res) {
  try {
    const { token } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const calls = await firebase.getCallsByToken(token);
    
    // Pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedCalls = calls.slice(startIndex, endIndex);

    res.json({
      success: true,
      data: {
        calls: paginatedCalls,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: calls.length,
          pages: Math.ceil(calls.length / limit)
        }
      }
    });

  } catch (error) {
    console.error('Error getting calls by token:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// Get calls by group
async function getCallsByGroup(req, res) {
  try {
    const { groupId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const calls = await firebase.getCallsByGroup(groupId);
    
    // Pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedCalls = calls.slice(startIndex, endIndex);

    res.json({
      success: true,
      data: {
        calls: paginatedCalls,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: calls.length,
          pages: Math.ceil(calls.length / limit)
        }
      }
    });

  } catch (error) {
    console.error('Error getting calls by group:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// Update call
async function updateCall(req, res) {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Remove fields that shouldn't be updated directly
    delete updateData.id;
    delete updateData.createdAt;
    delete updateData.token;
    delete updateData.callerId;
    delete updateData.groupId;
    delete updateData.tsCall;

    const success = await firebase.updateCall(id, updateData);

    if (!success) {
      return res.status(400).json({
        success: false,
        error: 'Failed to update call'
      });
    }

    res.json({
      success: true,
      message: 'Call updated successfully'
    });

  } catch (error) {
    console.error('Error updating call:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// Delete call
async function deleteCall(req, res) {
  try {
    const { id } = req.params;

    // Get call first to update caller stats
    const call = await firebase.getCall(id);
    if (call) {
      await updateCallerStats(call.callerId, 'call_deleted');
    }

    const success = await firebase.remove(`calls/${id}`);

    if (!success) {
      return res.status(400).json({
        success: false,
        error: 'Failed to delete call'
      });
    }

    res.json({
      success: true,
      message: 'Call deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting call:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// Helper function to update caller stats
async function updateCallerStats(callerId, action) {
  try {
    const stats = await firebase.getCallerStats(callerId);
    
    switch (action) {
      case 'call_created':
        stats.totals.calls = (stats.totals.calls || 0) + 1;
        break;
      case 'call_deleted':
        stats.totals.calls = Math.max(0, (stats.totals.calls || 0) - 1);
        break;
    }

    await firebase.updateCallerStats(callerId, stats);
  } catch (error) {
    console.error('Error updating caller stats:', error);
  }
}

module.exports = {
  createCall,
  getCall,
  getCallsByToken,
  getCallsByGroup,
  updateCall,
  deleteCall
};
