/**
 * DETERMINISTIC PnL Calculation Service - Race-safe, drift-free
 * Implements the invariant model with immutable snapshots and monotonic tracking
 */

class DeterministicPnlCalculationService {
  constructor() {
    this.cache = new Map();
    this.lockTTL = 25000; // 25 seconds
    this.candleGranularity = 60000; // 1 minute in ms
    this.anomalyThreshold = 8; // z-score threshold
  }

  /**
   * PURE PnL CALCULATION - Side-effect free, deterministic
   * @param {Object} params - Calculation parameters
   * @returns {number|null} PnL percentage or null if invalid
   */
  computePnl({ mcapAtCall, currentMcap, maxMcapSinceCall = null }) {
    if (!Number.isFinite(mcapAtCall) || mcapAtCall <= 0) return null;

    const basis = Number(mcapAtCall);
    const peak = Number.isFinite(maxMcapSinceCall) && maxMcapSinceCall > 0
      ? maxMcapSinceCall
      : currentMcap;

    if (!Number.isFinite(peak) || peak <= 0) return null;

    const pnl = (peak / basis) - 1;
    return pnl;
  }

  /**
   * UPDATE MILESTONES - Write-once milestone tracking
   * @param {Object} params - Milestone parameters
   * @returns {Object} Updated milestones
   */
  updateMilestones({ peak, basis, milestones = {} }) {
    const xs = [2, 5, 10, 25, 50, 100];
    const out = { ...milestones };
    
    for (const x of xs) {
      const threshold = x * basis;
      if (!out[`${x}x`] && peak >= threshold) {
        out[`${x}x`] = Date.now(); // write-once
      }
    }
    
    return out;
  }

  /**
   * ACQUIRE DISTRIBUTED LOCK - Race-safe per-contract locking
   * @param {string} contractAddress - Contract to lock
   * @param {string} holderId - Unique holder identifier
   * @returns {Promise<boolean>} True if lock acquired
   */
  async acquireLock(contractAddress, holderId) {
    try {
      const FirebaseService = require('./FirebaseService');
      const db = new FirebaseService();
      
      const lockRef = `locks/${contractAddress}`;
      const lockData = {
        holderId,
        expiresAt: Date.now() + this.lockTTL,
        acquiredAt: Date.now()
      };

      // Try to acquire lock via transaction
      const result = await db.transaction(lockRef, (current) => {
        if (!current || current.expiresAt < Date.now()) {
          return lockData;
        }
        return null; // Lock already held
      });

      return result !== null;
    } catch (error) {
      console.error(`❌ Lock acquisition failed for ${contractAddress}:`, error);
      return false;
    }
  }

  /**
   * RELEASE DISTRIBUTED LOCK
   * @param {string} contractAddress - Contract to unlock
   * @param {string} holderId - Holder identifier
   */
  async releaseLock(contractAddress, holderId) {
    try {
      const FirebaseService = require('./FirebaseService');
      const db = new FirebaseService();
      
      const lockRef = `locks/${contractAddress}`;
      const lockData = await db.get(lockRef);
      
      if (lockData && lockData.holderId === holderId) {
        await db.remove(lockRef);
      }
    } catch (error) {
      console.error(`❌ Lock release failed for ${contractAddress}:`, error);
    }
  }

  /**
   * VALIDATE TOKEN DATA - Comprehensive data validation
   * @param {Object} tokenData - Token data from API
   * @param {Object} call - Call object
   * @returns {Object} Validation result
   */
  validateTokenData(tokenData, call) {
    const errors = [];
    const warnings = [];

    // Basic validation
    if (!tokenData) {
      errors.push('No token data provided');
      return { valid: false, errors, warnings };
    }

    const price = parseFloat(tokenData.price) || 0;
    const supply = parseFloat(tokenData.supply) || 0;
    const marketCap = parseFloat(tokenData.marketCap) || 0;
    const decimals = parseInt(tokenData.decimals) || 0;

    // Price validation
    if (price <= 0) errors.push('Invalid price: must be > 0');
    if (!Number.isFinite(price)) errors.push('Price is not finite');

    // Supply validation
    if (supply <= 0) errors.push('Invalid supply: must be > 0');
    if (!Number.isFinite(supply)) errors.push('Supply is not finite');

    // Market cap validation
    if (marketCap <= 0) errors.push('Invalid market cap: must be > 0');
    if (!Number.isFinite(marketCap)) errors.push('Market cap is not finite');

    // Decimals validation
    if (decimals < 0 || decimals > 18) errors.push('Invalid decimals: must be 0-18');

    // Supply change validation (if previous data exists)
    if (call.currentSupply && call.currentSupply > 0) {
      const supplyChange = Math.abs(supply - call.currentSupply) / call.currentSupply;
      if (supplyChange > 0.9) { // 90% change
        warnings.push(`Large supply change: ${(supplyChange * 100).toFixed(1)}%`);
      }
    }

    // Market cap consistency check
    const calculatedMcap = price * supply;
    const mcapDiff = Math.abs(marketCap - calculatedMcap) / marketCap;
    if (mcapDiff > 0.1) { // 10% difference
      warnings.push(`Market cap inconsistency: API=${marketCap}, Calculated=${calculatedMcap}`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      validatedData: {
        price,
        supply,
        marketCap,
        decimals,
        timestamp: Date.now()
      }
    };
  }

  /**
   * DETECT ANOMALIES - Z-score based anomaly detection
   * @param {Array} mcapHistory - Historical market cap data
   * @param {number} currentMcap - Current market cap
   * @returns {Object} Anomaly detection result
   */
  detectAnomalies(mcapHistory, currentMcap) {
    if (mcapHistory.length < 3) {
      return { isAnomaly: false, reason: 'Insufficient history' };
    }

    // Calculate z-score
    const values = mcapHistory.map(h => h.marketCap);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) {
      return { isAnomaly: false, reason: 'No variance in history' };
    }

    const zScore = Math.abs(currentMcap - mean) / stdDev;
    const isAnomaly = zScore > this.anomalyThreshold;

    return {
      isAnomaly,
      zScore,
      mean,
      stdDev,
      reason: isAnomaly ? `High z-score: ${zScore.toFixed(2)}` : 'Normal'
    };
  }

  /**
   * NORMALIZE TIMESTAMP - Convert to UTC ms
   * @param {any} timestamp - Timestamp to normalize
   * @returns {number} UTC milliseconds
   */
  normalizeTimestamp(timestamp) {
    if (typeof timestamp === 'number') {
      return timestamp;
    }
    
    if (typeof timestamp === 'string') {
      const date = new Date(timestamp);
      return isNaN(date.getTime()) ? null : date.getTime();
    }
    
    return null;
  }

  /**
   * GET CANDLE AT TIMESTAMP - Find appropriate candle for given time
   * @param {Array} candles - Array of candle data
   * @param {number} targetTime - Target timestamp in ms
   * @returns {Object|null} Candle data or null
   */
  getCandleAtTimestamp(candles, targetTime) {
    if (!candles || candles.length === 0) return null;

    // Sort candles by timestamp
    const sortedCandles = candles.sort((a, b) => a.timestamp - b.timestamp);

    // Find candle with open_time <= targetTime < close_time
    for (const candle of sortedCandles) {
      const openTime = candle.timestamp;
      const closeTime = candle.timestamp + this.candleGranularity;
      
      if (openTime <= targetTime && targetTime < closeTime) {
        return candle;
      }
    }

    // If no exact match, take the last candle before targetTime
    const beforeCandles = sortedCandles.filter(c => c.timestamp <= targetTime);
    return beforeCandles.length > 0 ? beforeCandles[beforeCandles.length - 1] : null;
  }

  /**
   * CALCULATE MAX MCAP SINCE CALL - Find maximum market cap after call time
   * @param {Array} candles - Historical candle data
   * @param {number} callTime - Call timestamp in ms
   * @returns {Object} Max mcap data
   */
  calculateMaxMcapSinceCall(candles, callTime) {
    if (!candles || candles.length === 0) {
      return { maxMcap: null, maxTimestamp: null };
    }

    // Filter candles after call time
    const postCallCandles = candles.filter(c => c.timestamp >= callTime);
    
    if (postCallCandles.length === 0) {
      return { maxMcap: null, maxTimestamp: null };
    }

    // Find maximum market cap
    let maxMcap = 0;
    let maxTimestamp = null;

    for (const candle of postCallCandles) {
      if (candle.marketCap > maxMcap) {
        maxMcap = candle.marketCap;
        maxTimestamp = candle.timestamp;
      }
    }

    return { maxMcap, maxTimestamp };
  }

  /**
   * MAIN PnL CALCULATION - Deterministic and race-safe
   * @param {Object} call - Call object with immutable data
   * @param {Object} tokenData - Current token data
   * @returns {Promise<Object>} Calculation result
   */
  async calculateDeterministicPnl(call, tokenData) {
    const holderId = `calc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const contractAddress = call.contractAddress;
    
    try {
      // Acquire distributed lock
      const lockAcquired = await this.acquireLock(contractAddress, holderId);
      if (!lockAcquired) {
        return {
          success: false,
          error: 'Could not acquire lock for calculation',
          pnlPercent: 0,
          calculationType: 'lock_failed'
        };
      }

      // Validate token data
      const validation = this.validateTokenData(tokenData, call);
      if (!validation.valid) {
        await this.releaseLock(contractAddress, holderId);
        return {
          success: false,
          error: `Data validation failed: ${validation.errors.join(', ')}`,
          pnlPercent: 0,
          calculationType: 'validation_failed',
          warnings: validation.warnings
        };
      }

      // Extract immutable call data
      const callTime = this.normalizeTimestamp(call.createdAt || call.callTime);
      const mcapAtCall = parseFloat(call.entryMarketCap) || 0;
      
      if (!callTime || mcapAtCall <= 0) {
        await this.releaseLock(contractAddress, holderId);
        return {
          success: false,
          error: 'Invalid call data: missing timestamp or market cap',
          pnlPercent: 0,
          calculationType: 'invalid_call_data'
        };
      }

      // Get current market cap
      const currentMcap = validation.validatedData.marketCap;
      
      // Calculate max mcap since call (from historical data if available)
      const maxMcapData = this.calculateMaxMcapSinceCall(tokenData.candles || [], callTime);
      const maxMcapSinceCall = maxMcapData.maxMcap || currentMcap;

      // Detect anomalies
      const anomalyCheck = this.detectAnomalies(tokenData.candles || [], currentMcap);
      if (anomalyCheck.isAnomaly) {
        console.log(`🚨 Anomaly detected for ${contractAddress}: ${anomalyCheck.reason}`);
        // Don't update max mcap if anomaly detected
      }

      // Calculate PnL
      const pnl = this.computePnl({
        mcapAtCall,
        currentMcap,
        maxMcapSinceCall: anomalyCheck.isAnomaly ? null : maxMcapSinceCall
      });

      if (pnl === null) {
        await this.releaseLock(contractAddress, holderId);
        return {
          success: false,
          error: 'PnL calculation returned null',
          pnlPercent: 0,
          calculationType: 'calculation_failed'
        };
      }

      // Update milestones
      const milestones = this.updateMilestones({
        peak: maxMcapSinceCall,
        basis: mcapAtCall,
        milestones: call.milestones || {}
      });

      // Determine calculation type
      let calculationType = 'current_price';
      if (maxMcapSinceCall > currentMcap) {
        calculationType = 'peak_locked';
      }
      if (anomalyCheck.isAnomaly) {
        calculationType = 'anomaly_detected';
      }

      const result = {
        success: true,
        pnlPercent: pnl * 100,
        maxPnl: (maxMcapSinceCall / mcapAtCall - 1) * 100,
        calculationType,
        data: {
          mcapAtCall,
          currentMcap,
          maxMcapSinceCall,
          maxMcapTimestamp: maxMcapData.maxTimestamp,
          milestones,
          anomalyCheck,
          validation: validation.warnings,
          sourceStamp: {
            endpoint: 'deterministic_calculation',
            granularity: this.candleGranularity,
            timestamp: Date.now(),
            holderId
          }
        }
      };

      await this.releaseLock(contractAddress, holderId);
      return result;

    } catch (error) {
      await this.releaseLock(contractAddress, holderId);
      console.error(`❌ Error in calculateDeterministicPnl:`, error);
      return {
        success: false,
        error: error.message,
        pnlPercent: 0,
        calculationType: 'error'
      };
    }
  }

  /**
   * REFRESH SINGLE CALL - Race-safe refresh with lock
   * @param {Object} call - Call object
   * @returns {Promise<Object>} Refresh result
   */
  async refreshCall(call) {
    try {
      const SolanaTrackerService = require('./SolanaTrackerService');
      const solanaService = new SolanaTrackerService();
      
      // Add delay to avoid rate limiting
      await this.delay(2000);
      
      // Fetch current token data
      const tokenData = await solanaService.getTokenData(call.contractAddress);
      
      if (!tokenData) {
        return {
          success: false,
          error: 'No token data available',
          pnlPercent: 0
        };
      }

      // Calculate deterministic PnL
      const result = await this.calculateDeterministicPnl(call, tokenData);
      
      return result;
    } catch (error) {
      console.error(`❌ Error in refreshCall:`, error);
      return {
        success: false,
        error: error.message,
        pnlPercent: 0
      };
    }
  }

  /**
   * UTILITY: Add delay
   * @param {number} ms - Milliseconds to delay
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = DeterministicPnlCalculationService;
