// Health check endpoint for Vercel - now with Firebase stats
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

    // Get Firebase stats
    const stats = {
      totalCalls: await db.getTotalCalls(),
      activeCalls: await db.getActiveCallsCount(),
      totalUsers: await db.getTotalUsers(),
      totalTokens: await db.getTotalTokens(),
      totalVolume: await db.getTotalVolume(),
      averagePnL: await db.getAveragePnL()
    };

    res.status(200).json({ 
      status: 'OK', 
      message: 'Solana Tracker API is running with Firebase',
      timestamp: new Date().toISOString(),
      method: req.method,
      url: req.url,
      database: 'Firebase',
      stats: stats
    });
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({ 
      status: 'ERROR', 
      message: error.message 
    });
  }
};
