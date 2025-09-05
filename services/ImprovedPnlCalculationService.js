/**
 * IMPROVED PnL Calculation Service - Single Source of Truth
 * Fixes all identified issues with data validation, corruption detection, and consistent calculations
 */

class ImprovedPnlCalculationService {
  constructor() {
    this.cache = new Map();
    this.validationFailures = new Map(); // Track validation failures for debugging
  }

  /**
   * MAIN PnL CALCULATION METHOD - Single source of truth
   * @param {Object} call - Call object from database
   * @param {Object} tokenData - Current token data from API
   * @returns {Object} Calculation result with validation info
   */
  calculatePnl(call, tokenData) {
    const result = {
      pnlPercent: 0,
      maxPnl: 0,
      isValid: false,
      validationErrors: [],
      calculationType: 'error',
      debugInfo: {}
    };

    try {
      // STEP 1: VALIDATE INPUTS
      const validation = this.validateInputs(call, tokenData);
      if (!validation.isValid) {
        result.validationErrors = validation.errors;
        result.debugInfo.validation = validation;
        console.error(`❌ PnL Validation failed for call ${call.id}:`, validation.errors);
        return result;
      }

      // STEP 2: EXTRACT VALIDATED DATA
      const {
        callTime,
        entryMarketCap,
        currentMarketCap,
        athMarketCap,
        athTimestamp,
        currentMaxPnl
      } = validation.data;

      result.debugInfo.extractedData = validation.data;

      // STEP 3: DETECT AND HANDLE CORRUPTED DATA
      const corruptionCheck = this.detectCorruption(call, tokenData, validation.data);
      if (corruptionCheck.isCorrupted) {
        console.warn(`🔄 Corruption detected for call ${call.id}:`, corruptionCheck.reason);
        result.debugInfo.corruption = corruptionCheck;
        // Reset corrupted maxPnl
        result.maxPnl = 0;
      } else {
        result.maxPnl = currentMaxPnl;
      }

      // STEP 4: CALCULATE PnL USING BUSINESS RULES
      const pnlCalculation = this.applyBusinessRules(validation.data, result.maxPnl);
      
      result.pnlPercent = pnlCalculation.finalPnl;
      result.maxPnl = Math.max(result.maxPnl, pnlCalculation.finalPnl);
      result.calculationType = pnlCalculation.type;
      result.isValid = true;
      result.debugInfo.calculation = pnlCalculation;

      // STEP 5: FINAL VALIDATION
      const finalValidation = this.validateResult(result, validation.data);
      if (!finalValidation.isValid) {
        result.validationErrors = finalValidation.errors;
        result.pnlPercent = finalValidation.safePnl;
        result.calculationType = 'capped_for_safety';
        console.warn(`⚠️ Result capped for safety on call ${call.id}:`, finalValidation.errors);
      }

      console.log(`✅ PnL calculated for ${call.id}: ${result.pnlPercent.toFixed(2)}% (${result.calculationType})`);
      return result;

    } catch (error) {
      console.error(`❌ Critical error calculating PnL for call ${call.id}:`, error);
      result.validationErrors.push(`Critical calculation error: ${error.message}`);
      result.debugInfo.error = {
        message: error.message,
        stack: error.stack
      };
      return result;
    }
  }

  /**
   * VALIDATE ALL INPUTS - Comprehensive validation
   */
  validateInputs(call, tokenData) {
    const errors = [];
    const data = {};

    // Validate call object
    if (!call || typeof call !== 'object') {
      errors.push('Invalid call object');
      return { isValid: false, errors, data: null };
    }

    // Validate and extract call time
    try {
      data.callTime = new Date(call.createdAt || call.callTime).getTime();
      if (isNaN(data.callTime) || data.callTime <= 0) {
        errors.push('Invalid call timestamp');
      }
    } catch (e) {
      errors.push('Unable to parse call timestamp');
    }

    // Validate and extract entry market cap
    data.entryMarketCap = parseFloat(call.entryMarketCap);
    if (!data.entryMarketCap || data.entryMarketCap <= 0 || !isFinite(data.entryMarketCap)) {
      errors.push(`Invalid entry market cap: ${call.entryMarketCap}`);
    }

    // Validate and extract current market cap
    if (!tokenData || typeof tokenData !== 'object') {
      errors.push('Invalid token data object');
      return { isValid: false, errors, data: null };
    }

    data.currentMarketCap = parseFloat(tokenData.marketCap);
    if (!data.currentMarketCap || data.currentMarketCap <= 0 || !isFinite(data.currentMarketCap)) {
      errors.push(`Invalid current market cap: ${tokenData.marketCap}`);
    }

    // Extract ATH data (optional, but validate if present)
    data.athMarketCap = parseFloat(tokenData.ath) || 0;
    if (data.athMarketCap < 0 || !isFinite(data.athMarketCap)) {
      data.athMarketCap = 0; // Reset invalid ATH to 0
    }

    // Extract ATH timestamp (optional)
    data.athTimestamp = null;
    if (tokenData.athTimestamp) {
      try {
        data.athTimestamp = new Date(tokenData.athTimestamp).getTime();
        if (isNaN(data.athTimestamp)) {
          data.athTimestamp = null;
        }
      } catch (e) {
        data.athTimestamp = null;
      }
    }

    // Extract current maxPnl
    data.currentMaxPnl = parseFloat(call.maxPnl) || 0;
    if (!isFinite(data.currentMaxPnl)) {
      data.currentMaxPnl = 0;
    }

    // Additional sanity checks
    if (data.entryMarketCap && data.currentMarketCap) {
      const ratio = data.currentMarketCap / data.entryMarketCap;
      if (ratio > 10000) { // 10,000x seems unrealistic
        errors.push(`Suspicious market cap ratio: ${ratio.toFixed(2)}x`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      data: errors.length === 0 ? data : null
    };
  }

  /**
   * DETECT CORRUPTED DATA - Advanced corruption detection
   */
  detectCorruption(call, tokenData, validatedData) {
    const { entryMarketCap, currentMarketCap, athMarketCap, currentMaxPnl } = validatedData;

    // Calculate maximum theoretically possible PnL
    const maxPossibleFromCurrent = ((currentMarketCap / entryMarketCap) - 1) * 100;
    const maxPossibleFromAth = athMarketCap > 0 ? ((athMarketCap / entryMarketCap) - 1) * 100 : 0;
    const maxPossiblePnl = Math.max(maxPossibleFromCurrent, maxPossibleFromAth);

    // Corruption thresholds
    const CORRUPTION_MULTIPLIER = 2.5; // If maxPnl is 2.5x higher than possible, it's corrupted
    const EXTREME_PNL_THRESHOLD = 50000; // 50,000% is definitely corrupted

    // Check for corruption
    const isCorrupted = (
      currentMaxPnl > maxPossiblePnl * CORRUPTION_MULTIPLIER ||
      currentMaxPnl > EXTREME_PNL_THRESHOLD ||
      (currentMaxPnl > 0 && maxPossiblePnl <= 0 && currentMaxPnl > 100) // Positive maxPnl when max possible is negative/zero
    );

    let reason = '';
    if (isCorrupted) {
      if (currentMaxPnl > EXTREME_PNL_THRESHOLD) {
        reason = `Extreme PnL detected: ${currentMaxPnl}% (threshold: ${EXTREME_PNL_THRESHOLD}%)`;
      } else if (currentMaxPnl > maxPossiblePnl * CORRUPTION_MULTIPLIER) {
        reason = `MaxPnl ${currentMaxPnl}% exceeds possible ${maxPossiblePnl.toFixed(2)}% by ${CORRUPTION_MULTIPLIER}x`;
      } else {
        reason = `Logic violation: maxPnl ${currentMaxPnl}% when max possible is ${maxPossiblePnl.toFixed(2)}%`;
      }
    }

    return {
      isCorrupted,
      reason,
      currentMaxPnl,
      maxPossiblePnl,
      threshold: maxPossiblePnl * CORRUPTION_MULTIPLIER
    };
  }

  /**
   * APPLY BUSINESS RULES - The core PnL calculation logic
   */
  applyBusinessRules(data, currentMaxPnl) {
    const {
      callTime,
      entryMarketCap,
      currentMarketCap,
      athMarketCap,
      athTimestamp
    } = data;

    let pnl = ((currentMarketCap / entryMarketCap) - 1) * 100;
    let calculationType = 'current_price';

    console.log(`🧮 Business Rules - Initial PnL: ${pnl.toFixed(2)}%`);

    // RULE 1: ATH LOCK - If ATH was reached AFTER the call
    if (athTimestamp && athTimestamp > callTime && athMarketCap > currentMarketCap) {
      const athPnl = ((athMarketCap / entryMarketCap) - 1) * 100;
      
      // Only use ATH if it's better than current AND it makes sense
      if (athPnl > pnl && athPnl > 0) {
        pnl = athPnl;
        calculationType = 'ath_locked';
        console.log(`🔒 ATH Rule Applied: Locked at ${pnl.toFixed(2)}% (ATH after call)`);
      }
    }

    // RULE 2: 2X LOCK - Once token hits 2x (100% gain), track the peak
    const peakPnl = Math.max(currentMaxPnl, pnl);
    if (peakPnl >= 100) { // 100% = 2x multiplier
      // Validate that this peak was actually achievable
      const maxAchievablePnl = Math.max(
        ((currentMarketCap / entryMarketCap) - 1) * 100,
        athMarketCap > 0 ? ((athMarketCap / entryMarketCap) - 1) * 100 : 0
      );

      if (peakPnl <= maxAchievablePnl * 1.1) { // Allow 10% tolerance for timing differences
        pnl = peakPnl;
        calculationType = 'peak_locked_2x';
        console.log(`🚀 2x Rule Applied: Locked at peak ${pnl.toFixed(2)}%`);
      } else {
        console.log(`⚠️ 2x Rule Skipped: Peak ${peakPnl.toFixed(2)}% exceeds achievable ${maxAchievablePnl.toFixed(2)}%`);
      }
    }

    // RULE 3: NO ARTIFICIAL CAPS - Let gains run as high as they can go
    // (This rule is implemented by not having any caps)

    return {
      finalPnl: pnl,
      type: calculationType,
      peakPnl,
      athPnl: athMarketCap > 0 ? ((athMarketCap / entryMarketCap) - 1) * 100 : 0,
      currentPnl: ((currentMarketCap / entryMarketCap) - 1) * 100
    };
  }

  /**
   * VALIDATE FINAL RESULT - Ensure result makes sense
   */
  validateResult(result, validatedData) {
    const { entryMarketCap, currentMarketCap, athMarketCap } = validatedData;
    const errors = [];

    // Calculate absolute maximum possible PnL
    const maxPossiblePnl = Math.max(
      ((currentMarketCap / entryMarketCap) - 1) * 100,
      athMarketCap > 0 ? ((athMarketCap / entryMarketCap) - 1) * 100 : 0
    );

    // Check if result is impossible
    if (result.pnlPercent > maxPossiblePnl * 1.2) { // Allow 20% tolerance for edge cases
      errors.push(`Result ${result.pnlPercent.toFixed(2)}% exceeds maximum possible ${maxPossiblePnl.toFixed(2)}%`);
    }

    // Check for NaN or infinite values
    if (!isFinite(result.pnlPercent)) {
      errors.push('PnL result is not finite');
    }

    // Check for extreme values (likely errors)
    if (Math.abs(result.pnlPercent) > 100000) { // 100,000% is probably an error
      errors.push(`Extreme PnL value: ${result.pnlPercent.toFixed(2)}%`);
    }

    // If validation failed, provide a safe fallback
    let safePnl = result.pnlPercent;
    if (errors.length > 0) {
      safePnl = Math.min(maxPossiblePnl, Math.max(-99, result.pnlPercent)); // Cap between -99% and max possible
      console.warn(`🛡️ Using safe PnL: ${safePnl.toFixed(2)}% instead of ${result.pnlPercent.toFixed(2)}%`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      safePnl
    };
  }

  /**
   * CONVENIENCE METHOD - Calculate PnL for a call (backward compatibility)
   */
  calculatePnlForCall(call, tokenData) {
    const result = this.calculatePnl(call, tokenData);
    if (result.isValid) {
      return result.pnlPercent;
    } else {
      console.error(`❌ PnL calculation failed for call ${call.id}:`, result.validationErrors);
      return 0; // Safe fallback
    }
  }

  /**
   * UPDATE CALL WITH NEW PNL - With validation
   */
  updateCallWithPnl(call, calculationResult) {
    return {
      ...call,
      pnlPercent: calculationResult.pnlPercent,
      maxPnl: calculationResult.maxPnl,
      lastPnlUpdate: new Date().toISOString(),
      pnlCalculationType: calculationResult.calculationType,
      pnlValidationErrors: calculationResult.validationErrors.length > 0 ? calculationResult.validationErrors : undefined
    };
  }

  /**
   * BATCH CALCULATION - Process multiple calls efficiently
   */
  async calculateBatchPnl(calls, tokenDataMap) {
    console.log(`🔄 Batch calculating PnL for ${calls.length} calls...`);
    
    const results = [];
    let validCount = 0;
    let errorCount = 0;
    let corruptionCount = 0;

    for (const call of calls) {
      try {
        const tokenData = tokenDataMap[call.contractAddress];
        if (!tokenData) {
          results.push({
            callId: call.id,
            error: 'Token data not available',
            pnlPercent: 0,
            isValid: false
          });
          errorCount++;
          continue;
        }

        const result = this.calculatePnl(call, tokenData);
        results.push({
          callId: call.id,
          ...result
        });

        if (result.isValid) {
          validCount++;
        } else {
          errorCount++;
        }

        if (result.debugInfo.corruption?.isCorrupted) {
          corruptionCount++;
        }

      } catch (error) {
        console.error(`❌ Batch calculation error for call ${call.id}:`, error);
        results.push({
          callId: call.id,
          error: error.message,
          pnlPercent: 0,
          isValid: false
        });
        errorCount++;
      }
    }

    console.log(`✅ Batch calculation complete: ${validCount} valid, ${errorCount} errors, ${corruptionCount} corrupted`);
    
    return {
      results,
      summary: {
        total: calls.length,
        valid: validCount,
        errors: errorCount,
        corrupted: corruptionCount,
        successRate: (validCount / calls.length * 100).toFixed(1)
      }
    };
  }

  /**
   * GET CORRUPTION REPORT - Analyze all calls for corruption
   */
  async generateCorruptionReport(calls, tokenDataMap) {
    const corruptedCalls = [];
    
    for (const call of calls) {
      const tokenData = tokenDataMap[call.contractAddress];
      if (!tokenData) continue;

      const validation = this.validateInputs(call, tokenData);
      if (!validation.isValid) continue;

      const corruptionCheck = this.detectCorruption(call, tokenData, validation.data);
      if (corruptionCheck.isCorrupted) {
        corruptedCalls.push({
          callId: call.id,
          tokenSymbol: call.tokenSymbol,
          contractAddress: call.contractAddress,
          currentMaxPnl: corruptionCheck.currentMaxPnl,
          maxPossiblePnl: corruptionCheck.maxPossiblePnl,
          reason: corruptionCheck.reason,
          shouldReset: true
        });
      }
    }

    return {
      totalCalls: calls.length,
      corruptedCount: corruptedCalls.length,
      corruptionRate: (corruptedCalls.length / calls.length * 100).toFixed(2),
      corruptedCalls
    };
  }

  /**
   * CALCULATE ACCURATE PNL FOR CONTRACT ADDRESS
   * This method is used by the dashboard API endpoints
   * @param {Object} call - Call object from database
   * @returns {Object} PnL calculation result
   */
  async calculateAccuratePnl(call) {
    try {
      // Validate call object first
      if (!call || typeof call !== 'object') {
        console.error('❌ Invalid call object in calculateAccuratePnl:', call);
        return {
          pnlPercent: 0,
          pnlType: 'error',
          reason: 'Invalid call object',
          data: null,
          timestamp: Date.now()
        };
      }

      const entryMarketCap = parseFloat(call.entryMarketCap) || 0;
      
      if (!entryMarketCap) {
        console.error('❌ No valid entry market cap for call:', call.id || call.contractAddress);
        return {
          pnlPercent: 0,
          pnlType: 'error',
          reason: 'No valid entry market cap data',
          data: null,
          timestamp: Date.now()
        };
      }

      // Try to fetch current token data from Solana Tracker API
      let currentMarketCap = parseFloat(call.currentMarketCap) || 0;
      let tokenData = null;
      
      try {
        // Import SolanaTrackerService to get current data
        const SolanaTrackerService = require('./SolanaTrackerService');
        const solanaService = new SolanaTrackerService();
        
        // Fetch current token data
        tokenData = await solanaService.getTokenData(call.contractAddress);
        
        // Add comprehensive validation for tokenData
        if (tokenData && typeof tokenData === 'object' && tokenData.marketCap !== undefined && tokenData.marketCap !== null) {
          const parsedMarketCap = parseFloat(tokenData.marketCap);
          if (!isNaN(parsedMarketCap) && parsedMarketCap > 0) {
            currentMarketCap = parsedMarketCap;
            console.log(`✅ Fetched fresh market cap for ${call.contractAddress}: $${currentMarketCap.toLocaleString()}`);
          } else {
            console.log(`⚠️ Invalid market cap value for ${call.contractAddress}: ${tokenData.marketCap}, using stored data`);
          }
        } else {
          console.log(`⚠️ Invalid token data structure for ${call.contractAddress}:`, {
            tokenData: tokenData ? 'exists' : 'null',
            marketCap: tokenData?.marketCap,
            type: typeof tokenData?.marketCap,
            isValid: tokenData && tokenData.marketCap && !isNaN(parseFloat(tokenData.marketCap))
          });
          console.log(`⚠️ Using stored data instead`);
        }
      } catch (error) {
        console.error(`❌ Error fetching fresh token data for ${call.contractAddress}:`, error.message);
        console.log(`⚠️ Using stored data instead`);
        // Fall back to stored currentMarketCap
        tokenData = null; // Ensure tokenData is null if API call failed
      }

      if (!currentMarketCap || currentMarketCap <= 0) {
        console.log(`⚠️ No valid current market cap for ${call.contractAddress}, using entry market cap`);
        // If no current market cap, assume no change (0% PnL)
        currentMarketCap = entryMarketCap;
      }

      const pnl = ((currentMarketCap / entryMarketCap) - 1) * 100;
      
      console.log(`📊 PnL calculation for ${call.contractAddress}: Entry $${entryMarketCap.toLocaleString()} → Current $${currentMarketCap.toLocaleString()} = ${pnl.toFixed(2)}%`);
      
      return {
        pnlPercent: pnl,
        pnlType: 'current_price',
        reason: 'Using current market cap calculation',
        data: {
          entryMarketCap,
          currentMarketCap,
          pnl,
          tokenData: tokenData || null,
          contractAddress: call.contractAddress || 'unknown'
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
   * RESET CORRUPTED MAX PNL VALUES
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
   * CLEAR CACHE AND RESET
   */
  clearCache() {
    this.cache.clear();
    this.validationFailures.clear();
    console.log('🗑️ PnL calculation cache cleared');
  }
}

module.exports = ImprovedPnlCalculationService;
