import { Router } from 'express';
import { executeQuery, saveHistoryEntry, getDatabaseSchema } from '../services/db.js';
import { processNLQuery, generateInsights, generatePythonVizCode, generateSuggestions, generateCleaningQuery, generateExecutiveSummary } from '../services/llm.js';
import { runPythonViz } from '../services/pythonViz.js';
import { optionalAuth } from '../middleware/auth.js';

const router = Router();

// In-memory cache
const queryCache = new Map();

// GET /api/query/stream — SSE streaming query pipeline
router.get('/stream', optionalAuth, async (req, res) => {
  const { query, activeTable, mode } = req.query;
  if (!query) return res.status(400).json({ error: 'Query parameter is required' });

  // SSE setup
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const startTime = Date.now();
  let sqlQuery = null;

  try {
    // Cache check
    const cacheKey = `${query.trim().toLowerCase()}_${activeTable || 'all'}`;
    if (queryCache.has(cacheKey)) {
      send('state', 'DONE');
      send('result', queryCache.get(cacheKey));
      return res.end();
    }

    // Step 1: NL → SQL
    send('state', 'PARSING');
    sqlQuery = await processNLQuery(query, activeTable);

    // Step 2: Validate
    send('state', 'VALIDATING');
    const normalizedSQL = sqlQuery.trim().toUpperCase();
    const isReadOnly = normalizedSQL.startsWith('SELECT') || normalizedSQL.startsWith('SHOW') || normalizedSQL.startsWith('DESCRIBE');

    // Allow cleaning/mutation queries if mode is 'clean'
    if (!isReadOnly && mode !== 'clean') {
      send('error', 'Only SELECT queries are permitted in analysis mode. Use cleaning mode for data mutations.');
      await saveHistoryEntry(query, sqlQuery, 'blocked', 0, 'Non-SELECT query blocked', activeTable, Date.now() - startTime);
      return res.end();
    }

    // Step 3: Execute
    send('state', 'EXECUTING');
    const dbResult = await executeQuery(sqlQuery);

    if (!Array.isArray(dbResult)) {
      // Mutation queries return OkPacket
      const result = {
        sql: sqlQuery,
        data: [],
        insights: `Operation completed successfully. ${dbResult.affectedRows || 0} rows affected.`,
        chartImage: null,
        rowsAffected: dbResult.affectedRows || 0
      };
      send('state', 'DONE');
      send('result', result);
      await saveHistoryEntry(query, sqlQuery, 'success', dbResult.affectedRows || 0, null, activeTable, Date.now() - startTime);
      return res.end();
    }

    if (dbResult.length === 0) {
      send('state', 'DONE');
      send('result', { sql: sqlQuery, data: [], insights: 'Query executed successfully but returned no results.', chartImage: null });
      await saveHistoryEntry(query, sqlQuery, 'success', 0, null, activeTable, Date.now() - startTime);
      return res.end();
    }

    // Step 4: Generate Insights
    send('state', 'INSIGHTS');
    const insights = await generateInsights(query, dbResult);

    // Step 5: Generate Visualization
    send('state', 'CHART');
    let chartImage = null;
    let vizSkipped = null;

    if (Object.keys(dbResult[0]).length >= 2 && dbResult.length >= 2) {
      try {
        const pythonCode = await generatePythonVizCode(query, dbResult);
        if (pythonCode) {
          chartImage = await runPythonViz(pythonCode, dbResult);
        }
      } catch (vizErr) {
        console.error('[Query] Viz error:', vizErr.message);
        vizSkipped = 'Visualization could not be generated for this data.';
      }
    } else {
      vizSkipped = 'Visualization requires at least 2 columns and 2 rows of data.';
    }

    // Build result
    const resultPayload = {
      sql: sqlQuery,
      data: dbResult,
      insights,
      chartImage,
      vizSkipped,
      rowCount: dbResult.length,
      executionTime: Date.now() - startTime
    };

    // Cache result
    queryCache.set(cacheKey, resultPayload);
    if (queryCache.size > 100) {
      const firstKey = queryCache.keys().next().value;
      queryCache.delete(firstKey);
    }

    // Save history
    await saveHistoryEntry(query, sqlQuery, 'success', dbResult.length, null, activeTable, Date.now() - startTime);

    send('state', 'DONE');
    send('result', resultPayload);
    res.end();

  } catch (error) {
    console.error('[Query] Error:', error.message);
    await saveHistoryEntry(query, sqlQuery, 'error', 0, error.message, activeTable, Date.now() - startTime);
    send('error', error.message || 'An error occurred during query processing.');
    res.end();
  }
});

// POST /api/query/suggestions
router.post('/suggestions', optionalAuth, async (req, res) => {
  try {
    const { history, activeTable } = req.body;
    const suggestions = await generateSuggestions(history || [], activeTable);
    res.json({ suggestions });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate suggestions.' });
  }
});

// POST /api/query/clean — Execute a data cleaning operation
router.post('/clean', optionalAuth, async (req, res) => {
  try {
    const { instruction, tableName } = req.body;
    if (!instruction || !tableName) {
      return res.status(400).json({ error: 'Instruction and tableName are required' });
    }

    const schema = await getDatabaseSchema();
    const sql = await generateCleaningQuery(instruction, tableName, schema);
    const result = await executeQuery(sql);

    // Invalidate cache
    queryCache.clear();

    res.json({
      success: true,
      sql,
      affectedRows: result.affectedRows || 0,
      message: `Cleaning operation completed: ${result.affectedRows || 0} rows affected.`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/query/executive-summary
router.post('/executive-summary', optionalAuth, async (req, res) => {
  try {
    const { query: nlQuery, data, insights } = req.body;
    const summary = await generateExecutiveSummary(nlQuery, data, insights);
    res.json({ summary });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/query/cache/clear
router.post('/cache/clear', optionalAuth, (req, res) => {
  queryCache.clear();
  res.json({ success: true, message: 'Query cache cleared.' });
});

export default router;
