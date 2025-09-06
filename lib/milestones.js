const SolanaTrackerService = require('./solanaTracker');

const THRESHOLDS = [2, 5, 10, 25, 50, 100];

class MilestoneService {
  constructor() {
    this.solanaTracker = new SolanaTrackerService();
  }

  // Find first-cross timestamps for milestones
  async findFirstCrossTimestamps(tokenAddress, tsCall, thresholds, entryBasisValue, basis, toTs) {
    try {
      const chart = await this.solanaTracker.getChartData({
        tokenAddress,
        type: (toTs - tsCall) > 60 * 60 * 48 ? '5m' : '1m',
        timeFrom: tsCall,
        timeTo: toTs,
        marketCap: true,
        removeOutliers: true,
        dynamicPools: true,
        fastCache: true
      });

      if (!chart?.data || !Array.isArray(chart.data)) {
        throw new Error('No chart data available for milestone scanning');
      }

      const firstHit = {};
      const pending = new Set(thresholds.map(x => String(x)));

      for (const candle of chart.data) {
        const candleTs = candle.timestamp || candle.t;
        if (candleTs < tsCall) continue; // Skip pre-call data

        // Get basis value for this candle
        const basisValue = this.getBasisValue(candle, basis);
        if (!Number.isFinite(basisValue) || basisValue <= 0) continue;

        // Calculate current multiplier
        const currentMultiplier = basisValue / entryBasisValue;

        // Check each pending threshold
        for (const threshold of thresholds) {
          const thresholdKey = String(threshold);
          if (pending.has(thresholdKey) && currentMultiplier >= threshold) {
            firstHit[thresholdKey] = candleTs;
            pending.delete(thresholdKey);
          }
        }

        // If all thresholds found, break early
        if (pending.size === 0) break;
      }

      return firstHit;
    } catch (error) {
      console.error(`Error finding first-cross timestamps for ${tokenAddress}:`, error);
      throw error;
    }
  }

  // Get basis value from candle data
  getBasisValue(candle, basis) {
    if (basis === 'marketCap') {
      return typeof candle.marketCapHigh === 'number' ? candle.marketCapHigh : 
             (typeof candle.marketCap === 'number' ? candle.marketCap : NaN);
    } else {
      return typeof candle.high === 'number' ? candle.high : 
             (typeof candle.price === 'number' ? candle.price : NaN);
    }
  }

  // Lock milestones for a call
  async lockMilestones(callId, tokenAddress, tsCall, entryBasisValue, basis, toTs, preferMarketCap = true) {
    try {
      const firstHits = await this.findFirstCrossTimestamps(
        tokenAddress,
        tsCall,
        THRESHOLDS,
        entryBasisValue,
        basis,
        toTs
      );

      const milestoneUpdates = {};
      const milestones = {
        x2: { hit: false },
        x5: { hit: false },
        x10: { hit: false },
        x25: { hit: false },
        x50: { hit: false },
        x100: { hit: false }
      };

      // Update milestones based on first hits
      for (const [threshold, timestamp] of Object.entries(firstHits)) {
        const milestoneKey = `x${threshold}`;
        if (milestones[milestoneKey]) {
          milestones[milestoneKey] = {
            hit: true,
            ts: timestamp
          };
        }
      }

      // Prepare updates for Firebase
      for (const [key, milestone] of Object.entries(milestones)) {
        if (milestone.hit) {
          milestoneUpdates[`calls/${callId}/milestones/${key}`] = milestone;
        }
      }

      return {
        milestones,
        updates: milestoneUpdates,
        firstHits
      };
    } catch (error) {
      console.error(`Error locking milestones for call ${callId}:`, error);
      throw error;
    }
  }

  // Check if milestone should be locked (for existing calls)
  shouldLockMilestone(currentMilestone, newMultiplier, threshold) {
    // Never unset existing milestones
    if (currentMilestone?.hit) {
      return false;
    }

    // Lock if threshold crossed
    return newMultiplier >= threshold;
  }

  // Get milestone display name
  getMilestoneDisplayName(threshold) {
    const names = {
      2: '2x',
      5: '5x', 
      10: '10x',
      25: '25x',
      50: '50x',
      100: '100x'
    };
    return names[threshold] || `${threshold}x`;
  }

  // Calculate milestone progress
  calculateMilestoneProgress(multiplier) {
    const progress = {};
    for (const threshold of THRESHOLDS) {
      progress[`x${threshold}`] = {
        threshold,
        crossed: multiplier >= threshold,
        progress: Math.min(100, (multiplier / threshold) * 100)
      };
    }
    return progress;
  }

  // Get next milestone
  getNextMilestone(multiplier) {
    for (const threshold of THRESHOLDS) {
      if (multiplier < threshold) {
        return {
          threshold,
          display: this.getMilestoneDisplayName(threshold),
          remaining: threshold - multiplier,
          progress: (multiplier / threshold) * 100
        };
      }
    }
    return null; // All milestones achieved
  }

  // Validate milestone data
  validateMilestoneData(milestones) {
    const validKeys = ['x2', 'x5', 'x10', 'x25', 'x50', 'x100'];
    const errors = [];

    for (const key of validKeys) {
      const milestone = milestones[key];
      if (!milestone) {
        errors.push(`Missing milestone: ${key}`);
        continue;
      }

      if (typeof milestone.hit !== 'boolean') {
        errors.push(`Invalid hit value for ${key}: ${milestone.hit}`);
      }

      if (milestone.hit && (!milestone.ts || typeof milestone.ts !== 'number')) {
        errors.push(`Missing or invalid timestamp for ${key}`);
      }

      if (!milestone.hit && milestone.ts) {
        errors.push(`Timestamp set for unlocked milestone ${key}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

module.exports = { MilestoneService, THRESHOLDS };
