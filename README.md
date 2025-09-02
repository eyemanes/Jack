# Solana Tracker API

## 🚀 Firebase-Powered API for Solana Token Tracking

This API provides real-time data for the Solana Tracker frontend, connecting directly to Firebase Realtime Database.

## 📊 Features

- **Real-time Token Calls**: Track and monitor Solana token calls
- **User Leaderboard**: Rank users by performance and score
- **Live Statistics**: Get comprehensive stats on calls, users, and tokens
- **Firebase Integration**: Direct connection to Firebase Realtime Database

## 🔥 API Endpoints

### Calls
- `GET /api/calls` - Get all active token calls
- `GET /api/calls/user/:userId` - Get calls by specific user
- `POST /api/refresh/:contractAddress` - Refresh token data

### Leaderboard
- `GET /api/leaderboard` - Get user leaderboard ranked by score

### Statistics
- `GET /api/health` - Get API health and Firebase stats
- `GET /api/stats` - Get comprehensive statistics

## 🛠️ Setup

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Environment Variables**
   Set these in your Vercel dashboard:
   - `FIREBASE_API_KEY`
   - `FIREBASE_AUTH_DOMAIN`
   - `FIREBASE_DATABASE_URL`
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_STORAGE_BUCKET`
   - `FIREBASE_MESSAGING_SENDER_ID`
   - `FIREBASE_APP_ID`

3. **Deploy to Vercel**
   ```bash
   vercel --prod
   ```

## 🔥 Firebase Structure

```
firebase-database/
├── calls/
│   ├── {callId}/
│   │   ├── contractAddress
│   │   ├── tokenName
│   │   ├── tokenSymbol
│   │   ├── userId
│   │   ├── entryPrice
│   │   ├── currentPrice
│   │   ├── pnlPercent
│   │   └── score
├── users/
│   ├── {userId}/
│   │   ├── telegramId
│   │   ├── username
│   │   ├── totalCalls
│   │   ├── totalScore
│   │   └── avgPnL
├── tokens/
│   ├── {tokenId}/
│   │   ├── contractAddress
│   │   ├── name
│   │   ├── symbol
│   │   ├── price
│   │   └── marketCap
└── chats/
    └── {chatId}/
        ├── telegramId
        ├── title
        └── type
```

## 🚀 Recent Updates

- ✅ **Firebase Integration**: Complete Firebase Realtime Database connection
- ✅ **Real-time Data**: Live token calls and user statistics
- ✅ **CORS Support**: Full CORS headers for frontend integration
- ✅ **Error Handling**: Comprehensive error handling and logging
- ✅ **Data Transformation**: Proper data formatting for frontend consumption

## 📱 Frontend Integration

The API is designed to work seamlessly with the React frontend:

```javascript
// Fetch active calls
const response = await fetch('https://jack-alpha.vercel.app/api/calls');
const data = await response.json();

// Get leaderboard
const leaderboard = await fetch('https://jack-alpha.vercel.app/api/leaderboard');

// Check health
const health = await fetch('https://jack-alpha.vercel.app/api/health');
```

## 🔧 Development

```bash
# Install dependencies
npm install

# Run locally (requires Firebase config)
npm run dev

# Deploy to Vercel
vercel --prod
```

## 📊 Data Flow

1. **Telegram Bot** → Creates calls in Firebase
2. **API** → Reads from Firebase and transforms data
3. **Frontend** → Consumes API and displays real-time data

## 🎯 Performance

- **Real-time Updates**: Firebase Realtime Database
- **Fast Response**: Optimized queries and data transformation
- **Scalable**: Serverless Vercel deployment
- **Reliable**: Comprehensive error handling

---

**🐙 Jack Ace of Scans - Track your calls, climb the leaderboard!**
