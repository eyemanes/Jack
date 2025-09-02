// Calls endpoint for Vercel - now using Firebase
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
    
    const calls = await db.getAllActiveCalls();
    
    // Transform the data to match frontend expectations
    const transformedCalls = calls.map(call => ({
      id: call.id,
      contractAddress: call.contractAddress,
      createdAt: call.createdAt,
      updatedAt: call.updatedAt,
      token: {
        name: call.tokenName,
        symbol: call.tokenSymbol,
        contractAddress: call.contractAddress
      },
      user: {
        id: call.userId,
        username: call.username,
        firstName: call.firstName,
        lastName: call.lastName,
        displayName: call.username || call.firstName || 'Anonymous'
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
      },
      marketData: {
        liquidity: call.currentLiquidity,
        volume24h: call.current24hVolume
      }
    }));
    
    res.status(200).json({ 
      success: true, 
      data: transformedCalls 
    });
  } catch (error) {
    console.error('Error fetching calls:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
};
