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

export let pool = mysql.createPool(dbConfig);

export async function switchDatabase(newDbName) {
  if (pool) await pool.end();
  dbConfig.database = newDbName;
  pool = mysql.createPool(dbConfig);
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
  try {
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
    const info = tablesList.map(row => ({ tableName: Object.values(row)[0] }));
    return { dbName: activeDb, tables: info };
  } catch (error) {
    console.error('Error fetching DB info:', error);
    return { dbName: dbConfig.database, tables: [] };
  }
}

export async function getTableStats(tableName) {
  try {
    const [cols] = await pool.execute(`DESCRIBE \`${tableName}\``);
    const validCols = cols.filter(c => c.Field !== '__internal_id' && c.Field !== 'id').map(c => `\`${c.Field}\``);
    
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
