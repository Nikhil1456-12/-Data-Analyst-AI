import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { executeQuery, getDatabaseInfo, getTableStats, getDatabases, switchDatabase } from './services/db.js';
import { processNLQuery, generateInsights, generatePythonVizCode, generateSuggestions } from './services/llm.js';
import { runPythonViz } from './services/pythonViz.js';
import { processAndImportFile } from './services/fileUpload.js';

dotenv.config();

const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 250 * 1024 * 1024, // 250 MB per file
    files: 20                    // max 20 files per request
  }
});


const app = express();
app.use(cors());
app.use(express.json({ limit: '100mb' }));

// In-Memory cache for LLM AI Queries
const queryCache = new Map();

// Setup static file serving for the React Frontend in production
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, 'client/dist')));

app.post('/api/upload', upload.array('files'), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  try {
    const results = [];
    for (const file of req.files) {
      const result = await processAndImportFile(file.path, file.originalname);
      results.push(`${result.rowsCount} rows into \`${result.tableName}\``);
    }
    
    // Invalidate the query cache whenever new data is uploaded to prevent stale insights
    queryCache.clear();

    res.json({ success: true, message: `Successfully imported: ${results.join(', ')}` });
  } catch (error) {
    console.error('File processing error:', error);
    res.status(500).json({ error: error.message || 'Failed to process and import file.' });
  }
});

app.get('/api/database/info', async (req, res) => {
  try {
    const info = await getDatabaseInfo();
    res.json(info);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/database/stats/:tableName', async (req, res) => {
  try {
    const stats = await getTableStats(req.params.tableName);
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/databases', async (req, res) => {
  try {
    const dbs = await getDatabases();
    res.json({ databases: dbs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/database/switch', async (req, res) => {
  try {
    const { database } = req.body;
    await switchDatabase(database);
    res.json({ success: true, message: `Switched to database: ${database}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/suggestions', async (req, res) => {
  try {
    const { history, activeTable } = req.body;
    const suggestions = await generateSuggestions(history || [], activeTable);
    res.json({ suggestions });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to generate suggestions.' });
  }
});

app.get('/api/query/stream', async (req, res) => {
  const { query, activeTable } = req.query;
  if (!query) {
    return res.status(400).json({ error: 'Query is required' });
  }

  // Set up SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  const sendEvent = (type, data) => {
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const cacheKey = `${query.trim().toLowerCase()}_${activeTable || 'none'}`;
    if (queryCache.has(cacheKey)) {
      console.log('Cache hit for query:', cacheKey);
      sendEvent('state', 'DONE');
      sendEvent('result', queryCache.get(cacheKey));
      return res.end();
    }

    sendEvent('state', 'PARSING');
    // 1. Convert NL to SQL
    const sqlQuery = await processNLQuery(query, activeTable);
    
    sendEvent('state', 'VALIDATING');
    // 1.5 Validate SQL (Ensure SELECT only)
    const normalizedSql = sqlQuery.trim().toUpperCase();
    if (!normalizedSql.startsWith('SELECT')) {
      sendEvent('error', 'Security Exception: Only SELECT queries are permitted by the current workflow rules.');
      return res.end();
    }

    sendEvent('state', 'EXECUTING');
    // 2. Execute SQL
    const dbResult = await executeQuery(sqlQuery);

    if (!Array.isArray(dbResult)) {
        sendEvent('error', 'Unexpected Database Response. Expected an array of rows from a SELECT query.');
        return res.end();
    }

    if (dbResult.length === 0) {
      sendEvent('state', 'DONE');
      sendEvent('result', {
        sql: sqlQuery,
        data: [],
        insights: 'Query executed successfully, but returned no data.',
        chartImage: null
      });
      return res.end();
    }
    
    sendEvent('state', 'INSIGHTS');
    // 3. Generate Insights & Chart config
    const insights = await generateInsights(query, dbResult);
    
    sendEvent('state', 'CHART');
    let pythonCode = null;
    let vizSkipped = null;

    // Only generate visualizations if we have 2 or more variables (columns) to plot!
    if (Object.keys(dbResult[0]).length >= 2) {
       pythonCode = await generatePythonVizCode(query, dbResult);
    } else {
       vizSkipped = "Visualization skipped: Query returned only 1 variable. Visualizations require 2 or more variables.";
    }

    // 4. Generate Python Chart (Base64 Image)
    let chartImage = null;
    if (pythonCode && dbResult.length > 0) {
      try {
        chartImage = await runPythonViz(pythonCode, dbResult);
      } catch (err) {
        console.error("Error generating python viz:", err);
      }
    }

    const resultPayload = {
      sql: sqlQuery,
      data: dbResult,
      insights,
      chartImage,
      vizSkipped
    };

    // Cache the result for subsequent identical queries
    queryCache.set(cacheKey, resultPayload);

    sendEvent('state', 'DONE');
    sendEvent('result', resultPayload);
    res.end();

  } catch (error) {
    console.error(error);
    sendEvent('error', error.message || 'An error occurred during query processing.');
    res.end();
  }
});

// Global error handler to catch all exceptions and send JSON instead of Express HTML default
app.use((err, req, res, next) => {
  console.error('Unhandled app error:', err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

// Wildcard route to serve the React application for any unknown routes (SPA routing)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client/dist', 'index.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
