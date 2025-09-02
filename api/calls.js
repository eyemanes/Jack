// Calls endpoint for Vercel

// Simple mock data for now (since SQLite won't work on Vercel)
const mockCalls = [
  {
    id: 1,
    contractAddress: "mock-address-1",
    createdAt: new Date().toISOString(),
    token: {
      name: "Mock Token 1",
      symbol: "MOCK1",
      contractAddress: "mock-address-1"
    },
    user: {
      id: 1,
      username: "testuser",
      displayName: "Test User"
    },
    prices: {
      entry: 0.001,
      current: 0.002,
      entryMarketCap: 10000,
      currentMarketCap: 20000
    },
    performance: {
      pnlPercent: 100,
      score: 5,
      isEarlyCall: true,
      callRank: 1
    },
    marketData: {
      liquidity: 5000,
      volume24h: 1000
    }
  }
];

module.exports = (req, res) => {
  try {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    
    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }
    
    res.status(200).json({ 
      success: true, 
      data: mockCalls 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
};
