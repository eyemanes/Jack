// Leaderboard endpoint for Vercel
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
    
    // Mock leaderboard data
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
      },
      {
        id: 2,
        telegramId: "987654321",
        username: "testuser2",
        firstName: "User",
        totalCalls: 3,
        successfulCalls: 2,
        winRate: 66.7,
        totalScore: 12.0,
        avgPnL: 35.8,
        bestCall: 120.0,
        rank: 2
      }
    ];
    
    res.status(200).json({ 
      success: true, 
      data: mockLeaderboard 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
};
