const pool = require('../config/db');
const P = require('../config/prefix');
const metaKeys = require('../config/metaKeys');
const { parseList, listResponse } = require('../utils/listParams');
const { slugify, nowLocal } = require('../utils/datetime');
const { hashPassword } = require('../utils/password');
const { serializeCapabilities, parseCapabilities } = require('../utils/php');
const { upsertUserMeta } = require('../utils/meta');
const { withTransaction } = require('../utils/transaction');
const { httpError } = require('../utils/httpError');

const SORT = {
  id: 'u.ID',
  login: 'u.user_login',
  email: 'u.user_email',
  name: 'u.display_name',
  registered: 'u.user_registered',
};

const ADMIN_ROLES = ['administrator', 'shop_manager', 'editor'];

async function list(req) {
  const { page, limit, offset, sortCol, dir, search } = parseList(req, SORT, 'id');
  const role = req.query.role || '';
  const params = [];
  let where = `1=1`;

  if (search) {
    where += ` AND (u.user_login LIKE ? OR u.user_email LIKE ? OR u.display_name LIKE ?)`;
    const q = `%${search}%`;
    params.push(q, q, q);
  }
  if (role) {
    where += ` AND cap.meta_value LIKE ?`;
    params.push(`%${role}%`);
  } else {
    // Default: show users with any admin-capable role
    where += ` AND (${ADMIN_ROLES.map(() => `cap.meta_value LIKE ?`).join(' OR ')})`;
    ADMIN_ROLES.forEach((r) => params.push(`%${r}%`));
  }

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM ${P}users u
     LEFT JOIN ${P}usermeta cap ON cap.user_id = u.ID AND cap.meta_key = ?
     WHERE ${where}`,
    [metaKeys.capabilities, ...params]
  );

  const [rows] = await pool.query(
    `SELECT u.ID AS id, u.user_login AS login, u.user_email AS email,
            u.display_name, u.user_registered AS registered, u.user_status AS status,
            cap.meta_value AS capabilities,
            fn.meta_value AS first_name, ln.meta_value AS last_name
     FROM ${P}users u
     LEFT JOIN ${P}usermeta cap ON cap.user_id = u.ID AND cap.meta_key = ?
     LEFT JOIN ${P}usermeta fn ON fn.user_id = u.ID AND fn.meta_key = 'first_name'
     LEFT JOIN ${P}usermeta ln ON ln.user_id = u.ID AND ln.meta_key = 'last_name'
     WHERE ${where}
     ORDER BY ${sortCol} ${dir}
     LIMIT ? OFFSET ?`,
    [metaKeys.capabilities, ...params, limit, offset]
  );

  const data = rows.map((r) => ({
    id: r.id,
    login: r.login,
    email: r.email,
    display_name: r.display_name,
    registered: r.registered,
    status: r.status,
    first_name: r.first_name,
    last_name: r.last_name,
    roles: parseCapabilities(r.capabilities),
  }));

  return listResponse(data, total, page, limit);
}

async function getById(id) {
  const [[row]] = await pool.query(
    `SELECT u.ID AS id, u.user_login AS login, u.user_email AS email,
            u.display_name, u.user_registered AS registered, u.user_status AS status,
            cap.meta_value AS capabilities
     FROM ${P}users u
     LEFT JOIN ${P}usermeta cap ON cap.user_id = u.ID AND cap.meta_key = ?
     WHERE u.ID = ? LIMIT 1`,
    [metaKeys.capabilities, id]
  );
  if (!row) throw httpError(404, 'User not found');

  const [metaRows] = await pool.query(
    `SELECT meta_key, meta_value FROM ${P}usermeta
     WHERE user_id = ? AND meta_key IN ('first_name','last_name','nickname')`,
    [id]
  );
  const meta = {};
  for (const m of metaRows) meta[m.meta_key] = m.meta_value;

  return {
    id: row.id,
    login: row.login,
    email: row.email,
    display_name: row.display_name,
    registered: row.registered,
    status: row.status,
    roles: parseCapabilities(row.capabilities),
    ...meta,
  };
}

async function create(body) {
  const {
    login,
    email,
    password,
    display_name,
    first_name = '',
    last_name = '',
    roles = ['administrator'],
  } = body || {};

  if (!login || !email || !password) {
    throw httpError(400, 'login, email, and password are required');
  }

  const roleList = Array.isArray(roles) && roles.length ? roles : ['administrator'];
  const nicename = slugify(login);
  const display = display_name || login;
  const hash = hashPassword(password);

  const userId = await withTransaction(pool, async (conn) => {
    const [existing] = await conn.query(
      `SELECT ID FROM ${P}users WHERE user_login = ? OR user_email = ? LIMIT 1`,
      [login, email]
    );
    if (existing.length) throw httpError(409, 'Login or email already exists');

    const [result] = await conn.query(
      `INSERT INTO ${P}users
        (user_login, user_pass, user_nicename, user_email, user_url, user_registered,
         user_activation_key, user_status, display_name)
       VALUES (?, ?, ?, ?, '', ?, '', 0, ?)`,
      [login, hash, nicename, email, nowLocal(), display]
    );
    const id = result.insertId;

    await upsertUserMeta(conn, P, id, 'nickname', login);
    await upsertUserMeta(conn, P, id, 'first_name', first_name);
    await upsertUserMeta(conn, P, id, 'last_name', last_name);
    await upsertUserMeta(conn, P, id, metaKeys.capabilities, serializeCapabilities(roleList));
    await upsertUserMeta(conn, P, id, metaKeys.userLevel, roleList.includes('administrator') ? '10' : '0');

    return id;
  });

  return getById(userId);
}

async function update(id, body) {
  const user = await getById(id);
  const {
    email,
    display_name,
    first_name,
    last_name,
    roles,
    status,
    password,
    active,
  } = body || {};

  return withTransaction(pool, async (conn) => {
    const fields = [];
    const params = [];
    if (email != null) {
      fields.push('user_email = ?');
      params.push(email);
    }
    if (display_name != null) {
      fields.push('display_name = ?');
      params.push(display_name);
    }
    if (status != null) {
      fields.push('user_status = ?');
      params.push(status);
    }
    if (password) {
      fields.push('user_pass = ?');
      params.push(hashPassword(password));
    }
    if (fields.length) {
      params.push(id);
      await conn.query(`UPDATE ${P}users SET ${fields.join(', ')} WHERE ID = ?`, params);
    }

    if (first_name != null) await upsertUserMeta(conn, P, id, 'first_name', first_name);
    if (last_name != null) await upsertUserMeta(conn, P, id, 'last_name', last_name);

    if (Array.isArray(roles) && roles.length) {
      await upsertUserMeta(conn, P, id, metaKeys.capabilities, serializeCapabilities(roles));
      await upsertUserMeta(
        conn,
        P,
        id,
        metaKeys.userLevel,
        roles.includes('administrator') ? '10' : '0'
      );
    } else if (active === false) {
      // Deactivate admin access → subscriber
      await upsertUserMeta(conn, P, id, metaKeys.capabilities, serializeCapabilities(['subscriber']));
      await upsertUserMeta(conn, P, id, metaKeys.userLevel, '0');
    } else if (active === true && (!user.roles || !user.roles.length)) {
      await upsertUserMeta(conn, P, id, metaKeys.capabilities, serializeCapabilities(['administrator']));
      await upsertUserMeta(conn, P, id, metaKeys.userLevel, '10');
    }

    return getById(id);
  });
}

async function remove(id) {
  // Soft deactivate — do not destroy user or password hash
  return update(id, { active: false });
}

module.exports = { list, getById, create, update, remove };
