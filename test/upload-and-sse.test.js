import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import http from 'node:http';
import { parseCSV, parseJSON, parseExcel, parsePDF, MAX_PARSER_BYTES, importToDatabase } from '../services/fileUpload.js';
import { pool } from '../services/db.js';
import uploadRoutes from '../routes/upload.js';
import queryRoutes, { formatSSE } from '../routes/query.js';
import { generateToken } from '../middleware/auth.js';
import { parseBoundedArray } from '../services/llm.js';

const fixtureDir = path.join(process.cwd(), 'test', '.fixtures');
test.beforeEach(async () => fs.mkdir(fixtureDir, { recursive: true }));
test.afterEach(async () => fs.rm(fixtureDir, { recursive: true, force: true }));

test('CSV and JSON parsing stop at the row resource limit', async () => {
  const csvFile = path.join(fixtureDir, 'too-many.csv');
  await fs.writeFile(csvFile, `value\n${'x\n'.repeat(100001)}`);
  await assert.rejects(parseCSV(csvFile), /100000-row limit/);
  const jsonFile = path.join(fixtureDir, 'too-many.json');
  await fs.writeFile(jsonFile, `[${Array.from({ length: 100001 }, () => '{"value":1}').join(',')}]`);
  await assert.rejects(parseJSON(jsonFile), /100000-row limit/);
});

test('Excel and PDF reject oversized inputs before parser materialization', async () => {
  const file = path.join(fixtureDir, 'oversized.bin');
  await fs.writeFile(file, Buffer.alloc(MAX_PARSER_BYTES + 1));
  await assert.rejects(parseExcel(file), /parser size limit/);
  await assert.rejects(parsePDF(file), /parser size limit/);
  assert.throws(() => parseBoundedArray(`[${'{"value":1},'.repeat(100001)}]`, 100000, 200), /100000-row limit/);
  const wide = JSON.stringify([Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`column${i}`, i]))]);
  assert.throws(() => parseBoundedArray(wide, 100000, 200), /200-column limit/);
});

test('SSE errors use a valid event envelope', () => {
  assert.equal(formatSSE('error', 'query failed'), 'event: error\ndata: "query failed"\n\n');
});

test('authenticated SSE reports post-header processing failures', async () => {
  const app = express();
  app.use('/api/query', queryRoutes);
  const server = await new Promise(resolve => {
    const instance = app.listen(0, () => resolve(instance));
  });
  try {
    const response = await request(server, '/api/query/stream?query=force-processing-error', {
      authorization: `Bearer ${generateToken({ id: 1 })}`
    });
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /event: state\ndata: "PARSING"/);
    assert.match(response.body, /event: error/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('database import rejects conflicts and only drops with explicit replacement', async () => {
  const calls = [];
  const connection = {
    execute: async sql => {
      calls.push(sql);
      if (sql.startsWith('SELECT COUNT')) return [[{ count: 1 }]];
      return [[]];
    },
    release() {}
  };
  const getConnection = mock.method(pool, 'getConnection', async () => connection);
  try {
    await assert.rejects(importToDatabase('orders', ['amount'], new Map([['amount', 'INT']]), [{ amount: 1 }]), /already exists/);
    assert.equal(calls.some(sql => sql.startsWith('DROP TABLE')), false);
    calls.length = 0;
    await importToDatabase('orders', ['amount'], new Map([['amount', 'INT']]), [{ amount: 1 }], { replace: true });
    assert.equal(calls.some(sql => sql.startsWith('DROP TABLE')), true);
  } finally {
    getConnection.mock.restore();
  }
});

test('upload endpoint exposes conflict and explicit replacement behavior', async () => {
  const app = express();
  app.use('/api/upload', uploadRoutes);
  const connection = {
    execute: async sql => sql.startsWith('SELECT COUNT') ? [[{ count: 1 }]] : [[]],
    release() {}
  };
  const getConnection = mock.method(pool, 'getConnection', async () => connection);
  const server = await new Promise(resolve => {
    const instance = app.listen(0, () => resolve(instance));
  });
  try {
    const token = generateToken({ id: 1 });
    const conflict = await multipart(server, 'data.csv', 'value\n1\n', token, false);
    assert.equal(conflict.statusCode, 409);
    const replacement = await multipart(server, 'data.csv', 'value\n1\n', token, true);
    assert.equal(replacement.statusCode, 200);
  } finally {
    getConnection.mock.restore();
    await new Promise(resolve => server.close(resolve));
  }
});

test('Multer removes files written before a later file-filter failure', async () => {
  const app = express();
  app.use('/api/upload', uploadRoutes);
  const server = await new Promise(resolve => {
    const instance = app.listen(0, () => resolve(instance));
  });
  try {
    const response = await multipart(server, 'good.csv', 'value\n1\n', generateToken({ id: 1 }), false, [
      ['bad.exe', 'not allowed']
    ]);
    assert.equal(response.statusCode, 400);
    const files = await fs.readdir(path.join(process.cwd(), 'uploads')).catch(() => []);
    assert.equal(files.length, 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

function request(server, requestPath, headers = {}) {
  return new Promise(resolve => {
    const req = http.request({ port: server.address().port, path: requestPath, headers }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
    });
    req.end();
  });
}

function multipart(server, filename, content, token, replace, extra = []) {
  const boundary = `----test-${Date.now()}-${Math.random()}`;
  const parts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="replace"\r\n\r\n${replace}\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${filename}"\r\nContent-Type: text/plain\r\n\r\n${content}\r\n`,
    ...extra.map(([name, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${name}"\r\nContent-Type: text/plain\r\n\r\n${value}\r\n`)
  ];
  const body = `${parts.join('')}--${boundary}--\r\n`;
  return new Promise(resolve => {
    const req = http.request({
      port: server.address().port,
      path: '/api/upload',
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'content-length': Buffer.byteLength(body)
      }
    }, res => {
      let responseBody = '';
      res.on('data', chunk => { responseBody += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: responseBody }));
    });
    req.end(body);
  });
}
