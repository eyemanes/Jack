# Token Call PnL Backend

A production-ready Token Call PnL backend service built with Phanes-style logic for tracking token call performance. This system efficiently handles 100-200 token calls per day per group with real-time updates and milestone tracking.

## 🚀 Features

- **Phanes-style Logic**: Tracks token call performance with milestone locking
- **Firebase Realtime Database**: Single source of truth with live updates
- **Solana Tracker Integration**: Real-time price and market cap data
- **Batch Processing**: Efficient refresh of 100-200 calls per day
- **Milestone Tracking**: 2x, 5x, 10x, 25x, 50x, 100x multipliers
- **ATH Protection**: Ignores peaks before call timestamp
- **Fallback Support**: Price-based tracking when market cap unavailable
- **Vercel Ready**: Deployable on serverless functions

## 📋 Core Logic

### Call Creation
When a user calls a token in a Telegram group:
1. Lock in entry point at exact moment (price and market cap)
2. If market cap unavailable, fallback to price × circulating supply
3. Store call data with timestamp and caller information

### Progress Tracking
After the call:
1. Track max multiplier based on market cap (preferred) or price (fallback)
2. If token crosses milestones (2x, 5x, 10x, etc.), lock them forever
3. Ignore any ATH or peaks before the call timestamp
4. Update progress in real-time

### Milestone Locking
- When a milestone is hit: `{ hit: true, ts: now }` - never unset
- Milestones are locked even if token later dumps
- Fair scoring by ignoring pre-call ATH

## 🏗️ Architecture

```
Jack/
├── lib/
│   ├── firebase.js          # Firebase admin setup
│   ├── solanaTracker.js     # Solana Tracker API client
│   └── refreshEngine.js     # Batch refresh logic
├── api/
│   ├── calls.js             # Call management
│   ├── refresh.js           # Refresh operations
│   ├── leaderboard.js       # Leaderboard functionality
│   └── dev/
│       └── simulate.js      # Test scenarios
├── server.js                # Main server
├── vercel.json             # Vercel deployment config
└── firebase-database-rules.json
```

## 🗄️ Database Structure

### Firebase Realtime Database

```json
{
  "calls": {
    "{callId}": {
      "token": "string",
      "callerId": "string", 
      "groupId": "string",
      "tsCall": "number",
      "basis": "marketCap" | "price",
      "entry": {
        "price": "number",
        "marketCap": "number | null"
      },
      "progress": {
        "max": {
          "price": "number | null",
          "marketCap": "number | null", 
          "ts": "number | null"
        },
        "multiplier": "number"
      },
      "milestones": {
        "x2": { "hit": "boolean", "ts": "number" },
        "x5": { "hit": "boolean", "ts": "number" },
        "x10": { "hit": "boolean", "ts": "number" },
        "x25": { "hit": "boolean", "ts": "number" },
        "x50": { "hit": "boolean", "ts": "number" },
        "x100": { "hit": "boolean", "ts": "number" }
      },
      "status": "active" | "finalized",
      "updatedAt": "number"
    }
  },
  "callIndexByToken": {
    "{token}": {
      "{callId}": true
    }
  },
  "callIndexByGroup": {
    "{groupId}": {
      "{callId}": true
    }
  },
  "callerStats": {
    "{callerId}": {
      "totals": {
        "calls": "number",
        "x2": "number",
        "x5": "number", 
        "x10": "number",
        "x25": "number",
        "x50": "number",
        "x100": "number"
      },
      "bestMultiplier": "number",
      "lastUpdated": "number"
    }
  }
}
```

## 🚀 Quick Start

### 1. Clone and Install

```bash
cd Jack
npm install
```

### 2. Environment Setup

Copy `env.example` to `.env` and configure:

```bash
cp env.example .env
```

Required environment variables:
- `FIREBASE_PROJECT_ID`: Your Firebase project ID
- `FIREBASE_DATABASE_URL`: Your Firebase Realtime Database URL
- `FIREBASE_SERVICE_ACCOUNT_KEY`: Firebase service account JSON (or individual fields)
- `SOLANA_TRACKER_API_KEY`: Your Solana Tracker API key

### 3. Firebase Setup

1. Create a Firebase project
2. Enable Realtime Database
3. Create a service account and download the key
4. Set up database rules (use `firebase-database-rules.json`)

### 4. Run Development Server

```bash
npm run dev
```

Server will start at `http://localhost:3001`

## 📡 API Endpoints

### Call Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/calls` | Create new call entry |
| GET | `/api/calls/:id` | Get call by ID |
| GET | `/api/token/:token/calls` | Get calls by token |
| GET | `/api/group/:groupId/calls` | Get calls by group |
| PUT | `/api/calls/:id` | Update call data |
| DELETE | `/api/calls/:id` | Delete call |

### Refresh Operations

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/refresh` | Refresh all active calls |
| POST | `/api/refresh/:callId` | Refresh specific call |
| GET | `/api/refresh/status` | Get refresh status |
| POST | `/api/refresh/start` | Start auto-refresh |
| POST | `/api/refresh/stop` | Stop auto-refresh |
| POST | `/api/refresh/tokens` | Refresh specific tokens |

### Leaderboards

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/leaderboard` | Get leaderboard data |
| GET | `/api/caller/:callerId/stats` | Get caller statistics |
| GET | `/api/callers` | Get all caller stats |
| GET | `/api/group/:groupId/stats` | Get group statistics |

### Development

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/dev/simulate` | Run test scenarios |
| POST | `/api/dev/cleanup` | Clean up test data |
| GET | `/api/dev/simulate-ath` | Run ATH backfill test scenarios |
| POST | `/api/dev/cleanup-ath` | Clean up ATH test data |

### Admin (Protected)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/admin/backfill-ath` | Start ATH backfill migration |
| GET | `/api/admin/backfill-ath/status` | Get backfill run status |
| GET | `/api/admin/backfill-ath/runs` | List all backfill runs |
| POST | `/api/admin/backfill-ath/cleanup` | Clean up old backfill runs |

## 🧪 Testing

### Run Test Scenarios

```bash
# Test all scenarios
curl http://localhost:3001/api/dev/simulate

# Test specific scenario
curl "http://localhost:3001/api/dev/simulate?scenario=ath_before_call"
```

Available scenarios:
- `ath_before_call`: ATH before call (should be ignored)
- `hit_2x_dump`: Hit 2x then dump (milestone locked)
- `flat_token`: Flat token (no milestones)
- `price_fallback`: Price fallback mode
- `milestone_progression`: Multiple milestones

### ATH Backfill Testing

```bash
# Test ATH backfill scenarios
curl http://localhost:3001/api/dev/simulate-ath

# Test specific ATH scenario
curl "http://localhost:3001/api/dev/simulate-ath?scenario=ath_after_call"
```

Available ATH scenarios:
- `ath_after_call`: ATH after call (should use ATH)
- `ath_before_call`: ATH before call (should use local high)
- `no_marketcap`: No market cap (price fallback)
- `milestone_progression`: Multiple milestones from ATH

### Clean Up Test Data

```bash
# Clean up regular test data
curl -X POST http://localhost:3001/api/dev/cleanup

# Clean up ATH test data
curl -X POST http://localhost:3001/api/dev/cleanup-ath
```

## 🔄 ATH Backfill Migration

### Overview

The ATH backfill system fixes older calls where PnL might be wrong because they relied on live highs instead of validating whether the global ATH actually happened after the call.

### New Rule

If the token's global ATH timestamp is ≥ tsCall, set the post-call max to ATH (prefer marketCap), otherwise compute the local post-call high from tsCall → now.

### Running Backfill

```bash
# Start backfill (requires admin secret)
curl -X POST http://localhost:3001/api/admin/backfill-ath \
  -H "x-admin-secret: your-admin-secret" \
  -H "Content-Type: application/json" \
  -d '{
    "groupId": "optional",
    "token": "optional", 
    "fromTs": 1640995200,
    "toTs": 1672531200,
    "limit": 500,
    "dryRun": false
  }'

# Check status
curl "http://localhost:3001/api/admin/backfill-ath/status?runId=20240101-120000" \
  -H "x-admin-secret: your-admin-secret"

# List all runs
curl "http://localhost:3001/api/admin/backfill-ath/runs" \
  -H "x-admin-secret: your-admin-secret"
```

### Backfill Features

- **Idempotent**: Only increases max values, never decreases
- **Audit Trail**: Records migration details in `/_migrations/{runId}`
- **Pagination**: Processes calls in batches to avoid timeouts
- **Dry Run**: Test without making changes
- **Rate Limiting**: Handles Solana Tracker API limits gracefully
- **Milestone Locking**: Locks milestones on first cross, never unsets

## 🚀 Deployment

### Vercel Deployment

1. Install Vercel CLI:
```bash
npm i -g vercel
```

2. Deploy:
```bash
vercel --prod
```

3. Set environment variables in Vercel dashboard

### Manual Deployment

1. Set `NODE_ENV=production`
2. Deploy `server.js` to your preferred platform
3. Configure environment variables

## ⚡ Performance

- **Batch Processing**: Handles 100-200 calls per day efficiently
- **Rate Limiting**: Built-in Solana Tracker API rate limit handling
- **Caching**: 60-120 second cache for chart data
- **Real-time Updates**: Firebase Realtime Database for live syncing
- **Auto-refresh**: 30-60 second intervals in production

## 🔧 Configuration

### Refresh Interval

Set `REFRESH_INTERVAL` environment variable (default: 30000ms):

```bash
REFRESH_INTERVAL=60000  # 1 minute
```

### Firebase Rules

Import `firebase-database-rules.json` to your Firebase project for proper security.

## 📊 Monitoring

### Health Check

```bash
curl http://localhost:3001/api/health
```

### Refresh Status

```bash
curl http://localhost:3001/api/refresh/status
```

## 🐛 Troubleshooting

### Common Issues

1. **Firebase Authentication**: Ensure service account key is properly configured
2. **Rate Limiting**: Check Solana Tracker API key and limits
3. **Database Rules**: Verify Firebase rules are properly set
4. **Environment Variables**: Ensure all required variables are set

### Logs

Check console output for detailed error messages and processing logs.

## 📝 License

MIT License - see LICENSE file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📞 Support

For issues and questions:
1. Check the troubleshooting section
2. Review API documentation
3. Run test scenarios to verify functionality
4. Check Firebase and Solana Tracker API status