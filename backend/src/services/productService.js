const pool = require('../config/db');
const P = require('../config/prefix');
const env = require('../config/env');
const { parseList, listResponse } = require('../utils/listParams');
const { slugify, nowLocal, nowGmt } = require('../utils/datetime');
const { upsertPostMeta, getPostMetaMap } = require('../utils/meta');
const { withTransaction } = require('../utils/transaction');
const { httpError } = require('../utils/httpError');

const SORT = {
  id: 'p.ID',
  name: 'p.post_title',
  date: 'p.post_date',
  sku: 'ml.sku',
  price: 'ml.min_price',
  sales: 'ml.total_sales',
  stock: 'ml.stock_status',
};

const PRODUCT_TYPE_TT = { simple: 2, variable: 4, grouped: 3, external: 5 };
const DEFAULT_CAT_TT = 144; // Uniforms
const UNCATEGORIZED_TT = 15;
const OUTOFSTOCK_TT = 9;

function resolvePrice(regular, sale) {
  const r = regular == null || regular === '' ? '' : String(regular);
  const s = sale == null || sale === '' ? '' : String(sale);
  if (s !== '' && !Number.isNaN(Number(s))) return s;
  return r;
}

async function syncProductMetaLookup(conn, productId, fields) {
  const {
    sku = '',
    virtual = 0,
    downloadable = 0,
    min_price = 0,
    max_price = 0,
    onsale = 0,
    stock_quantity = null,
    stock_status = 'instock',
    rating_count = 0,
    average_rating = 0,
    total_sales = 0,
    tax_status = 'taxable',
    tax_class = '',
  } = fields;

  const [existing] = await conn.query(
    `SELECT product_id FROM ${P}wc_product_meta_lookup WHERE product_id = ?`,
    [productId]
  );

  if (existing.length) {
    await conn.query(
      `UPDATE ${P}wc_product_meta_lookup SET
         sku = ?, virtual = ?, downloadable = ?, min_price = ?, max_price = ?,
         onsale = ?, stock_quantity = ?, stock_status = ?, rating_count = ?,
         average_rating = ?, total_sales = ?, tax_status = ?, tax_class = ?
       WHERE product_id = ?`,
      [
        sku, virtual ? 1 : 0, downloadable ? 1 : 0, min_price, max_price,
        onsale ? 1 : 0, stock_quantity, stock_status, rating_count,
        average_rating, total_sales, tax_status, tax_class, productId,
      ]
    );
  } else {
    await conn.query(
      `INSERT INTO ${P}wc_product_meta_lookup
        (product_id, sku, virtual, downloadable, min_price, max_price, onsale,
         stock_quantity, stock_status, rating_count, average_rating, total_sales,
         tax_status, tax_class)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        productId, sku, virtual ? 1 : 0, downloadable ? 1 : 0, min_price, max_price,
        onsale ? 1 : 0, stock_quantity, stock_status, rating_count,
        average_rating, total_sales, tax_status, tax_class,
      ]
    );
  }
}

async function bumpTermCount(conn, termTaxonomyId, delta) {
  await conn.query(
    `UPDATE ${P}term_taxonomy SET count = GREATEST(0, count + ?) WHERE term_taxonomy_id = ?`,
    [delta, termTaxonomyId]
  );
}

async function setProductType(conn, productId, typeSlug = 'simple') {
  const ttId = PRODUCT_TYPE_TT[typeSlug] || PRODUCT_TYPE_TT.simple;
  await conn.query(
    `DELETE tr FROM ${P}term_relationships tr
     JOIN ${P}term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id
     WHERE tr.object_id = ? AND tt.taxonomy = 'product_type'`,
    [productId]
  );
  await conn.query(
    `INSERT INTO ${P}term_relationships (object_id, term_taxonomy_id, term_order) VALUES (?, ?, 0)`,
    [productId, ttId]
  );
}

async function setProductCategories(conn, productId, categoryTermTaxonomyIds) {
  const ids = Array.isArray(categoryTermTaxonomyIds) && categoryTermTaxonomyIds.length
    ? categoryTermTaxonomyIds.map(Number)
    : [DEFAULT_CAT_TT];

  const [old] = await conn.query(
    `SELECT tr.term_taxonomy_id
     FROM ${P}term_relationships tr
     JOIN ${P}term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id
     WHERE tr.object_id = ? AND tt.taxonomy = 'product_cat'`,
    [productId]
  );
  for (const row of old) {
    await conn.query(
      `DELETE FROM ${P}term_relationships WHERE object_id = ? AND term_taxonomy_id = ?`,
      [productId, row.term_taxonomy_id]
    );
    await bumpTermCount(conn, row.term_taxonomy_id, -1);
  }

  for (const ttId of ids) {
    await conn.query(
      `INSERT INTO ${P}term_relationships (object_id, term_taxonomy_id, term_order) VALUES (?, ?, 0)`,
      [productId, ttId]
    );
    await bumpTermCount(conn, ttId, 1);
  }
}

async function syncOutOfStockVisibility(conn, productId, stockStatus) {
  const [existing] = await conn.query(
    `SELECT object_id FROM ${P}term_relationships
     WHERE object_id = ? AND term_taxonomy_id = ?`,
    [productId, OUTOFSTOCK_TT]
  );
  if (stockStatus === 'outofstock' && !existing.length) {
    await conn.query(
      `INSERT INTO ${P}term_relationships (object_id, term_taxonomy_id, term_order) VALUES (?, ?, 0)`,
      [productId, OUTOFSTOCK_TT]
    );
    await bumpTermCount(conn, OUTOFSTOCK_TT, 1);
  } else if (stockStatus !== 'outofstock' && existing.length) {
    await conn.query(
      `DELETE FROM ${P}term_relationships WHERE object_id = ? AND term_taxonomy_id = ?`,
      [productId, OUTOFSTOCK_TT]
    );
    await bumpTermCount(conn, OUTOFSTOCK_TT, -1);
  }
}

async function writeProductMeta(conn, productId, data, existingSales) {
  const regular = data.regular_price ?? data.regularPrice ?? '';
  const sale = data.sale_price ?? data.salePrice ?? '';
  const price = resolvePrice(regular, sale);
  const stockQty = data.stock_quantity ?? data.stock ?? null;
  const stockStatus = data.stock_status || 'instock';
  const manageStock = data.manage_stock != null
    ? (data.manage_stock ? 'yes' : 'no')
    : (stockQty != null && stockQty !== '' ? 'yes' : 'no');
  const sku = data.sku || '';
  const taxStatus = data.tax_status || 'taxable';
  const virtual = data.virtual ? 'yes' : 'no';
  const downloadable = data.downloadable ? 'yes' : 'no';
  const totalSales = existingSales != null ? existingSales : (data.total_sales || 0);

  const pairs = [
    ['_sku', sku],
    ['_regular_price', regular === null || regular === undefined ? '' : String(regular)],
    ['_sale_price', sale === null || sale === undefined ? '' : String(sale)],
    ['_price', price],
    ['_stock', stockQty == null || stockQty === '' ? '' : String(stockQty)],
    ['_stock_status', stockStatus],
    ['_manage_stock', manageStock],
    ['_tax_status', taxStatus],
    ['_tax_class', data.tax_class || ''],
    ['_virtual', virtual],
    ['_downloadable', downloadable],
    ['total_sales', String(totalSales)],
  ];

  if (data.weight != null) pairs.push(['_weight', String(data.weight)]);
  if (data.length != null) pairs.push(['_length', String(data.length)]);
  if (data.width != null) pairs.push(['_width', String(data.width)]);
  if (data.height != null) pairs.push(['_height', String(data.height)]);
  if (data.thumbnail_id != null) pairs.push(['_thumbnail_id', String(data.thumbnail_id)]);
  if (data.gallery != null) {
    const gallery = Array.isArray(data.gallery) ? data.gallery.join(',') : String(data.gallery);
    pairs.push(['_product_image_gallery', gallery]);
  }

  for (const [k, v] of pairs) {
    await upsertPostMeta(conn, P, productId, k, v);
  }

  const onsale = sale !== '' && sale != null && Number(sale) < Number(regular || sale);
  await syncProductMetaLookup(conn, productId, {
    sku,
    virtual: virtual === 'yes' ? 1 : 0,
    downloadable: downloadable === 'yes' ? 1 : 0,
    min_price: price === '' ? 0 : Number(price),
    max_price: price === '' ? 0 : Number(price),
    onsale: onsale ? 1 : 0,
    stock_quantity: stockQty === '' || stockQty == null ? null : Number(stockQty),
    stock_status: stockStatus,
    total_sales: Number(totalSales) || 0,
    tax_status: taxStatus,
    tax_class: data.tax_class || '',
  });

  await syncOutOfStockVisibility(conn, productId, stockStatus);
}

async function list(req, options = {}) {
  const {
    publicOnly = false,
  } = options;

  const {
    page,
    limit,
    offset,
    sortCol,
    dir,
    search,
  } = parseList(
    req,
    SORT,
    'date'
  );

  const stockStatus =
    req.query.stock_status || '';

  // const category =
  //   req.query.category || '';
  const category =
  req.query.category || "";

/*
  Customer website can send:

  category=grade1-2

  OR

  category=grade1-2,jacket

  OR

  category=sports-1-5,sr-sports-uniform

  This allows common uniform products to appear
  together with the class-specific products.
*/
const categoryValues = String(category)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

  const status =
    req.query.status || '';

  const params = [];

  let where =
    `p.post_type = 'product'`;

  /* =====================================================
     CUSTOMER WEBSITE

     ONLY PUBLISHED PRODUCTS
  ===================================================== */

  if (publicOnly) {
    where += `
      AND p.post_status = 'publish'
    `;
  }

  /* =====================================================
     ADMIN PANEL

     ADMIN CAN SEE OTHER STATUSES
  ===================================================== */

  else {
    where += `
      AND p.post_status NOT IN ('auto-draft')
    `;

    if (status) {
      where += `
        AND p.post_status = ?
      `;

      params.push(status);
    } else {
      where += `
        AND p.post_status IN (
          'publish',
          'draft',
          'private',
          'pending'
        )
      `;
    }
  }

  /* =====================================================
     SEARCH
  ===================================================== */

  if (search) {
    where += `
      AND (
        p.post_title LIKE ?
        OR ml.sku LIKE ?
      )
    `;

    params.push(
      `%${search}%`,
      `%${search}%`
    );
  }

  /* =====================================================
     STOCK FILTER
  ===================================================== */

  if (stockStatus) {
    where += `
      AND ml.stock_status = ?
    `;

    params.push(stockStatus);
  }

  /* =====================================================
     CATEGORY FILTER
  ===================================================== */
/* =========================================================
   CATEGORY FILTER

   Supports one or multiple category slugs.

   Examples:
   grade1-2
   grade1-2,jacket
   grade-3-5,jacket,white-shirt
   sports-1-5,sr-sports-uniform
========================================================= */

if (categoryValues.length > 0) {
  const placeholders =
    categoryValues.map(() => "?").join(", ");

  where += `
    AND EXISTS (
      SELECT 1

      FROM ${P}term_relationships tr

      JOIN ${P}term_taxonomy tt
        ON tt.term_taxonomy_id =
           tr.term_taxonomy_id

      JOIN ${P}terms t
        ON t.term_id =
           tt.term_id

      WHERE
        tr.object_id = p.ID

        AND tt.taxonomy =
            'product_cat'

        AND (
          t.slug IN (${placeholders})
          OR CAST(t.term_id AS CHAR)
             IN (${placeholders})
        )
    )
  `;

  params.push(
    ...categoryValues,
    ...categoryValues
  );
}
  // if (category) {
  //   where += `
  //     AND EXISTS (
  //       SELECT 1

  //       FROM ${P}term_relationships tr

  //       JOIN ${P}term_taxonomy tt
  //         ON tt.term_taxonomy_id =
  //            tr.term_taxonomy_id

  //       JOIN ${P}terms t
  //         ON t.term_id = tt.term_id

  //       WHERE
  //         tr.object_id = p.ID

  //         AND tt.taxonomy =
  //             'product_cat'

  //         AND (
  //           t.slug = ?
  //           OR t.term_id = ?
  //         )
  //     )
  //   `;

  //   params.push(
  //     category,
  //     category
  //   );
  // }

  /* =====================================================
     TOTAL COUNT
  ===================================================== */

  const [[{ total }]] =
    await pool.query(
      `
        SELECT
          COUNT(*) AS total

        FROM ${P}posts p

        LEFT JOIN
          ${P}wc_product_meta_lookup ml
        ON ml.product_id = p.ID

        WHERE ${where}
      `,
      params
    );

  /* =====================================================
     PRODUCTS
  ===================================================== */

  const [rows] =
    await pool.query(
      `
        SELECT

          p.ID,
          p.ID AS id,

          p.post_title AS name,

          p.post_name AS slug,

          p.post_status AS status,

          p.post_date AS created_at,

          p.post_modified AS updated_at,

          ml.sku,

          ml.min_price,

          ml.max_price,

          ml.stock_status,

          ml.stock_quantity,

          ml.onsale,

          ml.total_sales,

          ml.average_rating,

          ml.rating_count,

          att.guid AS image_url,

          file_pm.meta_value
            AS image_file,

          (
            SELECT
              t.name

            FROM
              ${P}term_relationships tr

            JOIN
              ${P}term_taxonomy tt

              ON
                tt.term_taxonomy_id =
                tr.term_taxonomy_id

              AND
                tt.taxonomy =
                'product_type'

            JOIN
              ${P}terms t

              ON
                t.term_id =
                tt.term_id

            WHERE
              tr.object_id = p.ID

            LIMIT 1

          ) AS product_type,

          (
            SELECT
              GROUP_CONCAT(
                t.name
                ORDER BY t.name
                SEPARATOR ', '
              )

            FROM
              ${P}term_relationships tr

            JOIN
              ${P}term_taxonomy tt

              ON
                tt.term_taxonomy_id =
                tr.term_taxonomy_id

              AND
                tt.taxonomy =
                'product_cat'

            JOIN
              ${P}terms t

              ON
                t.term_id =
                tt.term_id

            WHERE
              tr.object_id = p.ID

          ) AS categories_text

        FROM ${P}posts p

        LEFT JOIN
          ${P}wc_product_meta_lookup ml

          ON ml.product_id = p.ID

        LEFT JOIN
          ${P}postmeta thumb

          ON thumb.post_id = p.ID

          AND thumb.meta_key =
              '_thumbnail_id'

        LEFT JOIN
          ${P}posts att

          ON att.ID =
             thumb.meta_value

          AND att.post_type =
              'attachment'

        LEFT JOIN
          ${P}postmeta file_pm

          ON file_pm.post_id =
             att.ID

          AND file_pm.meta_key =
              '_wp_attached_file'

        WHERE ${where}

        ORDER BY
          ${sortCol} ${dir}

        LIMIT ?
        OFFSET ?
      `,
      [
        ...params,
        limit,
        offset,
      ]
    );

  return listResponse(
    rows,
    total,
    page,
    limit
  );
}

async function getById(
  id,
  options = {}
) {
  const {
    publicOnly = false,
  } = options;

  /* =====================================================
     MAIN PRODUCT
  ===================================================== */

  const [[product]] =
    await pool.query(
      `
        SELECT

          p.ID,
          p.ID AS id,

          p.post_title AS name,

          p.post_name AS slug,

          p.post_content
            AS description,

          p.post_excerpt
            AS short_description,

          p.post_status
            AS status,

          p.post_date
            AS created_at,

          p.post_modified
            AS updated_at,

          ml.sku,

          ml.min_price,

          ml.max_price,

          ml.stock_status,

          ml.stock_quantity,

          ml.onsale,

          ml.total_sales,

          ml.average_rating,

          ml.rating_count,

          ml.virtual,

          ml.downloadable,

          ml.tax_status,

          ml.tax_class

        FROM ${P}posts p

        LEFT JOIN
          ${P}wc_product_meta_lookup ml

          ON ml.product_id = p.ID

        WHERE
          p.ID = ?

          AND
          p.post_type = 'product'

          ${
            publicOnly
              ? "AND p.post_status = 'publish'"
              : ''
          }
      `,
      [id]
    );

  if (!product) {
    throw httpError(
      404,
      'Product not found'
    );
  }

  /* =====================================================
     META
  ===================================================== */

  const metaMap =
    await getPostMetaMap(
      pool,
      P,
      id
    );

  /* =====================================================
     VARIATIONS / SIZES

     Out-of-stock variations stay visible.

     Only deleted/draft variation is hidden
     from customer side.
  ===================================================== */

  const [variations] =
    await pool.query(
      `
        SELECT

          v.ID,

          v.post_title AS name,

          v.post_status AS status,

          pm_price.meta_value
            AS price,

          pm_reg.meta_value
            AS regular_price,

          pm_sale.meta_value
            AS sale_price,

          pm_sku.meta_value
            AS sku,

          pm_stock.meta_value
            AS stock_quantity,

          pm_ss.meta_value
            AS stock_status,

          COALESCE(
  NULLIF(
    pm_size_pa.meta_value,
    ''
  ),
  NULLIF(
    pm_size_plain.meta_value,
    ''
  )
) AS size

        FROM ${P}posts v

        LEFT JOIN
          ${P}postmeta pm_price

          ON
            pm_price.post_id = v.ID

          AND
            pm_price.meta_key =
            '_price'

        LEFT JOIN
          ${P}postmeta pm_reg

          ON
            pm_reg.post_id = v.ID

          AND
            pm_reg.meta_key =
            '_regular_price'

        LEFT JOIN
          ${P}postmeta pm_sale

          ON
            pm_sale.post_id = v.ID

          AND
            pm_sale.meta_key =
            '_sale_price'

        LEFT JOIN
          ${P}postmeta pm_sku

          ON
            pm_sku.post_id = v.ID

          AND
            pm_sku.meta_key =
            '_sku'

        LEFT JOIN
          ${P}postmeta pm_stock

          ON
            pm_stock.post_id = v.ID

          AND
            pm_stock.meta_key =
            '_stock'

        LEFT JOIN
          ${P}postmeta pm_ss

          ON
            pm_ss.post_id = v.ID

          AND
            pm_ss.meta_key =
            '_stock_status'

        LEFT JOIN
  ${P}postmeta pm_size_pa

ON
  pm_size_pa.post_id = v.ID

AND
  pm_size_pa.meta_key =
  'attribute_pa_size'


LEFT JOIN
  ${P}postmeta pm_size_plain

ON
  pm_size_plain.post_id = v.ID

AND
  pm_size_plain.meta_key =
  'attribute_size'

        WHERE
          v.post_parent = ?

          AND
          v.post_type =
          'product_variation'

          ${
            publicOnly
              ? "AND v.post_status = 'publish'"
              : ''
          }

        ORDER BY
          v.menu_order,
          v.ID
      `,
      [id]
    );

  /* =====================================================
     CATEGORIES
  ===================================================== */

  const [categories] =
    await pool.query(
      `
        SELECT

          t.term_id,

          t.name,

          t.slug,

          tt.term_taxonomy_id

        FROM
          ${P}term_relationships tr

        JOIN
          ${P}term_taxonomy tt

          ON
            tt.term_taxonomy_id =
            tr.term_taxonomy_id

        JOIN
          ${P}terms t

          ON
            t.term_id =
            tt.term_id

        WHERE
          tr.object_id = ?

          AND
          tt.taxonomy =
          'product_cat'
      `,
      [id]
    );

  /* =====================================================
     TAGS
  ===================================================== */

  const [tags] =
    await pool.query(
      `
        SELECT

          t.term_id,

          t.name,

          t.slug

        FROM
          ${P}term_relationships tr

        JOIN
          ${P}term_taxonomy tt

          ON
            tt.term_taxonomy_id =
            tr.term_taxonomy_id

        JOIN
          ${P}terms t

          ON
            t.term_id =
            tt.term_id

        WHERE
          tr.object_id = ?

          AND
          tt.taxonomy =
          'product_tag'
      `,
      [id]
    );

  /* =====================================================
     PRODUCT TYPE
  ===================================================== */

  const [[typeRow]] =
    await pool.query(
      `
        SELECT
          t.name,
          t.slug

        FROM
          ${P}term_relationships tr

        JOIN
          ${P}term_taxonomy tt

          ON
            tt.term_taxonomy_id =
            tr.term_taxonomy_id

        JOIN
          ${P}terms t

          ON
            t.term_id =
            tt.term_id

        WHERE
          tr.object_id = ?

          AND
          tt.taxonomy =
          'product_type'

        LIMIT 1
      `,
      [id]
    );

  /* =====================================================
     VISIBILITY
  ===================================================== */

  const [visibility] =
    await pool.query(
      `
        SELECT
          t.name,
          t.slug

        FROM
          ${P}term_relationships tr

        JOIN
          ${P}term_taxonomy tt

          ON
            tt.term_taxonomy_id =
            tr.term_taxonomy_id

        JOIN
          ${P}terms t

          ON
            t.term_id =
            tt.term_id

        WHERE
          tr.object_id = ?

          AND
          tt.taxonomy =
          'product_visibility'
      `,
      [id]
    );

  /* =====================================================
     IMAGES
  ===================================================== */

  const thumb =
    metaMap._thumbnail_id ||
    null;

  const galleryIds =
    metaMap._product_image_gallery
      ? metaMap._product_image_gallery
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

  const imageIds = [
    ...new Set(
      [
        thumb,
        ...galleryIds,
      ].filter(Boolean)
    ),
  ];

  let images = [];

  if (imageIds.length) {
    const [atts] =
      await pool.query(
        `
          SELECT

            a.ID,

            a.post_title AS title,

            a.guid,

            f.meta_value AS file

          FROM ${P}posts a

          LEFT JOIN
            ${P}postmeta f

            ON
              f.post_id = a.ID

            AND
              f.meta_key =
              '_wp_attached_file'

          WHERE
            a.ID IN (
              ${imageIds
                .map(() => '?')
                .join(',')}
            )

            AND
            a.post_type =
            'attachment'
        `,
        imageIds
      );

    images = atts;
  }

  const featuredImage =
    images.find(
      (item) =>
        String(item.ID) ===
        String(thumb)
    ) || null;

  const gallery =
    images.filter(
      (item) =>
        galleryIds.includes(
          String(item.ID)
        )
    );

  /* =====================================================
     FINAL RESPONSE
  ===================================================== */

  return {
    ...product,

    product_type:
      typeRow?.slug ||
      typeRow?.name ||
      null,

    type:
      typeRow?.slug ||
      null,

    regular_price:
      metaMap._regular_price ??
      product.min_price,

    sale_price:
      metaMap._sale_price ||
      '',

    price:
      metaMap._price ??
      product.min_price,

    manage_stock:
      metaMap._manage_stock ||
      'no',

    backorders:
      metaMap._backorders ||
      'no',

    weight:
      metaMap._weight ||
      '',

    length:
      metaMap._length ||
      '',

    width:
      metaMap._width ||
      '',

    height:
      metaMap._height ||
      '',

    post_content:
      product.description,

    post_status:
      product.status,

    thumbnail_id:
      thumb,

    galleryIds,

    featured_image:
      featuredImage,

    gallery,

    variations,

    categories,

    tags,

    visibility,

    featured:
      visibility.some(
        (item) =>
          item.slug === 'featured'
      ),

    images,

    meta:
      metaMap,
  };
}

async function create(data, authorId = 1) {
  if (!data?.name) throw httpError(400, 'name is required');

  // Commit first — getById uses the pool and cannot see uncommitted rows.
  const id = await withTransaction(pool, async (conn) => {
    const local = nowLocal();
    const gmt = nowGmt();
    const slug = slugify(data.slug || data.name);
    const status = data.status || 'publish';
    const content = data.description || data.post_content || '';
    const excerpt = data.short_description || data.post_excerpt || '';

    const [result] = await conn.query(
      `INSERT INTO ${P}posts
        (post_author, post_date, post_date_gmt, post_content, post_title, post_excerpt,
         post_status, comment_status, ping_status, post_password, post_name, to_ping, pinged,
         post_modified, post_modified_gmt, post_content_filtered, post_parent, guid,
         menu_order, post_type, post_mime_type, comment_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'closed', 'closed', '', ?, '', '', ?, ?, '', 0, '', 0, 'product', '', 0)`,
      [authorId, local, gmt, content, data.name, excerpt, status, slug, local, gmt]
    );
    const newId = result.insertId;
    const guid = `${env.wpSiteUrl}/?post_type=product&p=${newId}`;
    await conn.query(`UPDATE ${P}posts SET guid = ? WHERE ID = ?`, [guid, newId]);

    await writeProductMeta(conn, newId, data, 0);

    const typeSlug = data.type || 'simple';
    await setProductType(conn, newId, typeSlug);

    let catIds = data.category_ids || data.categories;
    if (catIds && !Array.isArray(catIds)) catIds = [catIds];
    if (catIds) {
      const resolved = [];
      for (const c of catIds) {
        const [[row]] = await conn.query(
          `SELECT term_taxonomy_id FROM ${P}term_taxonomy
           WHERE taxonomy = 'product_cat' AND (term_taxonomy_id = ? OR term_id = ?) LIMIT 1`,
          [c, c]
        );
        if (row) resolved.push(row.term_taxonomy_id);
      }
      await setProductCategories(conn, newId, resolved.length ? resolved : [DEFAULT_CAT_TT]);
    } else {
      await setProductCategories(conn, newId, [DEFAULT_CAT_TT]);
    }

    return newId;
  });

  return getById(id);
}

async function update(id, data) {
  const [[existing]] = await pool.query(
    `SELECT ID FROM ${P}posts WHERE ID = ? AND post_type = 'product'`,
    [id]
  );
  if (!existing) throw httpError(404, 'Product not found');

  return withTransaction(pool, async (conn) => {
    const local = nowLocal();
    const gmt = nowGmt();
    const fields = [];
    const params = [];
    if (data.name != null) { fields.push('post_title = ?'); params.push(data.name); }
    if (data.slug != null) { fields.push('post_name = ?'); params.push(slugify(data.slug)); }
    if (data.description != null || data.post_content != null) {
      fields.push('post_content = ?');
      params.push(data.description ?? data.post_content);
    }
    if (data.short_description != null || data.post_excerpt != null) {
      fields.push('post_excerpt = ?');
      params.push(data.short_description ?? data.post_excerpt);
    }
    if (data.status != null) { fields.push('post_status = ?'); params.push(data.status); }
    fields.push('post_modified = ?', 'post_modified_gmt = ?');
    params.push(local, gmt, id);

    await conn.query(
      `UPDATE ${P}posts SET ${fields.join(', ')} WHERE ID = ?`,
      params
    );

    const metaMap = await getPostMetaMap(conn, P, id);
    await writeProductMeta(conn, id, {
      sku: data.sku ?? metaMap._sku,
      regular_price: data.regular_price ?? data.regularPrice ?? metaMap._regular_price,
      sale_price: data.sale_price !== undefined ? data.sale_price : metaMap._sale_price,
      stock_quantity: data.stock_quantity !== undefined ? data.stock_quantity : metaMap._stock,
      stock_status: data.stock_status || metaMap._stock_status,
      manage_stock: data.manage_stock,
      tax_status: data.tax_status || metaMap._tax_status,
      virtual: data.virtual != null ? data.virtual : metaMap._virtual === 'yes',
      downloadable: data.downloadable != null ? data.downloadable : metaMap._downloadable === 'yes',
      weight: data.weight,
      length: data.length,
      width: data.width,
      height: data.height,
      thumbnail_id: data.thumbnail_id,
      gallery: data.gallery,
      tax_class: data.tax_class,
    }, metaMap.total_sales || 0);

    if (data.type) await setProductType(conn, id, data.type);

    if (data.category_ids || data.categories) {
      let catIds = data.category_ids || data.categories;
      if (!Array.isArray(catIds)) catIds = [catIds];
      const resolved = [];
      for (const c of catIds) {
        const [[row]] = await conn.query(
          `SELECT term_taxonomy_id FROM ${P}term_taxonomy
           WHERE taxonomy = 'product_cat' AND (term_taxonomy_id = ? OR term_id = ?) LIMIT 1`,
          [c, c]
        );
        if (row) resolved.push(row.term_taxonomy_id);
      }
      if (resolved.length) await setProductCategories(conn, id, resolved);
    }

    return getById(id);
  });
}

async function trash(id) {
  const [[existing]] = await pool.query(
    `SELECT ID FROM ${P}posts WHERE ID = ? AND post_type = 'product'`,
    [id]
  );
  if (!existing) throw httpError(404, 'Product not found');

  await withTransaction(pool, async (conn) => {
    const local = nowLocal();
    const gmt = nowGmt();
    await conn.query(
      `UPDATE ${P}posts SET post_status = 'trash', post_modified = ?, post_modified_gmt = ? WHERE ID = ?`,
      [local, gmt, id]
    );
  });
  return { ok: true, id, status: 'trash' };
}

async function updateVariation(productId, variationId, data) {
  const [[parent]] = await pool.query(
    `SELECT ID FROM ${P}posts WHERE ID = ? AND post_type = 'product'`,
    [productId]
  );
  if (!parent) throw httpError(404, 'Product not found');

  const [[variation]] = await pool.query(
    `SELECT ID FROM ${P}posts
     WHERE ID = ? AND post_parent = ? AND post_type = 'product_variation'`,
    [variationId, productId]
  );
  if (!variation) throw httpError(404, 'Variation not found');

  await withTransaction(pool, async (conn) => {
    const local = nowLocal();
    const gmt = nowGmt();
    const metaMap = await getPostMetaMap(conn, P, variationId);

    if (data.status != null) {
      await conn.query(
        `UPDATE ${P}posts SET post_status = ?, post_modified = ?, post_modified_gmt = ? WHERE ID = ?`,
        [data.status, local, gmt, variationId]
      );
    } else {
      await conn.query(
        `UPDATE ${P}posts SET post_modified = ?, post_modified_gmt = ? WHERE ID = ?`,
        [local, gmt, variationId]
      );
    }

    const regular =
      data.regular_price !== undefined ? data.regular_price : metaMap._regular_price;
    const sale = data.sale_price !== undefined ? data.sale_price : metaMap._sale_price;
    const price = resolvePrice(regular, sale);
    const stockQty =
      data.stock_quantity !== undefined ? data.stock_quantity : metaMap._stock;
    const stockStatus = data.stock_status || metaMap._stock_status || 'instock';
    const sku = data.sku !== undefined ? data.sku : metaMap._sku || '';
    // const size =
    //   data.size !== undefined ? data.size : metaMap.attribute_pa_size || '';
    const size =
  data.size !== undefined
    ? data.size
    : (
        metaMap.attribute_pa_size ??
        metaMap.attribute_size ??
        ""
      );

    const pairs = [
      ['_sku', sku || ''],
      ['_regular_price', regular == null || regular === '' ? '' : String(regular)],
      ['_sale_price', sale == null || sale === '' ? '' : String(sale)],
      ['_price', price],
      ['_stock', stockQty == null || stockQty === '' ? '' : String(stockQty)],
      ['_stock_status', stockStatus],
      ['_manage_stock', stockQty != null && stockQty !== '' ? 'yes' : metaMap._manage_stock || 'no'],
    ];
    // if (size !== undefined && size !== null) {
    //   pairs.push(['attribute_pa_size', String(size)]);
    // }
    if (
  size !== undefined &&
  size !== null
) {
 
  pairs.push([
    'attribute_size',
    String(size),
  ]);

  pairs.push([
    'attribute_pa_size',
    String(size),
  ]);
}

    for (const [k, v] of pairs) {
      await upsertPostMeta(conn, P, variationId, k, v);
    }

    await syncProductMetaLookup(conn, variationId, {
      sku: sku || '',
      virtual: 0,
      downloadable: 0,
      min_price: price === '' ? 0 : Number(price),
      max_price: price === '' ? 0 : Number(price),
      onsale: sale !== '' && sale != null && Number(sale) < Number(regular || sale) ? 1 : 0,
      stock_quantity: stockQty === '' || stockQty == null ? null : Number(stockQty),
      stock_status: stockStatus,
      total_sales: Number(metaMap.total_sales) || 0,
      tax_status: metaMap._tax_status || 'taxable',
      tax_class: metaMap._tax_class || '',
    });
  });

  return getById(productId);
}

module.exports = {
  list,
  getById,
  create,
  update,
  trash,
  updateVariation,
  DEFAULT_CAT_TT,
  UNCATEGORIZED_TT,
};








// const pool = require('../config/db');
// const P = require('../config/prefix');
// const env = require('../config/env');
// const { parseList, listResponse } = require('../utils/listParams');
// const { slugify, nowLocal, nowGmt } = require('../utils/datetime');
// const { upsertPostMeta, getPostMetaMap } = require('../utils/meta');
// const { withTransaction } = require('../utils/transaction');
// const { httpError } = require('../utils/httpError');

// const SORT = {
//   id: 'p.ID',
//   name: 'p.post_title',
//   date: 'p.post_date',
//   sku: 'ml.sku',
//   price: 'ml.min_price',
//   sales: 'ml.total_sales',
//   stock: 'ml.stock_status',
// };

// const PRODUCT_TYPE_TT = { simple: 2, variable: 4, grouped: 3, external: 5 };
// const DEFAULT_CAT_TT = 144; // Uniforms
// const UNCATEGORIZED_TT = 15;
// const OUTOFSTOCK_TT = 9;

// function resolvePrice(regular, sale) {
//   const r = regular == null || regular === '' ? '' : String(regular);
//   const s = sale == null || sale === '' ? '' : String(sale);
//   if (s !== '' && !Number.isNaN(Number(s))) return s;
//   return r;
// }

// async function syncProductMetaLookup(conn, productId, fields) {
//   const {
//     sku = '',
//     virtual = 0,
//     downloadable = 0,
//     min_price = 0,
//     max_price = 0,
//     onsale = 0,
//     stock_quantity = null,
//     stock_status = 'instock',
//     rating_count = 0,
//     average_rating = 0,
//     total_sales = 0,
//     tax_status = 'taxable',
//     tax_class = '',
//   } = fields;

//   const [existing] = await conn.query(
//     `SELECT product_id FROM ${P}wc_product_meta_lookup WHERE product_id = ?`,
//     [productId]
//   );

//   if (existing.length) {
//     await conn.query(
//       `UPDATE ${P}wc_product_meta_lookup SET
//          sku = ?, virtual = ?, downloadable = ?, min_price = ?, max_price = ?,
//          onsale = ?, stock_quantity = ?, stock_status = ?, rating_count = ?,
//          average_rating = ?, total_sales = ?, tax_status = ?, tax_class = ?
//        WHERE product_id = ?`,
//       [
//         sku, virtual ? 1 : 0, downloadable ? 1 : 0, min_price, max_price,
//         onsale ? 1 : 0, stock_quantity, stock_status, rating_count,
//         average_rating, total_sales, tax_status, tax_class, productId,
//       ]
//     );
//   } else {
//     await conn.query(
//       `INSERT INTO ${P}wc_product_meta_lookup
//         (product_id, sku, virtual, downloadable, min_price, max_price, onsale,
//          stock_quantity, stock_status, rating_count, average_rating, total_sales,
//          tax_status, tax_class)
//        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//       [
//         productId, sku, virtual ? 1 : 0, downloadable ? 1 : 0, min_price, max_price,
//         onsale ? 1 : 0, stock_quantity, stock_status, rating_count,
//         average_rating, total_sales, tax_status, tax_class,
//       ]
//     );
//   }
// }

// async function bumpTermCount(conn, termTaxonomyId, delta) {
//   await conn.query(
//     `UPDATE ${P}term_taxonomy SET count = GREATEST(0, count + ?) WHERE term_taxonomy_id = ?`,
//     [delta, termTaxonomyId]
//   );
// }

// async function setProductType(conn, productId, typeSlug = 'simple') {
//   const ttId = PRODUCT_TYPE_TT[typeSlug] || PRODUCT_TYPE_TT.simple;
//   await conn.query(
//     `DELETE tr FROM ${P}term_relationships tr
//      JOIN ${P}term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id
//      WHERE tr.object_id = ? AND tt.taxonomy = 'product_type'`,
//     [productId]
//   );
//   await conn.query(
//     `INSERT INTO ${P}term_relationships (object_id, term_taxonomy_id, term_order) VALUES (?, ?, 0)`,
//     [productId, ttId]
//   );
// }

// async function setProductCategories(conn, productId, categoryTermTaxonomyIds) {
//   const ids = Array.isArray(categoryTermTaxonomyIds) && categoryTermTaxonomyIds.length
//     ? categoryTermTaxonomyIds.map(Number)
//     : [DEFAULT_CAT_TT];

//   const [old] = await conn.query(
//     `SELECT tr.term_taxonomy_id
//      FROM ${P}term_relationships tr
//      JOIN ${P}term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id
//      WHERE tr.object_id = ? AND tt.taxonomy = 'product_cat'`,
//     [productId]
//   );
//   for (const row of old) {
//     await conn.query(
//       `DELETE FROM ${P}term_relationships WHERE object_id = ? AND term_taxonomy_id = ?`,
//       [productId, row.term_taxonomy_id]
//     );
//     await bumpTermCount(conn, row.term_taxonomy_id, -1);
//   }

//   for (const ttId of ids) {
//     await conn.query(
//       `INSERT INTO ${P}term_relationships (object_id, term_taxonomy_id, term_order) VALUES (?, ?, 0)`,
//       [productId, ttId]
//     );
//     await bumpTermCount(conn, ttId, 1);
//   }
// }

// async function syncOutOfStockVisibility(conn, productId, stockStatus) {
//   const [existing] = await conn.query(
//     `SELECT object_id FROM ${P}term_relationships
//      WHERE object_id = ? AND term_taxonomy_id = ?`,
//     [productId, OUTOFSTOCK_TT]
//   );
//   if (stockStatus === 'outofstock' && !existing.length) {
//     await conn.query(
//       `INSERT INTO ${P}term_relationships (object_id, term_taxonomy_id, term_order) VALUES (?, ?, 0)`,
//       [productId, OUTOFSTOCK_TT]
//     );
//     await bumpTermCount(conn, OUTOFSTOCK_TT, 1);
//   } else if (stockStatus !== 'outofstock' && existing.length) {
//     await conn.query(
//       `DELETE FROM ${P}term_relationships WHERE object_id = ? AND term_taxonomy_id = ?`,
//       [productId, OUTOFSTOCK_TT]
//     );
//     await bumpTermCount(conn, OUTOFSTOCK_TT, -1);
//   }
// }

// async function writeProductMeta(conn, productId, data, existingSales) {
//   const regular = data.regular_price ?? data.regularPrice ?? '';
//   const sale = data.sale_price ?? data.salePrice ?? '';
//   const price = resolvePrice(regular, sale);
//   const stockQty = data.stock_quantity ?? data.stock ?? null;
//   const stockStatus = data.stock_status || 'instock';
//   const manageStock = data.manage_stock != null
//     ? (data.manage_stock ? 'yes' : 'no')
//     : (stockQty != null && stockQty !== '' ? 'yes' : 'no');
//   const sku = data.sku || '';
//   const taxStatus = data.tax_status || 'taxable';
//   const virtual = data.virtual ? 'yes' : 'no';
//   const downloadable = data.downloadable ? 'yes' : 'no';
//   const totalSales = existingSales != null ? existingSales : (data.total_sales || 0);

//   const pairs = [
//     ['_sku', sku],
//     ['_regular_price', regular === null || regular === undefined ? '' : String(regular)],
//     ['_sale_price', sale === null || sale === undefined ? '' : String(sale)],
//     ['_price', price],
//     ['_stock', stockQty == null || stockQty === '' ? '' : String(stockQty)],
//     ['_stock_status', stockStatus],
//     ['_manage_stock', manageStock],
//     ['_tax_status', taxStatus],
//     ['_tax_class', data.tax_class || ''],
//     ['_virtual', virtual],
//     ['_downloadable', downloadable],
//     ['total_sales', String(totalSales)],
//   ];

//   if (data.weight != null) pairs.push(['_weight', String(data.weight)]);
//   if (data.length != null) pairs.push(['_length', String(data.length)]);
//   if (data.width != null) pairs.push(['_width', String(data.width)]);
//   if (data.height != null) pairs.push(['_height', String(data.height)]);
//   if (data.thumbnail_id != null) pairs.push(['_thumbnail_id', String(data.thumbnail_id)]);
//   if (data.gallery != null) {
//     const gallery = Array.isArray(data.gallery) ? data.gallery.join(',') : String(data.gallery);
//     pairs.push(['_product_image_gallery', gallery]);
//   }

//   for (const [k, v] of pairs) {
//     await upsertPostMeta(conn, P, productId, k, v);
//   }

//   const onsale = sale !== '' && sale != null && Number(sale) < Number(regular || sale);
//   await syncProductMetaLookup(conn, productId, {
//     sku,
//     virtual: virtual === 'yes' ? 1 : 0,
//     downloadable: downloadable === 'yes' ? 1 : 0,
//     min_price: price === '' ? 0 : Number(price),
//     max_price: price === '' ? 0 : Number(price),
//     onsale: onsale ? 1 : 0,
//     stock_quantity: stockQty === '' || stockQty == null ? null : Number(stockQty),
//     stock_status: stockStatus,
//     total_sales: Number(totalSales) || 0,
//     tax_status: taxStatus,
//     tax_class: data.tax_class || '',
//   });

//   await syncOutOfStockVisibility(conn, productId, stockStatus);
// }

// // async function list(req) {
// //   const { page, limit, offset, sortCol, dir, search } = parseList(req, SORT, 'date');
// //   const stockStatus = req.query.stock_status || '';
// //   const category = req.query.category || '';
// //   const status = req.query.status || '';
// //   const params = [];
// //   let where = `p.post_type = 'product' AND p.post_status NOT IN ('auto-draft')`;

// //   if (status) {
// //     where += ` AND p.post_status = ?`;
// //     params.push(status);
// //   } else {
// //     where += ` AND p.post_status IN ('publish','draft','private','pending')`;
// //   }
// //   if (search) {
// //     where += ` AND (p.post_title LIKE ? OR ml.sku LIKE ?)`;
// //     params.push(`%${search}%`, `%${search}%`);
// //   }
// //   if (stockStatus) {
// //     where += ` AND ml.stock_status = ?`;
// //     params.push(stockStatus);
// //   }
// //   if (category) {
// //     where += ` AND EXISTS (
// //       SELECT 1 FROM ${P}term_relationships tr
// //       JOIN ${P}term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id
// //       JOIN ${P}terms t ON t.term_id = tt.term_id
// //       WHERE tr.object_id = p.ID AND tt.taxonomy = 'product_cat'
// //         AND (t.slug = ? OR t.term_id = ?)
// //     )`;
// //     params.push(category, category);
// //   }

// //   const [[{ total }]] = await pool.query(
// //     `SELECT COUNT(*) AS total
// //      FROM ${P}posts p
// //      LEFT JOIN ${P}wc_product_meta_lookup ml ON ml.product_id = p.ID
// //      WHERE ${where}`,
// //     params
// //   );

// //   const [rows] = await pool.query(
// //     `SELECT
// //        p.ID, p.ID AS id,
// //        p.post_title AS name,
// //        p.post_name AS slug,
// //        p.post_status AS status,
// //        p.post_date AS created_at,
// //        p.post_modified AS updated_at,
// //        ml.sku, ml.min_price, ml.max_price, ml.stock_status, ml.stock_quantity,
// //        ml.onsale, ml.total_sales, ml.average_rating, ml.rating_count,
// //        att.guid AS image_url,
// //        file_pm.meta_value AS image_file,
// //        (
// //          SELECT t.name FROM ${P}term_relationships tr
// //          JOIN ${P}term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'product_type'
// //          JOIN ${P}terms t ON t.term_id = tt.term_id
// //          WHERE tr.object_id = p.ID LIMIT 1
// //        ) AS product_type,
// //        (
// //          SELECT GROUP_CONCAT(t.name ORDER BY t.name SEPARATOR ', ')
// //          FROM ${P}term_relationships tr
// //          JOIN ${P}term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'product_cat'
// //          JOIN ${P}terms t ON t.term_id = tt.term_id
// //          WHERE tr.object_id = p.ID
// //        ) AS categories_text
// //      FROM ${P}posts p
// //      LEFT JOIN ${P}wc_product_meta_lookup ml ON ml.product_id = p.ID
// //      LEFT JOIN ${P}postmeta thumb
// //        ON thumb.post_id = p.ID AND thumb.meta_key = '_thumbnail_id'
// //      LEFT JOIN ${P}posts att ON att.ID = thumb.meta_value AND att.post_type = 'attachment'
// //      LEFT JOIN ${P}postmeta file_pm
// //        ON file_pm.post_id = att.ID AND file_pm.meta_key = '_wp_attached_file'
// //      WHERE ${where}
// //      ORDER BY ${sortCol} ${dir}
// //      LIMIT ? OFFSET ?`,
// //     [...params, limit, offset]
// //   );

// //   return listResponse(rows, total, page, limit);
// // }

// // async function getById(id) {
// //   const [[product]] = await pool.query(
// //     `SELECT
// //        p.ID, p.ID AS id,
// //        p.post_title AS name,
// //        p.post_name AS slug,
// //        p.post_content AS description,
// //        p.post_excerpt AS short_description,
// //        p.post_status AS status,
// //        p.post_date AS created_at,
// //        p.post_modified AS updated_at,
// //        ml.sku, ml.min_price, ml.max_price, ml.stock_status, ml.stock_quantity,
// //        ml.onsale, ml.total_sales, ml.average_rating, ml.rating_count,
// //        ml.virtual, ml.downloadable, ml.tax_status, ml.tax_class
// //      FROM ${P}posts p
// //      LEFT JOIN ${P}wc_product_meta_lookup ml ON ml.product_id = p.ID
// //      WHERE p.ID = ? AND p.post_type = 'product'`,
// //     [id]
// //   );
// //   if (!product) throw httpError(404, 'Product not found');

// //   const metaMap = await getPostMetaMap(pool, P, id);
// //   const [variations] = await pool.query(
// //     `SELECT
// //        v.ID, v.post_title AS name, v.post_status AS status,
// //        pm_price.meta_value AS price,
// //        pm_reg.meta_value AS regular_price,
// //        pm_sale.meta_value AS sale_price,
// //        pm_sku.meta_value AS sku,
// //        pm_stock.meta_value AS stock_quantity,
// //        pm_ss.meta_value AS stock_status,
// //        pm_size.meta_value AS size
// //      FROM ${P}posts v
// //      LEFT JOIN ${P}postmeta pm_price ON pm_price.post_id = v.ID AND pm_price.meta_key = '_price'
// //      LEFT JOIN ${P}postmeta pm_reg   ON pm_reg.post_id   = v.ID AND pm_reg.meta_key   = '_regular_price'
// //      LEFT JOIN ${P}postmeta pm_sale  ON pm_sale.post_id  = v.ID AND pm_sale.meta_key  = '_sale_price'
// //      LEFT JOIN ${P}postmeta pm_sku   ON pm_sku.post_id   = v.ID AND pm_sku.meta_key   = '_sku'
// //      LEFT JOIN ${P}postmeta pm_stock ON pm_stock.post_id = v.ID AND pm_stock.meta_key = '_stock'
// //      LEFT JOIN ${P}postmeta pm_ss    ON pm_ss.post_id    = v.ID AND pm_ss.meta_key    = '_stock_status'
// //      LEFT JOIN ${P}postmeta pm_size  ON pm_size.post_id  = v.ID AND pm_size.meta_key  = 'attribute_pa_size'
// //      WHERE v.post_parent = ? AND v.post_type = 'product_variation'
// //      ORDER BY v.menu_order, v.ID`,
// //     [id]
// //   );

// //   const [categories] = await pool.query(
// //     `SELECT t.term_id, t.name, t.slug, tt.term_taxonomy_id
// //      FROM ${P}term_relationships tr
// //      JOIN ${P}term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id
// //      JOIN ${P}terms t ON t.term_id = tt.term_id
// //      WHERE tr.object_id = ? AND tt.taxonomy = 'product_cat'`,
// //     [id]
// //   );

// //   const [tags] = await pool.query(
// //     `SELECT t.term_id, t.name, t.slug
// //      FROM ${P}term_relationships tr
// //      JOIN ${P}term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id
// //      JOIN ${P}terms t ON t.term_id = tt.term_id
// //      WHERE tr.object_id = ? AND tt.taxonomy = 'product_tag'`,
// //     [id]
// //   );

// //   const [[typeRow]] = await pool.query(
// //     `SELECT t.name, t.slug
// //      FROM ${P}term_relationships tr
// //      JOIN ${P}term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id
// //      JOIN ${P}terms t ON t.term_id = tt.term_id
// //      WHERE tr.object_id = ? AND tt.taxonomy = 'product_type'
// //      LIMIT 1`,
// //     [id]
// //   );

// //   const [visibility] = await pool.query(
// //     `SELECT t.name, t.slug
// //      FROM ${P}term_relationships tr
// //      JOIN ${P}term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id
// //      JOIN ${P}terms t ON t.term_id = tt.term_id
// //      WHERE tr.object_id = ? AND tt.taxonomy = 'product_visibility'`,
// //     [id]
// //   );

// //   const thumb = metaMap._thumbnail_id || null;
// //   const galleryIds = metaMap._product_image_gallery
// //     ? metaMap._product_image_gallery.split(',').map((s) => s.trim()).filter(Boolean)
// //     : [];
// //   const imageIds = [...new Set([thumb, ...galleryIds].filter(Boolean))];
// //   let images = [];
// //   if (imageIds.length) {
// //     const [atts] = await pool.query(
// //       `SELECT a.ID, a.post_title AS title, a.guid, f.meta_value AS file
// //        FROM ${P}posts a
// //        LEFT JOIN ${P}postmeta f ON f.post_id = a.ID AND f.meta_key = '_wp_attached_file'
// //        WHERE a.ID IN (${imageIds.map(() => '?').join(',')}) AND a.post_type = 'attachment'`,
// //       imageIds
// //     );
// //     images = atts;
// //   }

// //   const featuredImage = images.find((i) => String(i.ID) === String(thumb)) || null;
// //   const gallery = images.filter((i) => galleryIds.includes(String(i.ID)));

// //   return {
// //     ...product,
// //     product_type: typeRow?.slug || typeRow?.name || null,
// //     type: typeRow?.slug || null,
// //     regular_price: metaMap._regular_price ?? product.min_price,
// //     sale_price: metaMap._sale_price || '',
// //     price: metaMap._price ?? product.min_price,
// //     manage_stock: metaMap._manage_stock || 'no',
// //     backorders: metaMap._backorders || 'no',
// //     weight: metaMap._weight || '',
// //     length: metaMap._length || '',
// //     width: metaMap._width || '',
// //     height: metaMap._height || '',
// //     post_content: product.description,
// //     post_status: product.status,
// //     thumbnail_id: thumb,
// //     galleryIds,
// //     featured_image: featuredImage,
// //     gallery,
// //     variations,
// //     categories,
// //     tags,
// //     visibility,
// //     featured: visibility.some((v) => v.slug === 'featured'),
// //     images,
// //     meta: metaMap,
// //   };
// // }
// async function list(req, options = {}) {
//   const {
//     publicOnly = false,
//   } = options;

//   const {
//     page,
//     limit,
//     offset,
//     sortCol,
//     dir,
//     search,
//   } = parseList(
//     req,
//     SORT,
//     'date'
//   );

//   const stockStatus =
//     req.query.stock_status || '';

//   const category =
//     req.query.category || '';

//   const status =
//     req.query.status || '';

//   const params = [];

//   let where =
//     `p.post_type = 'product'`;

//   /* =====================================================
//      CUSTOMER WEBSITE

//      ONLY PUBLISHED PRODUCTS
//   ===================================================== */

//   if (publicOnly) {
//     where += `
//       AND p.post_status = 'publish'
//     `;
//   }

//   /* =====================================================
//      ADMIN PANEL

//      ADMIN CAN SEE OTHER STATUSES
//   ===================================================== */

//   else {
//     where += `
//       AND p.post_status NOT IN ('auto-draft')
//     `;

//     if (status) {
//       where += `
//         AND p.post_status = ?
//       `;

//       params.push(status);
//     } else {
//       where += `
//         AND p.post_status IN (
//           'publish',
//           'draft',
//           'private',
//           'pending'
//         )
//       `;
//     }
//   }

//   /* =====================================================
//      SEARCH
//   ===================================================== */

//   if (search) {
//     where += `
//       AND (
//         p.post_title LIKE ?
//         OR ml.sku LIKE ?
//       )
//     `;

//     params.push(
//       `%${search}%`,
//       `%${search}%`
//     );
//   }

//   /* =====================================================
//      STOCK FILTER
//   ===================================================== */

//   if (stockStatus) {
//     where += `
//       AND ml.stock_status = ?
//     `;

//     params.push(stockStatus);
//   }

//   /* =====================================================
//      CATEGORY FILTER
//   ===================================================== */

//   if (category) {
//     where += `
//       AND EXISTS (
//         SELECT 1

//         FROM ${P}term_relationships tr

//         JOIN ${P}term_taxonomy tt
//           ON tt.term_taxonomy_id =
//              tr.term_taxonomy_id

//         JOIN ${P}terms t
//           ON t.term_id = tt.term_id

//         WHERE
//           tr.object_id = p.ID

//           AND tt.taxonomy =
//               'product_cat'

//           AND (
//             t.slug = ?
//             OR t.term_id = ?
//           )
//       )
//     `;

//     params.push(
//       category,
//       category
//     );
//   }

//   /* =====================================================
//      TOTAL COUNT
//   ===================================================== */

//   const [[{ total }]] =
//     await pool.query(
//       `
//         SELECT
//           COUNT(*) AS total

//         FROM ${P}posts p

//         LEFT JOIN
//           ${P}wc_product_meta_lookup ml
//         ON ml.product_id = p.ID

//         WHERE ${where}
//       `,
//       params
//     );

//   /* =====================================================
//      PRODUCTS
//   ===================================================== */

//   const [rows] =
//     await pool.query(
//       `
//         SELECT

//           p.ID,
//           p.ID AS id,

//           p.post_title AS name,

//           p.post_name AS slug,

//           p.post_status AS status,

//           p.post_date AS created_at,

//           p.post_modified AS updated_at,

//           ml.sku,

//           ml.min_price,

//           ml.max_price,

//           ml.stock_status,

//           ml.stock_quantity,

//           ml.onsale,

//           ml.total_sales,

//           ml.average_rating,

//           ml.rating_count,

//           att.guid AS image_url,

//           file_pm.meta_value
//             AS image_file,

//           (
//             SELECT
//               t.name

//             FROM
//               ${P}term_relationships tr

//             JOIN
//               ${P}term_taxonomy tt

//               ON
//                 tt.term_taxonomy_id =
//                 tr.term_taxonomy_id

//               AND
//                 tt.taxonomy =
//                 'product_type'

//             JOIN
//               ${P}terms t

//               ON
//                 t.term_id =
//                 tt.term_id

//             WHERE
//               tr.object_id = p.ID

//             LIMIT 1

//           ) AS product_type,

//           (
//             SELECT
//               GROUP_CONCAT(
//                 t.name
//                 ORDER BY t.name
//                 SEPARATOR ', '
//               )

//             FROM
//               ${P}term_relationships tr

//             JOIN
//               ${P}term_taxonomy tt

//               ON
//                 tt.term_taxonomy_id =
//                 tr.term_taxonomy_id

//               AND
//                 tt.taxonomy =
//                 'product_cat'

//             JOIN
//               ${P}terms t

//               ON
//                 t.term_id =
//                 tt.term_id

//             WHERE
//               tr.object_id = p.ID

//           ) AS categories_text

//         FROM ${P}posts p

//         LEFT JOIN
//           ${P}wc_product_meta_lookup ml

//           ON ml.product_id = p.ID

//         LEFT JOIN
//           ${P}postmeta thumb

//           ON thumb.post_id = p.ID

//           AND thumb.meta_key =
//               '_thumbnail_id'

//         LEFT JOIN
//           ${P}posts att

//           ON att.ID =
//              thumb.meta_value

//           AND att.post_type =
//               'attachment'

//         LEFT JOIN
//           ${P}postmeta file_pm

//           ON file_pm.post_id =
//              att.ID

//           AND file_pm.meta_key =
//               '_wp_attached_file'

//         WHERE ${where}

//         ORDER BY
//           ${sortCol} ${dir}

//         LIMIT ?
//         OFFSET ?
//       `,
//       [
//         ...params,
//         limit,
//         offset,
//       ]
//     );

//   return listResponse(
//     rows,
//     total,
//     page,
//     limit
//   );
// }

// async function getById(
//   id,
//   options = {}
// ) {
//   const {
//     publicOnly = false,
//   } = options;

//   /* =====================================================
//      MAIN PRODUCT
//   ===================================================== */

//   const [[product]] =
//     await pool.query(
//       `
//         SELECT

//           p.ID,
//           p.ID AS id,

//           p.post_title AS name,

//           p.post_name AS slug,

//           p.post_content
//             AS description,

//           p.post_excerpt
//             AS short_description,

//           p.post_status
//             AS status,

//           p.post_date
//             AS created_at,

//           p.post_modified
//             AS updated_at,

//           ml.sku,

//           ml.min_price,

//           ml.max_price,

//           ml.stock_status,

//           ml.stock_quantity,

//           ml.onsale,

//           ml.total_sales,

//           ml.average_rating,

//           ml.rating_count,

//           ml.virtual,

//           ml.downloadable,

//           ml.tax_status,

//           ml.tax_class

//         FROM ${P}posts p

//         LEFT JOIN
//           ${P}wc_product_meta_lookup ml

//           ON ml.product_id = p.ID

//         WHERE
//           p.ID = ?

//           AND
//           p.post_type = 'product'

//           ${
//             publicOnly
//               ? "AND p.post_status = 'publish'"
//               : ''
//           }
//       `,
//       [id]
//     );

//   if (!product) {
//     throw httpError(
//       404,
//       'Product not found'
//     );
//   }

//   /* =====================================================
//      META
//   ===================================================== */

//   const metaMap =
//     await getPostMetaMap(
//       pool,
//       P,
//       id
//     );

//   /* =====================================================
//      VARIATIONS / SIZES

//      Out-of-stock variations stay visible.

//      Only deleted/draft variation is hidden
//      from customer side.
//   ===================================================== */

//   const [variations] =
//     await pool.query(
//       `
//         SELECT

//           v.ID,

//           v.post_title AS name,

//           v.post_status AS status,

//           pm_price.meta_value
//             AS price,

//           pm_reg.meta_value
//             AS regular_price,

//           pm_sale.meta_value
//             AS sale_price,

//           pm_sku.meta_value
//             AS sku,

//           pm_stock.meta_value
//             AS stock_quantity,

//           pm_ss.meta_value
//             AS stock_status,

//           pm_size.meta_value
//             AS size

//         FROM ${P}posts v

//         LEFT JOIN
//           ${P}postmeta pm_price

//           ON
//             pm_price.post_id = v.ID

//           AND
//             pm_price.meta_key =
//             '_price'

//         LEFT JOIN
//           ${P}postmeta pm_reg

//           ON
//             pm_reg.post_id = v.ID

//           AND
//             pm_reg.meta_key =
//             '_regular_price'

//         LEFT JOIN
//           ${P}postmeta pm_sale

//           ON
//             pm_sale.post_id = v.ID

//           AND
//             pm_sale.meta_key =
//             '_sale_price'

//         LEFT JOIN
//           ${P}postmeta pm_sku

//           ON
//             pm_sku.post_id = v.ID

//           AND
//             pm_sku.meta_key =
//             '_sku'

//         LEFT JOIN
//           ${P}postmeta pm_stock

//           ON
//             pm_stock.post_id = v.ID

//           AND
//             pm_stock.meta_key =
//             '_stock'

//         LEFT JOIN
//           ${P}postmeta pm_ss

//           ON
//             pm_ss.post_id = v.ID

//           AND
//             pm_ss.meta_key =
//             '_stock_status'

//         LEFT JOIN
//           ${P}postmeta pm_size

//           ON
//             pm_size.post_id = v.ID

//           AND
//             pm_size.meta_key =
//             'attribute_pa_size'

//         WHERE
//           v.post_parent = ?

//           AND
//           v.post_type =
//           'product_variation'

//           ${
//             publicOnly
//               ? "AND v.post_status = 'publish'"
//               : ''
//           }

//         ORDER BY
//           v.menu_order,
//           v.ID
//       `,
//       [id]
//     );

//   /* =====================================================
//      CATEGORIES
//   ===================================================== */

//   const [categories] =
//     await pool.query(
//       `
//         SELECT

//           t.term_id,

//           t.name,

//           t.slug,

//           tt.term_taxonomy_id

//         FROM
//           ${P}term_relationships tr

//         JOIN
//           ${P}term_taxonomy tt

//           ON
//             tt.term_taxonomy_id =
//             tr.term_taxonomy_id

//         JOIN
//           ${P}terms t

//           ON
//             t.term_id =
//             tt.term_id

//         WHERE
//           tr.object_id = ?

//           AND
//           tt.taxonomy =
//           'product_cat'
//       `,
//       [id]
//     );

//   /* =====================================================
//      TAGS
//   ===================================================== */

//   const [tags] =
//     await pool.query(
//       `
//         SELECT

//           t.term_id,

//           t.name,

//           t.slug

//         FROM
//           ${P}term_relationships tr

//         JOIN
//           ${P}term_taxonomy tt

//           ON
//             tt.term_taxonomy_id =
//             tr.term_taxonomy_id

//         JOIN
//           ${P}terms t

//           ON
//             t.term_id =
//             tt.term_id

//         WHERE
//           tr.object_id = ?

//           AND
//           tt.taxonomy =
//           'product_tag'
//       `,
//       [id]
//     );

//   /* =====================================================
//      PRODUCT TYPE
//   ===================================================== */

//   const [[typeRow]] =
//     await pool.query(
//       `
//         SELECT
//           t.name,
//           t.slug

//         FROM
//           ${P}term_relationships tr

//         JOIN
//           ${P}term_taxonomy tt

//           ON
//             tt.term_taxonomy_id =
//             tr.term_taxonomy_id

//         JOIN
//           ${P}terms t

//           ON
//             t.term_id =
//             tt.term_id

//         WHERE
//           tr.object_id = ?

//           AND
//           tt.taxonomy =
//           'product_type'

//         LIMIT 1
//       `,
//       [id]
//     );

//   /* =====================================================
//      VISIBILITY
//   ===================================================== */

//   const [visibility] =
//     await pool.query(
//       `
//         SELECT
//           t.name,
//           t.slug

//         FROM
//           ${P}term_relationships tr

//         JOIN
//           ${P}term_taxonomy tt

//           ON
//             tt.term_taxonomy_id =
//             tr.term_taxonomy_id

//         JOIN
//           ${P}terms t

//           ON
//             t.term_id =
//             tt.term_id

//         WHERE
//           tr.object_id = ?

//           AND
//           tt.taxonomy =
//           'product_visibility'
//       `,
//       [id]
//     );

//   /* =====================================================
//      IMAGES
//   ===================================================== */

//   const thumb =
//     metaMap._thumbnail_id ||
//     null;

//   const galleryIds =
//     metaMap._product_image_gallery
//       ? metaMap._product_image_gallery
//           .split(',')
//           .map((s) => s.trim())
//           .filter(Boolean)
//       : [];

//   const imageIds = [
//     ...new Set(
//       [
//         thumb,
//         ...galleryIds,
//       ].filter(Boolean)
//     ),
//   ];

//   let images = [];

//   if (imageIds.length) {
//     const [atts] =
//       await pool.query(
//         `
//           SELECT

//             a.ID,

//             a.post_title AS title,

//             a.guid,

//             f.meta_value AS file

//           FROM ${P}posts a

//           LEFT JOIN
//             ${P}postmeta f

//             ON
//               f.post_id = a.ID

//             AND
//               f.meta_key =
//               '_wp_attached_file'

//           WHERE
//             a.ID IN (
//               ${imageIds
//                 .map(() => '?')
//                 .join(',')}
//             )

//             AND
//             a.post_type =
//             'attachment'
//         `,
//         imageIds
//       );

//     images = atts;
//   }

//   const featuredImage =
//     images.find(
//       (item) =>
//         String(item.ID) ===
//         String(thumb)
//     ) || null;

//   const gallery =
//     images.filter(
//       (item) =>
//         galleryIds.includes(
//           String(item.ID)
//         )
//     );

//   /* =====================================================
//      FINAL RESPONSE
//   ===================================================== */

//   return {
//     ...product,

//     product_type:
//       typeRow?.slug ||
//       typeRow?.name ||
//       null,

//     type:
//       typeRow?.slug ||
//       null,

//     regular_price:
//       metaMap._regular_price ??
//       product.min_price,

//     sale_price:
//       metaMap._sale_price ||
//       '',

//     price:
//       metaMap._price ??
//       product.min_price,

//     manage_stock:
//       metaMap._manage_stock ||
//       'no',

//     backorders:
//       metaMap._backorders ||
//       'no',

//     weight:
//       metaMap._weight ||
//       '',

//     length:
//       metaMap._length ||
//       '',

//     width:
//       metaMap._width ||
//       '',

//     height:
//       metaMap._height ||
//       '',

//     post_content:
//       product.description,

//     post_status:
//       product.status,

//     thumbnail_id:
//       thumb,

//     galleryIds,

//     featured_image:
//       featuredImage,

//     gallery,

//     variations,

//     categories,

//     tags,

//     visibility,

//     featured:
//       visibility.some(
//         (item) =>
//           item.slug === 'featured'
//       ),

//     images,

//     meta:
//       metaMap,
//   };
// }

// async function create(data, authorId = 1) {
//   if (!data?.name) throw httpError(400, 'name is required');

//   // Commit first — getById uses the pool and cannot see uncommitted rows.
//   const id = await withTransaction(pool, async (conn) => {
//     const local = nowLocal();
//     const gmt = nowGmt();
//     const slug = slugify(data.slug || data.name);
//     const status = data.status || 'publish';
//     const content = data.description || data.post_content || '';
//     const excerpt = data.short_description || data.post_excerpt || '';

//     const [result] = await conn.query(
//       `INSERT INTO ${P}posts
//         (post_author, post_date, post_date_gmt, post_content, post_title, post_excerpt,
//          post_status, comment_status, ping_status, post_password, post_name, to_ping, pinged,
//          post_modified, post_modified_gmt, post_content_filtered, post_parent, guid,
//          menu_order, post_type, post_mime_type, comment_count)
//        VALUES (?, ?, ?, ?, ?, ?, ?, 'closed', 'closed', '', ?, '', '', ?, ?, '', 0, '', 0, 'product', '', 0)`,
//       [authorId, local, gmt, content, data.name, excerpt, status, slug, local, gmt]
//     );
//     const newId = result.insertId;
//     const guid = `${env.wpSiteUrl}/?post_type=product&p=${newId}`;
//     await conn.query(`UPDATE ${P}posts SET guid = ? WHERE ID = ?`, [guid, newId]);

//     await writeProductMeta(conn, newId, data, 0);

//     const typeSlug = data.type || 'simple';
//     await setProductType(conn, newId, typeSlug);

//     let catIds = data.category_ids || data.categories;
//     if (catIds && !Array.isArray(catIds)) catIds = [catIds];
//     if (catIds) {
//       const resolved = [];
//       for (const c of catIds) {
//         const [[row]] = await conn.query(
//           `SELECT term_taxonomy_id FROM ${P}term_taxonomy
//            WHERE taxonomy = 'product_cat' AND (term_taxonomy_id = ? OR term_id = ?) LIMIT 1`,
//           [c, c]
//         );
//         if (row) resolved.push(row.term_taxonomy_id);
//       }
//       await setProductCategories(conn, newId, resolved.length ? resolved : [DEFAULT_CAT_TT]);
//     } else {
//       await setProductCategories(conn, newId, [DEFAULT_CAT_TT]);
//     }

//     return newId;
//   });

//   return getById(id);
// }

// async function update(id, data) {
//   const [[existing]] = await pool.query(
//     `SELECT ID FROM ${P}posts WHERE ID = ? AND post_type = 'product'`,
//     [id]
//   );
//   if (!existing) throw httpError(404, 'Product not found');

//   return withTransaction(pool, async (conn) => {
//     const local = nowLocal();
//     const gmt = nowGmt();
//     const fields = [];
//     const params = [];
//     if (data.name != null) { fields.push('post_title = ?'); params.push(data.name); }
//     if (data.slug != null) { fields.push('post_name = ?'); params.push(slugify(data.slug)); }
//     if (data.description != null || data.post_content != null) {
//       fields.push('post_content = ?');
//       params.push(data.description ?? data.post_content);
//     }
//     if (data.short_description != null || data.post_excerpt != null) {
//       fields.push('post_excerpt = ?');
//       params.push(data.short_description ?? data.post_excerpt);
//     }
//     if (data.status != null) { fields.push('post_status = ?'); params.push(data.status); }
//     fields.push('post_modified = ?', 'post_modified_gmt = ?');
//     params.push(local, gmt, id);

//     await conn.query(
//       `UPDATE ${P}posts SET ${fields.join(', ')} WHERE ID = ?`,
//       params
//     );

//     const metaMap = await getPostMetaMap(conn, P, id);
//     await writeProductMeta(conn, id, {
//       sku: data.sku ?? metaMap._sku,
//       regular_price: data.regular_price ?? data.regularPrice ?? metaMap._regular_price,
//       sale_price: data.sale_price !== undefined ? data.sale_price : metaMap._sale_price,
//       stock_quantity: data.stock_quantity !== undefined ? data.stock_quantity : metaMap._stock,
//       stock_status: data.stock_status || metaMap._stock_status,
//       manage_stock: data.manage_stock,
//       tax_status: data.tax_status || metaMap._tax_status,
//       virtual: data.virtual != null ? data.virtual : metaMap._virtual === 'yes',
//       downloadable: data.downloadable != null ? data.downloadable : metaMap._downloadable === 'yes',
//       weight: data.weight,
//       length: data.length,
//       width: data.width,
//       height: data.height,
//       thumbnail_id: data.thumbnail_id,
//       gallery: data.gallery,
//       tax_class: data.tax_class,
//     }, metaMap.total_sales || 0);

//     if (data.type) await setProductType(conn, id, data.type);

//     if (data.category_ids || data.categories) {
//       let catIds = data.category_ids || data.categories;
//       if (!Array.isArray(catIds)) catIds = [catIds];
//       const resolved = [];
//       for (const c of catIds) {
//         const [[row]] = await conn.query(
//           `SELECT term_taxonomy_id FROM ${P}term_taxonomy
//            WHERE taxonomy = 'product_cat' AND (term_taxonomy_id = ? OR term_id = ?) LIMIT 1`,
//           [c, c]
//         );
//         if (row) resolved.push(row.term_taxonomy_id);
//       }
//       if (resolved.length) await setProductCategories(conn, id, resolved);
//     }

//     return getById(id);
//   });
// }

// async function trash(id) {
//   const [[existing]] = await pool.query(
//     `SELECT ID FROM ${P}posts WHERE ID = ? AND post_type = 'product'`,
//     [id]
//   );
//   if (!existing) throw httpError(404, 'Product not found');

//   await withTransaction(pool, async (conn) => {
//     const local = nowLocal();
//     const gmt = nowGmt();
//     await conn.query(
//       `UPDATE ${P}posts SET post_status = 'trash', post_modified = ?, post_modified_gmt = ? WHERE ID = ?`,
//       [local, gmt, id]
//     );
//   });
//   return { ok: true, id, status: 'trash' };
// }

// async function updateVariation(productId, variationId, data) {
//   const [[parent]] = await pool.query(
//     `SELECT ID FROM ${P}posts WHERE ID = ? AND post_type = 'product'`,
//     [productId]
//   );
//   if (!parent) throw httpError(404, 'Product not found');

//   const [[variation]] = await pool.query(
//     `SELECT ID FROM ${P}posts
//      WHERE ID = ? AND post_parent = ? AND post_type = 'product_variation'`,
//     [variationId, productId]
//   );
//   if (!variation) throw httpError(404, 'Variation not found');

//   await withTransaction(pool, async (conn) => {
//     const local = nowLocal();
//     const gmt = nowGmt();
//     const metaMap = await getPostMetaMap(conn, P, variationId);

//     if (data.status != null) {
//       await conn.query(
//         `UPDATE ${P}posts SET post_status = ?, post_modified = ?, post_modified_gmt = ? WHERE ID = ?`,
//         [data.status, local, gmt, variationId]
//       );
//     } else {
//       await conn.query(
//         `UPDATE ${P}posts SET post_modified = ?, post_modified_gmt = ? WHERE ID = ?`,
//         [local, gmt, variationId]
//       );
//     }

//     const regular =
//       data.regular_price !== undefined ? data.regular_price : metaMap._regular_price;
//     const sale = data.sale_price !== undefined ? data.sale_price : metaMap._sale_price;
//     const price = resolvePrice(regular, sale);
//     const stockQty =
//       data.stock_quantity !== undefined ? data.stock_quantity : metaMap._stock;
//     const stockStatus = data.stock_status || metaMap._stock_status || 'instock';
//     const sku = data.sku !== undefined ? data.sku : metaMap._sku || '';
//     const size =
//       data.size !== undefined ? data.size : metaMap.attribute_pa_size || '';

//     const pairs = [
//       ['_sku', sku || ''],
//       ['_regular_price', regular == null || regular === '' ? '' : String(regular)],
//       ['_sale_price', sale == null || sale === '' ? '' : String(sale)],
//       ['_price', price],
//       ['_stock', stockQty == null || stockQty === '' ? '' : String(stockQty)],
//       ['_stock_status', stockStatus],
//       ['_manage_stock', stockQty != null && stockQty !== '' ? 'yes' : metaMap._manage_stock || 'no'],
//     ];
//     if (size !== undefined && size !== null) {
//       pairs.push(['attribute_pa_size', String(size)]);
//     }

//     for (const [k, v] of pairs) {
//       await upsertPostMeta(conn, P, variationId, k, v);
//     }

//     await syncProductMetaLookup(conn, variationId, {
//       sku: sku || '',
//       virtual: 0,
//       downloadable: 0,
//       min_price: price === '' ? 0 : Number(price),
//       max_price: price === '' ? 0 : Number(price),
//       onsale: sale !== '' && sale != null && Number(sale) < Number(regular || sale) ? 1 : 0,
//       stock_quantity: stockQty === '' || stockQty == null ? null : Number(stockQty),
//       stock_status: stockStatus,
//       total_sales: Number(metaMap.total_sales) || 0,
//       tax_status: metaMap._tax_status || 'taxable',
//       tax_class: metaMap._tax_class || '',
//     });
//   });

//   return getById(productId);
// }

// module.exports = {
//   list,
//   getById,
//   create,
//   update,
//   trash,
//   updateVariation,
//   DEFAULT_CAT_TT,
//   UNCATEGORIZED_TT,
// };








