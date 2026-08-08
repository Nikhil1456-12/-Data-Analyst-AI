import bcrypt from 'bcryptjs';
import { pool } from './db.js';
import { generateToken } from '../middleware/auth.js';

// ─── Authentication Service ──────────────────────────────────────────────────

const SALT_ROUNDS = 12;

export async function registerUser(username, password, role = 'analyst') {
  if (!username || !password) {
    throw new Error('Username and password are required');
  }
  if (password.length < 6) {
    throw new Error('Password must be at least 6 characters');
  }
  if (username.length < 3 || username.length > 50) {
    throw new Error('Username must be between 3 and 50 characters');
  }

  // Check if user exists
  const [existing] = await pool.execute(
    'SELECT id FROM `__sys_users` WHERE username = ?', [username]
  );
  if (existing.length > 0) {
    throw new Error('Username already exists');
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  // Insert user
  const [result] = await pool.execute(
    'INSERT INTO `__sys_users` (username, password_hash, role) VALUES (?, ?, ?)',
    [username, passwordHash, role]
  );

  const token = generateToken({ id: result.insertId, username, role });

  return {
    user: { id: result.insertId, username, role },
    token
  };
}

export async function loginUser(username, password) {
  if (!username || !password) {
    throw new Error('Username and password are required');
  }

  const [users] = await pool.execute(
    'SELECT * FROM `__sys_users` WHERE username = ?', [username]
  );

  if (users.length === 0) {
    throw new Error('Invalid username or password');
  }

  const user = users[0];
  const isValid = await bcrypt.compare(password, user.password_hash);

  if (!isValid) {
    throw new Error('Invalid username or password');
  }

  const token = generateToken({ id: user.id, username: user.username, role: user.role });

  return {
    user: { id: user.id, username: user.username, role: user.role },
    token
  };
}

export async function getUserProfile(userId) {
  const [users] = await pool.execute(
    'SELECT id, username, role, created_at FROM `__sys_users` WHERE id = ?', [userId]
  );
  if (users.length === 0) {
    throw new Error('User not found');
  }
  return users[0];
}
