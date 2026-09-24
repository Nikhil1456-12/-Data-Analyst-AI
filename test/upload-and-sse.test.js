import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import http from 'node:http';
import { parseCSV, parseJSON } from '../services/fileUpload.js';
import { formatSSE } from '../routes/query.js';
import uploadRoutes, { isReplacementRequested } from '../routes/upload.js';

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

test('SSE errors use a valid event envelope', () => {
  assert.equal(formatSSE('error', 'query failed'), 'event: error\ndata: "query failed"\n\n');
});

test('replacement is opt-in and upload route is protected', async () => {
  assert.equal(isReplacementRequested('true'), true);
  assert.equal(isReplacementRequested('false'), false);
  const app = express();
  app.use('/api/upload', uploadRoutes);
  const server = await new Promise(resolve => {
    const instance = app.listen(0, () => resolve(instance));
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
