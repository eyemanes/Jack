const ATHBackfillService = require('../../lib/athBackfill');

const backfillService = new ATHBackfillService();

// Middleware to check admin secret
function requireAdmin(req, res, next) {
  const adminSecret = req.headers['x-admin-secret'];
  const expectedSecret = process.env.ADMIN_SECRET;

  if (!expectedSecret) {
    return res.status(500).json({
      success: false,
      error: 'Admin secret not configured'
    });
  }

  if (!adminSecret || adminSecret !== expectedSecret) {
    return res.status(401).json({
      success: false,
      error: 'Invalid admin secret'
    });
  }

  next();
}

// POST /api/admin/backfill-ath
async function startBackfill(req, res) {
  try {
    const {
      runId,
      groupId,
      token,
      fromTs,
      toTs,
      limit = 500,
      dryRun = false
    } = req.body;

    // Generate runId if not provided
    const finalRunId = runId || generateRunId();

    // Validate parameters
    if (limit > 1000) {
      return res.status(400).json({
        success: false,
        error: 'Limit cannot exceed 1000'
      });
    }

    if (fromTs && toTs && fromTs > toTs) {
      return res.status(400).json({
        success: false,
        error: 'fromTs cannot be greater than toTs'
      });
    }

    console.log(`Starting ATH backfill run ${finalRunId}`, {
      groupId,
      token,
      fromTs,
      toTs,
      limit,
      dryRun
    });

    // Run backfill
    const result = await backfillService.runBackfill({
      runId: finalRunId,
      groupId,
      token,
      fromTs,
      toTs,
      limit,
      dryRun
    });

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('Error starting backfill:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// GET /api/admin/backfill-ath/status
async function getBackfillStatus(req, res) {
  try {
    const { runId } = req.query;

    if (!runId) {
      return res.status(400).json({
        success: false,
        error: 'runId parameter is required'
      });
    }

    const status = await backfillService.getRunStatus(runId);

    res.json({
      success: true,
      data: status
    });

  } catch (error) {
    console.error('Error getting backfill status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// GET /api/admin/backfill-ath/runs
async function listBackfillRuns(req, res) {
  try {
    const { limit = 50 } = req.query;
    const runs = await backfillService.listRuns(parseInt(limit));

    res.json({
      success: true,
      data: {
        runs,
        total: runs.length
      }
    });

  } catch (error) {
    console.error('Error listing backfill runs:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// POST /api/admin/backfill-ath/cleanup
async function cleanupBackfillRuns(req, res) {
  try {
    const { olderThanDays = 30 } = req.body;
    const result = await backfillService.cleanupOldRuns(olderThanDays);

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('Error cleaning up backfill runs:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

// Generate run ID
function generateRunId() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

module.exports = {
  requireAdmin,
  startBackfill,
  getBackfillStatus,
  listBackfillRuns,
  cleanupBackfillRuns
};
