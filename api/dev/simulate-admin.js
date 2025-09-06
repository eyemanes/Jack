const ATHBackfillService = require('../../lib/athBackfill');
const { FirebaseService } = require('../../lib/firebase');
const SolanaTrackerService = require('../../lib/solanaTracker');

const backfillService = new ATHBackfillService();
const firebase = new FirebaseService();
const solanaTracker = new SolanaTrackerService();

// Simulate ATH backfill scenarios for testing
async function simulateATHScenarios(req, res) {
  try {
    const { scenario = 'all' } = req.query;
    
    const results = {};

    if (scenario === 'all' || scenario === 'ath_after_call') {
      results.athAfterCall = await simulateATHAfterCall();
    }

    if (scenario === 'all' || scenario === 'ath_before_call') {
      results.athBeforeCall = await simulateATHBeforeCall();
    }

    if (scenario === 'all' || scenario === 'no_marketcap') {
      results.noMarketCap = await simulateNoMarketCap();
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
    console.error('Error in ATH simulation:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// Simulate ATH after call (should use ATH)
async function simulateATHAfterCall() {
  const testToken = 'So11111111111111111111111111111111111111112'; // SOL
  const now = Math.floor(Date.now() / 1000);
  const callTime = now - 3600; // 1 hour ago
  const athTime = now - 1800; // 30 minutes ago (after call)

  try {
    // Create test call
    const callData = {
      token: testToken,
      callerId: 'test_caller_ath_after',
      groupId: 'test_group',
      tsCall: callTime,
      basis: 'marketCap',
      entry: {
        price: 100,
        marketCap: 1000000 // 1M market cap
      },
      progress: {
        max: {
          price: 100,
          marketCap: 1000000,
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

    // Simulate ATH data
    const mockATH = {
      basis: 'marketCap',
      value: 2000000, // 2M market cap (2x)
      ts: athTime
    };

    // Mock the ATH resolution
    const originalGetAthWithTimestamp = solanaTracker.getAthWithTimestamp;
    solanaTracker.getAthWithTimestamp = async () => mockATH;

    // Process call with ATH backfill
    const result = await backfillService.processCall(call, 'test-run-ath-after', now);

    // Restore original method
    solanaTracker.getAthWithTimestamp = originalGetAthWithTimestamp;

    return {
      scenario: 'ATH After Call',
      description: 'ATH happened after call - should use ATH value',
      callId: call.id,
      entryMarketCap: callData.entry.marketCap,
      athMarketCap: mockATH.value,
      athTime: new Date(athTime * 1000).toISOString(),
      callTime: new Date(callTime * 1000).toISOString(),
      result,
      expectedMultiplier: 2, // 2M / 1M = 2x
      correct: result.newMultiplier === 2
    };

  } catch (error) {
    return {
      scenario: 'ATH After Call',
      error: error.message
    };
  }
}

// Simulate ATH before call (should use local high)
async function simulateATHBeforeCall() {
  const testToken = 'So11111111111111111111111111111111111111112';
  const now = Math.floor(Date.now() / 1000);
  const callTime = now - 3600; // 1 hour ago
  const athTime = now - 7200; // 2 hours ago (before call)

  try {
    const callData = {
      token: testToken,
      callerId: 'test_caller_ath_before',
      groupId: 'test_group',
      tsCall: callTime,
      basis: 'marketCap',
      entry: {
        price: 100,
        marketCap: 1000000
      },
      progress: {
        max: {
          price: 100,
          marketCap: 1000000,
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

    // Simulate ATH before call
    const mockATH = {
      basis: 'marketCap',
      value: 5000000, // 5M market cap (5x)
      ts: athTime
    };

    // Mock local high after call
    const mockLocalHigh = {
      value: 1500000, // 1.5M market cap (1.5x)
      ts: now - 1800,
      basis: 'marketCap'
    };

    // Mock the methods
    const originalGetAthWithTimestamp = solanaTracker.getAthWithTimestamp;
    const originalGetLocalPostCallHigh = solanaTracker.getLocalPostCallHigh;

    solanaTracker.getAthWithTimestamp = async () => mockATH;
    solanaTracker.getLocalPostCallHigh = async () => mockLocalHigh;

    // Process call
    const result = await backfillService.processCall(call, 'test-run-ath-before', now);

    // Restore original methods
    solanaTracker.getAthWithTimestamp = originalGetAthWithTimestamp;
    solanaTracker.getLocalPostCallHigh = originalGetLocalPostCallHigh;

    return {
      scenario: 'ATH Before Call',
      description: 'ATH happened before call - should use local high',
      callId: call.id,
      entryMarketCap: callData.entry.marketCap,
      athMarketCap: mockATH.value,
      athTime: new Date(athTime * 1000).toISOString(),
      localHigh: mockLocalHigh.value,
      localHighTime: new Date(mockLocalHigh.ts * 1000).toISOString(),
      callTime: new Date(callTime * 1000).toISOString(),
      result,
      expectedMultiplier: 1.5, // 1.5M / 1M = 1.5x
      correct: result.newMultiplier === 1.5
    };

  } catch (error) {
    return {
      scenario: 'ATH Before Call',
      error: error.message
    };
  }
}

// Simulate no market cap (price fallback)
async function simulateNoMarketCap() {
  const testToken = 'So11111111111111111111111111111111111111112';
  const now = Math.floor(Date.now() / 1000);
  const callTime = now - 3600;

  try {
    const callData = {
      token: testToken,
      callerId: 'test_caller_no_mc',
      groupId: 'test_group',
      tsCall: callTime,
      basis: 'price', // Price basis
      entry: {
        price: 100,
        marketCap: null // No market cap
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

    // Simulate ATH with price only
    const mockATH = {
      basis: 'price',
      value: 300, // 3x price
      ts: now - 1800
    };

    // Mock the methods
    const originalGetAthWithTimestamp = solanaTracker.getAthWithTimestamp;
    solanaTracker.getAthWithTimestamp = async () => mockATH;

    // Process call
    const result = await backfillService.processCall(call, 'test-run-no-mc', now);

    // Restore original method
    solanaTracker.getAthWithTimestamp = originalGetAthWithTimestamp;

    return {
      scenario: 'No Market Cap',
      description: 'No market cap available - should use price basis',
      callId: call.id,
      entryPrice: callData.entry.price,
      athPrice: mockATH.value,
      athTime: new Date(mockATH.ts * 1000).toISOString(),
      callTime: new Date(callTime * 1000).toISOString(),
      result,
      expectedMultiplier: 3, // 300 / 100 = 3x
      correct: result.newMultiplier === 3
    };

  } catch (error) {
    return {
      scenario: 'No Market Cap',
      error: error.message
    };
  }
}

// Simulate milestone progression
async function simulateMilestoneProgression() {
  const testToken = 'So11111111111111111111111111111111111111112';
  const now = Math.floor(Date.now() / 1000);
  const callTime = now - 3600;

  try {
    const callData = {
      token: testToken,
      callerId: 'test_caller_milestones',
      groupId: 'test_group',
      tsCall: callTime,
      basis: 'marketCap',
      entry: {
        price: 100,
        marketCap: 1000000
      },
      progress: {
        max: {
          price: 100,
          marketCap: 1000000,
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

    // Simulate ATH that hits multiple milestones
    const mockATH = {
      basis: 'marketCap',
      value: 10000000, // 10M market cap (10x)
      ts: now - 1800
    };

    // Mock the method
    const originalGetAthWithTimestamp = solanaTracker.getAthWithTimestamp;
    solanaTracker.getAthWithTimestamp = async () => mockATH;

    // Process call
    const result = await backfillService.processCall(call, 'test-run-milestones', now);

    // Restore original method
    solanaTracker.getAthWithTimestamp = originalGetAthWithTimestamp;

    const milestonesHit = Object.entries(result.milestones || {})
      .filter(([key, milestone]) => milestone.hit)
      .map(([key, milestone]) => key);

    return {
      scenario: 'Milestone Progression',
      description: 'ATH hits multiple milestones - should lock them',
      callId: call.id,
      entryMarketCap: callData.entry.marketCap,
      athMarketCap: mockATH.value,
      athTime: new Date(mockATH.ts * 1000).toISOString(),
      callTime: new Date(callTime * 1000).toISOString(),
      result,
      expectedMultiplier: 10, // 10M / 1M = 10x
      milestonesHit,
      expectedMilestones: ['x2', 'x5', 'x10'],
      correct: result.newMultiplier === 10 && milestonesHit.includes('x2') && milestonesHit.includes('x5') && milestonesHit.includes('x10')
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
      'test_caller_ath_after',
      'test_caller_ath_before',
      'test_caller_no_mc',
      'test_caller_milestones'
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
  simulateATHScenarios,
  cleanupTestData
};
