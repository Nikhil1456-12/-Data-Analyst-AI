import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

let dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'test',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

function sanitizeName(name, maxLen = 64) {
  if (!name) return 'col';
  let san = String(name).trim().replace(/[^a-zA-Z0-9]/g, '_');
  san = san.replace(/_+/g, '_');
  if (/^[0-9]/.test(san)) san = 'col_' + san;
  if (san.length > maxLen) san = san.slice(0, maxLen);
  san = san.replace(/_$/, ''); // strip trailing underscore
  return san || 'col';
}

export let pool = mysql.createPool(dbConfig);

export async function switchDatabase(newDbName) {
  if (pool) await pool.end();
  dbConfig.database = newDbName;
  pool = mysql.createPool(dbConfig);
  await ensureHistoryTable();
}

export async function getDatabases() {
  const [rows] = await pool.execute('SHOW DATABASES');
  const ignore = ['information_schema', 'mysql', 'performance_schema', 'sys'];
  return rows
    .map(row => Object.values(row)[0])
    .filter(db => !ignore.includes(db));
}

export async function executeQuery(sql) {
  // Security check has been removed per user request to allow full CRUD capability
  // Note: Ensure `multipleStatements: true` is configured if dealing with complex scripts, but we stick to queries.
  // Guard: truncate any identifier that exceeds MySQL's max length to avoid silent errors
  try {
    sql = sql.replace(/`([^`]+)`/g, (_, id) => {
      return `\`${id.length > 63 ? id.slice(0, 63) : id}\``;
    });
    const [rows, fields] = await pool.execute(sql);
    return rows;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
}

export async function getDatabaseSchema() {
  try {
    const [tables] = await pool.execute('SHOW TABLES');
    let schemaStr = '';
    
    for (let i = 0; i < tables.length; i++) {
        const tableName = Object.values(tables[i])[0];
        if (tableName === '__internal_history') continue;
        const [columns] = await pool.execute(`DESCRIBE \`${tableName}\``);
        const colNames = columns.map(c => c.Field).join(', ');
        schemaStr += `Table: ${tableName} | Columns: ${colNames}\n`;
    }
    
    return schemaStr;
  } catch (error) {
    console.error('Error fetching schema:', error);
    return 'Could not fetch schema.';
  }
}

export async function getDatabaseInfo() {
  try {
    const [dbResult] = await pool.execute('SELECT DATABASE() as activeDb');
    const activeDb = dbResult[0].activeDb || dbConfig.database;

    const [tablesList] = await pool.execute('SHOW TABLES');
    const info = tablesList
      .map(row => ({ tableName: Object.values(row)[0] }))
      .filter(t => t.tableName !== '__internal_history');
    return { dbName: activeDb, tables: info };
  } catch (error) {
    console.error('Error fetching DB info:', error);
    return { dbName: dbConfig.database, tables: [] };
  }
}

export async function getTableStats(tableName) {
  try {
    // Defensive truncation
    if (tableName.length > 63) tableName = tableName.slice(0, 63);
    const [cols] = await pool.execute(`DESCRIBE \`${tableName}\``);
    const validCols = cols.filter(c => c.Field !== '_id' && c.Field !== 'id').map(c => `\`${c.Field}\``);
    
    let totalNulls = 0;
    let totalDuplicates = 0;
    let rowCount = 0;

    if (validCols.length > 0) {
      const [countRes] = await pool.execute(`SELECT COUNT(*) as c FROM \`${tableName}\``);
      rowCount = countRes[0].c;

      // Only check real nulls, skip casting empty strings which takes too long
      const nullSums = validCols.map(c => `SUM(CASE WHEN ${c} IS NULL THEN 1 ELSE 0 END)`).join(' + ');
      const [nullRes] = await pool.execute(`SELECT (${nullSums}) as nulls FROM \`${tableName}\``);
      totalNulls = Number(nullRes[0].nulls) || 0;

      const groupCols = validCols.join(', ');
      // Wait for duplicate group by...
      const [dupRes] = await pool.execute(`SELECT SUM(dup_count - 1) as duplicates FROM (SELECT COUNT(*) as dup_count FROM \`${tableName}\` GROUP BY ${groupCols} HAVING dup_count > 1) as subquery`);
      totalDuplicates = Number(dupRes[0].duplicates) || 0;
    }
    return { rowCount, totalNulls, totalDuplicates };
  } catch (error) {
    console.error(`Error in stats for ${tableName}:`, error.message);
    return { rowCount: 'Error', totalNulls: 'Error', totalDuplicates: 'Error' };
  }
}

export async function ensureHistoryTable() {
  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS \`__internal_history\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`nl_query\` TEXT NOT NULL,
        \`sql_query\` TEXT,
        \`status\` VARCHAR(20) NOT NULL,
        \`row_count\` INT DEFAULT 0,
        \`error_message\` TEXT,
        \`executed_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    
    // Self-healing migration: Add table_name column if it doesn't exist
    const [columns] = await pool.execute(`SHOW COLUMNS FROM \`__internal_history\` LIKE 'table_name'`);
    if (columns.length === 0) {
      await pool.execute(`ALTER TABLE \`__internal_history\` ADD COLUMN \`table_name\` VARCHAR(100) DEFAULT NULL`);
      console.log('Successfully added table_name column migration to __internal_history.');
    }
    console.log('History table verified/created successfully.');
  } catch (error) {
    console.error('Error ensuring history table:', error);
  }
}

export async function saveHistoryRecordEntry(nlQuery, sqlQuery, status, rowCount, errorMessage, tableName = null) {
  try {
    await pool.execute(
      `INSERT INTO \`__internal_history\` (nl_query, sql_query, status, row_count, error_message, table_name) VALUES (?, ?, ?, ?, ?, ?)`,
      [nlQuery, sqlQuery || null, status, rowCount || 0, errorMessage || null, tableName || null]
    );
  } catch (error) {
    console.error('Failed to save history entry:', error);
  }
}

export async function getHistoryRecords(tableName = null) {
  try {
    if (tableName) {
      const [rows] = await pool.execute(
        `SELECT * FROM \`__internal_history\` WHERE table_name = ? ORDER BY executed_at DESC LIMIT 100`,
        [tableName]
      );
      return rows;
    } else {
      const [rows] = await pool.execute(
        `SELECT * FROM \`__internal_history\` WHERE table_name IS NULL ORDER BY executed_at DESC LIMIT 100`
      );
      return rows;
    }
  } catch (error) {
    console.error('Error fetching history:', error);
    return [];
  }
}

export async function clearHistoryRecords(tableName = null) {
  try {
    if (tableName) {
      await pool.execute(`DELETE FROM \`__internal_history\` WHERE table_name = ?`, [tableName]);
    } else {
      await pool.execute(`DELETE FROM \`__internal_history\` WHERE table_name IS NULL`);
    }
    return true;
  } catch (error) {
    console.error('Error clearing history:', error);
    throw error;
  }
}
