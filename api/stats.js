// Stats endpoint for Vercel
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
    
    // Mock stats data
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
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
};
