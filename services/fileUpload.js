import fs from 'fs';
import csv from 'csv-parser';
import xlsx from 'xlsx';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

import { pool, sanitizeIdentifier, inferAllColumnTypes, generateCreateTableSQL } from './db.js';
import { parsePDFTableToJSON } from './llm.js';

const MAX_ROWS = 100000;
const MAX_COLUMNS = 200;

// ─── File Processing Entry Point ─────────────────────────────────────────────

export async function processAndImportFile(filePath, originalFilename, { replace = false } = {}) {
  const ext = originalFilename.toLowerCase().split('.').pop();
  const tableName = sanitizeIdentifier(originalFilename.replace(/\.[^.]+$/, ''));

  let headers = [];
  let rows = [];

  switch (ext) {
    case 'xlsx':
    case 'xls':
      ({ headers, rows } = await parseExcel(filePath));
      break;
    case 'csv':
    case 'tsv':
    case 'txt':
      ({ headers, rows } = await parseCSV(filePath, ext === 'tsv' ? '\t' : ','));
      break;
    case 'json':
      ({ headers, rows } = await parseJSON(filePath));
      break;
    case 'pdf':
      ({ headers, rows } = await parsePDF(filePath));
      break;
    default:
      throw new Error(`Unsupported file type: .${ext}. Supported: .csv, .xlsx, .xls, .json, .pdf, .tsv, .txt`);
  }

  if (rows.length === 0) {
    return { tableName, rowsCount: 0, columns: [], types: {} };
  }
  if (rows.length > MAX_ROWS || headers.length > MAX_COLUMNS) {
    throw new Error(`File exceeds limits (${MAX_ROWS} rows, ${MAX_COLUMNS} columns).`);
  }

  // Sanitize headers
  const sanitizedHeaders = headers.map((h, i) => sanitizeIdentifier(h || `col_${i + 1}`));

  // Remap row keys to sanitized headers
  const cleanRows = rows.map(row => {
    const out = {};
    headers.forEach((origH, idx) => {
      const sanH = sanitizedHeaders[idx];
      out[sanH] = row[origH] !== undefined ? row[origH] : null;
    });
    return out;
  });

  // Infer column types from actual data
  const typeMap = inferAllColumnTypes(sanitizedHeaders, cleanRows);

  // Import into database
  await importToDatabase(tableName, sanitizedHeaders, typeMap, cleanRows, { replace });

  // Build type info for response
  const typeInfo = {};
  for (const [col, type] of typeMap.entries()) {
    typeInfo[col] = type;
  }

  return {
    tableName,
    rowsCount: cleanRows.length,
    columns: sanitizedHeaders,
    types: typeInfo
  };
}

// ─── Excel Parser ────────────────────────────────────────────────────────────

async function parseExcel(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const workbook = xlsx.read(fileBuffer, { type: 'buffer', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const ws = workbook.Sheets[sheetName];

  if (!ws['!ref']) return { headers: [], rows: [] };

  const sheetData = xlsx.utils.sheet_to_json(ws, { header: 1, defval: null });
  if (sheetData.length < 2) return { headers: [], rows: [] };

  const rawHeaders = sheetData[0].map(h => String(h || '').trim());
  const rows = [];

  for (let i = 1; i < sheetData.length; i++) {
    const rowData = sheetData[i];
    if (!rowData || rowData.every(v => v === null || v === '')) continue;

    const out = {};
    rawHeaders.forEach((h, idx) => {
      let val = rowData[idx];
      if (val instanceof Date) {
        val = val.toISOString().split('T')[0];
      } else if (val !== null && val !== undefined) {
        val = String(val).trim();
      }
      out[h] = val || null;
    });
    rows.push(out);
  }

  return { headers: rawHeaders, rows };
}

// ─── CSV/TSV Parser ──────────────────────────────────────────────────────────

function parseCSV(filePath, separator = ',') {
  return new Promise((resolve, reject) => {
    const headers = [];
    const rows = [];

    fs.createReadStream(filePath, { encoding: 'utf-8' })
      .pipe(csv({ separator }))
      .on('headers', (h) => {
        headers.push(...h.map(name => String(name).trim()));
      })
      .on('data', (data) => {
        const out = {};
        headers.forEach((h, idx) => {
          const keys = Object.keys(data);
          const val = data[keys[idx]];
          out[h] = (val !== undefined && val !== '') ? String(val).trim() : null;
        });
        rows.push(out);
      })
      .on('end', () => resolve({ headers, rows }))
      .on('error', reject);
  });
}

// ─── JSON Parser ─────────────────────────────────────────────────────────────

async function parseJSON(filePath) {
  const rawData = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(rawData);
  const dataArr = Array.isArray(parsed) ? parsed : [parsed];

  if (dataArr.length === 0) return { headers: [], rows: [] };

  // Collect all unique keys
  const keySet = new Set();
  dataArr.forEach(obj => {
    if (obj && typeof obj === 'object') {
      Object.keys(obj).forEach(k => keySet.add(k));
    }
  });

  const headers = Array.from(keySet);
  const rows = dataArr.map(r => {
    const out = {};
    headers.forEach(h => {
      let val = r[h];
      if (val !== null && typeof val === 'object') val = JSON.stringify(val);
      else if (val !== null && val !== undefined) val = String(val);
      out[h] = val || null;
    });
    return out;
  });

  return { headers, rows };
}

// ─── PDF Parser ──────────────────────────────────────────────────────────────

async function parsePDF(filePath) {
  const dataBuffer = fs.readFileSync(filePath);
  const pdfData = await pdfParse(dataBuffer);
  const rawText = pdfData.text;

  const dataArr = await parsePDFTableToJSON(rawText);
  if (!Array.isArray(dataArr) || dataArr.length === 0) {
    return { headers: [], rows: [] };
  }

  const keySet = new Set();
  dataArr.forEach(obj => {
    if (obj && typeof obj === 'object') {
      Object.keys(obj).forEach(k => keySet.add(k));
    }
  });

  const headers = Array.from(keySet);
  const rows = dataArr.map(r => {
    const out = {};
    headers.forEach(h => {
      let val = r[h];
      if (val !== null && typeof val === 'object') val = JSON.stringify(val);
      else if (val !== null && val !== undefined) val = String(val);
      out[h] = val || null;
    });
    return out;
  });

  return { headers, rows };
}

// ─── Database Import with Typed Columns ──────────────────────────────────────

async function importToDatabase(tableName, headers, typeMap, rows, { replace = false } = {}) {
  const connection = await pool.getConnection();

  try {
    const safeName = sanitizeIdentifier(tableName);

    const [existing] = await connection.execute(
      'SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
      [safeName]
    );
    if (Number(existing[0]?.count) > 0 && !replace) {
      const error = new Error(`Table "${safeName}" already exists. Set replace=true to replace it.`);
      error.status = 409;
      throw error;
    }
    if (replace) await connection.execute(`DROP TABLE IF EXISTS \`${safeName}\``);

    // Create table with inferred types
    const createSQL = generateCreateTableSQL(tableName, headers, typeMap);
    await connection.execute(createSQL);

    // Prepare batch insert
    const safeHeaders = headers.map(h => `\`${sanitizeIdentifier(h)}\``).join(', ');
    const placeholders = headers.map(() => '?').join(', ');
    const insertSQL = `INSERT INTO \`${safeName}\` (${safeHeaders}) VALUES (${placeholders})`;

    // Batch insert in chunks
    const CHUNK_SIZE = 5000;
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      const batchPromises = chunk.map(row => {
        const values = headers.map(h => {
          const val = row[h];
          if (val === null || val === undefined || val === '') return null;
          return val;
        });
        return connection.execute(insertSQL, values);
      });

      // Execute in parallel batches of 50 for throughput
      const PARALLEL = 50;
      for (let j = 0; j < batchPromises.length; j += PARALLEL) {
        await Promise.all(batchPromises.slice(j, j + PARALLEL));
      }
    }

    console.log(`[Upload] Imported ${rows.length} rows into \`${safeName}\` with typed columns`);

  } catch (error) {
    console.error('[Upload] Import error:', error.message);
    const wrapped = new Error(`Database import failed: ${error.message}`);
    wrapped.status = error.status;
    throw wrapped;
  } finally {
    connection.release();
  }
}
