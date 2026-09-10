const path = require('path');
const fs = require('fs');
const pool = require('../config/db');
const P = require('../config/prefix');
const env = require('../config/env');
const { parseList, listResponse } = require('../utils/listParams');
const { nowLocal, nowGmt } = require('../utils/datetime');
const { upsertPostMeta } = require('../utils/meta');
const { withTransaction } = require('../utils/transaction');
const { httpError } = require('../utils/httpError');

const SORT = {
  id: 'p.ID',
  date: 'p.post_date',
  title: 'p.post_title',
};

function ensureUploadDir() {
  const dir = path.resolve(__dirname, '../../', env.uploadDir || 'uploads');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function list(req) {
  const { page, limit, offset, sortCol, dir, search } = parseList(req, SORT, 'date');
  const params = [];
  let where = `p.post_type = 'attachment' AND p.post_status IN ('inherit','private','publish')`;

  if (search) {
    where += ` AND (p.post_title LIKE ? OR p.guid LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`);
  }

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM ${P}posts p WHERE ${where}`,
    params
  );

  const [rows] = await pool.query(
    `SELECT p.ID AS id, p.post_title AS title, p.guid AS url, p.post_mime_type AS mime,
            p.post_date AS created_at, p.post_parent AS parent,
            file_pm.meta_value AS file
     FROM ${P}posts p
     LEFT JOIN ${P}postmeta file_pm
       ON file_pm.post_id = p.ID AND file_pm.meta_key = '_wp_attached_file'
     WHERE ${where}
     ORDER BY ${sortCol} ${dir}
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return listResponse(rows, total, page, limit);
}

async function getById(id) {
  const [[row]] = await pool.query(
    `SELECT p.ID AS id, p.post_title AS title, p.guid AS url, p.post_mime_type AS mime,
            p.post_date AS created_at, p.post_parent AS parent,
            file_pm.meta_value AS file
     FROM ${P}posts p
     LEFT JOIN ${P}postmeta file_pm
       ON file_pm.post_id = p.ID AND file_pm.meta_key = '_wp_attached_file'
     WHERE p.ID = ? AND p.post_type = 'attachment'
     LIMIT 1`,
    [id]
  );
  if (!row) throw httpError(404, 'Media not found');
  return row;
}

/**
 * Create a new attachment. Does not modify existing attachment IDs or URLs.
 * Files are stored under backend/uploads and guid points to a local URL for admin preview.
 * For production WC compatibility, sync files into wp-content/uploads on the WordPress host.
 */
async function createFromUpload(file, opts = {}) {
  if (!file) throw httpError(400, 'No file uploaded');

  // const uploadDir = ensureUploadDir();
  // const year = new Date().getFullYear();
  // const month = String(new Date().getMonth() + 1).padStart(2, '0');
  // const relDir = `${year}/${month}`;
  // const absDir = path.join(uploadDir, year, month);
  const uploadDir = ensureUploadDir();

const year = String(
  new Date().getFullYear()
);

const month = String(
  new Date().getMonth() + 1
).padStart(2, '0');

const relDir =
  `${year}/${month}`;

const absDir =
  path.join(
    uploadDir,
    year,
    month
  );

  if (!fs.existsSync(absDir)) fs.mkdirSync(absDir, { recursive: true });

  const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filename = `${Date.now()}-${safeName}`;
  const absPath = path.join(absDir, filename);
  fs.writeFileSync(absPath, file.buffer);

  const relativeFile = `${relDir}/${filename}`;
  const title = opts.title || path.parse(safeName).name;
  const mime = file.mimetype || 'application/octet-stream';
  const local = nowLocal();
  const gmt = nowGmt();

  // Local preview URL — existing WP attachments keep their original guid
  const guid = `http://localhost:${env.port}/uploads/${relativeFile}`;
  // const guid = `${env.apiPublicUrl}/uploads/${relativeFile}`;

  const id = await withTransaction(pool, async (conn) => {
    const [result] = await conn.query(
      `INSERT INTO ${P}posts
        (post_author, post_date, post_date_gmt, post_content, post_title, post_excerpt,
         post_status, comment_status, ping_status, post_password, post_name, to_ping, pinged,
         post_modified, post_modified_gmt, post_content_filtered, post_parent, guid,
         menu_order, post_type, post_mime_type, comment_count)
       VALUES (?, ?, ?, '', ?, '', 'inherit', 'open', 'closed', '', ?, '', '',
               ?, ?, '', ?, ?, 0, 'attachment', ?, 0)`,
      [
        opts.authorId || 1,
        local,
        gmt,
        title,
        slugifySafe(title),
        local,
        gmt,
        opts.parentId || 0,
        guid,
        mime,
      ]
    );
    const newId = result.insertId;
    await upsertPostMeta(conn, P, newId, '_wp_attached_file', relativeFile);
    await upsertPostMeta(conn, P, newId, '_wp_attachment_metadata', '');
    return newId;
  });

  return getById(id);
}

function slugifySafe(input) {
  return String(input || 'attachment')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180) || 'attachment';
}

async function setProductFeatured(productId, attachmentId) {
  return withTransaction(pool, async (conn) => {
    const [[product]] = await conn.query(
      `SELECT ID FROM ${P}posts WHERE ID = ? AND post_type = 'product'`,
      [productId]
    );
    if (!product) throw httpError(404, 'Product not found');
    await getById(attachmentId);
    await upsertPostMeta(conn, P, productId, '_thumbnail_id', String(attachmentId));
    return { product_id: productId, thumbnail_id: attachmentId };
  });
}

async function setProductGallery(productId, attachmentIds) {
  const ids = (attachmentIds || []).map(String).filter(Boolean);
  return withTransaction(pool, async (conn) => {
    const [[product]] = await conn.query(
      `SELECT ID FROM ${P}posts WHERE ID = ? AND post_type = 'product'`,
      [productId]
    );
    if (!product) throw httpError(404, 'Product not found');
    await upsertPostMeta(conn, P, productId, '_product_image_gallery', ids.join(','));
    return { product_id: productId, gallery: ids };
  });
}

/**
 * Soft-safe delete: only trash attachments not used as existing featured/gallery
 * when force is false. Never changes other attachment IDs.
 */
async function remove(id, { force = false } = {}) {
  await getById(id);
  if (!force) {
    const [used] = await pool.query(
      `SELECT post_id FROM ${P}postmeta
       WHERE (meta_key = '_thumbnail_id' AND meta_value = ?)
          OR (meta_key = '_product_image_gallery' AND FIND_IN_SET(?, meta_value))
       LIMIT 1`,
      [String(id), String(id)]
    );
    if (used.length) {
      throw httpError(409, 'Attachment is in use by a product; remove references first or force');
    }
  }
  await pool.query(
    `UPDATE ${P}posts SET post_status = 'trash', post_modified = ?, post_modified_gmt = ? WHERE ID = ?`,
    [nowLocal(), nowGmt(), id]
  );
  return { id, status: 'trash' };
}

module.exports = {
  list,
  getById,
  createFromUpload,
  setProductFeatured,
  setProductGallery,
  remove,
  ensureUploadDir,
};



// const path = require('path');
// const fs = require('fs');
// const pool = require('../config/db');
// const P = require('../config/prefix');
// const env = require('../config/env');
// const { parseList, listResponse } = require('../utils/listParams');
// const { nowLocal, nowGmt } = require('../utils/datetime');
// const { upsertPostMeta } = require('../utils/meta');
// const { withTransaction } = require('../utils/transaction');
// const { httpError } = require('../utils/httpError');

// const SORT = {
//   id: 'p.ID',
//   date: 'p.post_date',
//   title: 'p.post_title',
// };

// function ensureUploadDir() {
//   const dir = path.resolve(__dirname, '../../', env.uploadDir || 'uploads');
//   if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
//   return dir;
// }

// async function list(req) {
//   const { page, limit, offset, sortCol, dir, search } = parseList(req, SORT, 'date');
//   const params = [];
//   let where = `p.post_type = 'attachment' AND p.post_status IN ('inherit','private','publish')`;

//   if (search) {
//     where += ` AND (p.post_title LIKE ? OR p.guid LIKE ?)`;
//     params.push(`%${search}%`, `%${search}%`);
//   }

//   const [[{ total }]] = await pool.query(
//     `SELECT COUNT(*) AS total FROM ${P}posts p WHERE ${where}`,
//     params
//   );

//   const [rows] = await pool.query(
//     `SELECT p.ID AS id, p.post_title AS title, p.guid AS url, p.post_mime_type AS mime,
//             p.post_date AS created_at, p.post_parent AS parent,
//             file_pm.meta_value AS file
//      FROM ${P}posts p
//      LEFT JOIN ${P}postmeta file_pm
//        ON file_pm.post_id = p.ID AND file_pm.meta_key = '_wp_attached_file'
//      WHERE ${where}
//      ORDER BY ${sortCol} ${dir}
//      LIMIT ? OFFSET ?`,
//     [...params, limit, offset]
//   );

//   return listResponse(rows, total, page, limit);
// }

// async function getById(id) {
//   const [[row]] = await pool.query(
//     `SELECT p.ID AS id, p.post_title AS title, p.guid AS url, p.post_mime_type AS mime,
//             p.post_date AS created_at, p.post_parent AS parent,
//             file_pm.meta_value AS file
//      FROM ${P}posts p
//      LEFT JOIN ${P}postmeta file_pm
//        ON file_pm.post_id = p.ID AND file_pm.meta_key = '_wp_attached_file'
//      WHERE p.ID = ? AND p.post_type = 'attachment'
//      LIMIT 1`,
//     [id]
//   );
//   if (!row) throw httpError(404, 'Media not found');
//   return row;
// }

// /**
//  * Create a new attachment. Does not modify existing attachment IDs or URLs.
//  * Files are stored under backend/uploads and guid points to a local URL for admin preview.
//  * For production WC compatibility, sync files into wp-content/uploads on the WordPress host.
//  */
// async function createFromUpload(file, opts = {}) {
//   if (!file) throw httpError(400, 'No file uploaded');

//   const uploadDir = ensureUploadDir();
//   const year = new Date().getFullYear();
//   const month = String(new Date().getMonth() + 1).padStart(2, '0');
//   const relDir = `${year}/${month}`;
//   const absDir = path.join(uploadDir, year, month);
//   if (!fs.existsSync(absDir)) fs.mkdirSync(absDir, { recursive: true });

//   const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
//   const filename = `${Date.now()}-${safeName}`;
//   const absPath = path.join(absDir, filename);
//   fs.writeFileSync(absPath, file.buffer);

//   const relativeFile = `${relDir}/${filename}`;
//   const title = opts.title || path.parse(safeName).name;
//   const mime = file.mimetype || 'application/octet-stream';
//   const local = nowLocal();
//   const gmt = nowGmt();
//   // Local preview URL — existing WP attachments keep their original guid
//   const guid = `http://localhost:${env.port}/uploads/${relativeFile}`;

//   const id = await withTransaction(pool, async (conn) => {
//     const [result] = await conn.query(
//       `INSERT INTO ${P}posts
//         (post_author, post_date, post_date_gmt, post_content, post_title, post_excerpt,
//          post_status, comment_status, ping_status, post_password, post_name, to_ping, pinged,
//          post_modified, post_modified_gmt, post_content_filtered, post_parent, guid,
//          menu_order, post_type, post_mime_type, comment_count)
//        VALUES (?, ?, ?, '', ?, '', 'inherit', 'open', 'closed', '', ?, '', '',
//                ?, ?, '', ?, ?, 0, 'attachment', ?, 0)`,
//       [
//         opts.authorId || 1,
//         local,
//         gmt,
//         title,
//         slugifySafe(title),
//         local,
//         gmt,
//         opts.parentId || 0,
//         guid,
//         mime,
//       ]
//     );
//     const newId = result.insertId;
//     await upsertPostMeta(conn, P, newId, '_wp_attached_file', relativeFile);
//     await upsertPostMeta(conn, P, newId, '_wp_attachment_metadata', '');
//     return newId;
//   });

//   return getById(id);
// }

// function slugifySafe(input) {
//   return String(input || 'attachment')
//     .toLowerCase()
//     .replace(/[^a-z0-9]+/g, '-')
//     .replace(/^-+|-+$/g, '')
//     .slice(0, 180) || 'attachment';
// }

// async function setProductFeatured(productId, attachmentId) {
//   return withTransaction(pool, async (conn) => {
//     const [[product]] = await conn.query(
//       `SELECT ID FROM ${P}posts WHERE ID = ? AND post_type = 'product'`,
//       [productId]
//     );
//     if (!product) throw httpError(404, 'Product not found');
//     await getById(attachmentId);
//     await upsertPostMeta(conn, P, productId, '_thumbnail_id', String(attachmentId));
//     return { product_id: productId, thumbnail_id: attachmentId };
//   });
// }

// async function setProductGallery(productId, attachmentIds) {
//   const ids = (attachmentIds || []).map(String).filter(Boolean);
//   return withTransaction(pool, async (conn) => {
//     const [[product]] = await conn.query(
//       `SELECT ID FROM ${P}posts WHERE ID = ? AND post_type = 'product'`,
//       [productId]
//     );
//     if (!product) throw httpError(404, 'Product not found');
//     await upsertPostMeta(conn, P, productId, '_product_image_gallery', ids.join(','));
//     return { product_id: productId, gallery: ids };
//   });
// }

// /**
//  * Soft-safe delete: only trash attachments not used as existing featured/gallery
//  * when force is false. Never changes other attachment IDs.
//  */
// async function remove(id, { force = false } = {}) {
//   await getById(id);
//   if (!force) {
//     const [used] = await pool.query(
//       `SELECT post_id FROM ${P}postmeta
//        WHERE (meta_key = '_thumbnail_id' AND meta_value = ?)
//           OR (meta_key = '_product_image_gallery' AND FIND_IN_SET(?, meta_value))
//        LIMIT 1`,
//       [String(id), String(id)]
//     );
//     if (used.length) {
//       throw httpError(409, 'Attachment is in use by a product; remove references first or force');
//     }
//   }
//   await pool.query(
//     `UPDATE ${P}posts SET post_status = 'trash', post_modified = ?, post_modified_gmt = ? WHERE ID = ?`,
//     [nowLocal(), nowGmt(), id]
//   );
//   return { id, status: 'trash' };
// }

// module.exports = {
//   list,
//   getById,
//   createFromUpload,
//   setProductFeatured,
//   setProductGallery,
//   remove,
//   ensureUploadDir,
// };
