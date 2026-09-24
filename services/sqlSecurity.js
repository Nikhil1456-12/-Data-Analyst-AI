const SYSTEM_TABLE = /^__sys_/i;
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

export function validateIdentifier(value, label = 'identifier') {
  if (typeof value !== 'string' || !IDENTIFIER.test(value) || SYSTEM_TABLE.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

export function validateGeneratedSQL(sql, { allowMutation = false, tableName = null } = {}) {
  if (typeof sql !== 'string' || sql.length === 0 || sql.length > 100000) {
    throw new Error('Generated SQL is missing or too large');
  }
  const cleaned = sql.trim();
  if (cleaned.includes(';') && !/^([\s\S]*);$/.test(cleaned)) {
    throw new Error('Only one SQL statement is allowed');
  }
  const statement = cleaned.replace(/;\s*$/, '').trim();
  if (!statement || /(--|\/\*|\*\/|#)/.test(statement)) throw new Error('SQL comments are not allowed');
  const keyword = (statement.match(/^[\s(]*([A-Za-z]+)/) || [])[1]?.toUpperCase();
  const readOnly = ['SELECT', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN'].includes(keyword);
  const mutation = ['UPDATE', 'DELETE'].includes(keyword);
  if (!readOnly && !(allowMutation && mutation)) {
    throw new Error('Only read-only SQL is permitted');
  }
  if (/\b(DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|CALL|LOAD|INTO\s+OUTFILE|INTO\s+DUMPFILE|SET\s+GLOBAL)\b/i.test(statement)) {
    throw new Error('Unsafe SQL operation blocked');
  }
  if (/\b(__sys_|information_schema|mysql\.|performance_schema|sys\.)/i.test(statement)) {
    throw new Error('System tables are not accessible');
  }
  if (tableName) {
    validateIdentifier(tableName, 'table name');
    const quoted = `\`${tableName}\``;
    if (!new RegExp(`\\b${tableName}\\b`, 'i').test(statement) && !statement.includes(quoted)) {
      throw new Error('Cleaning query targets an unexpected table');
    }
  }
  return statement;
}

export function validateCleaningSQL(sql, tableName) {
  return validateGeneratedSQL(sql, { allowMutation: true, tableName });
}
