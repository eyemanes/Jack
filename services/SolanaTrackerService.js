const axios = require('axios');

class SolanaTrackerService {
  constructor(apiKey) {
    this.apiKey = apiKey || '6a281d1b-b7d4-4213-861c-4ac9b386cd60';
    this.baseUrl = 'https://data.solanatracker.io';
    this.axiosInstance = axios.create({
      timeout: 10000,
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json',
        'User-Agent': 'SolanaTrackerBot/1.0'
      }
    });
  }

  /**
   * Fetch token data from Solana Tracker API
   * @param {string} contractAddress - Solana token contract address
   * @returns {Promise<Object|null>} Token data or null if not found
   */
  async getTokenData(contractAddress) {
    try {
      console.log(`Fetching token data from Solana Tracker for: ${contractAddress}`);
      
      // Add delay to avoid rate limiting
      await this.delay(1000);
      
      // Fetch token data first
      const tokenResponse = await this.axiosInstance.get(`${this.baseUrl}/tokens/${contractAddress}`);
      
      if (!tokenResponse.data) {
        console.log(`No data found for token: ${contractAddress}`);
        return null;
      }

      const tokenData = tokenResponse.data;
      
      // Extract data from the API response structure first
      const token = tokenData.token || {};
      const pool = tokenData.pools && tokenData.pools[0] ? tokenData.pools[0] : {};
      const events = tokenData.events || {};
      
      // Try to fetch ATH data separately with delay to avoid rate limiting
      let athData = null;
      try {
        // Add delay to avoid rate limiting
        await this.delay(2000); // Increased delay
        const athResponse = await this.axiosInstance.get(`${this.baseUrl}/tokens/${contractAddress}/ath`);
        athData = athResponse.data;
        console.log(`ATH data fetched successfully for ${contractAddress}:`, athData);
      } catch (athError) {
        console.log(`ATH data not available for token: ${contractAddress}, Error:`, athError.message);
        // Use current price as fallback ATH
        athData = { highest_price: parseFloat(pool.price?.usd) || 0 };
      }
      
      return {
        contractAddress,
        name: token.name || 'Unknown',
        symbol: token.symbol || 'N/A',
        price: parseFloat(pool.price?.usd) || 0,
        marketCap: parseFloat(pool.marketCap?.usd) || 0,
        volume24h: parseFloat(pool.txns?.volume24h) || 0,
        liquidity: parseFloat(pool.liquidity?.usd) || 0,
        priceChange1h: parseFloat(events['1h']?.priceChangePercentage) || 0,
        priceChange6h: parseFloat(events['6h']?.priceChangePercentage) || 0,
        priceChange24h: parseFloat(events['24h']?.priceChangePercentage) || 0,
        supply: parseFloat(pool.tokenSupply) || 0,
        maxSupply: 0, // Not provided in this API
        holders: tokenData.holders || 0,
        ath: athData ? parseFloat(athData.highest_market_cap) || 0 : 0,
        athTimestamp: athData ? athData.timestamp : null,
        image: token.image || token.logo || null,
        website: token.website || null,
        twitter: token.twitter || null,
        telegram: token.telegram || null,
        timestamp: new Date()
      };
    } catch (error) {
      console.error(`Error fetching token data for ${contractAddress}:`, error.message);
      
      if (error.response?.status === 429) {
        console.log(`Rate limit hit, waiting 5 seconds before retry...`);
        await this.delay(5000);
        // Try one more time after delay
        try {
          const retryResponse = await this.axiosInstance.get(`${this.baseUrl}/tokens/${contractAddress}`);
          if (retryResponse.data) {
            // Process the retry response the same way
            const tokenData = retryResponse.data;
            const token = tokenData.token || {};
            const pool = tokenData.pools && tokenData.pools[0] ? tokenData.pools[0] : {};
            const events = tokenData.events || {};
            
            return {
              contractAddress,
              name: token.name || 'Unknown',
              symbol: token.symbol || 'N/A',
              price: parseFloat(pool.price?.usd) || 0,
              marketCap: parseFloat(pool.marketCap?.usd) || 0,
              volume24h: parseFloat(pool.txns?.volume24h) || 0,
              liquidity: parseFloat(pool.liquidity?.usd) || 0,
              priceChange1h: parseFloat(events['1h']?.priceChangePercentage) || 0,
              priceChange6h: parseFloat(events['6h']?.priceChangePercentage) || 0,
              priceChange24h: parseFloat(events['24h']?.priceChangePercentage) || 0,
              supply: parseFloat(pool.tokenSupply) || 0,
              maxSupply: 0,
              holders: tokenData.holders || 0,
              ath: parseFloat(pool.price?.usd) || 0, // Use current price as ATH fallback
              athTimestamp: null, // No timestamp for fallback
              image: token.image || token.logo || null,
              website: token.website || null,
              twitter: token.twitter || null,
              telegram: token.telegram || null,
              timestamp: new Date()
            };
          }
        } catch (retryError) {
          console.error(`Retry also failed:`, retryError.message);
        }
        throw new Error('Rate limit exceeded. Please try again later.');
      }
      
      if (error.response?.status === 404) {
        return null;
      }
      
      throw new Error(`Failed to fetch token data: ${error.message}`);
    }
  }



  /**
   * Fetch multiple tokens data using the batch API endpoint
   * @param {string[]} contractAddresses - Array of contract addresses
   * @returns {Promise<Object[]>} Array of token data
   */
  async getMultipleTokensData(contractAddresses) {
    try {
      console.log(`Fetching batch data for ${contractAddresses.length} tokens using multi endpoint`);
      
      // Use the batch API endpoint for better performance
      console.log(`🔍 Calling batch API with ${contractAddresses.length} tokens:`, contractAddresses);
      const response = await this.axiosInstance.post(`${this.baseUrl}/tokens/multi`, {
        tokens: contractAddresses
      });
      
      console.log(`📡 Batch API response status:`, response.status);
      console.log(`📡 Batch API response data:`, response.data);
      
      if (!response.data || !response.data.tokens) {
        console.log('❌ No batch data received from API - falling back to individual requests');
        return await this.getMultipleTokensDataFallback(contractAddresses);
      }
      
      const results = [];
      const batchData = response.data.tokens;
      
      // Process the batch response
      for (const contractAddress of contractAddresses) {
        try {
          const tokenData = batchData[contractAddress];
          
          if (tokenData) {
            // Extract data from the API response structure
            const token = tokenData.token || {};
            const pool = tokenData.pools && tokenData.pools[0] ? tokenData.pools[0] : {};
            const events = tokenData.events || {};
            
            // Try to get ATH data if available
            let athData = null;
            if (tokenData.ath) {
              athData = tokenData.ath;
            }
            
            const processedData = {
              contractAddress,
              name: token.name || 'Unknown',
              symbol: token.symbol || 'N/A',
              price: parseFloat(pool.price?.usd) || 0,
              marketCap: parseFloat(pool.marketCap?.usd) || 0,
              volume24h: parseFloat(pool.txns?.volume24h) || 0,
              liquidity: parseFloat(pool.liquidity?.usd) || 0,
              priceChange1h: parseFloat(events['1h']?.priceChangePercentage) || 0,
              priceChange6h: parseFloat(events['6h']?.priceChangePercentage) || 0,
              priceChange24h: parseFloat(events['24h']?.priceChangePercentage) || 0,
              supply: parseFloat(pool.tokenSupply) || 0,
              maxSupply: 0,
              holders: tokenData.holders || 0,
              ath: athData ? parseFloat(athData.highest_market_cap) || 0 : 0,
              athTimestamp: athData ? athData.timestamp : null,
              image: token.image || token.logo || null,
              website: token.website || null,
              twitter: token.twitter || null,
              telegram: token.telegram || null,
              timestamp: new Date()
            };
            
            results.push({ address: contractAddress, data: processedData, error: null });
          } else {
            results.push({ address: contractAddress, data: null, error: 'Token data not found in batch response' });
          }
        } catch (error) {
          console.error(`Error processing token ${contractAddress} from batch:`, error.message);
          results.push({ address: contractAddress, data: null, error: error.message });
        }
      }
      
      console.log(`Batch fetch completed: ${results.filter(r => r.data).length} successful, ${results.filter(r => !r.data).length} failed`);
      return results;
      
    } catch (error) {
      console.error('Error fetching batch token data:', error.message);
      
      // Fallback to individual requests if batch fails
      console.log('Falling back to individual token requests...');
      return await this.getMultipleTokensDataFallback(contractAddresses);
    }
  }

  /**
   * Fallback method for fetching multiple tokens data individually
   * @param {string[]} contractAddresses - Array of contract addresses
   * @returns {Promise<Object[]>} Array of token data
   */
  async getMultipleTokensDataFallback(contractAddresses) {
    const results = [];
    
    // Process in smaller batches to avoid rate limiting
    const batchSize = 3;
    for (let i = 0; i < contractAddresses.length; i += batchSize) {
      const batch = contractAddresses.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (address) => {
        try {
          const data = await this.getTokenData(address);
          return { address, data, error: null };
        } catch (error) {
          return { address, data: null, error: error.message };
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Add delay between batches to avoid rate limiting
      if (i + batchSize < contractAddresses.length) {
        await this.delay(2000); // Longer delay for fallback
      }
    }
    
    return results;
  }

  /**
   * Validate if a string is a valid Solana contract address
   * @param {string} address - Address to validate
   * @returns {boolean} True if valid Solana address
   */
  isValidSolanaAddress(address) {
    // Basic Solana address validation (base58, 32-44 characters)
    const solanaAddressRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    return solanaAddressRegex.test(address);
  }

  /**
   * Extract Solana contract addresses from text
   * @param {string} text - Text to search for addresses
   * @returns {string[]} Array of found contract addresses
   */
  extractContractAddresses(text) {
    const solanaAddressRegex = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
    const matches = text.match(solanaAddressRegex) || [];
    
    return matches.filter(address => this.isValidSolanaAddress(address));
  }

  /**
   * Extract token symbols from text (e.g., $RAPR, $BELIEVE)
   * @param {string} text - Text to search for symbols
   * @returns {string[]} Array of found token symbols
   */
  extractTokenSymbols(text) {
    const symbolRegex = /\$([A-Za-z][A-Za-z0-9]{1,9})\b/g;
    const matches = text.match(symbolRegex) || [];
    
    return matches.map(match => match.substring(1).toUpperCase()); // Remove the $ prefix and convert to uppercase
  }

  /**
   * Search for token by symbol and return the one with highest market cap
   * @param {string} symbol - Token symbol to search for
   * @returns {Promise<Object|null>} Token data or null if not found
   */
  async searchTokenBySymbol(symbol) {
    try {
      console.log(`Symbol search requested for: ${symbol} - returning coming soon message`);
      
      // Return a special "coming soon" token data object
      return {
        contractAddress: 'COMING_SOON',
        name: 'Symbol Search',
        symbol: symbol,
        price: 0,
        marketCap: 0,
        volume24h: 0,
        liquidity: 0,
        priceChange1h: 0,
        priceChange6h: 0,
        priceChange24h: 0,
        supply: 0,
        maxSupply: 0,
        holders: 0,
        ath: 0,
        image: null,
        website: null,
        twitter: null,
        telegram: null,
        timestamp: new Date(),
        comingSoon: true
      };
      
    } catch (error) {
      console.error(`Error in symbol search:`, error.message);
      return null;
    }
  }

  /**
   * Filter out potential scam tokens based on various criteria
   * @param {Array} tokens - Array of token objects
   * @returns {Array} Filtered array of legitimate tokens
   */
  filterScamTokens(tokens) {
    return tokens.filter(token => {
      const name = (token.name || '').toLowerCase();
      const symbol = (token.symbol || '').toLowerCase();
      const contractAddress = token.mint || '';
      const liquidity = parseFloat(token.liquidityUsd) || 0;
      const marketCap = parseFloat(token.marketCapUsd) || 0;
      const volume24h = parseFloat(token.volume_24h) || 0;
      const holders = parseInt(token.holders) || 0;
      const lpBurn = parseInt(token.lpBurn) || 0;

      // Whitelist of known legitimate tokens (by contract address)
      const legitimateTokens = [
        'CB9dDufT3ZuQXqqSfa1c5kY935TEreyBw9XJXxHKpump', // Legitimate USDUC
        '2REv3E31SK1uutWCuqG1nrgDNhgdcCeqfeMmmSzEi8xu', // Unstable Coin (usduc.org) - appears legitimate
        '5UUH9RTDiSpq6HKS6bp4NdU9PNJpXRXuiw6ShBTBhgH2', // Legitimate TROLL
        // Add more legitimate tokens here as needed
      ];

      if (legitimateTokens.includes(contractAddress)) {
        console.log(`Token is whitelisted as legitimate: ${token.name} (${token.symbol})`);
        return true;
      }

      // 1. Check for suspicious names/symbols
      const suspiciousKeywords = [
        'test', 'fake', 'scam', 'rug', 'honeypot', 'shitcoin', 'moon', 'pump', 'doge',
        'elon', 'musk', 'trump', 'biden', 'pepe', 'wojak', 'chad', 'based', 'retard',
        'ape', 'diamond', 'hands', 'hodl', 'lambo', 'to the moon', 'wen moon',
        'zero', 'null', 'undefined', 'empty', 'placeholder', 'unstable', 'stable',
        'coin', 'token', 'crypto', 'currency', 'dollar', 'usd', 'btc', 'eth'
      ];

      const hasSuspiciousName = suspiciousKeywords.some(keyword => 
        name.includes(keyword) || symbol.includes(keyword)
      );

      if (hasSuspiciousName) {
        console.log(`Filtered out token with suspicious name: ${token.name} (${token.symbol})`);
        return false;
      }

      // 2. Check for extremely low holder count (potential scam indicator)
      if (holders < 50) {
        console.log(`Filtered out token with too few holders: ${token.name} (${token.symbol}) - ${holders} holders`);
        return false;
      }

      // 3. Check for LP burn percentage (100% burn can be suspicious)
      if (lpBurn === 100 && holders < 100) {
        console.log(`Filtered out token with 100% LP burn and low holders: ${token.name} (${token.symbol})`);
        return false;
      }

      // 4. Check for unrealistic liquidity to market cap ratio
      if (liquidity > 0 && marketCap > 0) {
        const liquidityRatio = liquidity / marketCap;
        // If liquidity is more than 50% of market cap, it's suspicious
        if (liquidityRatio > 0.5) {
          console.log(`Filtered out token with suspicious liquidity ratio: ${token.name} (${token.symbol}) - ${(liquidityRatio * 100).toFixed(1)}%`);
          return false;
        }
      }

      // 5. Check for zero volume with high liquidity (potential wash trading)
      if (liquidity > 10000 && volume24h === 0) {
        console.log(`Filtered out token with high liquidity but zero volume: ${token.name} (${token.symbol})`);
        return false;
      }

      // 6. Check for tokens with "retard" in name (often scam tokens)
      if (name.includes('retard') || name.includes('retarded')) {
        console.log(`Filtered out token with 'retard' in name: ${token.name} (${token.symbol})`);
        return false;
      }

      // 7. Check for tokens with very low market cap but high liquidity (suspicious)
      if (marketCap < 1000 && liquidity > 5000) {
        console.log(`Filtered out token with suspicious low MC/high liquidity: ${token.name} (${token.symbol})`);
        return false;
      }

      // 7.5. Check for tokens with very low liquidity compared to market cap (suspicious)
      if (marketCap > 10000 && liquidity < 1000) {
        console.log(`Filtered out token with suspicious low liquidity for market cap: ${token.name} (${token.symbol}) - MC: $${this.formatNumber(marketCap)}, LP: $${this.formatNumber(liquidity)}`);
        return false;
      }

      // 8. Check for freeze authority (can be used to freeze tokens)
      if (token.freezeAuthority && token.freezeAuthority !== null) {
        console.log(`Filtered out token with freeze authority: ${token.name} (${token.symbol})`);
        return false;
      }

      // 9. Check for mint authority (can be used to mint more tokens)
      if (token.mintAuthority && token.mintAuthority !== null) {
        console.log(`Filtered out token with mint authority: ${token.name} (${token.symbol})`);
        return false;
      }

      // 10. Check for generic crypto names (often scams) - but allow domain names
      const genericCryptoNames = ['coin', 'token', 'crypto', 'currency', 'dollar', 'stable', 'unstable'];
      const hasGenericName = genericCryptoNames.some(keyword => 
        name.includes(keyword) && name.length < 20 && !name.includes('.')
      );
      
      if (hasGenericName) {
        console.log(`Filtered out token with generic crypto name: ${token.name} (${token.symbol})`);
        return false;
      }

      // 10.5. Prioritize tokens with domain names (more likely to be legitimate)
      if (name.includes('.') && (name.includes('.org') || name.includes('.com') || name.includes('.io'))) {
        console.log(`Token has domain name (likely legitimate): ${token.name} (${token.symbol})`);
        return true;
      }

      // 10.6. Prioritize tokens with very high liquidity and market cap (likely legitimate)
      if (liquidity > 1000000 && marketCap > 10000000 && holders > 1000) {
        console.log(`Token has high liquidity/market cap (likely legitimate): ${token.name} (${token.symbol}) - LP: $${this.formatNumber(liquidity)}, MC: $${this.formatNumber(marketCap)}, Holders: ${holders}`);
        return true;
      }

      // 11. Check for tokens with price of 0 (often broken or scam tokens)
      const price = parseFloat(token.priceUsd) || 0;
      if (price === 0 && marketCap > 0) {
        console.log(`Filtered out token with zero price but non-zero market cap: ${token.name} (${token.symbol})`);
        return false;
      }

      // 12. Check for tokens with extremely high ATH but current price near 0 (rug pull indicator)
      if (token.ath && price > 0) {
        const athPrice = parseFloat(token.ath) || 0;
        if (athPrice > 0 && price / athPrice < 0.01) { // Current price is less than 1% of ATH
          console.log(`Filtered out token with massive price drop (potential rug pull): ${token.name} (${token.symbol}) - ATH: $${athPrice}, Current: $${price}`);
          return false;
        }
      }

      // 13. Check for tokens with suspiciously high ATH compared to current market cap
      if (token.ath && marketCap > 0) {
        const athMarketCap = parseFloat(token.ath) || 0;
        if (athMarketCap > marketCap * 100) { // ATH was 100x higher than current MC
          console.log(`Filtered out token with suspiciously high ATH: ${token.name} (${token.symbol}) - ATH MC: $${athMarketCap}, Current MC: $${marketCap}`);
          return false;
        }
      }

      console.log(`Token passed scam filters: ${token.name} (${token.symbol}) - LP: $${this.formatNumber(liquidity)}, MC: $${this.formatNumber(marketCap)}, Holders: ${holders}`);
      return true;
    });
  }

  /**
   * Format search result to token data format
   * @param {Object} searchResult - Token data from search API
   * @returns {Object} Formatted token data
   */
  formatSearchResultToTokenData(searchResult) {
    return {
      contractAddress: searchResult.mint,
      name: searchResult.name || 'Unknown',
      symbol: searchResult.symbol || 'N/A',
      price: parseFloat(searchResult.priceUsd) || 0,
      marketCap: parseFloat(searchResult.marketCapUsd) || 0,
      volume24h: parseFloat(searchResult.volume_24h) || 0,
      liquidity: parseFloat(searchResult.liquidityUsd) || 0,
      priceChange1h: 0, // Not available in search results
      priceChange6h: 0, // Not available in search results
      priceChange24h: 0, // Not available in search results
      supply: parseFloat(searchResult.tokenSupply) || 0,
      maxSupply: 0, // Not available in search results
      holders: searchResult.holders || 0,
      ath: parseFloat(searchResult.priceUsd) || 0, // Use current price as ATH fallback
      image: searchResult.image || null,
      website: null, // Not available in search results
      twitter: null, // Not available in search results
      telegram: null, // Not available in search results
      timestamp: new Date()
    };
  }

  /**
   * Utility function to add delay
   * @param {number} ms - Milliseconds to delay
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get trending tokens from Solana Tracker
   * @returns {Promise<Object[]>} Array of trending tokens
   */
  async getTrendingTokens() {
    try {
      const response = await this.axiosInstance.get(`${this.baseUrl}/tokens/trending`);
      
      if (!response.data || response.data.status !== 'success') {
        return [];
      }

      return response.data.data.map(token => ({
        contractAddress: token.mint,
        name: token.name,
        symbol: token.symbol,
        price: parseFloat(token.priceUsd || token.price) || 0,
        marketCap: parseFloat(token.marketCapUsd || token.marketCap) || 0,
        volume24h: parseFloat(token.volume_24h || token.volume24h) || 0,
        priceChange24h: parseFloat(token.priceChange24h) || 0
      }));
    } catch (error) {
      console.error('Error fetching trending tokens:', error.message);
      return [];
    }
  }

  /**
   * Escape special characters for Telegram Markdown (but preserve URLs)
   * @param {string} text - Text to escape
   * @returns {string} Escaped text
   */
  escapeMarkdown(text) {
    if (!text) return '';
    return text.toString()
      .replace(/\*/g, '\\*')
      .replace(/_/g, '\\_')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
      .replace(/~/g, '\\~')
      .replace(/`/g, '\\`')
      .replace(/>/g, '\\>')
      .replace(/#/g, '\\#')
      .replace(/\+/g, '\\+')
      .replace(/-/g, '\\-')
      .replace(/=/g, '\\=')
      .replace(/\|/g, '\\|')
      .replace(/\{/g, '\\{')
      .replace(/\}/g, '\\}')
      .replace(/!/g, '\\!');
  }

  /**
   * Escape text for Telegram Markdown but preserve URLs
   * @param {string} text - Text to escape
   * @returns {string} Escaped text
   */
  escapeMarkdownSafe(text) {
    if (!text) return '';
    // Only escape the most problematic characters, leave URLs mostly intact
    return text.toString()
      .replace(/\*/g, '\\*')
      .replace(/_/g, '\\_')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
      .replace(/~/g, '\\~')
      .replace(/`/g, '\\`')
      .replace(/>/g, '\\>')
      .replace(/#/g, '\\#')
      .replace(/\+/g, '\\+')
      .replace(/-/g, '\\-')
      .replace(/=/g, '\\=')
      .replace(/\|/g, '\\|')
      .replace(/\{/g, '\\{')
      .replace(/\}/g, '\\}')
      .replace(/!/g, '\\!');
  }

  /**
   * Format token data for display in the format you provided
   * @param {Object} tokenData - Token data from API
   * @param {Object} callData - Call data from database
   * @returns {string} Formatted message
   */
  formatTokenDisplay(tokenData, callData = null) {
    // Handle "coming soon" case for symbol searches
    if (tokenData.comingSoon) {
      return `🚧 *Symbol Search Coming Soon!* 🐙\n\nSorry! Symbol search (like $${tokenData.symbol}) is not available yet.\n\nPlease use the full contract address instead:\n\`/ca <contract_address>\`\n\n*Coming soon!* 🚀`;
    }

    const isRecall = callData !== null;
    const pnlEmoji = isRecall && callData.pnlPercent >= 0 ? '🟢' : isRecall ? '🔴' : '🟢';
    
    let message = '';
    
    // Token image will be sent separately, no need to include in message
    
    if (isRecall) {
      message += `🔄 *Token Performance Update* 🐙\n\n`;
    } else {
      message += `✅ *Token Tracked Successfully!* 🐙\n\n`;
    }
    message += `💊 ${this.escapeMarkdown(tokenData.name)} (${this.escapeMarkdown(tokenData.symbol)})\n`;
    message += `🔗 \`${tokenData.contractAddress}\`\n`;
    message += `└ #SOL (Pump) | 🌱${this.formatTimeAgo(callData?.createdAt)} | 👁️${tokenData.holders || 0}\n\n`;
    
    // Token Stats
    message += `📊 *Token Stats* 🐙\n`;
    message += `├ USD:  $${tokenData.price.toFixed(8)} (${tokenData.priceChange24h >= 0 ? '+' : ''}${tokenData.priceChange24h?.toFixed(0) || 0}%)\n`;
    message += `├ MC:   $${this.formatNumber(tokenData.marketCap)}\n`;
    message += `├ Vol:  $${this.formatNumber(tokenData.volume24h)}\n`;
    message += `├ LP:   $${this.formatNumber(tokenData.liquidity)}\n`;
    message += `├ Sup:  ${this.formatNumber(tokenData.supply)}/${this.formatNumber(tokenData.maxSupply)}\n`;
    message += `├ 1H:   ${tokenData.priceChange1h >= 0 ? '+' : ''}${tokenData.priceChange1h?.toFixed(0) || 0}%\n`;
    
    message += `└ ATH:  $${this.formatNumber(tokenData.ath || 0)}\n\n`;
    
    // Links
    if (tokenData.website || tokenData.twitter || tokenData.telegram) {
      message += `🔗 *Links*\n`;
      const links = [];
      if (tokenData.twitter) {
        const twitterLink = `[𝕏](${tokenData.twitter})`;
        links.push(twitterLink);
      }
      if (tokenData.telegram) {
        const telegramLink = `[TG](${tokenData.telegram})`;
        links.push(telegramLink);
      }
      if (tokenData.website) {
        const websiteLink = `[Web](${tokenData.website})`;
        links.push(websiteLink);
      }
      message += `└ ${links.join(' • ')}\n\n`;
    }
    
    // Trading Links Section
    message += `\n`;
    message += `[AXI](http://axiom.trade/t/${tokenData.contractAddress}) - [TRO](https://t.me/paris_trojanbot?start=d-${tokenData.contractAddress}) - [GM](https://gmgn.ai/sol/token/30I510nA_${tokenData.contractAddress}) - [NEO](https://neo.bullx.io/terminal?chainId=1399811149&address=${tokenData.contractAddress}) - [BLOP](https://t.me/BloomSolana_bot?start=ref_ca_${tokenData.contractAddress})\n`;
    message += `[MAE](https://t.me/maestro?start=${tokenData.contractAddress}) - [BAN](https://t.me/BananaGun_bot?start=snp_${tokenData.contractAddress}) - [PDR](https://trade.padre.gg/trade/solana/${tokenData.contractAddress}) - [MVX](https://t.me/MevxTradingBot?start=${tokenData.contractAddress}) - [BNK](https://t.me/furiosa_bonkbot?start=ref_ca_${tokenData.contractAddress}) - [PEP](https://t.me/pepeboost_sol_bot?start=ref_ca_${tokenData.contractAddress})\n\n`;
    
    // Caller info - compact inline format
    if (callData) {
      const callerName = this.escapeMarkdown(callData.username || callData.firstName || 'Anonymous');
      const callTime = this.formatCallTime(callData.createdAt);
      
      if (isRecall) {
        // For recall calls, show PnL and multiplier with original entry market cap
        const entryPrice = parseFloat(callData.entryPrice) || 0;
        const currentPrice = parseFloat(tokenData.price) || 0;
        const entryMarketCap = parseFloat(callData.entryMarketCap) || 0;
        const currentMarketCap = parseFloat(tokenData.marketCap) || 0;
        
        // Determine which market cap to use for multiplier calculation
        let bestMarketCap = currentMarketCap; // Default to current market cap
        
        // Check if ATH is available and higher than current market cap
        if (tokenData.ath && tokenData.ath > currentMarketCap) {
          // Check if ATH timestamp is available
          if (tokenData.athTimestamp && callData.createdAt) {
            const callTime = new Date(callData.createdAt).getTime();
            const athTime = new Date(tokenData.athTimestamp).getTime();
            
            if (athTime > callTime) {
              // ATH reached AFTER call - use ATH for multiplier
              bestMarketCap = tokenData.ath;
            } else {
              // ATH reached BEFORE call - use current market cap for multiplier
              bestMarketCap = currentMarketCap;
            }
          } else {
            // If no timestamp, use current market cap to be safe
            bestMarketCap = currentMarketCap;
          }
        }
        
        // Calculate multiplier using the best market cap
        const multiplier = entryMarketCap && bestMarketCap ? bestMarketCap / entryMarketCap : 1;
        const pnlPercent = callData.pnlPercent || 0;
        
        // Display logic: negative = %, positive < 2x = %, positive >= 2x = multiplier
        let performanceText;
        if (multiplier < 1) {
          // Negative PnL - show percentage
          const negativePercent = ((multiplier - 1) * 100).toFixed(1);
          performanceText = `[${negativePercent}%]`;
        } else if (multiplier < 2) {
          // Positive PnL below 2x - show percentage
          const positivePercent = ((multiplier - 1) * 100).toFixed(1);
          performanceText = `[+${positivePercent}%]`;
        } else {
          // Positive PnL 2x and above - show multiplier
          performanceText = `[${multiplier.toFixed(1)}x]`;
        }
        
        message += `👤 ${callerName} @ $${this.formatNumber(entryMarketCap)} ${performanceText} (${callTime})\n`;
      } else {
        // For new calls, show current market cap
        message += `👤 ${callerName} @ $${this.formatNumber(tokenData.marketCap)} (${callTime})\n`;
      }
    } else {
      message += `👤 Current User @ $${this.formatNumber(tokenData.marketCap)}\n`;
    }
    
    return message;
  }

  /**
   * Format number with K, M, B suffixes
   * @param {number} num - Number to format
   * @returns {string} Formatted number
   */
  formatNumber(num) {
    if (!num || num === 0) return '0';
    
    if (num >= 1e9) {
      return (num / 1e9).toFixed(1) + 'B';
    } else if (num >= 1e6) {
      return (num / 1e6).toFixed(1) + 'M';
    } else if (num >= 1e3) {
      return (num / 1e3).toFixed(1) + 'K';
    } else if (num >= 1) {
      return num.toFixed(2);
    } else if (num >= 0.01) {
      return num.toFixed(4);
    } else if (num >= 0.0001) {
      return num.toFixed(6);
    } else {
      return num.toFixed(8);
    }
  }

  /**
   * Format time ago
   * @param {Date} date - Date to format
   * @returns {string} Formatted time
   */
  formatTimeAgo(date) {
    if (!date) return '0m';
    
    const now = new Date();
    const diffMs = now - new Date(date);
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) {
      return `${diffDays}d`;
    } else if (diffHours > 0) {
      return `${diffHours}h`;
    } else if (diffMins > 0) {
      return `${diffMins}m`;
    } else {
      return '0m';
    }
  }

  /**
   * Get time ago string
   * @param {Date} date - Date to format
   * @returns {string} Time ago string
   */
  getTimeAgo(date) {
    const now = new Date();
    const diffMs = now - new Date(date);
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) {
      return `${diffDays}d ago`;
    } else if (diffHours > 0) {
      return `${diffHours}h ago`;
    } else if (diffMins > 0) {
      return `${diffMins}m ago`;
    } else {
      return 'Just now';
    }
  }

  /**
   * Format call time to show exact moment
   * @param {Date} date - Date to format
   * @returns {string} Formatted call time
   */
  formatCallTime(date) {
    if (!date) return 'Unknown';
    
    const callDate = new Date(date);
    const now = new Date();
    const diffMs = now - callDate;
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    console.log(`Time calculation debug:`, {
      callDate: callDate.toISOString(),
      now: now.toISOString(),
      diffMs: diffMs,
      diffMins: diffMins,
      diffHours: diffHours
    });

    // Show exact time if less than 1 hour ago
    if (diffMins < 60) {
      return `${diffMins}m ago`;
    }
    // Show hours if less than 24 hours ago
    else if (diffHours < 24) {
      return `${diffHours}h ago`;
    }
    // Show days if more than 24 hours ago
    else {
      return `${diffDays}d ago`;
    }
  }
}

module.exports = SolanaTrackerService;
