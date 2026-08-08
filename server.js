import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import { apiLimiter } from './middleware/rateLimiter.js';
import { ensureSystemTables } from './services/db.js';

// Route imports
import authRoutes from './routes/auth.js';
import databaseRoutes from './routes/database.js';
import queryRoutes from './routes/query.js';
import uploadRoutes from './routes/upload.js';
import profileRoutes from './routes/profile.js';
import statisticsRoutes from './routes/statistics.js';
import forecastRoutes from './routes/forecast.js';
import reportRoutes from './routes/report.js';
import historyRoutes from './routes/history.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Security headers
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// CORS
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? false : '*',
  credentials: true
}));

// Body parsing
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Global rate limiter
app.use('/api/', apiLimiter);

// Static files (production frontend)
app.use(express.static(path.join(__dirname, 'client/dist')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/database', databaseRoutes);
app.use('/api/query', queryRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/statistics', statisticsRoutes);
app.use('/api/forecast', forecastRoutes);
app.use('/api/report', reportRoutes);
app.use('/api/history', historyRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', version: '2.0.0', timestamp: new Date().toISOString() });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Server Error]', err.stack || err.message);
  const status = err.status || 500;
  res.status(status).json({
    error: process.env.NODE_ENV === 'production'
      ? 'An internal server error occurred.'
      : err.message || 'Internal Server Error'
  });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client/dist', 'index.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
  console.log(`\n  ╔══════════════════════════════════════════╗`);
  console.log(`  ║   Data Analyst AI — v2.0.0               ║`);
  console.log(`  ║   Running on http://localhost:${PORT}        ║`);
  console.log(`  ╚══════════════════════════════════════════╝\n`);

  try {
    await ensureSystemTables();
    console.log('  ✓ System tables verified');
  } catch (err) {
    console.error('  ✗ Failed to initialize system tables:', err.message);
  }
});

export default app;
