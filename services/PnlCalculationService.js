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

    // Validate maxPnl - it should be reasonable
    const maxPnlPercent = maxPnl / 100; // Convert from percentage to decimal
    const maxPossiblePnl = Math.max(
      (currentMcap / mcapAtCall) - 1,
      athMcap > 0 ? (athMcap / mcapAtCall) - 1 : 0
    );
    
    // If maxPnl is unreasonably high, reset it
    if (maxPnlPercent > maxPossiblePnl * 2) {
      console.log(`⚠️ Suspicious maxPnl detected: ${maxPnl}% (${maxPnlPercent}x), max possible: ${(maxPossiblePnl * 100).toFixed(2)}%. Resetting.`);
      maxPnl = 0;
    }

    const now = Date.now();
    let pnl = (currentMcap / mcapAtCall) - 1;
    let peakPnl = maxPnl / 100; // Convert from percentage to decimal
    
    console.log(`🔍 PnL Calculation Debug:`, {
      currentPnl: (pnl * 100).toFixed(2) + '%',
      maxPnlFromDB: maxPnl + '%',
      peakPnlDecimal: peakPnl.toFixed(4),
      entryMcap: mcapAtCall,
      currentMcap: currentMcap,
      athMcap: athMcap
    });

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
    
    console.log(`📈 Peak PnL updated: ${(peakPnl * 100).toFixed(2)}%`);

    // Rule 2: 2x Lock Rule - Only apply if we actually reached 2x (100% gain)
    if (peakPnl >= 1.0) {
      // Check if the peak PnL was actually achieved with real data
      const peakMcap = mcapAtCall * (1 + peakPnl);
      const maxPossibleMcap = Math.max(currentMcap, athMcap);
      
      // Only lock if the peak was actually achievable with real market cap data
      if (maxPossibleMcap >= peakMcap * 0.9) { // Allow 10% tolerance
        pnl = peakPnl; // Never follow downside after 2x
        console.log(`🚀 2x Rule: Locking at peak PnL (${(pnl * 100).toFixed(2)}%)`);
      } else {
        console.log(`⚠️ 2x Rule: Peak PnL ${(peakPnl * 100).toFixed(2)}% not achievable with real data, using current PnL`);
      }
    }

    // Rule 3: No cap - let tokens go as high as they can!
    // Removed 10x cap to allow for real 100x-200x gains

    const finalPnlPercent = pnl * 100;
    
    // Sanity check: PnL should not be impossible
    const maxPossiblePnlPercent = Math.max(
      ((currentMcap / mcapAtCall) - 1) * 100,
      athMcap > 0 ? ((athMcap / mcapAtCall) - 1) * 100 : 0
    );
    
    if (finalPnlPercent > maxPossiblePnlPercent * 1.5) {
      console.log(`🚨 Impossible PnL detected: ${finalPnlPercent.toFixed(2)}%, max possible: ${maxPossiblePnlPercent.toFixed(2)}%. Capping.`);
      return maxPossiblePnlPercent;
    }
    
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
      console.error('❌ Error in calculatePnlForCall:', error);
      console.error('Call data:', call);
      console.error('Token data:', tokenData);
      return 0; // Return 0 PnL on error
    }
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

  /**
   * Reset corrupted maxPnl values
   * @param {Object} call - Call object from database
   * @param {Object} tokenData - Current token data
   * @returns {boolean} True if maxPnl was reset
   */
  shouldResetMaxPnl(call, tokenData) {
    const maxPnl = parseFloat(call.maxPnl) || 0;
    const entryMcap = parseFloat(call.entryMarketCap) || 0;
    const currentMcap = parseFloat(tokenData.marketCap) || 0;
    const athMcap = parseFloat(tokenData.ath) || 0;
    
    if (maxPnl <= 0 || entryMcap <= 0) return false;
    
    const maxPossiblePnl = Math.max(
      ((currentMcap / entryMcap) - 1) * 100,
      athMcap > 0 ? ((athMcap / entryMcap) - 1) * 100 : 0
    );
    
    // If maxPnl is more than 2x the maximum possible PnL, it's corrupted
    return maxPnl > maxPossiblePnl * 2;
  }
}

module.exports = PnlCalculationService;
