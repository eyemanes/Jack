/**
 * Advanced PnL Calculation Service
 * Implements the proper PnL calculation rules with ATH tracking
 */

class PnlCalculationService {
  constructor() {
    this.cache = new Map(); // Cache for storing max PnL per call
  }

  /**
   * Calculate PnL with proper ATH rules
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

    console.log(`🔍 PnL Debug:`, {
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
      console.log(`🔒 ATH Rule: Locking PnL at ATH (${(pnl * 100).toFixed(2)}%)`);
    }

    // Update peak PnL
    peakPnl = Math.max(peakPnl, pnl);

    // Rule 2: 2x Lock Rule
    if (peakPnl >= 1.0) {
      pnl = peakPnl; // Never follow downside after 2x
      console.log(`🚀 2x Rule: Locking at peak PnL (${(pnl * 100).toFixed(2)}%)`);
    }

    // Rule 3: 10x Cap Rule
    if (peakPnl >= 9.0) {
      pnl = 9.0; // Cap at 10x (900%)
      console.log(`🎯 10x Rule: Capping at 10x (${(pnl * 100).toFixed(2)}%)`);
    }

    const finalPnlPercent = pnl * 100;
    console.log(`✅ Final PnL: ${finalPnlPercent.toFixed(2)}%`);

    return finalPnlPercent;
  }

  /**
   * Calculate PnL for a call with database integration
   * @param {Object} call - Call object from database
   * @param {Object} tokenData - Current token data
   * @returns {number} Calculated PnL percentage
   */
  calculatePnlForCall(call, tokenData) {
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
  }

  /**
   * Update call with new PnL and store max PnL
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

module.exports = PnlCalculationService;
