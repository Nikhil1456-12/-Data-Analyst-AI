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

const upload = multer({ dest: 'uploads/' });


const app = express();
app.use(cors());
app.use(express.json());

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
    const { history } = req.body;
    const suggestions = await generateSuggestions(history || []);
    res.json({ suggestions });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to generate suggestions.' });
  }
});

app.post('/api/query', async (req, res) => {
  const { query } = req.body;
  if (!query) {
    return res.status(400).json({ error: 'Query is required' });
  }

  try {
    // 1. Convert NL to SQL
    const sqlQuery = await processNLQuery(query);
    
    // 2. Execute SQL
    const dbResult = await executeQuery(sqlQuery);

    // Handle non-SELECT queries (CREATE, UPDATE, INSERT, DROP)
    if (!Array.isArray(dbResult)) {
      return res.json({
        sql: sqlQuery,
        data: [],
        insights: `Operation successful. ${dbResult.affectedRows !== undefined ? 'Affected rows: ' + dbResult.affectedRows : 'Database structure modified.'}`,
        chartImage: null
      });
    }

    if (dbResult.length === 0) {
      return res.json({
        sql: sqlQuery,
        data: [],
        insights: 'Query executed successfully, but returned no data.',
        chartImage: null
      });
    }
    
    // 3. Generate Insights & Chart config
    const [insights, pythonCode] = await Promise.all([
      generateInsights(query, dbResult),
      generatePythonVizCode(query, dbResult)
    ]);

    // 4. Generate Python Chart (Base64 Image)
    let chartImage = null;
    if (pythonCode && dbResult.length > 0) {
      try {
        chartImage = await runPythonViz(pythonCode, dbResult);
      } catch (err) {
        console.error("Error generating python viz:", err);
      }
    }

    res.json({
      sql: sqlQuery,
      data: dbResult,
      insights,
      chartImage
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || 'An error occurred during query processing.' });
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
