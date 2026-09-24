import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGeneratedSQL, validateCleaningSQL } from '../services/sqlSecurity.js';

test('accepts one read-only statement and rejects stacked SQL', () => {
  assert.equal(validateGeneratedSQL('SELECT * FROM orders;'), 'SELECT * FROM orders');
  assert.throws(() => validateGeneratedSQL('SELECT 1; DROP TABLE orders'), /one SQL statement|read-only/i);
  assert.throws(() => validateGeneratedSQL('SELECT * FROM __sys_users'), /System tables/);
});

test('cleaning validation limits mutations to the requested table', () => {
  assert.equal(validateCleaningSQL('UPDATE `orders` SET amount = 0', 'orders'), 'UPDATE `orders` SET amount = 0');
  assert.equal(validateCleaningSQL('UPDATE orders SET amount = 0, status = "closed"', 'orders'), 'UPDATE orders SET amount = 0, status = "closed"');
  assert.throws(() => validateCleaningSQL('DROP TABLE orders', 'orders'), /read-only|Unsafe/);
  assert.throws(() => validateCleaningSQL('DELETE FROM users', 'orders'), /unexpected table/);
  assert.throws(() => validateCleaningSQL('UPDATE orders, users SET users.name = "x"', 'orders'), /unexpected|only the requested table/i);
  assert.throws(() => validateCleaningSQL('DELETE FROM orders USING orders, users', 'orders'), /unexpected|only the requested table/i);
  assert.throws(() => validateCleaningSQL('UPDATE orders SET amount = (SELECT amount FROM users)', 'orders'), /only the requested table/i);
});
