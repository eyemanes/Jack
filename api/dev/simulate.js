const { FirebaseService } = require('../../lib/firebase');
const SolanaTrackerService = require('../../lib/solanaTracker');
const RefreshEngine = require('../../lib/refreshEngine');

const firebase = new FirebaseService();
const solanaTracker = new SolanaTrackerService();
const refreshEngine = new RefreshEngine();

// Simulate different call scenarios for testing
async function simulateScenarios(req, res) {
  try {
    const { scenario = 'all' } = req.query;
    
    const results = {};

    if (scenario === 'all' || scenario === 'ath_before_call') {
      results.athBeforeCall = await simulateATHBeforeCall();
    }

    if (scenario === 'all' || scenario === 'hit_2x_dump') {
      results.hit2xDump = await simulateHit2xDump();
    }

    if (scenario === 'all' || scenario === 'flat_token') {
      results.flatToken = await simulateFlatToken();
    }

    if (scenario === 'all' || scenario === 'price_fallback') {
      results.priceFallback = await simulatePriceFallback();
    }

    if (scenario === 'all' || scenario === 'milestone_progression') {
      results.milestoneProgression = await simulateMilestoneProgression();
    }

    res.json({
      success: true,
      data: {
        scenarios: results,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error in simulation:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// Simulate ATH before call (should be ignored)
async function simulateATHBeforeCall() {
  const testToken = 'So11111111111111111111111111111111111111112'; // SOL
  const now = Date.now();
  const callTime = now - 3600000; // 1 hour ago
  const athTime = callTime - 7200000; // 3 hours ago (before call)

  try {
    // Create test call
    const callData = {
      token: testToken,
      callerId: 'test_caller_ath',
      groupId: 'test_group',
      tsCall: callTime,
      basis: 'price',
      entry: {
        price: 100,
        marketCap: null
      },
      progress: {
        max: {
          price: 100,
          marketCap: null,
          ts: callTime
        },
        multiplier: 1
      },
      milestones: {
        x2: { hit: false },
        x5: { hit: false },
        x10: { hit: false },
        x25: { hit: false },
        x50: { hit: false },
        x100: { hit: false }
      },
      status: 'active'
    };

    const call = await firebase.createCall(callData);

    // Simulate post-call data with ATH before call
    const postCallData = {
      maxPrice: 150, // 1.5x from entry
      maxMarketCap: null,
      maxPriceTimestamp: athTime, // ATH before call - should be ignored
      currentPrice: 120,
      currentMarketCap: null,
      data: {
        data: [
          { timestamp: athTime, price: 150, marketCap: null },
          { timestamp: callTime, price: 100, marketCap: null },
          { timestamp: now, price: 120, marketCap: null }
        ]
      }
    };

    // Process call
    const updatedCall = await refreshEngine.processCall(call, postCallData);
    await firebase.updateCall(call.id, updatedCall);

    return {
      scenario: 'ATH Before Call',
      description: 'Token had ATH before call time - should be ignored',
      callId: call.id,
      entryPrice: callData.entry.price,
      athPrice: 150,
      athTime: new Date(athTime).toISOString(),
      callTime: new Date(callTime).toISOString(),
      finalMultiplier: updatedCall.progress.multiplier,
      expectedMultiplier: 1.2, // Should be 120/100 = 1.2x, not 1.5x
      correct: updatedCall.progress.multiplier === 1.2
    };

  } catch (error) {
    return {
      scenario: 'ATH Before Call',
      error: error.message
    };
  }
}

// Simulate hit 2x then dump (milestone should be locked)
async function simulateHit2xDump() {
  const testToken = 'So11111111111111111111111111111111111111112';
  const now = Date.now();
  const callTime = now - 1800000; // 30 minutes ago

  try {
    const callData = {
      token: testToken,
      callerId: 'test_caller_2x',
      groupId: 'test_group',
      tsCall: callTime,
      basis: 'price',
      entry: {
        price: 100,
        marketCap: null
      },
      progress: {
        max: {
          price: 100,
          marketCap: null,
          ts: callTime
        },
        multiplier: 1
      },
      milestones: {
        x2: { hit: false },
        x5: { hit: false },
        x10: { hit: false },
        x25: { hit: false },
        x50: { hit: false },
        x100: { hit: false }
      },
      status: 'active'
    };

    const call = await firebase.createCall(callData);

    // Simulate hitting 2x then dumping
    const postCallData = {
      maxPrice: 200, // 2x from entry
      maxMarketCap: null,
      maxPriceTimestamp: now - 900000, // 15 minutes ago
      currentPrice: 50, // Dumped to 0.5x
      currentMarketCap: null,
      data: {
        data: [
          { timestamp: callTime, price: 100, marketCap: null },
          { timestamp: now - 900000, price: 200, marketCap: null },
          { timestamp: now, price: 50, marketCap: null }
        ]
      }
    };

    const updatedCall = await refreshEngine.processCall(call, postCallData);
    await firebase.updateCall(call.id, updatedCall);

    return {
      scenario: 'Hit 2x Then Dump',
      description: 'Token hit 2x milestone then dumped - milestone should be locked',
      callId: call.id,
      entryPrice: callData.entry.price,
      maxPrice: 200,
      currentPrice: 50,
      finalMultiplier: updatedCall.progress.multiplier,
      x2MilestoneHit: updatedCall.milestones.x2.hit,
      expectedX2Hit: true,
      correct: updatedCall.milestones.x2.hit === true
    };

  } catch (error) {
    return {
      scenario: 'Hit 2x Then Dump',
      error: error.message
    };
  }
}

// Simulate flat token (no milestones)
async function simulateFlatToken() {
  const testToken = 'So11111111111111111111111111111111111111112';
  const now = Date.now();
  const callTime = now - 1800000; // 30 minutes ago

  try {
    const callData = {
      token: testToken,
      callerId: 'test_caller_flat',
      groupId: 'test_group',
      tsCall: callTime,
      basis: 'price',
      entry: {
        price: 100,
        marketCap: null
      },
      progress: {
        max: {
          price: 100,
          marketCap: null,
          ts: callTime
        },
        multiplier: 1
      },
      milestones: {
        x2: { hit: false },
        x5: { hit: false },
        x10: { hit: false },
        x25: { hit: false },
        x50: { hit: false },
        x100: { hit: false }
      },
      status: 'active'
    };

    const call = await firebase.createCall(callData);

    // Simulate flat price movement
    const postCallData = {
      maxPrice: 105, // Only 1.05x
      maxMarketCap: null,
      maxPriceTimestamp: now - 600000, // 10 minutes ago
      currentPrice: 102, // 1.02x
      currentMarketCap: null,
      data: {
        data: [
          { timestamp: callTime, price: 100, marketCap: null },
          { timestamp: now - 600000, price: 105, marketCap: null },
          { timestamp: now, price: 102, marketCap: null }
        ]
      }
    };

    const updatedCall = await refreshEngine.processCall(call, postCallData);
    await firebase.updateCall(call.id, updatedCall);

    return {
      scenario: 'Flat Token',
      description: 'Token with minimal price movement - no milestones should be hit',
      callId: call.id,
      entryPrice: callData.entry.price,
      maxPrice: 105,
      currentPrice: 102,
      finalMultiplier: updatedCall.progress.multiplier,
      milestonesHit: Object.values(updatedCall.milestones).filter(m => m.hit).length,
      expectedMilestones: 0,
      correct: Object.values(updatedCall.milestones).every(m => !m.hit)
    };

  } catch (error) {
    return {
      scenario: 'Flat Token',
      error: error.message
    };
  }
}

// Simulate price fallback mode (when market cap not available)
async function simulatePriceFallback() {
  const testToken = 'So11111111111111111111111111111111111111112';
  const now = Date.now();
  const callTime = now - 1800000; // 30 minutes ago

  try {
    const callData = {
      token: testToken,
      callerId: 'test_caller_fallback',
      groupId: 'test_group',
      tsCall: callTime,
      basis: 'price', // Using price instead of marketCap
      entry: {
        price: 100,
        marketCap: null // No market cap available
      },
      progress: {
        max: {
          price: 100,
          marketCap: null,
          ts: callTime
        },
        multiplier: 1
      },
      milestones: {
        x2: { hit: false },
        x5: { hit: false },
        x10: { hit: false },
        x25: { hit: false },
        x50: { hit: false },
        x100: { hit: false }
      },
      status: 'active'
    };

    const call = await firebase.createCall(callData);

    // Simulate price-based tracking
    const postCallData = {
      maxPrice: 250, // 2.5x from entry
      maxMarketCap: null, // Still no market cap
      maxPriceTimestamp: now - 600000, // 10 minutes ago
      currentPrice: 200, // 2x current
      currentMarketCap: null,
      data: {
        data: [
          { timestamp: callTime, price: 100, marketCap: null },
          { timestamp: now - 600000, price: 250, marketCap: null },
          { timestamp: now, price: 200, marketCap: null }
        ]
      }
    };

    const updatedCall = await refreshEngine.processCall(call, postCallData);
    await firebase.updateCall(call.id, updatedCall);

    return {
      scenario: 'Price Fallback Mode',
      description: 'Using price instead of market cap when market cap unavailable',
      callId: call.id,
      entryPrice: callData.entry.price,
      maxPrice: 250,
      currentPrice: 200,
      finalMultiplier: updatedCall.progress.multiplier,
      basis: callData.basis,
      expectedMultiplier: 2.5,
      correct: updatedCall.progress.multiplier === 2.5
    };

  } catch (error) {
    return {
      scenario: 'Price Fallback Mode',
      error: error.message
    };
  }
}

// Simulate milestone progression
async function simulateMilestoneProgression() {
  const testToken = 'So11111111111111111111111111111111111111112';
  const now = Date.now();
  const callTime = now - 3600000; // 1 hour ago

  try {
    const callData = {
      token: testToken,
      callerId: 'test_caller_progression',
      groupId: 'test_group',
      tsCall: callTime,
      basis: 'price',
      entry: {
        price: 100,
        marketCap: null
      },
      progress: {
        max: {
          price: 100,
          marketCap: null,
          ts: callTime
        },
        multiplier: 1
      },
      milestones: {
        x2: { hit: false },
        x5: { hit: false },
        x10: { hit: false },
        x25: { hit: false },
        x50: { hit: false },
        x100: { hit: false }
      },
      status: 'active'
    };

    const call = await firebase.createCall(callData);

    // Simulate hitting multiple milestones
    const postCallData = {
      maxPrice: 500, // 5x from entry
      maxMarketCap: null,
      maxPriceTimestamp: now - 1800000, // 30 minutes ago
      currentPrice: 300, // 3x current
      currentMarketCap: null,
      data: {
        data: [
          { timestamp: callTime, price: 100, marketCap: null },
          { timestamp: now - 1800000, price: 500, marketCap: null },
          { timestamp: now, price: 300, marketCap: null }
        ]
      }
    };

    const updatedCall = await refreshEngine.processCall(call, postCallData);
    await firebase.updateCall(call.id, updatedCall);

    const milestonesHit = Object.entries(updatedCall.milestones)
      .filter(([key, milestone]) => milestone.hit)
      .map(([key, milestone]) => key);

    return {
      scenario: 'Milestone Progression',
      description: 'Token hitting multiple milestones (2x, 5x)',
      callId: call.id,
      entryPrice: callData.entry.price,
      maxPrice: 500,
      currentPrice: 300,
      finalMultiplier: updatedCall.progress.multiplier,
      milestonesHit,
      expectedMilestones: ['x2', 'x5'],
      correct: milestonesHit.includes('x2') && milestonesHit.includes('x5')
    };

  } catch (error) {
    return {
      scenario: 'Milestone Progression',
      error: error.message
    };
  }
}

// Clean up test data
async function cleanupTestData(req, res) {
  try {
    const testCallers = [
      'test_caller_ath',
      'test_caller_2x',
      'test_caller_flat',
      'test_caller_fallback',
      'test_caller_progression'
    ];

    const allCalls = await firebase.getActiveCalls();
    const testCalls = allCalls.filter(call => testCallers.includes(call.callerId));

    for (const call of testCalls) {
      await firebase.remove(`calls/${call.id}`);
    }

    res.json({
      success: true,
      message: `Cleaned up ${testCalls.length} test calls`,
      data: {
        removedCalls: testCalls.length,
        testCallers
      }
    });

  } catch (error) {
    console.error('Error cleaning up test data:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

module.exports = {
  simulateScenarios,
  cleanupTestData
};
