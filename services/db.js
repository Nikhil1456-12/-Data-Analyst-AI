import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { validateGeneratedSQL, validateIdentifier } from './sqlSecurity.js';

dotenv.config();

// ─── Configuration ───────────────────────────────────────────────────────────

let dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'data_analyst',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  waitForConnections: true,
  connectionLimit: 20,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000
};

export let pool = mysql.createPool(dbConfig);

// ─── Database Switching ──────────────────────────────────────────────────────

export async function switchDatabase(newDbName) {
  const safeName = sanitizeIdentifier(newDbName);
  if (pool) await pool.end();
  dbConfig.database = safeName;
  pool = mysql.createPool(dbConfig);
  await ensureSystemTables();
}

export async function getDatabases() {
  const [rows] = await pool.execute('SHOW DATABASES');
  const systemDbs = ['information_schema', 'mysql', 'performance_schema', 'sys'];
  return rows
    .map(row => Object.values(row)[0])
    .filter(db => !systemDbs.includes(db));
}

export async function tableExists(tableName) {
  const safeName = validateIdentifier(tableName, 'table name');
  const [rows] = await pool.execute(
    'SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
    [safeName]
  );
  return Number(rows[0]?.count) > 0;
}

// ─── Utility: Sanitize Identifiers ──────────────────────────────────────────

export function sanitizeIdentifier(name, maxLen = 64) {
  if (!name) return 'col';
  let san = String(name).trim().replace(/[^a-zA-Z0-9_]/g, '_');
  san = san.replace(/_+/g, '_').replace(/^_|_$/g, '');
  if (/^[0-9]/.test(san)) san = 'col_' + san;
  if (san.length > maxLen) san = san.slice(0, maxLen);
  return san || 'col';
}

export { validateGeneratedSQL, validateIdentifier };

// ─── Smart Type Inference ────────────────────────────────────────────────────

const TYPE_PATTERNS = {
  integer: /^-?\d+$/,
  decimal: /^-?\d+\.\d+$/,
  date: /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/,
  datetime: /^\d{4}[-/]\d{1,2}[-/]\d{1,2}[\sT]\d{1,2}:\d{2}/,
  boolean: /^(true|false|yes|no|1|0)$/i,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  url: /^https?:\/\//i
};

/**
 * Infers the best MySQL column type from a sample of values.
 * Samples up to 200 values from the column to determine type.
 */
export function inferColumnType(values) {
  const sample = values.slice(0, 200).filter(v => v !== null && v !== undefined && String(v).trim() !== '');
  if (sample.length === 0) return 'TEXT';

  let intCount = 0, decCount = 0, dateCount = 0, datetimeCount = 0, boolCount = 0;
  let maxLen = 0;

  for (const val of sample) {
    const str = String(val).trim();
    maxLen = Math.max(maxLen, str.length);

    if (TYPE_PATTERNS.datetime.test(str)) datetimeCount++;
    else if (TYPE_PATTERNS.date.test(str)) dateCount++;
    else if (TYPE_PATTERNS.integer.test(str)) intCount++;
    else if (TYPE_PATTERNS.decimal.test(str)) decCount++;
    else if (TYPE_PATTERNS.boolean.test(str)) boolCount++;
  }

  const threshold = sample.length * 0.85;

  if (datetimeCount >= threshold) return 'DATETIME';
  if (dateCount >= threshold) return 'DATE';
  if (intCount >= threshold) {
    const maxVal = Math.max(...sample.map(v => Math.abs(parseInt(v) || 0)));
    if (maxVal > 2147483647) return 'BIGINT';
    return 'INT';
  }
  if (decCount >= threshold || (intCount + decCount) >= threshold) return 'DECIMAL(18,4)';
  if (boolCount >= threshold) return 'TINYINT(1)';

  // Text sizing
  if (maxLen <= 50) return 'VARCHAR(100)';
  if (maxLen <= 255) return 'VARCHAR(255)';
  if (maxLen <= 1000) return 'VARCHAR(1000)';
  return 'TEXT';
}

/**
 * Infers types for all columns given rows of data.
 * Returns a Map of columnName -> MySQL type string.
 */
export function inferAllColumnTypes(headers, rows) {
  const typeMap = new Map();
  for (const header of headers) {
    const columnValues = rows.map(row => row[header]);
    typeMap.set(header, inferColumnType(columnValues));
  }
  return typeMap;
}

// ─── Table Creation with Typed Columns ───────────────────────────────────────

export function generateCreateTableSQL(tableName, headers, typeMap) {
  const safeName = sanitizeIdentifier(tableName);
  const columns = headers.map(h => {
    const safeCol = sanitizeIdentifier(h);
    const colType = typeMap.get(h) || 'TEXT';
    return `  \`${safeCol}\` ${colType}`;
  });

  return `CREATE TABLE IF NOT EXISTS \`${safeName}\` (
  \`__row_id\` INT AUTO_INCREMENT PRIMARY KEY,
${columns.join(',\n')}
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
}

// ─── Query Execution ─────────────────────────────────────────────────────────

export async function executeQuery(sql, options = {}) {
  try {
    const safeSQL = validateGeneratedSQL(sql, options);
    const [rows] = await pool.execute(safeSQL);
    return rows;
  } catch (error) {
    console.error('[DB] Query error:', error.message);
    throw error;
  }
}

export async function executeQueryWithFields(sql) {
  try {
    const [rows, fields] = await pool.execute(sql);
    return { rows, fields };
  } catch (error) {
    console.error('[DB] Query error:', error.message);
    throw error;
  }
}

export async function executeRawQuery(sql, params = []) {
  try {
    const [rows] = await pool.execute(sql, params);
    return rows;
  } catch (error) {
    console.error('[DB] Raw query error:', error.message);
    throw error;
  }
}

// ─── Schema Introspection ────────────────────────────────────────────────────

export async function getDatabaseSchema() {
  try {
    const [tables] = await pool.execute('SHOW TABLES');
    let schemaStr = '';

    for (const tableRow of tables) {
      const tableName = Object.values(tableRow)[0];
      if (tableName.startsWith('__sys_')) continue;

      const [columns] = await pool.execute(`SHOW COLUMNS FROM \`${tableName}\``);
      const colDescriptions = columns
        .filter(c => c.Field !== '__row_id')
        .map(c => `${c.Field} (${c.Type})`)
        .join(', ');
      schemaStr += `Table: ${tableName} | Columns: ${colDescriptions}\n`;
    }

    return schemaStr;
  } catch (error) {
    console.error('[DB] Schema fetch error:', error.message);
    return '';
  }
}

export async function getDetailedSchema() {
  try {
    const [tables] = await pool.execute('SHOW TABLES');
    const schema = [];

    for (const tableRow of tables) {
      const tableName = Object.values(tableRow)[0];
      if (tableName.startsWith('__sys_')) continue;

      const [columns] = await pool.execute(`SHOW COLUMNS FROM \`${tableName}\``);
      const [countResult] = await pool.execute(`SELECT COUNT(*) as cnt FROM \`${tableName}\``);

      schema.push({
        tableName,
        rowCount: countResult[0].cnt,
        columns: columns
          .filter(c => c.Field !== '__row_id')
          .map(c => ({
            name: c.Field,
            type: c.Type,
            nullable: c.Null === 'YES',
            key: c.Key,
            default: c.Default
          }))
      });
    }

    return schema;
  } catch (error) {
    console.error('[DB] Detailed schema error:', error.message);
    return [];
  }
}

export async function getDatabaseInfo() {
  try {
    const [dbResult] = await pool.execute('SELECT DATABASE() as activeDb');
    const activeDb = dbResult[0].activeDb || dbConfig.database;
    const schema = await getDetailedSchema();

    return {
      dbName: activeDb,
      tables: schema.map(t => ({
        tableName: t.tableName,
        rowCount: t.rowCount,
        columnCount: t.columns.length
      }))
    };
  } catch (error) {
    console.error('[DB] Info error:', error.message);
    return { dbName: dbConfig.database, tables: [] };
  }
}

export async function getTableStats(tableName) {
  try {
    const safeName = sanitizeIdentifier(tableName);
    const [cols] = await pool.execute(`SHOW COLUMNS FROM \`${safeName}\``);
    const validCols = cols.filter(c => c.Field !== '__row_id');

    const [countRes] = await pool.execute(`SELECT COUNT(*) as c FROM \`${safeName}\``);
    const rowCount = countRes[0].c;

    if (validCols.length === 0 || rowCount === 0) {
      return { rowCount, totalNulls: 0, totalDuplicates: 0, columns: [] };
    }

    // Null count
    const nullSums = validCols.map(c => `SUM(CASE WHEN \`${c.Field}\` IS NULL THEN 1 ELSE 0 END)`).join(' + ');
    const [nullRes] = await pool.execute(`SELECT (${nullSums}) as nulls FROM \`${safeName}\``);
    const totalNulls = Number(nullRes[0].nulls) || 0;

    // Duplicate count
    const groupCols = validCols.map(c => `\`${c.Field}\``).join(', ');
    const [dupRes] = await pool.execute(
      `SELECT COALESCE(SUM(dup_count - 1), 0) as duplicates FROM (SELECT COUNT(*) as dup_count FROM \`${safeName}\` GROUP BY ${groupCols} HAVING dup_count > 1) as subquery`
    );
    const totalDuplicates = Number(dupRes[0].duplicates) || 0;

    return {
      rowCount,
      totalNulls,
      totalDuplicates,
      columns: validCols.map(c => ({ name: c.Field, type: c.Type, nullable: c.Null === 'YES' }))
    };
  } catch (error) {
    console.error(`[DB] Stats error for ${tableName}:`, error.message);
    return { rowCount: 0, totalNulls: 0, totalDuplicates: 0, columns: [] };
  }
}

// ─── Relationship Detection ──────────────────────────────────────────────────

export async function detectRelationships() {
  try {
    const schema = await getDetailedSchema();
    const relationships = [];

    for (let i = 0; i < schema.length; i++) {
      for (let j = i + 1; j < schema.length; j++) {
        const tableA = schema[i];
        const tableB = schema[j];

        const colsA = tableA.columns.map(c => c.name.toLowerCase());
        const colsB = tableB.columns.map(c => c.name.toLowerCase());

        // Find shared column names (potential join keys)
        const shared = colsA.filter(c => colsB.includes(c));
        for (const col of shared) {
          relationships.push({
            tableA: tableA.tableName,
            tableB: tableB.tableName,
            joinColumn: col,
            confidence: 'high'
          });
        }

        // Check for FK patterns: tableA has column named tableB_id or vice versa
        for (const col of colsA) {
          if (col === `${tableB.tableName.toLowerCase()}_id` || col === `${tableB.tableName.toLowerCase()}id`) {
            relationships.push({
              tableA: tableA.tableName,
              tableB: tableB.tableName,
              joinColumn: col,
              confidence: 'medium'
            });
          }
        }
        for (const col of colsB) {
          if (col === `${tableA.tableName.toLowerCase()}_id` || col === `${tableA.tableName.toLowerCase()}id`) {
            relationships.push({
              tableA: tableB.tableName,
              tableB: tableA.tableName,
              joinColumn: col,
              confidence: 'medium'
            });
          }
        }
      }
    }

    return relationships;
  } catch (error) {
    console.error('[DB] Relationship detection error:', error.message);
    return [];
  }
}

// ─── System Tables ───────────────────────────────────────────────────────────

export async function ensureSystemTables() {
  // Query history table
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS \`__sys_history\` (
      \`id\` INT AUTO_INCREMENT PRIMARY KEY,
      \`nl_query\` TEXT NOT NULL,
      \`sql_query\` TEXT,
      \`status\` VARCHAR(20) NOT NULL DEFAULT 'success',
      \`row_count\` INT DEFAULT 0,
      \`error_message\` TEXT,
      \`table_context\` VARCHAR(100) DEFAULT NULL,
      \`execution_time_ms\` INT DEFAULT 0,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Sessions table
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS \`__sys_sessions\` (
      \`id\` VARCHAR(36) PRIMARY KEY,
      \`name\` VARCHAR(255) DEFAULT 'Untitled Session',
      \`queries\` JSON,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Users table (for auth)
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS \`__sys_users\` (
      \`id\` INT AUTO_INCREMENT PRIMARY KEY,
      \`username\` VARCHAR(100) UNIQUE NOT NULL,
      \`password_hash\` VARCHAR(255) NOT NULL,
      \`role\` VARCHAR(20) DEFAULT 'analyst',
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  console.log('[DB] System tables ready');
}

// ─── History Operations ──────────────────────────────────────────────────────

export async function saveHistoryEntry(nlQuery, sqlQuery, status, rowCount, errorMessage, tableContext, executionTimeMs) {
  try {
    await pool.execute(
      `INSERT INTO \`__sys_history\` (nl_query, sql_query, status, row_count, error_message, table_context, execution_time_ms) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [nlQuery, sqlQuery || null, status, rowCount || 0, errorMessage || null, tableContext || null, executionTimeMs || 0]
    );
  } catch (error) {
    console.error('[DB] Failed to save history:', error.message);
  }
}

export async function getHistoryEntries(tableContext = null, limit = 100) {
  try {
    if (tableContext) {
      const [rows] = await pool.execute(
        `SELECT * FROM \`__sys_history\` WHERE table_context = ? ORDER BY created_at DESC LIMIT ?`,
        [tableContext, limit]
      );
      return rows;
    }
    const [rows] = await pool.execute(
      `SELECT * FROM \`__sys_history\` ORDER BY created_at DESC LIMIT ?`,
      [limit]
    );
    return rows;
  } catch (error) {
    console.error('[DB] History fetch error:', error.message);
    return [];
  }
}

export async function clearHistory(tableContext = null) {
  try {
    if (tableContext) {
      await pool.execute(`DELETE FROM \`__sys_history\` WHERE table_context = ?`, [tableContext]);
    } else {
      await pool.execute(`DELETE FROM \`__sys_history\``);
    }
    return true;
  } catch (error) {
    console.error('[DB] History clear error:', error.message);
    throw error;
  }
}

// ─── Column Value Sampling (for profiling) ───────────────────────────────────

export async function sampleColumnValues(tableName, columnName, limit = 1000) {
  const safeTbl = sanitizeIdentifier(tableName);
  const safeCol = sanitizeIdentifier(columnName);
  try {
    const [rows] = await pool.execute(
      `SELECT \`${safeCol}\` as val FROM \`${safeTbl}\` WHERE \`${safeCol}\` IS NOT NULL LIMIT ${limit}`
    );
    return rows.map(r => r.val);
  } catch (error) {
    console.error(`[DB] Sample error for ${tableName}.${columnName}:`, error.message);
    return [];
  }
}

export async function getColumnDistribution(tableName, columnName, limit = 20) {
  const safeTbl = sanitizeIdentifier(tableName);
  const safeCol = sanitizeIdentifier(columnName);
  try {
    const [rows] = await pool.execute(
      `SELECT \`${safeCol}\` as value, COUNT(*) as count FROM \`${safeTbl}\` WHERE \`${safeCol}\` IS NOT NULL GROUP BY \`${safeCol}\` ORDER BY count DESC LIMIT ${limit}`
    );
    return rows;
  } catch (error) {
    console.error(`[DB] Distribution error:`, error.message);
    return [];
  }
}

export async function getNumericStats(tableName, columnName) {
  const safeTbl = sanitizeIdentifier(tableName);
  const safeCol = sanitizeIdentifier(columnName);
  try {
    const [rows] = await pool.execute(`
      SELECT 
        COUNT(\`${safeCol}\`) as count,
        AVG(CAST(\`${safeCol}\` AS DECIMAL(18,4))) as mean,
        MIN(CAST(\`${safeCol}\` AS DECIMAL(18,4))) as min,
        MAX(CAST(\`${safeCol}\` AS DECIMAL(18,4))) as max,
        STDDEV(CAST(\`${safeCol}\` AS DECIMAL(18,4))) as stddev
      FROM \`${safeTbl}\`
      WHERE \`${safeCol}\` IS NOT NULL
    `);
    return rows[0];
  } catch (error) {
    return null;
  }
}
