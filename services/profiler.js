import { pool, sanitizeIdentifier, getNumericStats, getColumnDistribution } from './db.js';

// ─── Automated EDA / Data Profiling ──────────────────────────────────────────

/**
 * Generates a comprehensive data profile for a given table.
 * Includes: row/column counts, type distribution, null analysis,
 * numeric statistics, cardinality, duplicate detection, and anomaly flags.
 */
export async function generateTableProfile(tableName) {
  const safeName = sanitizeIdentifier(tableName);

  // Get basic table info
  const [columns] = await pool.execute(`SHOW COLUMNS FROM \`${safeName}\``);
  const validCols = columns.filter(c => c.Field !== '__row_id');

  const [countRes] = await pool.execute(`SELECT COUNT(*) as total FROM \`${safeName}\``);
  const totalRows = countRes[0].total;

  if (totalRows === 0) {
    return {
      tableName: safeName,
      totalRows: 0,
      totalColumns: validCols.length,
      columns: [],
      dataQuality: { score: 0, issues: ['Table is empty'] },
      anomalies: []
    };
  }

  // Profile each column
  const columnProfiles = [];
  let totalNulls = 0;
  const anomalies = [];

  for (const col of validCols) {
    const profile = await profileColumn(safeName, col.Field, col.Type, totalRows);
    columnProfiles.push(profile);
    totalNulls += profile.nullCount;

    // Flag anomalies
    if (profile.nullPercentage > 50) {
      anomalies.push({
        type: 'high_null_rate',
        column: col.Field,
        severity: 'warning',
        message: `Column "${col.Field}" has ${profile.nullPercentage.toFixed(1)}% null values`
      });
    }
    if (profile.uniquePercentage === 100 && totalRows > 10) {
      anomalies.push({
        type: 'potential_id',
        column: col.Field,
        severity: 'info',
        message: `Column "${col.Field}" has 100% unique values — likely an identifier`
      });
    }
    if (profile.category === 'numeric' && profile.stats && profile.stats.stddev) {
      const mean = parseFloat(profile.stats.mean);
      const std = parseFloat(profile.stats.stddev);
      if (std > mean * 3 && mean !== 0) {
        anomalies.push({
          type: 'high_variance',
          column: col.Field,
          severity: 'warning',
          message: `Column "${col.Field}" has very high variance (σ=${std.toFixed(2)}, μ=${mean.toFixed(2)})`
        });
      }
    }
  }

  // Data quality score
  const nullRate = totalNulls / (totalRows * validCols.length);
  const qualityScore = Math.max(0, Math.round((1 - nullRate) * 100));

  const issues = [];
  if (nullRate > 0.1) issues.push(`Overall null rate is ${(nullRate * 100).toFixed(1)}%`);
  if (anomalies.filter(a => a.severity === 'warning').length > 0) {
    issues.push(`${anomalies.filter(a => a.severity === 'warning').length} columns have quality warnings`);
  }

  // Duplicate detection
  const groupCols = validCols.map(c => `\`${c.Field}\``).join(', ');
  let duplicateCount = 0;
  try {
    const [dupRes] = await pool.execute(
      `SELECT COALESCE(SUM(c - 1), 0) as dups FROM (SELECT COUNT(*) as c FROM \`${safeName}\` GROUP BY ${groupCols} HAVING c > 1) t`
    );
    duplicateCount = Number(dupRes[0].dups) || 0;
  } catch (e) { /* ignore for tables with too many columns */ }

  if (duplicateCount > 0) {
    issues.push(`${duplicateCount} duplicate rows detected`);
    anomalies.push({
      type: 'duplicates',
      column: null,
      severity: 'warning',
      message: `Table contains ${duplicateCount} duplicate rows`
    });
  }

  return {
    tableName: safeName,
    totalRows,
    totalColumns: validCols.length,
    totalNulls,
    duplicateRows: duplicateCount,
    dataQuality: { score: qualityScore, issues },
    columns: columnProfiles,
    anomalies
  };
}

// ─── Column-Level Profiling ──────────────────────────────────────────────────

async function profileColumn(tableName, columnName, columnType, totalRows) {
  const safeCol = `\`${columnName}\``;
  const safeTbl = `\`${tableName}\``;

  // Null count
  const [nullRes] = await pool.execute(
    `SELECT COUNT(*) as cnt FROM ${safeTbl} WHERE ${safeCol} IS NULL`
  );
  const nullCount = nullRes[0].cnt;
  const nullPercentage = (nullCount / totalRows) * 100;

  // Distinct count
  const [distinctRes] = await pool.execute(
    `SELECT COUNT(DISTINCT ${safeCol}) as cnt FROM ${safeTbl} WHERE ${safeCol} IS NOT NULL`
  );
  const uniqueCount = distinctRes[0].cnt;
  const uniquePercentage = totalRows > 0 ? (uniqueCount / (totalRows - nullCount)) * 100 : 0;

  // Categorize column
  const category = categorizeColumnType(columnType);

  const profile = {
    name: columnName,
    type: columnType,
    category,
    nullCount,
    nullPercentage,
    uniqueCount,
    uniquePercentage: Math.min(uniquePercentage, 100),
    nonNullCount: totalRows - nullCount
  };

  // Numeric-specific stats
  if (category === 'numeric') {
    const stats = await getNumericStats(tableName, columnName);
    if (stats) {
      profile.stats = {
        mean: stats.mean !== null ? parseFloat(stats.mean) : null,
        min: stats.min !== null ? parseFloat(stats.min) : null,
        max: stats.max !== null ? parseFloat(stats.max) : null,
        stddev: stats.stddev !== null ? parseFloat(stats.stddev) : null,
        range: stats.min !== null && stats.max !== null ? parseFloat(stats.max) - parseFloat(stats.min) : null
      };
    }
  }

  // Top values (frequency distribution)
  if (uniqueCount <= 50 || category === 'categorical') {
    const distribution = await getColumnDistribution(tableName, columnName, 10);
    profile.topValues = distribution.map(d => ({
      value: d.value,
      count: d.count,
      percentage: ((d.count / totalRows) * 100).toFixed(1)
    }));
  }

  // Sample values
  try {
    const [samples] = await pool.execute(
      `SELECT ${safeCol} as val FROM ${safeTbl} WHERE ${safeCol} IS NOT NULL LIMIT 5`
    );
    profile.sampleValues = samples.map(s => s.val);
  } catch (e) {
    profile.sampleValues = [];
  }

  return profile;
}

// ─── Column Type Categorization ──────────────────────────────────────────────

function categorizeColumnType(mysqlType) {
  const t = mysqlType.toLowerCase();
  if (t.includes('int') || t.includes('decimal') || t.includes('float') || t.includes('double') || t.includes('numeric')) {
    return 'numeric';
  }
  if (t.includes('date') || t.includes('time') || t.includes('timestamp')) {
    return 'datetime';
  }
  if (t.includes('tinyint(1)') || t.includes('bool')) {
    return 'boolean';
  }
  if (t.includes('varchar') && t.includes('(') && parseInt(t.match(/\d+/)?.[0] || '256') <= 100) {
    return 'categorical';
  }
  return 'text';
}

// ─── Correlation Analysis ────────────────────────────────────────────────────

export async function getCorrelationMatrix(tableName) {
  const safeName = sanitizeIdentifier(tableName);
  const [columns] = await pool.execute(`SHOW COLUMNS FROM \`${safeName}\``);

  // Find numeric columns
  const numericCols = columns
    .filter(c => c.Field !== '__row_id' && categorizeColumnType(c.Type) === 'numeric')
    .map(c => c.Field);

  if (numericCols.length < 2) {
    return { columns: numericCols, matrix: [], message: 'Need at least 2 numeric columns for correlation' };
  }

  // Limit to 10 columns max for performance
  const cols = numericCols.slice(0, 10);

  // Calculate pairwise correlations using SQL
  const matrix = [];
  for (const colA of cols) {
    const row = {};
    for (const colB of cols) {
      if (colA === colB) {
        row[colB] = 1.0;
      } else {
        try {
          const [res] = await pool.execute(`
            SELECT 
              (COUNT(*) * SUM(CAST(\`${colA}\` AS DECIMAL(18,4)) * CAST(\`${colB}\` AS DECIMAL(18,4))) - 
               SUM(CAST(\`${colA}\` AS DECIMAL(18,4))) * SUM(CAST(\`${colB}\` AS DECIMAL(18,4)))) /
              (SQRT(COUNT(*) * SUM(POW(CAST(\`${colA}\` AS DECIMAL(18,4)), 2)) - POW(SUM(CAST(\`${colA}\` AS DECIMAL(18,4))), 2)) *
               SQRT(COUNT(*) * SUM(POW(CAST(\`${colB}\` AS DECIMAL(18,4)), 2)) - POW(SUM(CAST(\`${colB}\` AS DECIMAL(18,4))), 2)))
            as correlation
            FROM \`${safeName}\`
            WHERE \`${colA}\` IS NOT NULL AND \`${colB}\` IS NOT NULL
          `);
          row[colB] = res[0].correlation !== null ? parseFloat(Number(res[0].correlation).toFixed(4)) : 0;
        } catch (e) {
          row[colB] = null;
        }
      }
    }
    matrix.push({ column: colA, correlations: row });
  }

  return { columns: cols, matrix };
}

// ─── Outlier Detection ───────────────────────────────────────────────────────

export async function detectOutliers(tableName, columnName, method = 'iqr') {
  const safeTbl = sanitizeIdentifier(tableName);
  const safeCol = sanitizeIdentifier(columnName);

  if (method === 'iqr') {
    // IQR method: values below Q1 - 1.5*IQR or above Q3 + 1.5*IQR
    const [countRes] = await pool.execute(`SELECT COUNT(*) as cnt FROM \`${safeTbl}\` WHERE \`${safeCol}\` IS NOT NULL`);
    const total = countRes[0].cnt;
    const q1Pos = Math.floor(total * 0.25);
    const q3Pos = Math.floor(total * 0.75);

    const [q1Res] = await pool.execute(
      `SELECT CAST(\`${safeCol}\` AS DECIMAL(18,4)) as val FROM \`${safeTbl}\` WHERE \`${safeCol}\` IS NOT NULL ORDER BY CAST(\`${safeCol}\` AS DECIMAL(18,4)) LIMIT 1 OFFSET ${q1Pos}`
    );
    const [q3Res] = await pool.execute(
      `SELECT CAST(\`${safeCol}\` AS DECIMAL(18,4)) as val FROM \`${safeTbl}\` WHERE \`${safeCol}\` IS NOT NULL ORDER BY CAST(\`${safeCol}\` AS DECIMAL(18,4)) LIMIT 1 OFFSET ${q3Pos}`
    );

    if (!q1Res[0] || !q3Res[0]) return { outliers: [], bounds: {} };

    const q1 = parseFloat(q1Res[0].val);
    const q3 = parseFloat(q3Res[0].val);
    const iqr = q3 - q1;
    const lowerBound = q1 - 1.5 * iqr;
    const upperBound = q3 + 1.5 * iqr;

    const [outliers] = await pool.execute(
      `SELECT \`__row_id\`, CAST(\`${safeCol}\` AS DECIMAL(18,4)) as value FROM \`${safeTbl}\` 
       WHERE \`${safeCol}\` IS NOT NULL AND (CAST(\`${safeCol}\` AS DECIMAL(18,4)) < ${lowerBound} OR CAST(\`${safeCol}\` AS DECIMAL(18,4)) > ${upperBound})
       ORDER BY ABS(CAST(\`${safeCol}\` AS DECIMAL(18,4)) - ${(q1 + q3) / 2}) DESC
       LIMIT 50`
    );

    return {
      method: 'IQR',
      column: columnName,
      q1,
      q3,
      iqr,
      lowerBound,
      upperBound,
      outlierCount: outliers.length,
      outliers: outliers.map(o => ({ rowId: o.__row_id, value: parseFloat(o.value) }))
    };
  }

  // Z-score method: |z| > 3
  const stats = await getNumericStats(tableName, columnName);
  if (!stats || !stats.mean || !stats.stddev) {
    return { outliers: [], method: 'zscore', message: 'Insufficient data for z-score analysis' };
  }

  const mean = parseFloat(stats.mean);
  const stddev = parseFloat(stats.stddev);
  const threshold = mean + 3 * stddev;
  const lowerThreshold = mean - 3 * stddev;

  const [outliers] = await pool.execute(
    `SELECT \`__row_id\`, CAST(\`${safeCol}\` AS DECIMAL(18,4)) as value FROM \`${safeTbl}\`
     WHERE \`${safeCol}\` IS NOT NULL AND (CAST(\`${safeCol}\` AS DECIMAL(18,4)) > ${threshold} OR CAST(\`${safeCol}\` AS DECIMAL(18,4)) < ${lowerThreshold})
     LIMIT 50`
  );

  return {
    method: 'Z-Score (|z| > 3)',
    column: columnName,
    mean,
    stddev,
    upperThreshold: threshold,
    lowerThreshold,
    outlierCount: outliers.length,
    outliers: outliers.map(o => ({ rowId: o.__row_id, value: parseFloat(o.value) }))
  };
}
