import { Router } from 'express';
import { generateForecast, getFeatureImportance, detectTimeColumns } from '../services/forecasting.js';
import { interpretForecast } from '../services/llm.js';
import { optionalAuth } from '../middleware/auth.js';

const router = Router();

// POST /api/forecast/generate — Generate time-series forecast
router.post('/generate', optionalAuth, async (req, res) => {
  try {
    const { tableName, dateColumn, valueColumn, periods, method, question } = req.body;

    if (!tableName || !dateColumn || !valueColumn) {
      return res.status(400).json({ error: 'tableName, dateColumn, and valueColumn are required' });
    }

    const forecast = await generateForecast({
      tableName,
      dateColumn,
      valueColumn,
      periods: periods || 12,
      method: method || 'auto'
    });

    // Generate interpretation
    let interpretation = null;
    if (question) {
      try {
        interpretation = await interpretForecast(question, forecast);
      } catch (e) {
        console.error('[Forecast] Interpretation error:', e.message);
      }
    }

    res.json({ ...forecast, interpretation });
  } catch (error) {
    console.error('[Forecast] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/forecast/feature-importance
router.post('/feature-importance', optionalAuth, async (req, res) => {
  try {
    const { tableName, targetColumn } = req.body;
    if (!tableName || !targetColumn) {
      return res.status(400).json({ error: 'tableName and targetColumn are required' });
    }

    const result = await getFeatureImportance({ tableName, targetColumn });
    res.json(result);
  } catch (error) {
    console.error('[Forecast] Feature importance error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/forecast/time-columns/:tableName — Detect time columns
router.get('/time-columns/:tableName', optionalAuth, async (req, res) => {
  try {
    const columns = await detectTimeColumns(req.params.tableName);
    res.json({ columns });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
