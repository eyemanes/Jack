// Simple health check endpoint for Vercel
module.exports = (req, res) => {
  try {
    res.status(200).json({ 
      status: 'OK', 
      message: 'Solana Tracker API is running',
      timestamp: new Date().toISOString(),
      method: req.method,
      url: req.url
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'ERROR', 
      message: error.message 
    });
  }
};
