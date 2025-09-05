const { ref, get, set, push, update, remove, query, orderByChild, orderByKey, limitToLast, equalTo, runTransaction } = require('firebase/database');
const { database } = require('../config/firebase');

class FirebaseService {
  constructor() {
    this.db = database;
  }

  // Calls methods
  async getAllActiveCalls() {
    try {
      const callsRef = ref(this.db, 'calls');
      const snapshot = await get(callsRef);
      
      if (snapshot.exists()) {
        const calls = [];
        snapshot.forEach((childSnapshot) => {
          const call = { id: childSnapshot.key, ...childSnapshot.val() };
          calls.push(call);
        });
        return calls;
      }
      return [];
    } catch (error) {
      console.error('Error getting all active calls:', error);
      return [];
    }
  }

  async getCallsByUser(userId) {
    try {
      const callsRef = ref(this.db, 'calls');
      const userCallsQuery = query(callsRef, orderByChild('userId'), equalTo(userId));
      const snapshot = await get(userCallsQuery);
      
      if (snapshot.exists()) {
        const calls = [];
        snapshot.forEach((childSnapshot) => {
          const call = { id: childSnapshot.key, ...childSnapshot.val() };
          calls.push(call);
        });
        return calls;
      }
      return [];
    } catch (error) {
      console.error('Error getting calls by user:', error);
      return [];
    }
  }

  async findCallByContractAddress(contractAddress) {
    try {
      const callsRef = ref(this.db, 'calls');
      const contractQuery = query(callsRef, orderByChild('contractAddress'), equalTo(contractAddress));
      const snapshot = await get(contractQuery);
      
      if (snapshot.exists()) {
        let call = null;
        snapshot.forEach((childSnapshot) => {
          call = { id: childSnapshot.key, ...childSnapshot.val() };
        });
        return call;
      }
      return null;
    } catch (error) {
      console.error('Error finding call by contract address:', error);
      return null;
    }
  }

  async createCall(callData) {
    try {
      const callsRef = ref(this.db, 'calls');
      const newCallRef = push(callsRef);
      const callId = newCallRef.key;
      
      const callWithId = {
        ...callData,
        id: callId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      await set(newCallRef, callWithId);
      return callWithId;
    } catch (error) {
      console.error('Error creating call:', error);
      throw error;
    }
  }

  async updateCall(callId, updateData) {
    try {
      const callRef = ref(this.db, `calls/${callId}`);
      const updates = {
        ...updateData,
        updatedAt: new Date().toISOString()
      };
      
      await update(callRef, updates);
      return true;
    } catch (error) {
      console.error('Error updating call:', error);
      throw error;
    }
  }

  async deleteCall(callId) {
    try {
      const callRef = ref(this.db, `calls/${callId}`);
      await remove(callRef);
      return true;
    } catch (error) {
      console.error('Error deleting call:', error);
      throw error;
    }
  }

  // Leaderboard methods
  async getLeaderboard() {
    try {
      const usersRef = ref(this.db, 'users');
      const snapshot = await get(usersRef);
      
      if (snapshot.exists()) {
        const users = [];
        snapshot.forEach((childSnapshot) => {
          const user = { id: childSnapshot.key, ...childSnapshot.val() };
          users.push(user);
        });
        
        // Sort by total score descending
        return users.sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));
      }
      return [];
    } catch (error) {
      console.error('Error getting leaderboard:', error);
      return [];
    }
  }

  // Token methods
  async findTokenByContractAddress(contractAddress) {
    try {
      const tokensRef = ref(this.db, 'tokens');
      const tokenQuery = query(tokensRef, orderByChild('contractAddress'), equalTo(contractAddress));
      const snapshot = await get(tokenQuery);
      
      if (snapshot.exists()) {
        let token = null;
        snapshot.forEach((childSnapshot) => {
          token = { id: childSnapshot.key, ...childSnapshot.val() };
        });
        return token;
      }
      return null;
    } catch (error) {
      console.error('Error finding token by contract address:', error);
      return null;
    }
  }

  async getLatestTokens(limit = 50) {
    try {
      const tokensRef = ref(this.db, 'tokens');
      const latestTokensQuery = query(tokensRef, orderByKey(), limitToLast(limit));
      const snapshot = await get(latestTokensQuery);
      
      if (snapshot.exists()) {
        const tokens = [];
        snapshot.forEach((childSnapshot) => {
          const token = { id: childSnapshot.key, ...childSnapshot.val() };
          tokens.push(token);
        });
        return tokens.reverse(); // Reverse to get newest first
      }
      return [];
    } catch (error) {
      console.error('Error getting latest tokens:', error);
      return [];
    }
  }

  async createOrUpdateToken(tokenData) {
    try {
      const tokensRef = ref(this.db, 'tokens');
      const tokenQuery = query(tokensRef, orderByChild('contractAddress'), equalTo(tokenData.contractAddress));
      const snapshot = await get(tokenQuery);
      
      if (snapshot.exists()) {
        // Update existing token
        let tokenId = null;
        snapshot.forEach((childSnapshot) => {
          tokenId = childSnapshot.key;
        });
        
        if (tokenId) {
          const tokenRef = ref(this.db, `tokens/${tokenId}`);
          await update(tokenRef, {
            ...tokenData,
            updatedAt: new Date().toISOString()
          });
          return { id: tokenId, ...tokenData };
        }
      } else {
        // Create new token
        const newTokenRef = push(tokensRef);
        const tokenId = newTokenRef.key;
        
        const tokenWithId = {
          ...tokenData,
          id: tokenId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        
        await set(newTokenRef, tokenWithId);
        return tokenWithId;
      }
    } catch (error) {
      console.error('Error creating or updating token:', error);
      throw error;
    }
  }

  // User methods
  async createOrUpdateUser(userData) {
    try {
      const usersRef = ref(this.db, 'users');
      const userQuery = query(usersRef, orderByChild('telegramId'), equalTo(userData.telegramId));
      const snapshot = await get(userQuery);
      
      if (snapshot.exists()) {
        // Update existing user
        let userId = null;
        snapshot.forEach((childSnapshot) => {
          userId = childSnapshot.key;
        });
        
        if (userId) {
          const userRef = ref(this.db, `users/${userId}`);
          await update(userRef, {
            ...userData,
            updatedAt: new Date().toISOString()
          });
          return { id: userId, ...userData };
        }
      } else {
        // Create new user
        const newUserRef = push(usersRef);
        const userId = newUserRef.key;
        
        const userWithId = {
          ...userData,
          id: userId,
          totalCalls: 0,
          successfulCalls: 0,
          totalScore: 0,
          avgPnL: 0,
          bestCall: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        
        await set(newUserRef, userWithId);
        return userWithId;
      }
    } catch (error) {
      console.error('Error creating or updating user:', error);
      throw error;
    }
  }

  async updateUser(userId, updateData) {
    try {
      const userRef = ref(this.db, `users/${userId}`);
      const updates = {
        ...updateData,
        updatedAt: new Date().toISOString()
      };
      
      await update(userRef, updates);
      return true;
    } catch (error) {
      console.error('Error updating user:', error);
      throw error;
    }
  }

  // Chat methods
  async createOrUpdateChat(chatData) {
    try {
      const chatsRef = ref(this.db, 'chats');
      const chatQuery = query(chatsRef, orderByChild('telegramId'), equalTo(chatData.telegramId));
      const snapshot = await get(chatQuery);
      
      if (snapshot.exists()) {
        // Update existing chat
        let chatId = null;
        snapshot.forEach((childSnapshot) => {
          chatId = childSnapshot.key;
        });
        
        if (chatId) {
          const chatRef = ref(this.db, `chats/${chatId}`);
          await update(chatRef, {
            ...chatData,
            updatedAt: new Date().toISOString()
          });
          return { id: chatId, ...chatData };
        }
      } else {
        // Create new chat
        const newChatRef = push(chatsRef);
        const chatId = newChatRef.key;
        
        const chatWithId = {
          ...chatData,
          id: chatId,
          callsCount: 0,
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        
        await set(newChatRef, chatWithId);
        return chatWithId;
      }
    } catch (error) {
      console.error('Error creating or updating chat:', error);
      throw error;
    }
  }

  // Stats methods
  async getTotalCalls() {
    try {
      const callsRef = ref(this.db, 'calls');
      const snapshot = await get(callsRef);
      return snapshot.exists() ? snapshot.size : 0;
    } catch (error) {
      console.error('Error getting total calls:', error);
      return 0;
    }
  }

  async getActiveCallsCount() {
    try {
      const calls = await this.getAllActiveCalls();
      return calls.length;
    } catch (error) {
      console.error('Error getting active calls count:', error);
      return 0;
    }
  }

  async getTotalUsers() {
    try {
      const usersRef = ref(this.db, 'users');
      const snapshot = await get(usersRef);
      return snapshot.exists() ? snapshot.size : 0;
    } catch (error) {
      console.error('Error getting total users:', error);
      return 0;
    }
  }

  async getTotalTokens() {
    try {
      const tokensRef = ref(this.db, 'tokens');
      const snapshot = await get(tokensRef);
      return snapshot.exists() ? snapshot.size : 0;
    } catch (error) {
      console.error('Error getting total tokens:', error);
      return 0;
    }
  }

  async getTotalVolume() {
    try {
      const calls = await this.getAllActiveCalls();
      return calls.reduce((total, call) => {
        return total + (parseFloat(call.entryMarketCap) || 0);
      }, 0);
    } catch (error) {
      console.error('Error getting total volume:', error);
      return 0;
    }
  }

  async getAveragePnL() {
    try {
      const calls = await this.getAllActiveCalls();
      if (calls.length === 0) return 0;
      
      const totalPnL = calls.reduce((total, call) => {
        return total + (parseFloat(call.pnlPercent) || 0);
      }, 0);
      
      return totalPnL / calls.length;
    } catch (error) {
      console.error('Error getting average PnL:', error);
      return 0;
    }
  }

  // Generic Firebase operations
  async set(path, data) {
    try {
      const refPath = ref(this.db, path);
      await set(refPath, data);
      return true;
    } catch (error) {
      console.error('Error setting data:', error);
      return false;
    }
  }

  async get(path) {
    try {
      const refPath = ref(this.db, path);
      const snapshot = await get(refPath);
      return snapshot.exists() ? snapshot.val() : null;
    } catch (error) {
      console.error('Error getting data:', error);
      return null;
    }
  }

  async update(path, data) {
    try {
      const refPath = ref(this.db, path);
      await update(refPath, data);
      return true;
    } catch (error) {
      console.error('Error updating data:', error);
      return false;
    }
  }

  async remove(path) {
    try {
      const refPath = ref(this.db, path);
      await remove(refPath);
      return true;
    } catch (error) {
      console.error('Error removing data:', error);
      return false;
    }
  }

  // Transaction support
  async transaction(path, updateFunction) {
    try {
      const refPath = ref(this.db, path);
      const result = await runTransaction(refPath, updateFunction);
      return result;
    } catch (error) {
      console.error('Error in transaction:', error);
      return null;
    }
  }
}

module.exports = FirebaseService;
