// Leaderboard endpoint for Vercel - using Firebase
const FirebaseService = require('../services/FirebaseService');

const db = new FirebaseService();

module.exports = async (req, res) => {
  try {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    
    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }
    
    const leaderboard = await db.getLeaderboard();
    
    // Transform the data to match frontend expectations
    const transformedLeaderboard = leaderboard.map((user, index) => ({
      rank: index + 1,
      user: {
        id: user.id,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        displayName: user.username || user.firstName || 'Anonymous'
      },
      stats: {
        totalCalls: user.totalCalls || 0,
        successfulCalls: user.successfulCalls || 0,
        totalScore: user.totalScore || 0,
        avgPnL: user.avgPnL || 0,
        bestCall: user.bestCall || 0
      }
    }));
    
    res.status(200).json({
      success: true,
      data: transformedLeaderboard
    });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};
