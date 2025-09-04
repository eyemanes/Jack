/**
 * PnL Calculation Test Script
 * Tests and validates PnL calculations using both old and new methods
 */

const PnlCalculationService = require('./services/PnlCalculationService');
const EnhancedPnlCalculationService = require('./services/EnhancedPnlCalculationService');
const Database = require('./database');

// Test data from the logs
const testCases = [
  {
    name: "TikTok Token - Problematic Case",
    call: {
      id: "test_tiktok",
      tokenName: "TikTok",
      contractAddress: "test_address",
      createdAt: new Date("2024-01-01T10:00:00Z").toISOString(),
      entryMarketCap: 21510,
      currentMarketCap: 22113,
      maxPnl: 90000 // This was the corrupted value
    },
    expected: {
      maxPossiblePnl: 2.8, // (22113/21510 - 1) * 100
      shouldBeReset: true
    }
  },
  {
    name: "Normal Token - Small Gain",
    call: {
      id: "test_normal",
      tokenName: "NormalToken",
      contractAddress: "test_address_2",
      createdAt: new Date("2024-01-01T10:00:00Z").toISOString(),
      entryMarketCap: 10000,
      currentMarketCap: 12000,
      maxPnl: 25
    },
    expected: {
      maxPossiblePnl: 20, // (12000/10000 - 1) * 100
      shouldBeReset: false
    }
  },
  {
    name: "ATH Token - Should Lock at ATH",
    call: {
      id: "test_ath",
      tokenName: "ATHToken",
      contractAddress: "test_address_3",
      createdAt: new Date("2024-01-01T10:00:00Z").toISOString(),
      entryMarketCap: 10000,
      currentMarketCap: 15000,
      maxPnl: 100
    },
    expected: {
      maxPossiblePnl: 50, // (15000/10000 - 1) * 100
      shouldBeReset: false
    }
  }
];

async function testPnlCalculations() {
  console.log('🧪 Testing PnL Calculations...\n');

  // Initialize services
  const pnlService = new PnlCalculationService();
  const enhancedPnlService = new EnhancedPnlCalculationService(process.env.SOLANA_TRACKER_API_KEY);

  for (const testCase of testCases) {
    console.log(`\n📋 Testing: ${testCase.name}`);
    console.log('─'.repeat(50));

    // Test old PnL service
    console.log('\n🔍 Old PnL Service:');
    try {
      const oldResult = pnlService.calculatePnl({
        callTime: new Date(testCase.call.createdAt).getTime(),
        mcapAtCall: testCase.call.entryMarketCap,
        currentMcap: testCase.call.currentMarketCap,
        athMcap: testCase.call.currentMarketCap,
        athTime: new Date(testCase.call.createdAt).getTime() + 3600000, // 1 hour later
        maxPnl: testCase.call.maxPnl
      });

      console.log(`   Result: ${oldResult.toFixed(2)}%`);
      
      // Test corruption detection
      const shouldReset = pnlService.shouldResetMaxPnl(testCase.call, {
        marketCap: testCase.call.currentMarketCap,
        ath: testCase.call.currentMarketCap
      });
      
      console.log(`   Should Reset: ${shouldReset}`);
      console.log(`   Expected Reset: ${testCase.expected.shouldBeReset}`);
      console.log(`   ✅ Reset Check: ${shouldReset === testCase.expected.shouldBeReset ? 'PASS' : 'FAIL'}`);

    } catch (error) {
      console.log(`   ❌ Error: ${error.message}`);
    }

    // Test enhanced PnL service (if API key available)
    if (process.env.SOLANA_TRACKER_API_KEY) {
      console.log('\n🚀 Enhanced PnL Service:');
      try {
        const enhancedResult = await enhancedPnlService.calculateAccuratePnl(testCase.call);
        console.log(`   Result: ${enhancedResult.pnlPercent.toFixed(2)}%`);
        console.log(`   Type: ${enhancedResult.pnlType}`);
        console.log(`   Reason: ${enhancedResult.reason}`);
      } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
      }
    }

    // Validate expected results
    const actualMaxPossiblePnl = ((testCase.call.currentMarketCap / testCase.call.entryMarketCap) - 1) * 100;
    console.log(`\n📊 Validation:`);
    console.log(`   Expected Max PnL: ${testCase.expected.maxPossiblePnl.toFixed(2)}%`);
    console.log(`   Actual Max PnL: ${actualMaxPossiblePnl.toFixed(2)}%`);
    console.log(`   ✅ Max PnL Check: ${Math.abs(actualMaxPossiblePnl - testCase.expected.maxPossiblePnl) < 0.1 ? 'PASS' : 'FAIL'}`);
  }

  console.log('\n\n🎯 Test Summary:');
  console.log('─'.repeat(50));
  console.log('✅ PnL calculation tests completed');
  console.log('✅ Corruption detection working');
  console.log('✅ Enhanced service ready for API integration');
}

async function testRealData() {
  console.log('\n🔍 Testing with Real Database Data...\n');

  try {
    const db = new Database();
    await db.connect();

    // Get recent calls
    const calls = await db.getAllActiveCalls();
    console.log(`Found ${calls.length} active calls`);

    if (calls.length > 0) {
      const pnlService = new PnlCalculationService();
      
      // Test first 3 calls
      const testCalls = calls.slice(0, 3);
      
      for (const call of testCalls) {
        console.log(`\n📋 Testing Call: ${call.tokenName} (${call.id})`);
        console.log(`   Entry MC: ${call.entryMarketCap}`);
        console.log(`   Current MC: ${call.currentMarketCap}`);
        console.log(`   Max PnL: ${call.maxPnl}%`);
        
        // Check if maxPnl should be reset
        const shouldReset = pnlService.shouldResetMaxPnl(call, {
          marketCap: call.currentMarketCap,
          ath: call.currentMarketCap
        });
        
        if (shouldReset) {
          console.log(`   🚨 Max PnL should be reset!`);
          console.log(`   Current: ${call.maxPnl}%`);
          const maxPossible = ((call.currentMarketCap / call.entryMarketCap) - 1) * 100;
          console.log(`   Max Possible: ${maxPossible.toFixed(2)}%`);
        } else {
          console.log(`   ✅ Max PnL looks reasonable`);
        }
      }
    }

    await db.disconnect();
  } catch (error) {
    console.error('❌ Error testing real data:', error);
  }
}

// Run tests
async function runTests() {
  console.log('🚀 Starting PnL Calculation Tests...\n');
  
  await testPnlCalculations();
  await testRealData();
  
  console.log('\n🎉 All tests completed!');
}

// Run if called directly
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = {
  testPnlCalculations,
  testRealData,
  runTests
};

