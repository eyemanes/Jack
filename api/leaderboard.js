// Leaderboard endpoint for Vercel - now using Firebase
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
    
    // Add rank to each user
    const leaderboardWithRank = leaderboard.map((user, index) => ({
      ...user,
      rank: index + 1
    }));
    
    res.status(200).json({ 
      success: true, 
      data: leaderboardWithRank 
    });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
};
