import { Router } from 'express';
import { runStatisticalTest, suggestStatisticalTest } from '../services/statistics.js';
import { generateStatisticalAnalysis } from '../services/llm.js';
import { optionalAuth } from '../middleware/auth.js';

const router = Router();

// POST /api/statistics/test — Run a statistical test
router.post('/test', optionalAuth, async (req, res) => {
  try {
    const { testType, params, question } = req.body;

    if (!testType || !params) {
      return res.status(400).json({ error: 'testType and params are required' });
    }

    const result = await runStatisticalTest(testType, params);

    // Generate human-readable interpretation
    let interpretation = null;
    if (question) {
      try {
        interpretation = await generateStatisticalAnalysis(question, result, result.test || testType);
      } catch (e) {
        console.error('[Stats] Interpretation error:', e.message);
      }
    }

    res.json({
      ...result,
      interpretation
    });
  } catch (error) {
    console.error('[Stats] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/statistics/suggest — Suggest best test for a question
router.post('/suggest', optionalAuth, async (req, res) => {
  try {
    const { question, columnTypes } = req.body;
    const suggestion = suggestStatisticalTest(columnTypes || {}, question || '');
    res.json(suggestion);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
