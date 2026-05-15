import fs from 'fs';
import csv from 'csv-parser';
import * as xlsx from 'xlsx';
import { executeQuery } from './db.js';

function sanitizeName(name, maxLen = 63) {
  let san = name.replace(/[^a-zA-Z0-9]/g, '_');
  // Collapse consecutive underscores
  san = san.replace(/_+/g, '_');
  if (san.length > maxLen) san = san.slice(0, maxLen);
  // Strip leading digits
  if (/^[0-9]/.test(san)) san = 'col_' + san;
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
  return new Promise((resolve, reject) => {
    let tableName = sanitizeName(originalFilename.split('.')[0]);
    
    let headers = [];
    let rows = [];

    const isExcel = filePath.endsWith('.xlsx') || filePath.endsWith('.xls');

    if (isExcel) {
      try {
        const workbook = xlsx.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const ws = workbook.Sheets[sheetName];
        if (!ws['!ref']) {
          return resolve({ tableName, rowsCount: 0 });
        }
        // Use readFile + sheet_to_json for Excel; the workbook is already
        // decompressed-to-memory by xlsx.readFile (XLSX is ZIP, so even a
        // 250 MB XLSX typically decompresses to << 1 GB of JSON-equivalent
        // objects for web-analyst workloads).
        //
        // For truly tiny memory Excel-only use, replace this block with
        // `xlsx.stream` (v0.19+), but v0.18.5 does not expose that API.
        rows = xlsx.utils.sheet_to_json(ws);
        if (rows.length === 0) return resolve({ tableName, rowsCount: 0 });
        headers = Object.keys(rows[0]).map(h => sanitizeName(h));
        // Rebuild rows dict with sanitised keys
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
    } else {
      // Assume CSV
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('headers', (h) => {
          headers = h;
        })
        .on('data', (data) => rows.push(data))
        .on('end', () => {
          if (rows.length === 0) return resolve({ tableName, rowsCount: 0 });
          importData(tableName, headers, rows).then(resolve).catch(reject);
        })
        .on('error', reject);
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
