// Stats endpoint for Vercel - using Firebase
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
    
    // Get comprehensive stats
    const stats = {
      totalCalls: await db.getTotalCalls(),
      activeCalls: await db.getActiveCallsCount(),
      totalUsers: await db.getTotalUsers(),
      totalTokens: await db.getTotalTokens(),
      totalVolume: await db.getTotalVolume(),
      averagePnL: await db.getAveragePnL()
    };
    
    res.status(200).json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};
