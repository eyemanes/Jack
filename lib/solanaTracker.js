const axios = require('axios');

class SolanaTrackerService {
  constructor(apiKey) {
    this.apiKey = apiKey || process.env.SOLANA_TRACKER_API_KEY || '6a281d1b-b7d4-4213-861c-4ac9b386cd60';
    this.baseUrl = 'https://data.solanatracker.io';
    this.axiosInstance = axios.create({
      timeout: 30000,
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json',
        'User-Agent': 'TokenCallPnL/1.0'
      }
    });

    // Rate limiting
    this.lastRequestTime = 0;
    this.minRequestInterval = 100; // 100ms between requests
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async rateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.minRequestInterval) {
      await this.delay(this.minRequestInterval - timeSinceLastRequest);
    }
    
    this.lastRequestTime = Date.now();
  }

  async handleRateLimit(error) {
    if (error.response?.status === 429) {
      const retryAfter = error.response.headers['retry-after'] || 5;
      console.log(`Rate limit hit, waiting ${retryAfter} seconds...`);
      await this.delay(retryAfter * 1000);
      return true;
    }
    return false;
  }

  async makeRequest(url, options = {}) {
    await this.rateLimit();
    
    try {
      const response = await this.axiosInstance(url, options);
      return response.data;
    } catch (error) {
      const shouldRetry = await this.handleRateLimit(error);
      if (shouldRetry) {
        return this.makeRequest(url, options);
      }
      throw error;
    }
  }

  // Get token information
  async getTokenInfo(tokenAddress) {
    try {
      const data = await this.makeRequest(`${this.baseUrl}/tokens/${tokenAddress}`);
      return data;
    } catch (error) {
      console.error(`Error getting token info for ${tokenAddress}:`, error.message);
      throw error;
    }
  }

  // Get price at specific timestamp
  async getPriceAtTimestamp(tokenAddress, timestamp) {
    try {
      const data = await this.makeRequest(`${this.baseUrl}/tokens/${tokenAddress}/price/${timestamp}`);
      return data;
    } catch (error) {
      console.error(`Error getting price at timestamp for ${tokenAddress}:`, error.message);
      throw error;
    }
  }

  // Get chart data with market cap
  async getChartData(params) {
    try {
      const {
        tokenAddress,
        type = '1m',
        timeFrom,
        timeTo,
        marketCap = true,
        dynamicPools = true,
        fastCache = true
      } = params;

      const queryParams = new URLSearchParams({
        type,
        timeFrom: timeFrom.toString(),
        timeTo: timeTo.toString(),
        marketCap: marketCap.toString(),
        dynamicPools: dynamicPools.toString(),
        fastCache: fastCache.toString()
      });

      const data = await this.makeRequest(`${this.baseUrl}/tokens/${tokenAddress}/chart?${queryParams}`);
      return data;
    } catch (error) {
      console.error(`Error getting chart data for ${tokenAddress}:`, error.message);
      throw error;
    }
  }

  // Get price range (fallback when market cap not available)
  async getPriceRange(tokenAddress, timeFrom, timeTo) {
    try {
      const data = await this.makeRequest(`${this.baseUrl}/tokens/${tokenAddress}/price-range/${timeFrom}/${timeTo}`);
      return data;
    } catch (error) {
      console.error(`Error getting price range for ${tokenAddress}:`, error.message);
      throw error;
    }
  }

  // Get multiple tokens data
  async getMultipleTokens(tokenAddresses) {
    try {
      const data = await this.makeRequest(`${this.baseUrl}/tokens/multi`, {
        method: 'POST',
        data: { tokens: tokenAddresses }
      });
      return data;
    } catch (error) {
      console.error(`Error getting multiple tokens:`, error.message);
      throw error;
    }
  }

  // Get multiple prices
  async getMultiplePrices(tokenAddresses) {
    try {
      const data = await this.makeRequest(`${this.baseUrl}/tokens/prices/multi`, {
        method: 'POST',
        data: { tokens: tokenAddresses }
      });
      return data;
    } catch (error) {
      console.error(`Error getting multiple prices:`, error.message);
      throw error;
    }
  }

  // Extract entry data at call time
  async getEntryData(tokenAddress, callTimestamp) {
    try {
      // Get price at call timestamp
      const priceData = await this.getPriceAtTimestamp(tokenAddress, callTimestamp);
      
      // Get chart data around call time for market cap
      const chartData = await this.getChartData({
        tokenAddress,
        type: '1m',
        timeFrom: callTimestamp - 600, // 10 minutes before
        timeTo: callTimestamp + 3600,  // 1 hour after
        marketCap: true,
        dynamicPools: true,
        fastCache: true
      });

      // Get token info for circulating supply
      const tokenInfo = await this.getTokenInfo(tokenAddress);

      const entryPrice = priceData?.price || 0;
      let entryMarketCap = null;

      // Try to find market cap at call timestamp from chart data
      if (chartData && chartData.data) {
        const callTimeData = chartData.data.find(point => 
          Math.abs(point.timestamp - callTimestamp) < 60000 // Within 1 minute
        );
        entryMarketCap = callTimeData?.marketCap || null;
      }

      // Fallback to price * supply if market cap not available
      if (!entryMarketCap && tokenInfo?.supply) {
        entryMarketCap = entryPrice * tokenInfo.supply;
      }

      return {
        price: entryPrice,
        marketCap: entryMarketCap,
        supply: tokenInfo?.supply || null,
        timestamp: callTimestamp
      };
    } catch (error) {
      console.error(`Error getting entry data for ${tokenAddress}:`, error.message);
      throw error;
    }
  }

  // Get post-call data for tracking progress
  async getPostCallData(tokenAddress, callTimestamp, currentTime = Date.now()) {
    try {
      // Get chart data from call time to now
      const chartData = await this.getChartData({
        tokenAddress,
        type: '1m',
        timeFrom: callTimestamp,
        timeTo: currentTime,
        marketCap: true,
        dynamicPools: true,
        fastCache: true
      });

      if (!chartData || !chartData.data) {
        // Fallback to price range if chart data fails
        const priceRange = await this.getPriceRange(tokenAddress, callTimestamp, currentTime);
        return {
          maxPrice: priceRange?.highest || 0,
          maxMarketCap: null,
          currentPrice: priceRange?.current || 0,
          currentMarketCap: null,
          data: priceRange
        };
      }

      // Find max values from chart data
      let maxPrice = 0;
      let maxMarketCap = 0;
      let maxPriceTimestamp = null;
      let maxMarketCapTimestamp = null;

      for (const point of chartData.data) {
        if (point.price > maxPrice) {
          maxPrice = point.price;
          maxPriceTimestamp = point.timestamp;
        }
        if (point.marketCap && point.marketCap > maxMarketCap) {
          maxMarketCap = point.marketCap;
          maxMarketCapTimestamp = point.timestamp;
        }
      }

      // Get current values (last data point)
      const currentData = chartData.data[chartData.data.length - 1];
      const currentPrice = currentData?.price || 0;
      const currentMarketCap = currentData?.marketCap || null;

      return {
        maxPrice,
        maxMarketCap: maxMarketCap || null,
        maxPriceTimestamp,
        maxMarketCapTimestamp,
        currentPrice,
        currentMarketCap,
        data: chartData
      };
    } catch (error) {
      console.error(`Error getting post-call data for ${tokenAddress}:`, error.message);
      throw error;
    }
  }

  // Get ATH with timestamp (prefer marketCap, fallback to price)
  async getAthWithTimestamp(tokenAddress) {
    try {
      // 1) Try to get token stats first (if available)
      try {
        const stats = await this.makeRequest(`${this.baseUrl}/tokens/${tokenAddress}/stats`);
        if (stats?.athPrice && stats?.athTimestamp) {
          return { 
            basis: 'price', 
            value: Number(stats.athPrice), 
            ts: Number(stats.athTimestamp) 
          };
        }
        if (stats?.athMarketCap && stats?.athTimestamp) {
          return { 
            basis: 'marketCap', 
            value: Number(stats.athMarketCap), 
            ts: Number(stats.athTimestamp) 
          };
        }
      } catch (statsError) {
        console.log(`Stats endpoint not available for ${tokenAddress}, trying fallback`);
      }

      // 2) Fallback: get ATH price + scan chart for timestamp
      const [athPrice, chart] = await Promise.allSettled([
        this.getAthPrice(tokenAddress),
        this.getChartData({
          tokenAddress,
          type: '5m',
          timeFrom: 0, // Full history
          timeTo: Math.floor(Date.now() / 1000),
          marketCap: true,
          removeOutliers: true,
          dynamicPools: true,
          fastCache: true
        })
      ]);

      if (chart.status === 'fulfilled' && chart.value?.data) {
        let maxMC = -Infinity, maxMCTs = 0;
        let maxPrice = -Infinity, maxPriceTs = 0;

        for (const candle of chart.value.data) {
          if (typeof candle.marketCapHigh === 'number' && candle.marketCapHigh > maxMC) {
            maxMC = candle.marketCapHigh;
            maxMCTs = candle.timestamp || candle.t;
          }
          if (typeof candle.high === 'number' && candle.high > maxPrice) {
            maxPrice = candle.high;
            maxPriceTs = candle.timestamp || candle.t;
          }
        }

        if (isFinite(maxMC)) {
          return { basis: 'marketCap', value: maxMC, ts: maxMCTs };
        }
        if (isFinite(maxPrice)) {
          return { basis: 'price', value: maxPrice, ts: maxPriceTs };
        }
      }

      if (athPrice.status === 'fulfilled') {
        return { 
          basis: 'price', 
          value: Number(athPrice.value), 
          ts: 0 // No timestamp available
        };
      }

      throw new Error('ATH resolution failed');
    } catch (error) {
      console.error(`Error getting ATH with timestamp for ${tokenAddress}:`, error);
      throw error;
    }
  }

  // Get ATH price only
  async getAthPrice(tokenAddress) {
    try {
      const data = await this.makeRequest(`${this.baseUrl}/tokens/${tokenAddress}/ath`);
      return data?.highest_price || data?.price || 0;
    } catch (error) {
      console.error(`Error getting ATH price for ${tokenAddress}:`, error);
      throw error;
    }
  }

  // Get local post-call high with proper basis handling
  async getLocalPostCallHigh(tokenAddress, fromTs, toTs, preferMarketCap = true) {
    try {
      const chart = await this.getChartData({
        tokenAddress,
        type: (toTs - fromTs) > 60 * 60 * 48 ? '5m' : '1m',
        timeFrom: fromTs,
        timeTo: toTs,
        marketCap: true,
        removeOutliers: true,
        dynamicPools: true,
        fastCache: true
      });

      if (!chart?.data || !Array.isArray(chart.data)) {
        throw new Error('No chart data available');
      }

      let maxVal = -Infinity, maxTs = 0, basis = 'marketCap';

      for (const candle of chart.data) {
        const marketCapHigh = typeof candle.marketCapHigh === 'number' ? candle.marketCapHigh : NaN;
        const priceHigh = typeof candle.high === 'number' ? candle.high : NaN;

        if (preferMarketCap && Number.isFinite(marketCapHigh)) {
          if (marketCapHigh > maxVal) {
            maxVal = marketCapHigh;
            maxTs = candle.timestamp || candle.t;
            basis = 'marketCap';
          }
        } else {
          const value = Number.isFinite(marketCapHigh) ? marketCapHigh : priceHigh;
          const valueBasis = Number.isFinite(marketCapHigh) ? 'marketCap' : 'price';
          
          if (Number.isFinite(value) && value > maxVal) {
            maxVal = value;
            maxTs = candle.timestamp || candle.t;
            basis = valueBasis;
          }
        }
      }

      if (!Number.isFinite(maxVal)) {
        throw new Error('No highs found in window');
      }

      return { value: maxVal, ts: maxTs, basis };
    } catch (error) {
      console.error(`Error getting local post-call high for ${tokenAddress}:`, error);
      throw error;
    }
  }

  // Batch refresh multiple tokens
  async batchRefreshTokens(calls) {
    try {
      // Group calls by token to minimize API calls
      const tokenGroups = {};
      for (const call of calls) {
        if (!tokenGroups[call.token]) {
          tokenGroups[call.token] = [];
        }
        tokenGroups[call.token].push(call);
      }

      const results = [];
      const tokenAddresses = Object.keys(tokenGroups);

      // Get multiple tokens data
      const tokensData = await this.getMultipleTokens(tokenAddresses);

      for (const tokenAddress of tokenAddresses) {
        const calls = tokenGroups[tokenAddress];
        const tokenData = tokensData?.tokens?.[tokenAddress];

        if (!tokenData) {
          // Mark all calls for this token as failed
          for (const call of calls) {
            results.push({
              callId: call.id,
              success: false,
              error: 'Token data not found'
            });
          }
          continue;
        }

        // Process each call for this token
        for (const call of calls) {
          try {
            const postCallData = await this.getPostCallData(
              tokenAddress, 
              call.tsCall, 
              Date.now()
            );

            results.push({
              callId: call.id,
              success: true,
              data: postCallData
            });
          } catch (error) {
            results.push({
              callId: call.id,
              success: false,
              error: error.message
            });
          }
        }
      }

      return results;
    } catch (error) {
      console.error('Error in batch refresh:', error);
      throw error;
    }
  }
}

module.exports = SolanaTrackerService;
