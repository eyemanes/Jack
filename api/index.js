// Simple API handler for Vercel
module.exports = (req, res) => {
  try {
    // Enable CORS
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    
    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }
    
    const { url } = req;
    
    // Route handling
    if (url === '/api/health' || url === '/health') {
      res.status(200).json({ 
        status: 'OK', 
        message: 'Solana Tracker API is running',
        timestamp: new Date().toISOString()
      });
      return;
    }
    
    if (url === '/api/calls' || url === '/calls') {
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
      
      res.status(200).json({ 
        success: true, 
        data: mockCalls 
      });
      return;
    }
    
    if (url === '/api/leaderboard' || url === '/leaderboard') {
      const mockLeaderboard = [
        {
          id: 1,
          telegramId: "123456789",
          username: "testuser1",
          firstName: "Test",
          totalCalls: 5,
          successfulCalls: 3,
          winRate: 60.0,
          totalScore: 15.5,
          avgPnL: 45.2,
          bestCall: 150.0,
          rank: 1
        }
      ];
      
      res.status(200).json({ 
        success: true, 
        data: mockLeaderboard 
      });
      return;
    }
    
    if (url === '/api/stats' || url === '/stats') {
      const mockStats = {
        totalCalls: 25,
        activeCalls: 15,
        totalUsers: 8,
        totalTokens: 12,
        totalVolume: 150000,
        averagePnL: 35.5
      };
      
      res.status(200).json({ 
        success: true, 
        data: mockStats 
      });
      return;
    }
    
    // Default response
    res.status(200).json({ 
      status: 'OK', 
      message: 'Solana Tracker API',
      availableEndpoints: ['/api/health', '/api/calls', '/api/leaderboard', '/api/stats'],
      url: url
    });
    
  } catch (error) {
    res.status(500).json({ 
      status: 'ERROR', 
      message: error.message,
      stack: error.stack
    });
  }
};