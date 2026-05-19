import fs from 'fs';
import csv from 'csv-parser';
import * as xlsx from 'xlsx';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
import { executeQuery } from './db.js';
import { parsePDFTableToJSON } from './llm.js';

function sanitizeName(name, maxLen = 50) {
  if (!name) return 'col';
  let san = String(name).trim().replace(/[^a-zA-Z0-9]/g, '_');
  san = san.replace(/_+/g, '_');
  if (/^[0-9]/.test(san)) san = 'col_' + san;
  if (san.length > maxLen) san = san.slice(0, maxLen);
  san = san.replace(/_$/, ''); // strip trailing underscore
  return san || 'col';
}

function generateCreateTableSql(tableName, headers) {
  const safeTableName = sanitizeName(tableName);
  const columns = headers.map(h => {
    let sanName = sanitizeName(h);
    return `\`${sanName}\` TEXT`;
  }).join(', ');
  const sql = `CREATE TABLE IF NOT EXISTS \`${safeTableName}\` (\`_id\` INT AUTO_INCREMENT PRIMARY KEY, ${columns})`;
  console.log('[fileUpload] generateCreateTableSql | rawTableNameLen:%d safeTableName:%s | SQL: %s',
    tableName.length, safeTableName, sql);
  return sql;
}

function generateInsertSql(tableName, headers, rowCount) {
  const columns = headers.map(h => {
    let sanName = sanitizeName(h);
    return `\`${sanName}\``;
  }).join(', ');
  const safe = sanitizeName(tableName);
  const sql = `INSERT INTO \`${safe}\` (${columns}) VALUES ?`;
  console.log('[fileUpload] generateInsertSql | safeTable:%s rowCount:%d columns:%d | SQL: %s',
    safe, rowCount ?? -1, headers.length, sql);
  return sql;
}

export async function processAndImportFile(filePath, originalFilename) {
  return new Promise(async (resolve, reject) => {
    let tableName = sanitizeName(originalFilename.split('.')[0]);
    
    let headers = [];
    let rows = [];

    const isExcel = originalFilename.toLowerCase().endsWith('.xlsx') || originalFilename.toLowerCase().endsWith('.xls');
    const isJson = originalFilename.toLowerCase().endsWith('.json');
    const isPdf = originalFilename.toLowerCase().endsWith('.pdf');
    const isCsv = originalFilename.toLowerCase().endsWith('.csv') || originalFilename.toLowerCase().endsWith('.txt') || originalFilename.toLowerCase().endsWith('.tsv');

    if (isExcel) {
      try {
        const workbook = xlsx.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const ws = workbook.Sheets[sheetName];
        if (!ws['!ref']) {
          return resolve({ tableName, rowsCount: 0 });
        }
        rows = xlsx.utils.sheet_to_json(ws);
        if (rows.length === 0) return resolve({ tableName, rowsCount: 0 });
        headers = Object.keys(rows[0]).map(h => sanitizeName(h));
        rows = rows.map(r => {
          const out = {};
          headers.forEach((h, idx) => {
            const origKey = Object.keys(r)[idx];
            out[h] = r[origKey] ?? null;
          });
          return out;
        });
        importData(tableName, headers, rows).then(resolve).catch(reject);
      } catch (err) {
        reject(err);
      }
    } else if (isJson) {
      try {
        const rawData = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(rawData);
        const dataArr = Array.isArray(parsed) ? parsed : [parsed];
        if (dataArr.length === 0) return resolve({ tableName, rowsCount: 0 });
        
        // Extract all unique keys from all objects to form complete headers
        const keySet = new Set();
        dataArr.forEach(obj => {
           if (obj && typeof obj === 'object') {
               Object.keys(obj).forEach(k => keySet.add(k));
           }
        });
        const originalHeaders = Array.from(keySet);
        headers = originalHeaders.map(h => sanitizeName(h));
        
        rows = dataArr.map(r => {
          const out = {};
          headers.forEach((h, idx) => {
            const origKey = originalHeaders[idx];
            let val = r[origKey];
            if (val !== null && typeof val === 'object') val = JSON.stringify(val);
            out[h] = val ?? null;
          });
          return out;
        });
        importData(tableName, headers, rows).then(resolve).catch(reject);
      } catch (err) {
        reject(err);
      }
    } else if (isPdf) {
      try {
        const dataBuffer = fs.readFileSync(filePath);
        const pdfData = await pdfParse(dataBuffer);
        const rawText = pdfData.text;

        const dataArr = await parsePDFTableToJSON(rawText);
        if (!Array.isArray(dataArr) || dataArr.length === 0) {
           return resolve({ tableName, rowsCount: 0 });
        }

        const keySet = new Set();
        dataArr.forEach(obj => {
           if (obj && typeof obj === 'object') {
               Object.keys(obj).forEach(k => keySet.add(k));
           }
        });
        const originalHeaders = Array.from(keySet);
        if (originalHeaders.length === 0) return resolve({ tableName, rowsCount: 0 });

        headers = originalHeaders.map(h => sanitizeName(h));
        
        rows = dataArr.map(r => {
          const out = {};
          headers.forEach((h, idx) => {
            const origKey = originalHeaders[idx];
            let val = r[origKey];
            if (val !== null && typeof val === 'object') val = JSON.stringify(val);
            out[h] = val ?? null;
          });
          return out;
        });
        importData(tableName, headers, rows).then(resolve).catch(reject);
      } catch (err) {
        reject(err);
      }
    } else if (isCsv) {
      // Assume CSV or TXT
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('headers', (h) => {
          headers = h.map(name => sanitizeName(name));
        })
        .on('data', (data) => {
          // Re-map row keys to match sanitized headers
          const out = {};
          Object.keys(data).forEach((origKey, idx) => {
            if (headers[idx]) {
              out[headers[idx]] = data[origKey];
            }
          });
          rows.push(out);
        })
        .on('end', () => {
          if (rows.length === 0) return resolve({ tableName, rowsCount: 0 });
          importData(tableName, headers, rows).then(resolve).catch(reject);
        })
        .on('error', reject);
    } else {
      reject(new Error(`Unsupported file type: ${originalFilename}. The AI Data Analyst only extracts tables from .csv, .xlsx, .xls, .json, and .pdf files.`));
    }
  });
}

import { pool } from './db.js';

async function importData(tableName, headers, rows) {
  const connection = await pool.getConnection();
  try {
    await connection.execute('SET FOREIGN_KEY_CHECKS=0');

    const createTableStmt = generateCreateTableSql(tableName, headers);
    await connection.execute(createTableStmt);
    console.log('[fileUpload] CREATE TABLE OK | table:%s rows:%d cols:%d', tableName, rows.length, headers.length);

    // Prepare batch values payload
    const insertStmt = generateInsertSql(tableName, headers, rows.length);
    const valuesArray = rows.map(row => {
      return headers.map(h => {
        let val = row[h];
        if (val === undefined || val === null) return null;
        return val;
      });
    });

    // Batch insert — larger chunks for better throughput on large data sets
    const chunkSize = 20000;
    for (let i = 0; i < valuesArray.length; i += chunkSize) {
      const chunk = valuesArray.slice(i, i + chunkSize);
      await connection.query(insertStmt, [chunk]);
    }

    await connection.execute('SET FOREIGN_KEY_CHECKS=1');
    connection.release();

    return { tableName, rowsCount: rows.length };
  } catch (error) {
    await connection.execute('SET FOREIGN_KEY_CHECKS=1');
    connection.release();
    console.error('[fileUpload] importData ERROR | table:%s rows:%d | raw error:', tableName, rows.length, error.message);
    if (error.sql) console.error('[fileUpload] FAILED SQL:', error.sql);
    throw new Error(`SQL Error during import: ${error.message}`);
  }
}
