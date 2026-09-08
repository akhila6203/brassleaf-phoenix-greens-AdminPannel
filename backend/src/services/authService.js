const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const P = require('../config/prefix');
const metaKeys = require('../config/metaKeys');
const env = require('../config/env');
const { verifyPassword, hashPassword } = require('../utils/password');
const { parseCapabilities, hasAdminRole, serializeCapabilities } = require('../utils/php');
const { upsertUserMeta } = require('../utils/meta');
const { withTransaction } = require('../utils/transaction');

function publicUser(row, roles) {
  return {
    id: row.ID,
    login: row.user_login,
    email: row.user_email,
    display_name: row.display_name,
    roles,
  };
}

async function findUserByLoginOrEmail(identifier) {
  const [rows] = await pool.query(
    `SELECT u.ID, u.user_login, u.user_email, u.user_pass, u.display_name, u.user_status,
            cap.meta_value AS capabilities
     FROM ${P}users u
     LEFT JOIN ${P}usermeta cap
       ON cap.user_id = u.ID AND cap.meta_key = ?
     WHERE u.user_login = ? OR u.user_email = ?
     LIMIT 1`,
    [metaKeys.capabilities, identifier, identifier]
  );
  return rows[0] || null;
}

async function login(username, password) {
  const user = await findUserByLoginOrEmail(username);
  if (!user) {
    const err = new Error('Invalid credentials');
    err.status = 401;
    throw err;
  }
  const roles = parseCapabilities(user.capabilities);
  if (!hasAdminRole(roles)) {
    const err = new Error('Admin access required');
    err.status = 403;
    throw err;
  }
  if (!verifyPassword(password, user.user_pass)) {
    const err = new Error('Invalid credentials');
    err.status = 401;
    throw err;
  }
  const payload = {
    id: user.ID,
    login: user.user_login,
    email: user.user_email,
    roles,
  };
  const token = jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn });
  return { token, user: publicUser(user, roles) };
}

async function me(userId) {
  const [rows] = await pool.query(
    `SELECT u.ID, u.user_login, u.user_email, u.display_name, u.user_status,
            cap.meta_value AS capabilities
     FROM ${P}users u
     LEFT JOIN ${P}usermeta cap
       ON cap.user_id = u.ID AND cap.meta_key = ?
     WHERE u.ID = ?
     LIMIT 1`,
    [metaKeys.capabilities, userId]
  );
  const user = rows[0];
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
  const roles = parseCapabilities(user.capabilities);
  return { user: publicUser(user, roles) };
}

async function resetPassword(userId, newPassword) {
  if (!newPassword || String(newPassword).length < 8) {
    const err = new Error('Password must be at least 8 characters');
    err.status = 400;
    throw err;
  }
  const hash = hashPassword(newPassword);
  await pool.query(`UPDATE ${P}users SET user_pass = ? WHERE ID = ?`, [hash, userId]);
  return { ok: true };
}

module.exports = { login, me, resetPassword, findUserByLoginOrEmail };
