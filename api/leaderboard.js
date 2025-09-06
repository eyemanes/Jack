const { FirebaseService } = require('../lib/firebase');

const firebase = new FirebaseService();

// Get leaderboard for a specific group
async function getLeaderboard(req, res) {
  try {
    const { groupId } = req.query;
    const { page = 1, limit = 50, sortBy = 'totalScore' } = req.query;

    let calls = [];
    
    if (groupId) {
      // Get calls for specific group
      calls = await firebase.getCallsByGroup(groupId);
    } else {
      // Get all active calls
      calls = await firebase.getActiveCalls();
    }

    // Calculate leaderboard data
    const leaderboard = calculateLeaderboard(calls);

    // Sort by specified field
    const validSortFields = ['totalScore', 'bestMultiplier', 'totalCalls', 'x2', 'x5', 'x10', 'x25', 'x50', 'x100'];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'totalScore';
    
    leaderboard.sort((a, b) => {
      if (sortField === 'bestMultiplier') {
        return b.bestMultiplier - a.bestMultiplier;
      }
      return b[sortField] - a[sortField];
    });

    // Pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedLeaderboard = leaderboard.slice(startIndex, endIndex);

    res.json({
      success: true,
      data: {
        leaderboard: paginatedLeaderboard,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: leaderboard.length,
          pages: Math.ceil(leaderboard.length / limit)
        },
        filters: {
          groupId: groupId || null,
          sortBy: sortField
        }
      }
    });

  } catch (error) {
    console.error('Error getting leaderboard:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// Get caller stats
async function getCallerStats(req, res) {
  try {
    const { callerId } = req.params;
    
    const stats = await firebase.getCallerStats(callerId);
    
    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error('Error getting caller stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// Get all caller stats
async function getAllCallerStats(req, res) {
  try {
    const { page = 1, limit = 100, sortBy = 'totalScore' } = req.query;
    
    const allStats = await firebase.getAllCallerStats();
    
    // Sort by specified field
    const validSortFields = ['totalScore', 'bestMultiplier', 'calls'];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'totalScore';
    
    allStats.sort((a, b) => {
      if (sortField === 'bestMultiplier') {
        return b.bestMultiplier - a.bestMultiplier;
      }
      return b.totals[sortField] - a.totals[sortField];
    });

    // Pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedStats = allStats.slice(startIndex, endIndex);

    res.json({
      success: true,
      data: {
        callers: paginatedStats,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: allStats.length,
          pages: Math.ceil(allStats.length / limit)
        },
        filters: {
          sortBy: sortField
        }
      }
    });

  } catch (error) {
    console.error('Error getting all caller stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// Get group statistics
async function getGroupStats(req, res) {
  try {
    const { groupId } = req.params;
    
    const calls = await firebase.getCallsByGroup(groupId);
    
    const stats = calculateGroupStats(calls);
    
    res.json({
      success: true,
      data: {
        groupId,
        ...stats
      }
    });

  } catch (error) {
    console.error('Error getting group stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// Calculate leaderboard from calls
function calculateLeaderboard(calls) {
  const callerMap = new Map();

  for (const call of calls) {
    const callerId = call.callerId;
    
    if (!callerMap.has(callerId)) {
      callerMap.set(callerId, {
        callerId,
        totalCalls: 0,
        totalScore: 0,
        bestMultiplier: 0,
        milestones: {
          x2: 0,
          x5: 0,
          x10: 0,
          x25: 0,
          x50: 0,
          x100: 0
        },
        calls: []
      });
    }

    const caller = callerMap.get(callerId);
    caller.totalCalls++;
    caller.calls.push(call);

    // Calculate score based on multiplier
    const multiplier = call.progress?.multiplier || 1;
    const score = Math.max(0, (multiplier - 1) * 100); // Convert multiplier to percentage score
    caller.totalScore += score;

    // Update best multiplier
    if (multiplier > caller.bestMultiplier) {
      caller.bestMultiplier = multiplier;
    }

    // Count milestones
    const milestones = call.milestones || {};
    for (const [key, milestone] of Object.entries(milestones)) {
      if (milestone.hit) {
        caller.milestones[key]++;
      }
    }
  }

  return Array.from(callerMap.values());
}

// Calculate group statistics
function calculateGroupStats(calls) {
  if (calls.length === 0) {
    return {
      totalCalls: 0,
      activeCalls: 0,
      totalCallers: 0,
      avgMultiplier: 0,
      bestMultiplier: 0,
      totalMilestones: {
        x2: 0,
        x5: 0,
        x10: 0,
        x25: 0,
        x50: 0,
        x100: 0
      }
    };
  }

  const activeCalls = calls.filter(call => call.status === 'active');
  const callers = new Set(calls.map(call => call.callerId));
  
  let totalMultiplier = 0;
  let bestMultiplier = 0;
  const totalMilestones = {
    x2: 0,
    x5: 0,
    x10: 0,
    x25: 0,
    x50: 0,
    x100: 0
  };

  for (const call of calls) {
    const multiplier = call.progress?.multiplier || 1;
    totalMultiplier += multiplier;
    
    if (multiplier > bestMultiplier) {
      bestMultiplier = multiplier;
    }

    // Count milestones
    const milestones = call.milestones || {};
    for (const [key, milestone] of Object.entries(milestones)) {
      if (milestone.hit) {
        totalMilestones[key]++;
      }
    }
  }

  return {
    totalCalls: calls.length,
    activeCalls: activeCalls.length,
    totalCallers: callers.size,
    avgMultiplier: totalMultiplier / calls.length,
    bestMultiplier,
    totalMilestones
  };
}

module.exports = {
  getLeaderboard,
  getCallerStats,
  getAllCallerStats,
  getGroupStats
};
