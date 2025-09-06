const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY 
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
    : {
        type: "service_account",
        project_id: process.env.FIREBASE_PROJECT_ID || "jacky-b501a",
        private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
        private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        client_id: process.env.FIREBASE_CLIENT_ID,
        auth_uri: "https://accounts.google.com/o/oauth2/auth",
        token_uri: "https://oauth2.googleapis.com/token",
        auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
        client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL
      };

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL || "https://jacky-b501a-default-rtdb.europe-west1.firebasedatabase.app"
  });
}

const db = admin.database();

class FirebaseService {
  constructor() {
    this.db = db;
  }

  // Call management methods
  async createCall(callData) {
    try {
      const callId = this.db.ref('calls').push().key;
      const call = {
        ...callData,
        id: callId,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      // Create call entry
      await this.db.ref(`calls/${callId}`).set(call);

      // Create indexes
      await this.db.ref(`callIndexByToken/${callData.token}/${callId}`).set(true);
      await this.db.ref(`callIndexByGroup/${callData.groupId}/${callId}`).set(true);

      return call;
    } catch (error) {
      console.error('Error creating call:', error);
      throw error;
    }
  }

  async getCall(callId) {
    try {
      const snapshot = await this.db.ref(`calls/${callId}`).once('value');
      return snapshot.val();
    } catch (error) {
      console.error('Error getting call:', error);
      return null;
    }
  }

  async updateCall(callId, updateData) {
    try {
      const updates = {
        ...updateData,
        updatedAt: Date.now()
      };
      await this.db.ref(`calls/${callId}`).update(updates);
      return true;
    } catch (error) {
      console.error('Error updating call:', error);
      throw error;
    }
  }

  async getActiveCalls() {
    try {
      const snapshot = await this.db.ref('calls')
        .orderByChild('status')
        .equalTo('active')
        .once('value');
      
      const calls = [];
      snapshot.forEach((childSnapshot) => {
        calls.push({ id: childSnapshot.key, ...childSnapshot.val() });
      });
      return calls;
    } catch (error) {
      console.error('Error getting active calls:', error);
      return [];
    }
  }

  async getCallsByToken(token) {
    try {
      const snapshot = await this.db.ref(`callIndexByToken/${token}`).once('value');
      if (!snapshot.exists()) return [];

      const callIds = Object.keys(snapshot.val());
      const calls = [];
      
      for (const callId of callIds) {
        const call = await this.getCall(callId);
        if (call) calls.push(call);
      }
      
      return calls;
    } catch (error) {
      console.error('Error getting calls by token:', error);
      return [];
    }
  }

  async getCallsByGroup(groupId) {
    try {
      const snapshot = await this.db.ref(`callIndexByGroup/${groupId}`).once('value');
      if (!snapshot.exists()) return [];

      const callIds = Object.keys(snapshot.val());
      const calls = [];
      
      for (const callId of callIds) {
        const call = await this.getCall(callId);
        if (call) calls.push(call);
      }
      
      return calls;
    } catch (error) {
      console.error('Error getting calls by group:', error);
      return [];
    }
  }

  // Caller stats management
  async updateCallerStats(callerId, stats) {
    try {
      const updates = {
        ...stats,
        lastUpdated: Date.now()
      };
      await this.db.ref(`callerStats/${callerId}`).update(updates);
      return true;
    } catch (error) {
      console.error('Error updating caller stats:', error);
      throw error;
    }
  }

  async getCallerStats(callerId) {
    try {
      const snapshot = await this.db.ref(`callerStats/${callerId}`).once('value');
      return snapshot.val() || {
        totals: { calls: 0, x2: 0, x5: 0, x10: 0, x25: 0, x50: 0, x100: 0 },
        bestMultiplier: 0,
        lastUpdated: 0
      };
    } catch (error) {
      console.error('Error getting caller stats:', error);
      return {
        totals: { calls: 0, x2: 0, x5: 0, x10: 0, x25: 0, x50: 0, x100: 0 },
        bestMultiplier: 0,
        lastUpdated: 0
      };
    }
  }

  async getAllCallerStats() {
    try {
      const snapshot = await this.db.ref('callerStats').once('value');
      const stats = [];
      snapshot.forEach((childSnapshot) => {
        stats.push({ callerId: childSnapshot.key, ...childSnapshot.val() });
      });
      return stats;
    } catch (error) {
      console.error('Error getting all caller stats:', error);
      return [];
    }
  }

  // Batch operations for refresh
  async batchUpdateCalls(updates) {
    try {
      const batch = {};
      for (const [callId, updateData] of Object.entries(updates)) {
        batch[`calls/${callId}`] = {
          ...updateData,
          updatedAt: Date.now()
        };
      }
      await this.db.ref().update(batch);
      return true;
    } catch (error) {
      console.error('Error batch updating calls:', error);
      throw error;
    }
  }

  // Generic database operations
  async set(path, data) {
    try {
      await this.db.ref(path).set(data);
      return true;
    } catch (error) {
      console.error('Error setting data:', error);
      return false;
    }
  }

  async get(path) {
    try {
      const snapshot = await this.db.ref(path).once('value');
      return snapshot.val();
    } catch (error) {
      console.error('Error getting data:', error);
      return null;
    }
  }

  async update(path, data) {
    try {
      await this.db.ref(path).update(data);
      return true;
    } catch (error) {
      console.error('Error updating data:', error);
      return false;
    }
  }

  async remove(path) {
    try {
      await this.db.ref(path).remove();
      return true;
    } catch (error) {
      console.error('Error removing data:', error);
      return false;
    }
  }

  // Transaction support
  async transaction(path, updateFunction) {
    try {
      const result = await this.db.ref(path).transaction(updateFunction);
      return result;
    } catch (error) {
      console.error('Error in transaction:', error);
      return null;
    }
  }
}

module.exports = { FirebaseService, db };
