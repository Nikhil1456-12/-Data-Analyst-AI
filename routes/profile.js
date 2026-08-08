import { Router } from 'express';
import { generateTableProfile, getCorrelationMatrix, detectOutliers } from '../services/profiler.js';
import { optionalAuth } from '../middleware/auth.js';

const router = Router();

// GET /api/profile/:tableName — Full table profile
router.get('/:tableName', optionalAuth, async (req, res) => {
  try {
    const profile = await generateTableProfile(req.params.tableName);
    res.json(profile);
  } catch (error) {
    console.error('[Profile] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/profile/:tableName/correlation — Correlation matrix
router.get('/:tableName/correlation', optionalAuth, async (req, res) => {
  try {
    const matrix = await getCorrelationMatrix(req.params.tableName);
    res.json(matrix);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/profile/:tableName/outliers/:columnName — Outlier detection
router.get('/:tableName/outliers/:columnName', optionalAuth, async (req, res) => {
  try {
    const method = req.query.method || 'iqr';
    const result = await detectOutliers(req.params.tableName, req.params.columnName, method);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
