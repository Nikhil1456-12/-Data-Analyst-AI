import fs from 'fs';
import csv from 'csv-parser';
import * as xlsx from 'xlsx';
import { executeQuery } from './db.js';

function sanitizeColumnName(name) {
  return name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
}

function generateCreateTableSql(tableName, headers) {
  const columns = headers.map(h => {
    let sanName = sanitizeColumnName(h);
    if (!sanName) sanName = 'col_' + Math.floor(Math.random() * 10000);
    return `\`${sanName}\` TEXT`;
  }).join(', ');
  // Use a very unique primary key name to avoid collision with any user CSV columns named "id"
  return `CREATE TABLE IF NOT EXISTS \`${tableName}\` (__internal_id INT AUTO_INCREMENT PRIMARY KEY, ${columns})`;
}

function generateInsertSql(tableName, headers) {
  const columns = headers.map(h => {
    let sanName = sanitizeColumnName(h);
    if (!sanName) sanName = 'col_' + Math.floor(Math.random() * 10000);
    return `\`${sanName}\``;
  }).join(', ');
  
  return `INSERT INTO \`${tableName}\` (${columns}) VALUES ?`;
}

export async function processAndImportFile(filePath, originalFilename) {
  return new Promise((resolve, reject) => {
    let tableName = sanitizeColumnName(originalFilename.split('.')[0]);
    
    let headers = [];
    let rows = [];

    const isExcel = filePath.endsWith('.xlsx') || filePath.endsWith('.xls');

    if (isExcel) {
      try {
        const workbook = xlsx.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        rows = xlsx.utils.sheet_to_json(sheet);
        
        if (rows.length === 0) return resolve({ tableName, rowsCount: 0 });
        headers = Object.keys(rows[0]);
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
    // Disable FK checks to allow out-of-order foreign key data loading
    await connection.execute('SET FOREIGN_KEY_CHECKS=0');

    const createTableStmt = generateCreateTableSql(tableName, headers);
    await connection.execute(createTableStmt);

    // Prepare batch values payload
    const insertStmt = generateInsertSql(tableName, headers);
    const valuesArray = rows.map(row => {
      return headers.map(h => {
        let val = row[h];
        if (val === undefined || val === null) return null;
        return val;
      });
    });

    // Batch insert size limit handling (chunks of 2000 for safety)
    const chunkSize = 2000;
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
    console.error('Import SQL Error:', error);
    throw new Error(`SQL Error during import: ${error.message}`);
  }
}
