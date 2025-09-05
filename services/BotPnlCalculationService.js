/**
 * Bot PnL Calculation Service - Exact same logic as the bot
 * Implements the proper PnL calculation rules with ATH tracking
 */

class BotPnlCalculationService {
  constructor() {
    this.cache = new Map(); // Cache for storing max PnL per call
  }

  /**
   * Calculate PnL with proper ATH rules - EXACT SAME AS BOT
   * @param {Object} input - PnL calculation input
   * @param {number} input.callTime - Timestamp when token was called
   * @param {number} input.mcapAtCall - Market cap at call time
   * @param {number} input.currentMcap - Latest market cap
   * @param {number} input.athMcap - All-time-high market cap
   * @param {number} input.athTime - Timestamp of ATH
   * @param {number} input.maxPnl - Previous maximum PnL (optional)
   * @returns {number} Calculated PnL percentage
   */
  calculatePnl(input) {
    const { 
      callTime, 
      mcapAtCall, 
      currentMcap, 
      athMcap, 
      athTime, 
      maxPnl = 0 
    } = input;

    // Validate inputs
    if (!callTime || !mcapAtCall || !currentMcap || mcapAtCall === 0) {
      console.log('❌ Invalid PnL input:', input);
      return 0;
    }

    const now = Date.now();
    let pnl = (currentMcap / mcapAtCall) - 1;
    let peakPnl = maxPnl;

    // Fresh Call Optimization: If call is less than 1 minute old and token is at ATH
    const fresh = now - callTime < 60_000; // 1 minute
    const nearAth = athMcap > 0 && Math.abs(currentMcap - athMcap) / athMcap < 0.01; // Within 1%

    console.log(`🔍 Backend PnL Debug:`, {
      callTime: new Date(callTime).toISOString(),
      athTime: athTime ? new Date(athTime).toISOString() : 'N/A',
      fresh,
      nearAth,
      currentMcap,
      athMcap,
      mcapAtCall
    });

    // Rule 1: ATH Logic
    if (athTime > callTime && !(fresh && nearAth)) {
      // ATH happened after the call → lock PnL at ATH
      pnl = (athMcap / mcapAtCall) - 1;
      console.log(`🔒 Backend ATH Rule: Locking PnL at ATH (${(pnl * 100).toFixed(2)}%)`);
    }

    // Update peak PnL
    peakPnl = Math.max(peakPnl, pnl);

    // Rule 2: 2x Lock Rule
    if (peakPnl >= 1.0) {
      pnl = peakPnl; // Never follow downside after 2x
      console.log(`🚀 Backend 2x Rule: Locking at peak PnL (${(pnl * 100).toFixed(2)}%)`);
    }

    // Rule 3: 10x Cap Rule (REMOVED - as per user request)
    // if (peakPnl >= 9.0) {
    //   pnl = 9.0; // Cap at 10x (900%)
    //   console.log(`🎯 Backend 10x Rule: Capping at 10x (${(pnl * 100).toFixed(2)}%)`);
    // }

    const finalPnlPercent = pnl * 100;
    console.log(`✅ Backend Final PnL: ${finalPnlPercent.toFixed(2)}%`);

    return finalPnlPercent;
  }

  /**
   * Calculate PnL for a call with database integration - EXACT SAME AS BOT
   * @param {Object} call - Call object from database
   * @param {Object} tokenData - Current token data
   * @returns {number} Calculated PnL percentage
   */
  calculatePnlForCall(call, tokenData) {
    try {
      const callTime = new Date(call.createdAt || call.callTime).getTime();
      const mcapAtCall = parseFloat(call.entryMarketCap) || 0;
      const currentMcap = parseFloat(tokenData.marketCap) || 0;
      const athMcap = parseFloat(tokenData.ath) || 0;
      const athTime = tokenData.athTimestamp ? new Date(tokenData.athTimestamp).getTime() : null;
      const maxPnl = parseFloat(call.maxPnl) || 0;

      return this.calculatePnl({
        callTime,
        mcapAtCall,
        currentMcap,
        athMcap,
        athTime,
        maxPnl
      });
    } catch (error) {
      console.error('❌ Backend Error in calculatePnlForCall:', error);
      console.error('Call data:', call);
      console.error('Token data:', tokenData);
      return 0; // Return 0 PnL on error
    }
  }

  /**
   * Calculate accurate PnL for contract address - with proper delays
   * @param {Object} call - Call object from database
   * @returns {Object} PnL calculation result
   */
  async calculateAccuratePnl(call) {
    try {
      console.log(`🔄 Backend calculating PnL for: ${call.contractAddress}`);
      
      // Add delay to avoid rate limiting
      await this.delay(2000); // 2 second delay
      
      // Import SolanaTrackerService to get current data
      const SolanaTrackerService = require('./SolanaTrackerService');
      const solanaService = new SolanaTrackerService();
      
      // Fetch current token data
      const tokenData = await solanaService.getTokenData(call.contractAddress);
      
      if (!tokenData) {
        console.log(`❌ No token data found for ${call.contractAddress}`);
        return {
          pnlPercent: 0,
          pnlType: 'error',
          reason: 'No token data available',
          data: null,
          timestamp: Date.now()
        };
      }

      // Use the exact same calculation as the bot
      const pnlPercent = this.calculatePnlForCall(call, tokenData);
      
      console.log(`📊 Backend PnL calculation for ${call.contractAddress}: ${pnlPercent.toFixed(2)}%`);
      
      return {
        pnlPercent: pnlPercent,
        pnlType: 'bot_calculation',
        reason: 'Using bot calculation system',
        data: {
          entryMarketCap: call.entryMarketCap,
          currentMarketCap: tokenData.marketCap,
          athMarketCap: tokenData.ath,
          athTimestamp: tokenData.athTimestamp,
          pnl: pnlPercent,
          tokenData: tokenData
        },
        timestamp: Date.now()
      };
    } catch (error) {
      console.error(`❌ Backend Error in calculateAccuratePnl:`, error);
      return {
        pnlPercent: 0,
        pnlType: 'error',
        reason: 'Calculation failed',
        data: null,
        timestamp: Date.now()
      };
    }
  }

  /**
   * Update call with new PnL and store max PnL - EXACT SAME AS BOT
   * @param {Object} call - Call object
   * @param {number} newPnl - New PnL percentage
   * @returns {Object} Updated call object
   */
  updateCallWithPnl(call, newPnl) {
    const currentMaxPnl = parseFloat(call.maxPnl) || 0;
    const newMaxPnl = Math.max(currentMaxPnl, newPnl);

    return {
      ...call,
      pnlPercent: newPnl,
      maxPnl: newMaxPnl,
      lastPnlUpdate: new Date().toISOString()
    };
  }

  /**
   * Reset corrupted maxPnl values - EXACT SAME AS BOT
   * @param {Object} call - Call object from database
   * @param {Object} tokenData - Current token data (optional)
   * @returns {boolean} True if maxPnl should be reset
   */
  shouldResetMaxPnl(call, tokenData = null) {
    try {
      const maxPnl = parseFloat(call.maxPnl) || 0;
      const entryMcap = parseFloat(call.entryMarketCap) || 0;
      
      if (maxPnl <= 0 || entryMcap <= 0) return false;
      
      // If no tokenData provided, use a simple check based on current stored data
      if (!tokenData) {
        const currentMcap = parseFloat(call.currentMarketCap) || 0;
        if (currentMcap <= 0) return false;
        
        const maxPossiblePnl = ((currentMcap / entryMcap) - 1) * 100;
        return maxPnl > maxPossiblePnl * 2;
      }
      
      const currentMcap = parseFloat(tokenData.marketCap) || 0;
      const athMcap = parseFloat(tokenData.ath) || 0;
      
      if (currentMcap <= 0) return false;
      
      const maxPossiblePnl = Math.max(
        ((currentMcap / entryMcap) - 1) * 100,
        athMcap > 0 ? ((athMcap / entryMcap) - 1) * 100 : 0
      );
      
      // If maxPnl is more than 2x the maximum possible PnL, it's corrupted
      return maxPnl > maxPossiblePnl * 2;
    } catch (error) {
      console.error('❌ Error in shouldResetMaxPnl:', error);
      return false;
    }
  }

  /**
   * Utility function to add delay
   * @param {number} ms - Milliseconds to delay
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get cache key for a call
   * @param {string} callId - Call ID
   * @returns {string} Cache key
   */
  getCacheKey(callId) {
    return `pnl_${callId}`;
  }

  /**
   * Store max PnL in cache
   * @param {string} callId - Call ID
   * @param {number} maxPnl - Maximum PnL
   */
  setMaxPnl(callId, maxPnl) {
    this.cache.set(this.getCacheKey(callId), maxPnl);
  }

  /**
   * Get max PnL from cache
   * @param {string} callId - Call ID
   * @returns {number} Maximum PnL
   */
  getMaxPnl(callId) {
    return this.cache.get(this.getCacheKey(callId)) || 0;
  }

  /**
   * Clear cache for a call
   * @param {string} callId - Call ID
   */
  clearCache(callId) {
    this.cache.delete(this.getCacheKey(callId));
  }

  /**
   * Clear all cache
   */
  clearAllCache() {
    this.cache.clear();
  }
}

module.exports = BotPnlCalculationService;
