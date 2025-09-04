require('dotenv').config();
const { ref, get } = require('firebase/database');
const { database } = require('./config/firebase');

async function testFirebaseConnection() {
  console.log('🔍 Testing Firebase connection...');
  
  try {
    // Test basic connection
    const testRef = ref(database, 'test');
    console.log('✅ Firebase connection initialized');
    
    // Check calls collection
    console.log('\n📊 Checking calls collection...');
    const callsRef = ref(database, 'calls');
    const callsSnapshot = await get(callsRef);
    
    if (callsSnapshot.exists()) {
      console.log(`✅ Calls collection exists with ${callsSnapshot.size} records`);
      
      // Show first few calls
      const calls = [];
      callsSnapshot.forEach((childSnapshot) => {
        const call = { id: childSnapshot.key, ...childSnapshot.val() };
        calls.push(call);
      });
      
      console.log('\n📋 First 3 calls:');
      calls.slice(0, 3).forEach((call, index) => {
        console.log(`${index + 1}. ID: ${call.id}`);
        console.log(`   Contract: ${call.contractAddress}`);
        console.log(`   Token: ${call.tokenSymbol} (${call.tokenName})`);
        console.log(`   User: ${call.username || 'Unknown'}`);
        console.log(`   PnL: ${call.pnlPercent || 0}%`);
        console.log(`   Created: ${call.createdAt}`);
        console.log('   ---');
      });
    } else {
      console.log('❌ Calls collection is empty or does not exist');
    }
    
    // Check tokens collection
    console.log('\n🪙 Checking tokens collection...');
    const tokensRef = ref(database, 'tokens');
    const tokensSnapshot = await get(tokensRef);
    
    if (tokensSnapshot.exists()) {
      console.log(`✅ Tokens collection exists with ${tokensSnapshot.size} records`);
    } else {
      console.log('❌ Tokens collection is empty or does not exist');
    }
    
    // Check users collection
    console.log('\n👥 Checking users collection...');
    const usersRef = ref(database, 'users');
    const usersSnapshot = await get(usersRef);
    
    if (usersSnapshot.exists()) {
      console.log(`✅ Users collection exists with ${usersSnapshot.size} records`);
    } else {
      console.log('❌ Users collection is empty or does not exist');
    }
    
    // Check linkingCodes collection
    console.log('\n🔗 Checking linkingCodes collection...');
    const linkingRef = ref(database, 'linkingCodes');
    const linkingSnapshot = await get(linkingRef);
    
    if (linkingSnapshot.exists()) {
      console.log(`✅ LinkingCodes collection exists with ${linkingSnapshot.size} records`);
    } else {
      console.log('❌ LinkingCodes collection is empty or does not exist');
    }
    
  } catch (error) {
    console.error('❌ Firebase connection failed:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      stack: error.stack
    });
  }
}

testFirebaseConnection();
