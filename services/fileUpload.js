import fs from 'fs';
import csv from 'csv-parser';
import readXlsxFile from 'read-excel-file/node';
import { Open } from 'unzipper-esm';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
import { streamArray } from 'stream-json/streamers/stream-array.js';

import { pool, sanitizeIdentifier, inferAllColumnTypes, generateCreateTableSQL } from './db.js';
import { parsePDFTableToJSON } from './llm.js';

export const MAX_ROWS = 100000;
export const MAX_COLUMNS = 200;
export const MAX_PARSER_BYTES = 50 * 1024 * 1024;
const MAX_PDF_TEXT_BYTES = 10 * 1024 * 1024;

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

export async function parseExcel(filePath) {
  const { size } = await fs.promises.stat(filePath);
  if (size > MAX_PARSER_BYTES) throw new Error('Spreadsheet exceeds the parser size limit.');
  await preflightExcel(filePath);
  const sheetData = await readXlsxFile(filePath);
  if (sheetData.length < 2) return { headers: [], rows: [] };

  const rawHeaders = sheetData[0].map(h => String(h || '').trim());
  if (rawHeaders.length > MAX_COLUMNS) throw new Error(`File exceeds the ${MAX_COLUMNS}-column limit.`);
  const rows = [];

  for (let i = 1; i < sheetData.length; i++) {
    if (rows.length >= MAX_ROWS) throw new Error(`File exceeds the ${MAX_ROWS}-row limit.`);
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

function columnNumber(letters) {
  return [...letters].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0);
}

export async function preflightExcel(filePath) {
  const archive = await Open.file(filePath);
  const worksheet = archive.files.find(entry => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.path));
  if (!worksheet) throw new Error('Spreadsheet does not contain a worksheet.');
  let rows = 0;
  let maxColumn = 0;
  let carry = '';
  await new Promise((resolve, reject) => {
    const stream = worksheet.stream();
    const inspect = chunk => {
      carry += chunk.toString();
      const splitAt = carry.lastIndexOf('<');
      const complete = splitAt > 0 ? carry.slice(0, splitAt) : '';
      carry = splitAt > 0 ? carry.slice(splitAt) : carry;
      rows += (complete.match(/<row(?:\s|>)/g) || []).length;
      for (const cell of complete.match(/<c[^>]*\br="([A-Z]+)\d+"/g) || []) {
        const ref = cell.match(/\br="([A-Z]+)\d+"/i)?.[1];
        if (ref) maxColumn = Math.max(maxColumn, columnNumber(ref));
      }
      if (rows > MAX_ROWS) stream.destroy(new Error(`File exceeds the ${MAX_ROWS}-row limit.`));
      else if (maxColumn > MAX_COLUMNS) stream.destroy(new Error(`File exceeds the ${MAX_COLUMNS}-column limit.`));
    };
    stream.on('data', inspect).on('end', () => {
      rows += (carry.match(/<row(?:\s|>)/g) || []).length;
      for (const cell of carry.match(/<c[^>]*\br="([A-Z]+)\d+"/g) || []) {
        const ref = cell.match(/\br="([A-Z]+)\d+"/i)?.[1];
        if (ref) maxColumn = Math.max(maxColumn, columnNumber(ref));
      }
      if (rows > MAX_ROWS) return reject(new Error(`File exceeds the ${MAX_ROWS}-row limit.`));
      if (maxColumn > MAX_COLUMNS) return reject(new Error(`File exceeds the ${MAX_COLUMNS}-column limit.`));
      resolve();
    }).on('error', reject);
  });
}

// ─── CSV/TSV Parser ──────────────────────────────────────────────────────────

export function parseCSV(filePath, separator = ',') {
  return new Promise((resolve, reject) => {
    const headers = [];
    const rows = [];

    const stream = fs.createReadStream(filePath, { encoding: 'utf-8' }).pipe(csv({ separator }));
    stream
      .on('headers', (h) => {
        headers.push(...h.map(name => String(name).trim()));
        if (headers.length > MAX_COLUMNS) {
          stream.destroy(new Error(`File exceeds the ${MAX_COLUMNS}-column limit.`));
        }
      })
      .on('data', (data) => {
        if (rows.length >= MAX_ROWS) {
          stream.destroy(new Error(`File exceeds the ${MAX_ROWS}-row limit.`));
          return;
        }
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

export async function parseJSON(filePath) {
  const { size } = await fs.promises.stat(filePath);
  if (size > MAX_PARSER_BYTES) throw new Error('JSON file exceeds the parser size limit.');
  const firstByte = (await fs.promises.open(filePath, 'r'));
  const buffer = Buffer.alloc(1);
  await firstByte.read(buffer, 0, 1, 0);
  await firstByte.close();
  if (buffer.toString() !== '[') {
    const parsed = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
    return normalizeJSONRows([parsed]);
  }
  const dataArr = [];
  await new Promise((resolve, reject) => {
    const input = fs.createReadStream(filePath).pipe(streamArray.withParserAsStream());
    input.on('data', ({ value }) => {
      if (dataArr.length >= MAX_ROWS) {
        input.destroy(new Error(`File exceeds the ${MAX_ROWS}-row limit.`));
        return;
      }
      dataArr.push(value);
    });
    input.on('end', resolve);
    input.on('error', reject);
  });
  return normalizeJSONRows(dataArr);
}

function normalizeJSONRows(dataArr) {
  if (dataArr.length === 0) return { headers: [], rows: [] };

  // Collect all unique keys
  const keySet = new Set();
  dataArr.forEach(obj => {
    if (obj && typeof obj === 'object') {
      Object.keys(obj).forEach(k => keySet.add(k));
    }
  });

  const headers = Array.from(keySet);
  if (headers.length > MAX_COLUMNS) throw new Error(`File exceeds the ${MAX_COLUMNS}-column limit.`);
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

export async function parsePDF(filePath) {
  const { size } = await fs.promises.stat(filePath);
  if (size > MAX_PARSER_BYTES) throw new Error('PDF exceeds the parser size limit.');
  const dataBuffer = await fs.promises.readFile(filePath);
  const pdfData = await pdfParse(dataBuffer);
  const rawText = pdfData.text.slice(0, MAX_PDF_TEXT_BYTES);

  const dataArr = await parsePDFTableToJSON(rawText, { maxRows: MAX_ROWS, maxColumns: MAX_COLUMNS });
  if (!Array.isArray(dataArr) || dataArr.length === 0) {
    return { headers: [], rows: [] };
  }
  if (dataArr.length > MAX_ROWS) {
    throw new Error(`PDF exceeds the ${MAX_ROWS}-row limit.`);
  }

  const keySet = new Set();
  dataArr.forEach(obj => {
    if (obj && typeof obj === 'object') {
      for (const key of Object.keys(obj)) {
        keySet.add(key);
        if (keySet.size > MAX_COLUMNS) {
          throw new Error(`File exceeds the ${MAX_COLUMNS}-column limit.`);
        }
      }
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

export async function importToDatabase(tableName, headers, typeMap, rows, { replace = false } = {}) {
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
