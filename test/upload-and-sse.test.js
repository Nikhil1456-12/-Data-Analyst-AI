import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import http from 'node:http';
import { parseCSV, parseJSON, parseExcel, parsePDF, MAX_PARSER_BYTES, importToDatabase } from '../services/fileUpload.js';
import { pool } from '../services/db.js';
import { formatSSE } from '../routes/query.js';
import uploadRoutes, { isReplacementRequested } from '../routes/upload.js';
import queryRoutes, { validateQueryForMode } from '../routes/query.js';
import { generateToken } from '../middleware/auth.js';

const fixtureDir = path.join(process.cwd(), 'test', '.fixtures');

test.beforeEach(async () => fs.mkdir(fixtureDir, { recursive: true }));
test.afterEach(async () => fs.rm(fixtureDir, { recursive: true, force: true }));

test('CSV parsing stops at the row resource limit', async () => {
  const file = path.join(fixtureDir, 'too-many.csv');
  await fs.writeFile(file, `value\n${'x\n'.repeat(100001)}`);
  await assert.rejects(parseCSV(file), /100000-row limit/);
});

test('JSON parsing stops before materializing more than the row limit', async () => {
  const file = path.join(fixtureDir, 'too-many.json');
  await fs.writeFile(file, `[${Array.from({ length: 100001 }, () => '{"value":1}').join(',')}]`);
  await assert.rejects(parseJSON(file), /100000-row limit/);
});

test('Excel and PDF reject oversized inputs before parser materialization', async () => {
  const file = path.join(fixtureDir, 'oversized.bin');
  await fs.writeFile(file, Buffer.alloc(MAX_PARSER_BYTES + 1));
  await assert.rejects(parseExcel(file), /parser size limit/);
  await assert.rejects(parsePDF(file), /parser size limit/);
});

test('SSE errors use a valid event envelope', () => {
  assert.equal(formatSSE('error', 'query failed'), 'event: error\ndata: "query failed"\n\n');
});

test('cleaning validation is exact-table scoped for stream and explicit replacement remains opt-in', () => {
  assert.equal(validateQueryForMode('UPDATE orders SET amount = 0', 'clean', 'orders'), 'UPDATE orders SET amount = 0');
  assert.throws(() => validateQueryForMode('UPDATE orders, users SET users.name = "x"', 'clean', 'orders'), /unexpected|only the requested table/i);
  assert.throws(() => validateQueryForMode('DELETE FROM orders USING orders, users', 'clean', 'orders'), /unexpected|only the requested table/i);
  assert.throws(() => validateQueryForMode('UPDATE users SET name = "x"', 'clean', 'orders'), /unexpected table/i);
});

test('SSE cleaning emits an error after headers are sent when target is missing', async () => {
  const app = express();
  app.use('/api/query', queryRoutes);
  const server = await new Promise(resolve => {
    const instance = app.listen(0, () => resolve(instance));
  });
  try {
    const token = generateToken({ id: 1 });
    const response = await new Promise(resolve => {
      const request = http.request({
        port: server.address().port,
        path: '/api/query/stream?mode=clean&query=clean',
        headers: { authorization: `Bearer ${token}` }
      }, res => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ statusCode: res.statusCode, body }));
      });
      request.end();
    });
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /event: error/);
    assert.match(response.body, /target table is required/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('replacement is opt-in and upload route is protected', async () => {
  assert.equal(isReplacementRequested('true'), true);
  assert.equal(isReplacementRequested('false'), false);
  const app = express();
  app.use('/api/upload', uploadRoutes);
  const server = await new Promise(resolve => {
    const instance = app.listen(0, () => resolve(instance));
  });

  test('database import rejects conflicts and only drops with explicit replacement', async () => {
    const calls = [];
    const connection = {
      execute: async (sql) => {
        calls.push(sql);
        if (sql.startsWith('SELECT COUNT')) return [[{ count: 1 }]];
        return [[]];
      },
      release() {}
    };
    const getConnection = mock.method(pool, 'getConnection', async () => connection);
    try {
      await assert.rejects(
        importToDatabase('orders', ['amount'], new Map([['amount', 'INT']]), [{ amount: 1 }]),
        error => error.status === 409 && /already exists/.test(error.message)
      );
      assert.equal(calls.some(sql => sql.startsWith('DROP TABLE')), false);
      calls.length = 0;
      await importToDatabase('orders', ['amount'], new Map([['amount', 'INT']]), [{ amount: 1 }], { replace: true });
      assert.equal(calls.some(sql => sql.startsWith('DROP TABLE')), true);
    } finally {
      getConnection.mock.restore();
    }
  });

  test('Multer cleanup removes files when parsing fails', async () => {
    const { cleanupUploadedFiles } = await import('../routes/upload.js');
    const file = path.join(fixtureDir, 'partial-upload.csv');
    await fs.writeFile(file, 'value\n1\n');
    await cleanupUploadedFiles([{ path: file }]);
    await assert.rejects(fs.stat(file), { code: 'ENOENT' });
  });
  try {
    const response = await new Promise(resolve => {
      const request = http.request({ port: server.address().port, path: '/api/upload', method: 'POST' }, res => {
        res.resume();
        res.on('end', () => resolve(res));
      });
      request.end();
    });
    assert.equal(response.statusCode, 401);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
