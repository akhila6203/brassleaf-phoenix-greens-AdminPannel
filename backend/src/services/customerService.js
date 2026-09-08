const pool = require('../config/db');
const P = require('../config/prefix');
const metaKeys = require('../config/metaKeys');
const { parseList, listResponse } = require('../utils/listParams');
const { slugify, nowLocal, nowGmt } = require('../utils/datetime');
const { hashPassword } = require('../utils/password');
const { serializeCapabilities } = require('../utils/php');
const { upsertUserMeta } = require('../utils/meta');
const { withTransaction } = require('../utils/transaction');
const { httpError } = require('../utils/httpError');

const SORT = {
  id: 'cl.customer_id',
  email: 'cl.email',
  name: 'cl.last_name',
  registered: 'cl.date_registered',
  active: 'cl.date_last_active',
  orders: 'order_count',
  spent: 'lifetime_value',
};

function pickAddress(metaMap, prefix) {
  return {
    first_name: metaMap[`${prefix}first_name`] || null,
    last_name: metaMap[`${prefix}last_name`] || null,
    company: metaMap[`${prefix}company`] || null,
    address_1: metaMap[`${prefix}address_1`] || null,
    address_2: metaMap[`${prefix}address_2`] || null,
    city: metaMap[`${prefix}city`] || null,
    state: metaMap[`${prefix}state`] || null,
    postcode: metaMap[`${prefix}postcode`] || null,
    country: metaMap[`${prefix}country`] || null,
    email: metaMap[`${prefix}email`] || null,
    phone: metaMap[`${prefix}phone`] || null,
  };
}

async function list(req) {
  const { page, limit, offset, sortCol, dir, search } = parseList(req, SORT, 'active');
  const country = req.query.country || '';
  const params = [];
  let where = '1=1';

  if (search) {
    where += ` AND (cl.email LIKE ? OR cl.first_name LIKE ? OR cl.last_name LIKE ? OR cl.username LIKE ? OR cl.city LIKE ? OR cl.postcode LIKE ?)`;
    const q = `%${search}%`;
    params.push(q, q, q, q, q, q);
  }
  if (country) {
    where += ` AND cl.country = ?`;
    params.push(country);
  }

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM ${P}wc_customer_lookup cl WHERE ${where}`,
    params
  );

   const [rows] = await pool.query(
    `SELECT
       cl.customer_id, cl.customer_id AS id, cl.user_id, cl.username,
       cl.first_name, cl.last_name, cl.email, cl.country, cl.city, cl.state, cl.postcode,
       cl.date_registered, cl.date_last_active, u.user_registered, u.display_name, u.user_status,
       (
  SELECT COUNT(*)
  FROM ${P}wc_orders o
  WHERE o.customer_id = cl.user_id
    AND o.type = 'shop_order'
    AND o.status IN (
      'wc-processing',
      'wc-completed'
    )
    AND EXISTS (
      SELECT 1
      FROM ${P}paytm_order_data p
      WHERE p.order_id = o.id
        AND p.status = '1'
    )
) AS order_count,

(
  SELECT ROUND(
    COALESCE(
      SUM(o.total_amount),
      0
    ),
    2
  )
  FROM ${P}wc_orders o
  WHERE o.customer_id = cl.user_id
    AND o.type = 'shop_order'
    AND o.status IN (
      'wc-processing',
      'wc-completed'
    )
    AND EXISTS (
      SELECT 1
      FROM ${P}paytm_order_data p
      WHERE p.order_id = o.id
        AND p.status = '1'
    )
) AS lifetime_value,

(
  SELECT MAX(o.date_created_gmt)
  FROM ${P}wc_orders o
  WHERE o.customer_id = cl.user_id
    AND o.type = 'shop_order'
    AND o.status IN (
      'wc-processing',
      'wc-completed'
    )
    AND EXISTS (
      SELECT 1
      FROM ${P}paytm_order_data p
      WHERE p.order_id = o.id
        AND p.status = '1'
    )
) AS last_order_date
     FROM ${P}wc_customer_lookup cl
     LEFT JOIN ${P}users u ON u.ID = cl.user_id
     WHERE ${where}
     ORDER BY ${sortCol} ${dir}
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  // const [rows] = await pool.query(
  //   `SELECT
  //      cl.customer_id, cl.customer_id AS id, cl.user_id, cl.username,
  //      cl.first_name, cl.last_name, cl.email, cl.country, cl.city, cl.state, cl.postcode,
  //      cl.date_registered, cl.date_last_active, u.user_registered, u.display_name, u.user_status,
  //      (
  //        SELECT COUNT(*) FROM ${P}wc_orders o
  //        WHERE o.customer_id = cl.user_id AND o.type = 'shop_order'
  //      ) AS order_count,
  //      (
  //        SELECT ROUND(SUM(o.total_amount), 2) FROM ${P}wc_orders o
  //        WHERE o.customer_id = cl.user_id AND o.type = 'shop_order'
  //          AND o.status NOT IN ('wc-cancelled','wc-failed')
  //      ) AS lifetime_value,
  //      (
  //        SELECT MAX(o.date_created_gmt) FROM ${P}wc_orders o
  //        WHERE o.customer_id = cl.user_id AND o.type = 'shop_order'
  //      ) AS last_order_date
  //    FROM ${P}wc_customer_lookup cl
  //    LEFT JOIN ${P}users u ON u.ID = cl.user_id
  //    WHERE ${where}
  //    ORDER BY ${sortCol} ${dir}
  //    LIMIT ? OFFSET ?`,
  //   [...params, limit, offset]
  // );

  const data = rows.map((r) => ({
    ...r,
    orders_count: Number(r.order_count) || 0,
    total_spent: r.lifetime_value != null ? Number(r.lifetime_value) : 0,
    total_spend: r.lifetime_value != null ? Number(r.lifetime_value) : 0,
  }));

  return listResponse(data, total, page, limit);
}

async function getById(id) {
  const [[customer]] = await pool.query(
    `SELECT cl.*, u.user_login, u.user_email, u.display_name, u.user_registered, u.user_status
     FROM ${P}wc_customer_lookup cl
     LEFT JOIN ${P}users u ON u.ID = cl.user_id
     WHERE cl.customer_id = ? OR cl.user_id = ?
     LIMIT 1`,
    [id, id]
  );
  if (!customer) throw httpError(404, 'Customer not found');

  const [meta] = await pool.query(
    `SELECT meta_key, meta_value
     FROM ${P}usermeta
     WHERE user_id = ?
       AND (
         meta_key LIKE 'billing_%' OR meta_key LIKE 'shipping_%'
         OR meta_key IN ('first_name','last_name','nickname')
       )`,
    [customer.user_id]
  );

  const metaMap = {};
  for (const m of meta) metaMap[m.meta_key] = m.meta_value;

  const billing = pickAddress(metaMap, 'billing_');
  const shipping = pickAddress(metaMap, 'shipping_');

  // const [orders] = await pool.query(
  //   `SELECT
  //      o.id, o.status, o.total_amount, o.tax_amount, o.currency,
  //      o.date_created_gmt, o.payment_method, o.payment_method_title, o.transaction_id,
  //      op.shipping_total_amount, op.discount_total_amount
  //    FROM ${P}wc_orders o
  //    LEFT JOIN ${P}wc_order_operational_data op ON op.order_id = o.id
  //    WHERE o.customer_id = ? AND o.type = 'shop_order'
  //    ORDER BY o.date_created_gmt DESC
  //    LIMIT 100`,
  //   [customer.user_id]
  // );

  const [orders] = await pool.query(
  `SELECT
     o.id,
     o.status,
     o.total_amount,
     o.tax_amount,
     o.currency,
     o.date_created_gmt,
     o.payment_method,
     o.payment_method_title,
     o.transaction_id,
     op.shipping_total_amount,
     op.discount_total_amount

   FROM ${P}wc_orders o

   LEFT JOIN ${P}wc_order_operational_data op
     ON op.order_id = o.id

   WHERE o.customer_id = ?
     AND o.type = 'shop_order'

     AND o.status IN (
       'wc-processing',
       'wc-completed'
     )

     AND EXISTS (
       SELECT 1
       FROM ${P}paytm_order_data p
       WHERE p.order_id = o.id
         AND p.status = '1'
     )

   ORDER BY o.date_created_gmt DESC
   LIMIT 100`,
  [customer.user_id]
);


const [[stats]] = await pool.query(
  `SELECT
     COUNT(*) AS total_orders,

     SUM(
       CASE
         WHEN o.status = 'wc-completed'
         THEN 1
         ELSE 0
       END
     ) AS completed_orders,

     SUM(
       CASE
         WHEN o.status = 'wc-processing'
         THEN 1
         ELSE 0
       END
     ) AS processing_orders,

     0 AS cancelled_orders,
     0 AS failed_orders,
     0 AS pending_orders,

     ROUND(
       COALESCE(
         SUM(o.total_amount),
         0
       ),
       2
     ) AS total_spent,

     ROUND(
       COALESCE(
         AVG(o.total_amount),
         0
       ),
       2
     ) AS average_order_value,

     MIN(o.date_created_gmt)
       AS first_order_date,

     MAX(o.date_created_gmt)
       AS last_order_date

   FROM ${P}wc_orders o

   WHERE o.customer_id = ?
     AND o.type = 'shop_order'

     AND o.status IN (
       'wc-processing',
       'wc-completed'
     )

     AND EXISTS (
       SELECT 1
       FROM ${P}paytm_order_data p
       WHERE p.order_id = o.id
         AND p.status = '1'
     )`,
  [customer.user_id]
);
  // const [[stats]] = await pool.query(
  //   `SELECT
  //      COUNT(*) AS total_orders,
  //      SUM(CASE WHEN status = 'wc-completed' THEN 1 ELSE 0 END) AS completed_orders,
  //      SUM(CASE WHEN status = 'wc-processing' THEN 1 ELSE 0 END) AS processing_orders,
  //      SUM(CASE WHEN status = 'wc-cancelled' THEN 1 ELSE 0 END) AS cancelled_orders,
  //      SUM(CASE WHEN status = 'wc-failed' THEN 1 ELSE 0 END) AS failed_orders,
  //      SUM(CASE WHEN status = 'wc-pending' THEN 1 ELSE 0 END) AS pending_orders,
  //      ROUND(COALESCE(SUM(CASE WHEN status NOT IN ('wc-cancelled','wc-failed') THEN total_amount ELSE 0 END), 0), 2) AS total_spent,
  //      ROUND(COALESCE(AVG(CASE WHEN status NOT IN ('wc-cancelled','wc-failed') THEN total_amount ELSE NULL END), 0), 2) AS average_order_value,
  //      MIN(date_created_gmt) AS first_order_date,
  //      MAX(date_created_gmt) AS last_order_date
  //    FROM ${P}wc_orders
  //    WHERE customer_id = ? AND type = 'shop_order'`,
  //   [customer.user_id]
  // );

  // const [payments] = await pool.query(
  //   `SELECT p.id, p.order_id, p.paytm_order_id, p.transaction_id, p.status,
  //           p.date_added, o.total_amount
  //    FROM ${P}paytm_order_data p
  //    JOIN ${P}wc_orders o ON o.id = p.order_id
  //    WHERE o.customer_id = ?
  //    ORDER BY p.date_added DESC
  //    LIMIT 50`,
  //   [customer.user_id]
  // );
  const [payments] = await pool.query(
  `SELECT
     p.id,
     p.order_id,
     p.paytm_order_id,
     p.transaction_id,
     p.status,
     p.date_added,
     o.total_amount

   FROM ${P}paytm_order_data p

   JOIN ${P}wc_orders o
     ON o.id = p.order_id

   WHERE o.customer_id = ?

     AND p.status = '1'

     AND o.status IN (
       'wc-processing',
       'wc-completed'
     )

   ORDER BY p.date_added DESC
   LIMIT 50`,
  [customer.user_id]
);

  const { user_pass, ...safe } = customer;
  return {
    ...safe,
    id: customer.customer_id,
    customer_id: customer.customer_id,
    user_id: customer.user_id,
    phone: billing.phone || metaMap.shipping_phone || null,
    billing,
    shipping,
    addresses: { billing, shipping },
    meta,
    meta_map: metaMap,
    orders,
    payments,
    statistics: {
      total_orders: Number(stats.total_orders) || 0,
      completed_orders: Number(stats.completed_orders) || 0,
      processing_orders: Number(stats.processing_orders) || 0,
      cancelled_orders: Number(stats.cancelled_orders) || 0,
      failed_orders: Number(stats.failed_orders) || 0,
      pending_orders: Number(stats.pending_orders) || 0,
      total_spent: Number(stats.total_spent) || 0,
      average_order_value: Number(stats.average_order_value) || 0,
      first_order_date: stats.first_order_date,
      last_order_date: stats.last_order_date,
    },
    orders_count: Number(stats.total_orders) || 0,
    order_count: Number(stats.total_orders) || 0,
    total_spent: Number(stats.total_spent) || 0,
    total_spend: Number(stats.total_spent) || 0,
  };
}

async function create(data) {
  const email = data.email;
  if (!email) throw httpError(400, 'email is required');
  const username = data.username || email.split('@')[0];
  const first = data.first_name || '';
  const last = data.last_name || '';
  const display = data.display_name || `${first} ${last}`.trim() || username;
  const password = data.password || `Tmp${Date.now()}!x`;

  const [[dup]] = await pool.query(
    `SELECT ID FROM ${P}users WHERE user_login = ? OR user_email = ? LIMIT 1`,
    [username, email]
  );
  if (dup) throw httpError(409, 'User with this login or email already exists');

  const lookupId = await withTransaction(pool, async (conn) => {
    const registered = nowLocal();
    const hash = hashPassword(password);
    const nicename = slugify(username);

    const [userRes] = await conn.query(
      `INSERT INTO ${P}users
        (user_login, user_pass, user_nicename, user_email, user_url, user_registered,
         user_activation_key, user_status, display_name)
       VALUES (?, ?, ?, ?, '', ?, '', 0, ?)`,
      [username, hash, nicename, email, registered, display]
    );
    const userId = userRes.insertId;

    const caps = serializeCapabilities(['customer']);
    await upsertUserMeta(conn, P, userId, 'nickname', username);
    await upsertUserMeta(conn, P, userId, 'first_name', first);
    await upsertUserMeta(conn, P, userId, 'last_name', last);
    await upsertUserMeta(conn, P, userId, metaKeys.capabilities, caps);
    await upsertUserMeta(conn, P, userId, metaKeys.userLevel, '0');
    await upsertUserMeta(conn, P, userId, 'billing_first_name', first);
    await upsertUserMeta(conn, P, userId, 'billing_last_name', last);
    await upsertUserMeta(conn, P, userId, 'billing_email', email);
    if (data.phone) await upsertUserMeta(conn, P, userId, 'billing_phone', data.phone);

    const addrKeys = [
      'billing_address_1', 'billing_address_2', 'billing_city', 'billing_state',
      'billing_postcode', 'billing_country', 'billing_company',
      'shipping_first_name', 'shipping_last_name', 'shipping_address_1',
      'shipping_address_2', 'shipping_city', 'shipping_state',
      'shipping_postcode', 'shipping_country', 'shipping_company', 'shipping_phone',
    ];
    for (const key of addrKeys) {
      if (data[key] != null) await upsertUserMeta(conn, P, userId, key, data[key]);
    }

    const [lookupRes] = await conn.query(
      `INSERT INTO ${P}wc_customer_lookup
        (user_id, username, first_name, last_name, email, date_last_active, date_registered,
         country, postcode, city, state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        username,
        first,
        last,
        email,
        nowGmt(),
        registered,
        data.billing_country || data.country || '',
        data.billing_postcode || data.postcode || '',
        data.billing_city || data.city || '',
        data.billing_state || data.state || '',
      ]
    );

    return lookupRes.insertId;
  });

  return getById(lookupId);
}

async function update(id, data) {
  const customer = await getById(id);
  const userId = customer.user_id;

  await withTransaction(pool, async (conn) => {
    const email = data.email != null ? data.email : customer.email;
    const first = data.first_name != null ? data.first_name : customer.first_name;
    const last = data.last_name != null ? data.last_name : customer.last_name;
    const display =
      data.display_name ||
      `${first || ''} ${last || ''}`.trim() ||
      customer.display_name ||
      customer.username;

    await conn.query(
      `UPDATE ${P}users SET user_email = ?, display_name = ? WHERE ID = ?`,
      [email, display, userId]
    );

    await upsertUserMeta(conn, P, userId, 'first_name', first || '');
    await upsertUserMeta(conn, P, userId, 'last_name', last || '');
    await upsertUserMeta(conn, P, userId, 'billing_first_name', first || '');
    await upsertUserMeta(conn, P, userId, 'billing_last_name', last || '');
    await upsertUserMeta(conn, P, userId, 'billing_email', email || '');
    if (data.phone != null) {
      await upsertUserMeta(conn, P, userId, 'billing_phone', data.phone);
    }

    const addrKeys = [
      'billing_address_1', 'billing_address_2', 'billing_city', 'billing_state',
      'billing_postcode', 'billing_country', 'billing_company',
      'shipping_first_name', 'shipping_last_name', 'shipping_address_1',
      'shipping_address_2', 'shipping_city', 'shipping_state',
      'shipping_postcode', 'shipping_country', 'shipping_company', 'shipping_phone',
    ];
    for (const key of addrKeys) {
      if (data[key] != null) await upsertUserMeta(conn, P, userId, key, data[key]);
    }

    await conn.query(
      `UPDATE ${P}wc_customer_lookup
       SET first_name = ?, last_name = ?, email = ?,
           city = COALESCE(?, city), state = COALESCE(?, state),
           postcode = COALESCE(?, postcode), country = COALESCE(?, country)
       WHERE user_id = ?`,
      [
        first || '',
        last || '',
        email,
        data.billing_city ?? data.city ?? null,
        data.billing_state ?? data.state ?? null,
        data.billing_postcode ?? data.postcode ?? null,
        data.billing_country ?? data.country ?? null,
        userId,
      ]
    );
  });

  return getById(customer.customer_id);
}

async function remove(id) {
  const customer = await getById(id);
  const [[ord]] = await pool.query(
    `SELECT COUNT(*) AS c FROM ${P}wc_orders WHERE customer_id = ? AND type = 'shop_order'`,
    [customer.user_id]
  );
  if (Number(ord.c) > 0) {
    throw httpError(400, 'Cannot delete customer with orders');
  }

  return withTransaction(pool, async (conn) => {
    await conn.query(`DELETE FROM ${P}wc_customer_lookup WHERE user_id = ?`, [customer.user_id]);
    await conn.query(`DELETE FROM ${P}usermeta WHERE user_id = ?`, [customer.user_id]);
    await conn.query(`DELETE FROM ${P}users WHERE ID = ?`, [customer.user_id]);
    return { ok: true, id: customer.customer_id };
  });
}

module.exports = { list, getById, create, update, remove };



// const pool = require('../config/db');
// const P = require('../config/prefix');
// const { parseList, listResponse } = require('../utils/listParams');
// const { slugify, nowLocal, nowGmt } = require('../utils/datetime');
// const { hashPassword } = require('../utils/password');
// const { serializeCapabilities } = require('../utils/php');
// const { upsertUserMeta } = require('../utils/meta');
// const { withTransaction } = require('../utils/transaction');
// const { httpError } = require('../utils/httpError');

// const SORT = {
//   id: 'cl.customer_id',
//   email: 'cl.email',
//   name: 'cl.last_name',
//   registered: 'cl.date_registered',
//   active: 'cl.date_last_active',
//   orders: 'order_count',
//   spent: 'lifetime_value',
// };

// function pickAddress(metaMap, prefix) {
//   return {
//     first_name: metaMap[`${prefix}first_name`] || null,
//     last_name: metaMap[`${prefix}last_name`] || null,
//     company: metaMap[`${prefix}company`] || null,
//     address_1: metaMap[`${prefix}address_1`] || null,
//     address_2: metaMap[`${prefix}address_2`] || null,
//     city: metaMap[`${prefix}city`] || null,
//     state: metaMap[`${prefix}state`] || null,
//     postcode: metaMap[`${prefix}postcode`] || null,
//     country: metaMap[`${prefix}country`] || null,
//     email: metaMap[`${prefix}email`] || null,
//     phone: metaMap[`${prefix}phone`] || null,
//   };
// }

// async function list(req) {
//   const { page, limit, offset, sortCol, dir, search } = parseList(req, SORT, 'active');
//   const country = req.query.country || '';
//   const params = [];
//   let where = '1=1';

//   if (search) {
//     where += ` AND (cl.email LIKE ? OR cl.first_name LIKE ? OR cl.last_name LIKE ? OR cl.username LIKE ? OR cl.city LIKE ? OR cl.postcode LIKE ?)`;
//     const q = `%${search}%`;
//     params.push(q, q, q, q, q, q);
//   }
//   if (country) {
//     where += ` AND cl.country = ?`;
//     params.push(country);
//   }

//   const [[{ total }]] = await pool.query(
//     `SELECT COUNT(*) AS total FROM ${P}wc_customer_lookup cl WHERE ${where}`,
//     params
//   );

//   const [rows] = await pool.query(
//     `SELECT
//        cl.customer_id, cl.customer_id AS id, cl.user_id, cl.username,
//        cl.first_name, cl.last_name, cl.email, cl.country, cl.city, cl.state, cl.postcode,
//        cl.date_registered, cl.date_last_active, u.user_registered, u.display_name, u.user_status,
//        (
//          SELECT COUNT(*) FROM ${P}wc_orders o
//          WHERE o.customer_id = cl.user_id AND o.type = 'shop_order'
//        ) AS order_count,
//        (
//          SELECT ROUND(SUM(o.total_amount), 2) FROM ${P}wc_orders o
//          WHERE o.customer_id = cl.user_id AND o.type = 'shop_order'
//            AND o.status NOT IN ('wc-cancelled','wc-failed')
//        ) AS lifetime_value,
//        (
//          SELECT MAX(o.date_created_gmt) FROM ${P}wc_orders o
//          WHERE o.customer_id = cl.user_id AND o.type = 'shop_order'
//        ) AS last_order_date
//      FROM ${P}wc_customer_lookup cl
//      LEFT JOIN ${P}users u ON u.ID = cl.user_id
//      WHERE ${where}
//      ORDER BY ${sortCol} ${dir}
//      LIMIT ? OFFSET ?`,
//     [...params, limit, offset]
//   );

//   const data = rows.map((r) => ({
//     ...r,
//     orders_count: Number(r.order_count) || 0,
//     total_spent: r.lifetime_value != null ? Number(r.lifetime_value) : 0,
//     total_spend: r.lifetime_value != null ? Number(r.lifetime_value) : 0,
//   }));

//   return listResponse(data, total, page, limit);
// }

// async function getById(id) {
//   const [[customer]] = await pool.query(
//     `SELECT cl.*, u.user_login, u.user_email, u.display_name, u.user_registered, u.user_status
//      FROM ${P}wc_customer_lookup cl
//      LEFT JOIN ${P}users u ON u.ID = cl.user_id
//      WHERE cl.customer_id = ? OR cl.user_id = ?
//      LIMIT 1`,
//     [id, id]
//   );
//   if (!customer) throw httpError(404, 'Customer not found');

//   const [meta] = await pool.query(
//     `SELECT meta_key, meta_value
//      FROM ${P}usermeta
//      WHERE user_id = ?
//        AND (
//          meta_key LIKE 'billing_%' OR meta_key LIKE 'shipping_%'
//          OR meta_key IN ('first_name','last_name','nickname')
//        )`,
//     [customer.user_id]
//   );

//   const metaMap = {};
//   for (const m of meta) metaMap[m.meta_key] = m.meta_value;

//   const billing = pickAddress(metaMap, 'billing_');
//   const shipping = pickAddress(metaMap, 'shipping_');

//   const [orders] = await pool.query(
//     `SELECT
//        o.id, o.status, o.total_amount, o.tax_amount, o.currency,
//        o.date_created_gmt, o.payment_method, o.payment_method_title, o.transaction_id,
//        op.shipping_total_amount, op.discount_total_amount
//      FROM ${P}wc_orders o
//      LEFT JOIN ${P}wc_order_operational_data op ON op.order_id = o.id
//      WHERE o.customer_id = ? AND o.type = 'shop_order'
//      ORDER BY o.date_created_gmt DESC
//      LIMIT 100`,
//     [customer.user_id]
//   );

//   const [[stats]] = await pool.query(
//     `SELECT
//        COUNT(*) AS total_orders,
//        SUM(CASE WHEN status = 'wc-completed' THEN 1 ELSE 0 END) AS completed_orders,
//        SUM(CASE WHEN status = 'wc-processing' THEN 1 ELSE 0 END) AS processing_orders,
//        SUM(CASE WHEN status = 'wc-cancelled' THEN 1 ELSE 0 END) AS cancelled_orders,
//        SUM(CASE WHEN status = 'wc-failed' THEN 1 ELSE 0 END) AS failed_orders,
//        SUM(CASE WHEN status = 'wc-pending' THEN 1 ELSE 0 END) AS pending_orders,
//        ROUND(COALESCE(SUM(CASE WHEN status NOT IN ('wc-cancelled','wc-failed') THEN total_amount ELSE 0 END), 0), 2) AS total_spent,
//        ROUND(COALESCE(AVG(CASE WHEN status NOT IN ('wc-cancelled','wc-failed') THEN total_amount ELSE NULL END), 0), 2) AS average_order_value,
//        MIN(date_created_gmt) AS first_order_date,
//        MAX(date_created_gmt) AS last_order_date
//      FROM ${P}wc_orders
//      WHERE customer_id = ? AND type = 'shop_order'`,
//     [customer.user_id]
//   );

//   const [payments] = await pool.query(
//     `SELECT p.id, p.order_id, p.paytm_order_id, p.transaction_id, p.status,
//             p.date_added, o.total_amount
//      FROM ${P}paytm_order_data p
//      JOIN ${P}wc_orders o ON o.id = p.order_id
//      WHERE o.customer_id = ?
//      ORDER BY p.date_added DESC
//      LIMIT 50`,
//     [customer.user_id]
//   );

//   const { user_pass, ...safe } = customer;
//   return {
//     ...safe,
//     id: customer.customer_id,
//     customer_id: customer.customer_id,
//     user_id: customer.user_id,
//     phone: billing.phone || metaMap.shipping_phone || null,
//     billing,
//     shipping,
//     addresses: { billing, shipping },
//     meta,
//     meta_map: metaMap,
//     orders,
//     payments,
//     statistics: {
//       total_orders: Number(stats.total_orders) || 0,
//       completed_orders: Number(stats.completed_orders) || 0,
//       processing_orders: Number(stats.processing_orders) || 0,
//       cancelled_orders: Number(stats.cancelled_orders) || 0,
//       failed_orders: Number(stats.failed_orders) || 0,
//       pending_orders: Number(stats.pending_orders) || 0,
//       total_spent: Number(stats.total_spent) || 0,
//       average_order_value: Number(stats.average_order_value) || 0,
//       first_order_date: stats.first_order_date,
//       last_order_date: stats.last_order_date,
//     },
//     orders_count: Number(stats.total_orders) || 0,
//     order_count: Number(stats.total_orders) || 0,
//     total_spent: Number(stats.total_spent) || 0,
//     total_spend: Number(stats.total_spent) || 0,
//   };
// }

// async function create(data) {
//   const email = data.email;
//   if (!email) throw httpError(400, 'email is required');
//   const username = data.username || email.split('@')[0];
//   const first = data.first_name || '';
//   const last = data.last_name || '';
//   const display = data.display_name || `${first} ${last}`.trim() || username;
//   const password = data.password || `Tmp${Date.now()}!x`;

//   const [[dup]] = await pool.query(
//     `SELECT ID FROM ${P}users WHERE user_login = ? OR user_email = ? LIMIT 1`,
//     [username, email]
//   );
//   if (dup) throw httpError(409, 'User with this login or email already exists');

//   const lookupId = await withTransaction(pool, async (conn) => {
//     const registered = nowLocal();
//     const hash = hashPassword(password);
//     const nicename = slugify(username);

//     const [userRes] = await conn.query(
//       `INSERT INTO ${P}users
//         (user_login, user_pass, user_nicename, user_email, user_url, user_registered,
//          user_activation_key, user_status, display_name)
//        VALUES (?, ?, ?, ?, '', ?, '', 0, ?)`,
//       [username, hash, nicename, email, registered, display]
//     );
//     const userId = userRes.insertId;

//     const caps = serializeCapabilities(['customer']);
//     await upsertUserMeta(conn, P, userId, 'nickname', username);
//     await upsertUserMeta(conn, P, userId, 'first_name', first);
//     await upsertUserMeta(conn, P, userId, 'last_name', last);
//     await upsertUserMeta(conn, P, userId, 'wpwd_capabilities', caps);
//     await upsertUserMeta(conn, P, userId, 'wpwd_user_level', '0');
//     await upsertUserMeta(conn, P, userId, 'billing_first_name', first);
//     await upsertUserMeta(conn, P, userId, 'billing_last_name', last);
//     await upsertUserMeta(conn, P, userId, 'billing_email', email);
//     if (data.phone) await upsertUserMeta(conn, P, userId, 'billing_phone', data.phone);

//     const addrKeys = [
//       'billing_address_1', 'billing_address_2', 'billing_city', 'billing_state',
//       'billing_postcode', 'billing_country', 'billing_company',
//       'shipping_first_name', 'shipping_last_name', 'shipping_address_1',
//       'shipping_address_2', 'shipping_city', 'shipping_state',
//       'shipping_postcode', 'shipping_country', 'shipping_company', 'shipping_phone',
//     ];
//     for (const key of addrKeys) {
//       if (data[key] != null) await upsertUserMeta(conn, P, userId, key, data[key]);
//     }

//     const [lookupRes] = await conn.query(
//       `INSERT INTO ${P}wc_customer_lookup
//         (user_id, username, first_name, last_name, email, date_last_active, date_registered,
//          country, postcode, city, state)
//        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//       [
//         userId,
//         username,
//         first,
//         last,
//         email,
//         nowGmt(),
//         registered,
//         data.billing_country || data.country || '',
//         data.billing_postcode || data.postcode || '',
//         data.billing_city || data.city || '',
//         data.billing_state || data.state || '',
//       ]
//     );

//     return lookupRes.insertId;
//   });

//   return getById(lookupId);
// }

// async function update(id, data) {
//   const customer = await getById(id);
//   const userId = customer.user_id;

//   await withTransaction(pool, async (conn) => {
//     const email = data.email != null ? data.email : customer.email;
//     const first = data.first_name != null ? data.first_name : customer.first_name;
//     const last = data.last_name != null ? data.last_name : customer.last_name;
//     const display =
//       data.display_name ||
//       `${first || ''} ${last || ''}`.trim() ||
//       customer.display_name ||
//       customer.username;

//     await conn.query(
//       `UPDATE ${P}users SET user_email = ?, display_name = ? WHERE ID = ?`,
//       [email, display, userId]
//     );

//     await upsertUserMeta(conn, P, userId, 'first_name', first || '');
//     await upsertUserMeta(conn, P, userId, 'last_name', last || '');
//     await upsertUserMeta(conn, P, userId, 'billing_first_name', first || '');
//     await upsertUserMeta(conn, P, userId, 'billing_last_name', last || '');
//     await upsertUserMeta(conn, P, userId, 'billing_email', email || '');
//     if (data.phone != null) {
//       await upsertUserMeta(conn, P, userId, 'billing_phone', data.phone);
//     }

//     const addrKeys = [
//       'billing_address_1', 'billing_address_2', 'billing_city', 'billing_state',
//       'billing_postcode', 'billing_country', 'billing_company',
//       'shipping_first_name', 'shipping_last_name', 'shipping_address_1',
//       'shipping_address_2', 'shipping_city', 'shipping_state',
//       'shipping_postcode', 'shipping_country', 'shipping_company', 'shipping_phone',
//     ];
//     for (const key of addrKeys) {
//       if (data[key] != null) await upsertUserMeta(conn, P, userId, key, data[key]);
//     }

//     await conn.query(
//       `UPDATE ${P}wc_customer_lookup
//        SET first_name = ?, last_name = ?, email = ?,
//            city = COALESCE(?, city), state = COALESCE(?, state),
//            postcode = COALESCE(?, postcode), country = COALESCE(?, country)
//        WHERE user_id = ?`,
//       [
//         first || '',
//         last || '',
//         email,
//         data.billing_city ?? data.city ?? null,
//         data.billing_state ?? data.state ?? null,
//         data.billing_postcode ?? data.postcode ?? null,
//         data.billing_country ?? data.country ?? null,
//         userId,
//       ]
//     );
//   });

//   return getById(customer.customer_id);
// }

// async function remove(id) {
//   const customer = await getById(id);
//   const [[ord]] = await pool.query(
//     `SELECT COUNT(*) AS c FROM ${P}wc_orders WHERE customer_id = ? AND type = 'shop_order'`,
//     [customer.user_id]
//   );
//   if (Number(ord.c) > 0) {
//     throw httpError(400, 'Cannot delete customer with orders');
//   }

//   return withTransaction(pool, async (conn) => {
//     await conn.query(`DELETE FROM ${P}wc_customer_lookup WHERE user_id = ?`, [customer.user_id]);
//     await conn.query(`DELETE FROM ${P}usermeta WHERE user_id = ?`, [customer.user_id]);
//     await conn.query(`DELETE FROM ${P}users WHERE ID = ?`, [customer.user_id]);
//     return { ok: true, id: customer.customer_id };
//   });
// }

// module.exports = { list, getById, create, update, remove };
