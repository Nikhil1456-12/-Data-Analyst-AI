import { Router } from 'express';
import multer from 'multer';
import { processAndImportFile } from '../services/fileUpload.js';
import { optionalAuth } from '../middleware/auth.js';
import { uploadLimiter } from '../middleware/rateLimiter.js';

const router = Router();

const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 250 * 1024 * 1024, // 250 MB per file
    files: 20
  },
  fileFilter: (req, file, cb) => {
    const allowed = ['.csv', '.xlsx', '.xls', '.json', '.pdf', '.tsv', '.txt'];
    const ext = '.' + file.originalname.split('.').pop().toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${ext}. Allowed: ${allowed.join(', ')}`));
    }
  }
});

// POST /api/upload
router.post('/', uploadLimiter, optionalAuth, upload.array('files', 20), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  try {
    const results = [];

    for (const file of req.files) {
      const result = await processAndImportFile(file.path, file.originalname);
      results.push({
        filename: file.originalname,
        tableName: result.tableName,
        rowsImported: result.rowsCount,
        columns: result.columns,
        types: result.types
      });
    }

    const summary = results.map(r => `${r.rowsImported} rows → \`${r.tableName}\``).join(', ');

    res.json({
      success: true,
      message: `Successfully imported: ${summary}`,
      tables: results
    });
  } catch (error) {
    console.error('[Upload] Error:', error.message);
    res.status(500).json({ error: error.message || 'Failed to process uploaded files.' });
  }
});

export default router;
