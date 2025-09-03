# Solana Tracker Data API Documentation

## Overview
The library provides methods for all endpoints in the Solana Tracker Data API.

## Token Endpoints

### Basic Token Information
```javascript
// Get token information
const tokenInfo = await client.getTokenInfo('tokenAddress');

// Get token by pool address
const tokenByPool = await client.getTokenByPool('poolAddress');

// Get token holders
const tokenHolders = await client.getTokenHolders('tokenAddress');

// Get top token holders
const topHolders = await client.getTopHolders('tokenAddress');

// Get all-time high price for a token
const athPrice = await client.getAthPrice('tokenAddress');
```

### Token Discovery
```javascript
// Get tokens by deployer wallet
const deployerTokens = await client.getTokensByDeployer('walletAddress');

// Search for tokens
const searchResults = await client.searchTokens({
  query: 'SOL',
  minLiquidity: 100000,
  sortBy: 'marketCapUsd',
  sortOrder: 'desc',
});

// Get latest tokens
const latestTokens = await client.getLatestTokens(100);

// Get information about multiple tokens (UPDATED: Now returns MultiTokensResponse)
const multipleTokens = await client.getMultipleTokens([
  'So11111111111111111111111111111111111111112',
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
]);
// Access tokens like: multipleTokens.tokens['tokenAddress']

// Get trending tokens
const trendingTokens = await client.getTrendingTokens('1h');

// Get tokens by volume
const volumeTokens = await client.getTokensByVolume('24h');

// Get token overview (latest, graduating, graduated)
const tokenOverview = await client.getTokenOverview();

// Get graduated tokens
const graduatedTokens = await client.getGraduatedTokens();
```

## Price Endpoints

### Price Information
```javascript
// Get token price
const tokenPrice = await client.getPrice('tokenAddress', true); // Include price changes

// Get historic price information
const priceHistory = await client.getPriceHistory('tokenAddress');

// Get price at a specific timestamp
const timestampPrice = await client.getPriceAtTimestamp('tokenAddress', 1690000000);

// Get price range (lowest/highest in time range)
const priceRange = await client.getPriceRange('tokenAddress', 1690000000, 1695000000);

// Get price using POST method
const postedPrice = await client.postPrice('tokenAddress');

// Get multiple token prices
const multiplePrices = await client.getMultiplePrices([
  'So11111111111111111111111111111111111111112',
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
]);

// Get multiple token prices using POST
const postedMultiplePrices = await client.postMultiplePrices([
  'So11111111111111111111111111111111111111112',
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
]);
```

## Wallet Endpoints

### Wallet Information
```javascript
// Get basic wallet information
const walletBasic = await client.getWalletBasic('walletAddress');

// Get all tokens in a wallet
const wallet = await client.getWallet('walletAddress');

// Get wallet tokens with pagination
const walletPage = await client.getWalletPage('walletAddress', 2);

// Get wallet portfolio chart data with historical values and PnL
const walletChart = await client.getWalletChart('walletAddress');
console.log('24h PnL:', walletChart.pnl['24h']);
console.log('30d PnL:', walletChart.pnl['30d']);
console.log('Chart data points:', walletChart.chartData.length);

// Get wallet trades
const walletTrades = await client.getWalletTrades('walletAddress', undefined, true, true, false);
```

## Trade Endpoints

### Trade Information
```javascript
// Get trades for a token
const tokenTrades = await client.getTokenTrades('tokenAddress');

// Get trades for a specific token and pool
const poolTrades = await client.getPoolTrades('tokenAddress', 'poolAddress');

// Get trades for a specific token, pool, and wallet
const userPoolTrades = await client.getUserPoolTrades('tokenAddress', 'poolAddress', 'walletAddress');

// Get trades for a specific token and wallet
const userTokenTrades = await client.getUserTokenTrades('tokenAddress', 'walletAddress');
```

## Chart Endpoints

### OHLCV Data
```javascript
// Get OHLCV data for a token - NEW: Now supports object syntax
// Method 1: Object syntax (recommended for multiple parameters)
const chartData = await client.getChartData({
  tokenAddress: 'tokenAddress',
  type: '1h',
  timeFrom: 1690000000,
  timeTo: 1695000000,
  marketCap: false,
  removeOutliers: true,
  dynamicPools: true,      // NEW: Dynamic pool selection
  timezone: 'current',     // NEW: Use current timezone or specify like 'America/New_York'
  fastCache: true         // NEW: Enable fast cache for better performance
});

// Method 2: Traditional syntax (still supported)
const chartData = await client.getChartData(
  'tokenAddress', 
  '1h', 
  1690000000, 
  1695000000,
  false,      // marketCap
  true,       // removeOutliers  
  true,       // dynamicPools
  'current',  // timezone
  true        // fastCache
);

// Get OHLCV data for a specific token and pool
const poolChartData = await client.getPoolChartData({
  tokenAddress: 'tokenAddress',
  poolAddress: 'poolAddress',
  type: '15m',
  timezone: 'UTC',
  fastCache: false
});

// Get holder count chart data
const holdersChart = await client.getHoldersChart('tokenAddress', '1d');
```

## PnL Endpoints

### PnL Calculations
```javascript
// Get PnL data for all positions of a wallet
const walletPnL = await client.getWalletPnL('walletAddress', true, true, false);

// Get the first 100 buyers of a token with PnL data
const firstBuyers = await client.getFirstBuyers('tokenAddress');

// Get PnL data for a specific token in a wallet - NEW: holdingCheck parameter
const tokenPnL = await client.getTokenPnL('walletAddress', 'tokenAddress', true);

// Can also use object syntax
const tokenPnL = await client.getTokenPnL({
  wallet: 'walletAddress',
  tokenAddress: 'tokenAddress',
  holdingCheck: true
});
```

## Top Traders Endpoints

### Trader Rankings
```javascript
// Get the most profitable traders across all tokens
const topTraders = await client.getTopTraders(1, true, 'total');

// Get top 100 traders by PnL for a token
const tokenTopTraders = await client.getTokenTopTraders('tokenAddress');
```

## Events Endpoints (Live Data)

### Live Event Processing
```javascript
// Get raw event data for live processing
// NOTE: For non-live statistics, use getTokenStats() instead which is more efficient
const events = await client.getEvents('tokenAddress');
console.log('Total events:', events.length);

// Get events for a specific pool
const poolEvents = await client.getPoolEvents('tokenAddress', 'poolAddress');

// Process events into statistics using the processEvents utility
import { processEventsAsync } from '@solana-tracker/data-api';

const stats = await processEvents(events);
console.log('1h stats:', stats['1h']);
console.log('24h volume:', stats['24h']?.volume.total);
```

## Additional Endpoints

### Statistics and Management
```javascript
// Get detailed stats for a token
const tokenStats = await client.getTokenStats('tokenAddress');

// Get detailed stats for a specific token and pool
const poolStats = await client.getPoolStats('tokenAddress', 'poolAddress');

// Get remaining API credits
const credits = await client.getCredits();
console.log('Remaining credits:', credits.credits);

// NEW: Get subscription information
const subscription = await client.getSubscription();
console.log('Plan:', subscription.plan);
console.log('Credits:', subscription.credits);
console.log('Status:', subscription.status);
console.log('Next billing date:', subscription.next_billing_date);
```

## Error Handling

### Robust Error Management
```javascript
import { Client, DataApiError, RateLimitError, ValidationError } from '@solana-tracker/data-api';

try {
  const tokenInfo = await client.getTokenInfo('invalid-address');
} catch (error) {
  if (error instanceof RateLimitError) {
    console.error('Rate limit exceeded. Retry after:', error.retryAfter, 'seconds');
  } else if (error instanceof ValidationError) {
    console.error('Validation error:', error.message);
  } else if (error instanceof DataApiError) {
    console.error('API error:', error.message, 'Status:', error.status);
    
    // NEW: Access detailed error information
    if (error.details) {
      console.error('Error details:', error.details);
    }
  } else {
    console.error('Unexpected error:', error);
  }
}
```

## New Features

### Live Stats Subscriptions
- Subscribe to real-time statistics for tokens and pools across all timeframes (1m, 5m, 15m, 30m, 1h, 4h, 24h) using `.stats.token()` and `.stats.pool()` methods
- Primary Pool Subscriptions: Subscribe to only the primary pool for a token using `.primary()` method
- Developer Holdings Tracking: Monitor developer/creator wallet holdings in real-time with `.dev.holding()` method
- Top 10 Holders Monitoring: Track the top 10 holders and their combined percentage of token supply with `.top10()` method

### Type Definitions
```typescript
// NEW: Developer holding update structure
interface DevHoldingUpdate {
  token: string;
  creator: string;
  amount: string;
  percentage: number;
  previousPercentage: number;
  timestamp: number;
}

// NEW: Top holder information
interface TopHolder {
  address: string;
  amount: string;
  percentage: number;
}

// NEW: Top 10 holders update structure
interface Top10HoldersUpdate {
  token: string;
  holders: TopHolder[];
  totalPercentage: number;
  previousPercentage: number | null;
  timestamp: number;
}
```

## Usage Notes

### Best Practices
1. **Use object syntax** for complex API calls with multiple parameters
2. **Enable fastCache** for better performance on frequently accessed data
3. **Use timezone parameter** for consistent time-based queries
4. **Handle rate limits** gracefully with retry logic
5. **Validate addresses** before making API calls
6. **Use batch endpoints** (getMultipleTokens, getMultiplePrices) for efficiency

### Performance Tips
- Use `fastCache: true` for frequently accessed data
- Batch multiple token requests when possible
- Use `removeOutliers: true` for cleaner chart data
- Enable `dynamicPools` for better pool selection
- Use appropriate timeframes for your use case

### Rate Limiting
- Monitor your API credits with `getCredits()`
- Implement exponential backoff for rate limit errors
- Use batch endpoints to reduce API calls
- Cache responses when appropriate
