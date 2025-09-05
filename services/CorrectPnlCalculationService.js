/**
 * CORRECT PnL Calculation Service - Matches exact user specifications
 * Implements the precise rules as specified by the user
 */

class CorrectPnlCalculationService {
  constructor() {
    this.cache = new Map();
  }

  /**
   * MAIN PnL CALCULATION METHOD - Exact user specifications
   * @param {Object} call - Call object from database
   * @param {Object} tokenData - Current token data from API
   * @returns {Object} Calculation result
   */
  calculatePnl(call, tokenData) {
    const result = {
      pnlPercent: 0,
      maxPnl: 0,
      isValid: false,
      calculationType: 'error',
      debugInfo: {}
    };

    try {
      // Extract data
      const callTime = new Date(call.createdAt || call.callTime).getTime();
      const mcapAtCall = parseFloat(call.entryMarketCap) || 0;
      const currentMcap = parseFloat(tokenData.marketCap) || 0;
      const athMcap = parseFloat(tokenData.ath) || 0;
      const athTime = tokenData.athTimestamp ? new Date(tokenData.athTimestamp).getTime() : null;
      const maxPnl = parseFloat(call.maxPnl) || 0;

      // Validate inputs
      if (!callTime || !mcapAtCall || !currentMcap || mcapAtCall === 0) {
        console.error('❌ Invalid PnL input:', { callTime, mcapAtCall, currentMcap });
        return result;
      }

      let pnl = (currentMcap / mcapAtCall) - 1;
      let peakPnl = maxPnl;
      let calculationType = 'current_price';

      console.log(`🧮 PnL Calculation Debug:`, {
        callTime: new Date(callTime).toISOString(),
        athTime: athTime ? new Date(athTime).toISOString() : 'N/A',
        mcapAtCall,
        currentMcap,
        athMcap,
        maxPnl
      });

      // FRESH CALL OPTIMIZATION: If call is less than 1 minute old, skip ATH-after-call logic
      const now = Date.now();
      const fresh = now - callTime < 60_000; // 1 minute
      const nearAth = athMcap > 0 && Math.abs(currentMcap - athMcap) / athMcap < 0.01; // Within 1%

      console.log(`🕐 Fresh Call Check:`, { fresh, nearAth, timeDiff: now - callTime });

      // RULE 1: ATH Logic
      if (athTime && athTime > callTime && !(fresh && nearAth)) {
        // ATH happened after the call → lock PnL at ATH
        const athPnl = (athMcap / mcapAtCall) - 1;
        pnl = athPnl;
        calculationType = 'ath_locked';
        console.log(`🔒 ATH Rule Applied: Locked at ${(pnl * 100).toFixed(2)}% (ATH after call)`);
      }

      // Update peak PnL
      peakPnl = Math.max(peakPnl, pnl);

      // RULE 2: 2x Lock Rule
      if (peakPnl >= 1.0) { // 1.0 = 2x multiplier (100% gain)
        pnl = peakPnl; // Never follow downside after 2x
        calculationType = 'peak_locked_2x';
        console.log(`🚀 2x Rule Applied: Locked at peak ${(pnl * 100).toFixed(2)}%`);
      }

      const finalPnlPercent = pnl * 100;
      console.log(`✅ Final PnL: ${finalPnlPercent.toFixed(2)}% (${calculationType})`);

      result.pnlPercent = finalPnlPercent;
      result.maxPnl = peakPnl * 100;
      result.isValid = true;
      result.calculationType = calculationType;
      result.debugInfo = {
        callTime: new Date(callTime).toISOString(),
        athTime: athTime ? new Date(athTime).toISOString() : null,
        fresh,
        nearAth,
        mcapAtCall,
        currentMcap,
        athMcap,
        peakPnl: peakPnl * 100,
        calculationType
      };

      return result;

    } catch (error) {
      console.error(`❌ Error in calculatePnl:`, error);
      result.debugInfo.error = error.message;
      return result;
    }
  }

  /**
   * Calculate PnL for a call with database integration
   * @param {Object} call - Call object from database
   * @param {Object} tokenData - Current token data
   * @returns {number} Calculated PnL percentage
   */
  calculatePnlForCall(call, tokenData) {
    const result = this.calculatePnl(call, tokenData);
    return result.isValid ? result.pnlPercent : 0;
  }

  /**
   * Calculate accurate PnL for contract address - with proper delays
   * @param {Object} call - Call object from database
   * @returns {Object} PnL calculation result
   */
  async calculateAccuratePnl(call) {
    try {
      console.log(`🔄 Calculating PnL for: ${call.contractAddress}`);
      
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

      // Use the correct calculation method
      const result = this.calculatePnl(call, tokenData);
      
      console.log(`📊 PnL calculation for ${call.contractAddress}: ${result.pnlPercent.toFixed(2)}%`);
      
      return {
        pnlPercent: result.pnlPercent,
        pnlType: result.calculationType,
        reason: 'Using correct calculation system',
        data: {
          entryMarketCap: call.entryMarketCap,
          currentMarketCap: tokenData.marketCap,
          athMarketCap: tokenData.ath,
          athTimestamp: tokenData.athTimestamp,
          pnl: result.pnlPercent,
          maxPnl: result.maxPnl,
          tokenData: tokenData,
          debugInfo: result.debugInfo
        },
        timestamp: Date.now()
      };
    } catch (error) {
      console.error(`❌ Error in calculateAccuratePnl:`, error);
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
   * Reset corrupted maxPnl values
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

module.exports = CorrectPnlCalculationService;
