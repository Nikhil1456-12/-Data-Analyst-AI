import { Router } from 'express';
import { getDatabaseInfo, getTableStats, getDatabases, switchDatabase, detectRelationships, getDetailedSchema } from '../services/db.js';
import { optionalAuth } from '../middleware/auth.js';

const router = Router();

// GET /api/database/info
router.get('/info', optionalAuth, async (req, res) => {
  try {
    const info = await getDatabaseInfo();
    res.json(info);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/database/schema
router.get('/schema', optionalAuth, async (req, res) => {
  try {
    const schema = await getDetailedSchema();
    res.json({ schema });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/database/stats/:tableName
router.get('/stats/:tableName', optionalAuth, async (req, res) => {
  try {
    const stats = await getTableStats(req.params.tableName);
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/database/relationships
router.get('/relationships', optionalAuth, async (req, res) => {
  try {
    const relationships = await detectRelationships();
    res.json({ relationships });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/database/list
router.get('/list', optionalAuth, async (req, res) => {
  try {
    const databases = await getDatabases();
    res.json({ databases });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/database/switch
router.post('/switch', optionalAuth, async (req, res) => {
  try {
    const { database } = req.body;
    if (!database) return res.status(400).json({ error: 'Database name is required' });
    await switchDatabase(database);
    res.json({ success: true, message: `Switched to database: ${database}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
