/**
 * Enhanced PnL Calculation Service
 * Uses Solana Tracker Data API for more accurate PnL calculations
 */

const { Client } = require('@solana-tracker/data-api');

class EnhancedPnlCalculationService {
  constructor(apiKey) {
    this.client = new Client(apiKey);
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Get enhanced token data with historical price information
   * @param {string} tokenAddress - Token contract address
   * @param {number} callTime - Timestamp when token was called
   * @returns {Object} Enhanced token data
   */
  async getEnhancedTokenData(tokenAddress, callTime) {
    try {
      const cacheKey = `enhanced_${tokenAddress}_${callTime}`;
      const cached = this.cache.get(cacheKey);
      
      if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
        return cached.data;
      }

      console.log(`🔍 Fetching enhanced data for ${tokenAddress}...`);

      // Get current token info
      const tokenInfo = await this.client.getTokenInfo(tokenAddress);
      
      // Get price at call time
      const priceAtCall = await this.client.getPriceAtTimestamp(tokenAddress, callTime);
      
      // Get price history for ATH calculation
      const priceHistory = await this.client.getPriceHistory(tokenAddress);
      
      // Get ATH price
      const athPrice = await this.client.getAthPrice(tokenAddress);
      
      // Get detailed stats
      const tokenStats = await this.client.getTokenStats(tokenAddress);

      const enhancedData = {
        current: {
          price: tokenInfo.price,
          marketCap: tokenInfo.marketCap,
          volume24h: tokenInfo.volume24h,
          liquidity: tokenInfo.liquidity,
          holders: tokenInfo.holders,
          timestamp: Date.now()
        },
        atCall: {
          price: priceAtCall?.price || tokenInfo.price,
          marketCap: priceAtCall?.marketCap || tokenInfo.marketCap,
          timestamp: callTime
        },
        ath: {
          price: athPrice?.price || tokenInfo.price,
          marketCap: athPrice?.marketCap || tokenInfo.marketCap,
          timestamp: athPrice?.timestamp || Date.now()
        },
        history: priceHistory,
        stats: tokenStats
      };

      // Cache the result
      this.cache.set(cacheKey, {
        data: enhancedData,
        timestamp: Date.now()
      });

      console.log(`✅ Enhanced data fetched for ${tokenAddress}`);
      return enhancedData;

    } catch (error) {
      console.error(`❌ Error fetching enhanced data for ${tokenAddress}:`, error);
      return null;
    }
  }

  /**
   * Calculate accurate PnL using enhanced data
   * @param {Object} call - Call object from database
   * @returns {Object} PnL calculation result
   */
  async calculateAccuratePnl(call) {
    try {
      const callTime = new Date(call.createdAt || call.callTime).getTime();
      const tokenAddress = call.contractAddress;
      
      console.log(`🧮 Calculating accurate PnL for call ${call.id} (${call.tokenName})`);

      // Get enhanced token data
      const enhancedData = await this.getEnhancedTokenData(tokenAddress, callTime);
      if (!enhancedData) {
        console.log(`⚠️ Could not fetch enhanced data, using fallback calculation`);
        return this.calculateFallbackPnl(call);
      }

      // Extract key data points
      const entryPrice = enhancedData.atCall.price;
      const entryMarketCap = enhancedData.atCall.marketCap;
      const currentPrice = enhancedData.current.price;
      const currentMarketCap = enhancedData.current.marketCap;
      const athPrice = enhancedData.ath.price;
      const athMarketCap = enhancedData.ath.marketCap;
      const athTimestamp = enhancedData.ath.timestamp;

      // Validate data
      if (!entryPrice || !entryMarketCap || !currentPrice || !currentMarketCap) {
        console.log(`⚠️ Invalid data points, using fallback calculation`);
        return this.calculateFallbackPnl(call);
      }

      // Calculate different PnL metrics
      const pricePnl = ((currentPrice / entryPrice) - 1) * 100;
      const marketCapPnl = ((currentMarketCap / entryMarketCap) - 1) * 100;
      const athPricePnl = ((athPrice / entryPrice) - 1) * 100;
      const athMarketCapPnl = ((athMarketCap / entryMarketCap) - 1) * 100;

      // Determine which PnL to use based on rules
      let finalPnl = pricePnl;
      let pnlType = 'current_price';
      let reason = 'Using current price PnL';

      // Rule 1: If ATH happened after call, use ATH PnL
      if (athTimestamp > callTime) {
        finalPnl = athPricePnl;
        pnlType = 'ath_price';
        reason = 'ATH occurred after call, using ATH price PnL';
      }

      // Rule 2: If we reached 2x (100% gain), lock at peak
      const maxPnl = Math.max(pricePnl, athPricePnl);
      if (maxPnl >= 100) {
        finalPnl = maxPnl;
        pnlType = 'peak_locked';
        reason = 'Reached 2x, locking at peak PnL';
      }

      // Rule 3: Sanity check - PnL should be reasonable
      const maxPossiblePnl = Math.max(pricePnl, athPricePnl);
      if (finalPnl > maxPossiblePnl * 1.2) {
        finalPnl = maxPossiblePnl;
        pnlType = 'capped';
        reason = 'PnL capped to maximum possible value';
      }

      // Rule 4: Cap at 10x (900%)
      if (finalPnl > 900) {
        finalPnl = 900;
        pnlType = 'capped_10x';
        reason = 'PnL capped at 10x (900%)';
      }

      const result = {
        pnlPercent: finalPnl,
        pnlType,
        reason,
        data: {
          entryPrice,
          entryMarketCap,
          currentPrice,
          currentMarketCap,
          athPrice,
          athMarketCap,
          pricePnl,
          marketCapPnl,
          athPricePnl,
          athMarketCapPnl,
          maxPossiblePnl
        },
        timestamp: Date.now()
      };

      console.log(`✅ Accurate PnL calculated: ${finalPnl.toFixed(2)}% (${pnlType}) - ${reason}`);
      console.log(`📊 Entry: $${entryPrice.toFixed(6)} | Current: $${currentPrice.toFixed(6)} | ATH: $${athPrice.toFixed(6)}`);

      return result;

    } catch (error) {
      console.error(`❌ Error in accurate PnL calculation:`, error);
      return this.calculateFallbackPnl(call);
    }
  }

  /**
   * Fallback PnL calculation using basic data
   * @param {Object} call - Call object from database
   * @returns {Object} Fallback PnL result
   */
  calculateFallbackPnl(call) {
    const entryMarketCap = parseFloat(call.entryMarketCap) || 0;
    const currentMarketCap = parseFloat(call.currentMarketCap) || 0;
    
    if (!entryMarketCap || !currentMarketCap) {
      return {
        pnlPercent: 0,
        pnlType: 'fallback',
        reason: 'No valid market cap data',
        data: null,
        timestamp: Date.now()
      };
    }

    const pnl = ((currentMarketCap / entryMarketCap) - 1) * 100;
    
    return {
      pnlPercent: pnl,
      pnlType: 'fallback',
      reason: 'Using fallback market cap calculation',
      data: {
        entryMarketCap,
        currentMarketCap,
        pnl
      },
      timestamp: Date.now()
    };
  }

  /**
   * Batch calculate PnL for multiple calls
   * @param {Array} calls - Array of call objects
   * @returns {Array} Array of PnL results
   */
  async calculateBatchPnl(calls) {
    console.log(`🔄 Batch calculating PnL for ${calls.length} calls...`);
    
    const results = [];
    const batchSize = 5; // Process in batches to avoid rate limits
    
    for (let i = 0; i < calls.length; i += batchSize) {
      const batch = calls.slice(i, i + batchSize);
      const batchPromises = batch.map(call => this.calculateAccuratePnl(call));
      
      const batchResults = await Promise.allSettled(batchPromises);
      
      batchResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          results.push({
            callId: batch[index].id,
            ...result.value
          });
        } else {
          console.error(`❌ Failed to calculate PnL for call ${batch[index].id}:`, result.reason);
          results.push({
            callId: batch[index].id,
            pnlPercent: 0,
            pnlType: 'error',
            reason: 'Calculation failed',
            data: null,
            timestamp: Date.now()
          });
        }
      });

      // Add delay between batches to respect rate limits
      if (i + batchSize < calls.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.log(`✅ Batch PnL calculation completed for ${results.length} calls`);
    return results;
  }

  /**
   * Get wallet PnL for a specific token
   * @param {string} walletAddress - Wallet address
   * @param {string} tokenAddress - Token address
   * @returns {Object} Wallet PnL data
   */
  async getWalletTokenPnl(walletAddress, tokenAddress) {
    try {
      const pnlData = await this.client.getTokenPnL({
        wallet: walletAddress,
        tokenAddress: tokenAddress,
        holdingCheck: true
      });

      return {
        pnl: pnlData.pnl,
        trades: pnlData.trades,
        holding: pnlData.holding,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error(`❌ Error getting wallet PnL:`, error);
      return null;
    }
  }

  /**
   * Get first buyers PnL for a token
   * @param {string} tokenAddress - Token address
   * @returns {Array} First buyers with PnL data
   */
  async getFirstBuyersPnl(tokenAddress) {
    try {
      const firstBuyers = await this.client.getFirstBuyers(tokenAddress);
      return firstBuyers.map(buyer => ({
        wallet: buyer.wallet,
        pnl: buyer.pnl,
        amount: buyer.amount,
        timestamp: buyer.timestamp
      }));
    } catch (error) {
      console.error(`❌ Error getting first buyers PnL:`, error);
      return [];
    }
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
    console.log('🗑️ Enhanced PnL cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }
}

module.exports = EnhancedPnlCalculationService;
