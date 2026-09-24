import test from 'node:test';
import assert from 'node:assert/strict';
import { authMiddleware, generateToken } from '../middleware/auth.js';

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
  };
}

test('rejects requests without a bearer token', () => {
  const res = responseRecorder();
  let called = false;
  authMiddleware({ headers: {} }, res, () => { called = true; });
  assert.equal(res.statusCode, 401);
  assert.equal(called, false);
});

test('accepts a valid HS256 token and attaches the user', () => {
  const req = { headers: { authorization: `Bearer ${generateToken({ id: 7, role: 'analyst' })}` } };
  const res = responseRecorder();
  let called = false;
  authMiddleware(req, res, () => { called = true; });
  assert.equal(called, true);
  assert.equal(req.user.id, 7);
  assert.equal(res.statusCode, 200);
});

test('rejects malformed or unsupported tokens', () => {
  const res = responseRecorder();
  authMiddleware({ headers: { authorization: 'Bearer not-a-jwt' } }, res, () => {});
  assert.equal(res.statusCode, 401);
});
