import { Router } from 'express';
import { getHistoryEntries, clearHistory } from '../services/db.js';
import { optionalAuth } from '../middleware/auth.js';

const router = Router();

// GET /api/history
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { activeTable, limit } = req.query;
    const history = await getHistoryEntries(activeTable || null, parseInt(limit) || 100);
    res.json({ history });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve query history.' });
  }
});

// DELETE /api/history
router.delete('/', optionalAuth, async (req, res) => {
  try {
    const activeTable = req.body.activeTable || req.query.activeTable;
    await clearHistory(activeTable || null);
    res.json({ success: true, message: 'Query history cleared.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to clear history.' });
  }
});

export default router;
