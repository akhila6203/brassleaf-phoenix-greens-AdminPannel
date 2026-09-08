const pool = require('../config/db');
const P = require('../config/prefix');

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function resolvePrice(regular, sale, price) {
  const saleValue = sale == null || sale === '' ? '' : String(sale);
  if (saleValue !== '' && !Number.isNaN(Number(saleValue))) {
    return roundMoney(Number(saleValue));
  }

  const regularValue = regular == null || regular === '' ? '' : String(regular);
  if (regularValue !== '' && !Number.isNaN(Number(regularValue))) {
    return roundMoney(Number(regularValue));
  }

  return roundMoney(price);
}

function resolveGstPercent(meta = {}, taxStatus = 'taxable') {
  const raw = meta.gst_percent ?? meta._gst_percent;
  if (raw != null && raw !== '') {
    const parsed = Number(raw);
    if (!Number.isNaN(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  const status = meta._tax_status ?? taxStatus;
  if (status === 'none' || status === 'shipping') {
    return 0;
  }

  return 5;
}

function splitInclusive(total, gstPercent) {
  const inclusiveTotal = roundMoney(total);
  if (inclusiveTotal <= 0 || !gstPercent) {
    return {
      price: inclusiveTotal,
      gst: 0,
      total: inclusiveTotal,
    };
  }

  const price = roundMoney((inclusiveTotal * 100) / (100 + gstPercent));
  const gst = roundMoney(inclusiveTotal - price);

  return {
    price,
    gst,
    total: inclusiveTotal,
  };
}

function buildVariantLabel(variation) {
  if (variation.size) return String(variation.size);
  if (variation.name && variation.name !== 'Product') return String(variation.name);
  return '—';
}

const SORT_HANDLERS = {
  name_asc: (a, b) => a.product_name.localeCompare(b.product_name) || a.variant_label.localeCompare(b.variant_label),
  price_low: (a, b) => a.total - b.total || a.product_name.localeCompare(b.product_name),
  price_high: (a, b) => b.total - a.total || a.product_name.localeCompare(b.product_name),
  gst_low: (a, b) => a.gst - b.gst || a.product_name.localeCompare(b.product_name),
  gst_high: (a, b) => b.gst - a.gst || a.product_name.localeCompare(b.product_name),
};

async function fetchProductMetaMap(productIds) {
  if (!productIds.length) return new Map();

  const [rows] = await pool.query(
    `SELECT post_id, meta_key, meta_value
     FROM ${P}postmeta
     WHERE post_id IN (?)
       AND meta_key IN (
         '_regular_price',
         '_sale_price',
         '_price',
         'gst_percent',
         '_tax_status'
       )`,
    [productIds]
  );

  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.post_id)) {
      map.set(row.post_id, {});
    }
    map.get(row.post_id)[row.meta_key] = row.meta_value;
  }

  return map;
}

async function fetchProductTypes(productIds) {
  if (!productIds.length) return new Map();

  const [rows] = await pool.query(
    `SELECT tr.object_id AS product_id, t.slug AS type_slug
     FROM ${P}term_relationships tr
     JOIN ${P}term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id
     JOIN ${P}terms t ON t.term_id = tt.term_id
     WHERE tt.taxonomy = 'product_type'
       AND tr.object_id IN (?)`,
    [productIds]
  );

  const map = new Map();
  for (const row of rows) {
    map.set(Number(row.product_id), row.type_slug || 'simple');
  }
  return map;
}

async function findProductIdsByVariationSearch(search) {
  const [rows] = await pool.query(
    `SELECT DISTINCT v.post_parent AS product_id
     FROM ${P}posts v
     LEFT JOIN ${P}postmeta pm_sku
       ON pm_sku.post_id = v.ID AND pm_sku.meta_key = '_sku'
     LEFT JOIN ${P}postmeta pm_size
       ON pm_size.post_id = v.ID AND pm_size.meta_key = 'attribute_pa_size'
     WHERE v.post_type = 'product_variation'
       AND v.post_status NOT IN ('trash', 'auto-draft')
       AND (
         v.post_title LIKE ?
         OR pm_sku.meta_value LIKE ?
         OR pm_size.meta_value LIKE ?
       )`,
    [`%${search}%`, `%${search}%`, `%${search}%`]
  );

  return rows.map((row) => Number(row.product_id)).filter(Boolean);
}

async function fetchProducts(search) {
  const params = [];
  let where = `
    p.post_type = 'product'
    AND p.post_status NOT IN ('auto-draft', 'trash')
    AND p.post_status IN ('publish', 'draft', 'private', 'pending')
  `;

  if (search) {
    const variationProductIds = await findProductIdsByVariationSearch(search);
    if (variationProductIds.length) {
      where += ` AND (p.post_title LIKE ? OR ml.sku LIKE ? OR p.ID IN (?))`;
      params.push(`%${search}%`, `%${search}%`, variationProductIds);
    } else {
      where += ` AND (p.post_title LIKE ? OR ml.sku LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }
  }

  const [rows] = await pool.query(
    `SELECT
       p.ID AS id,
       p.post_title AS name,
       ml.sku,
       ml.tax_status
     FROM ${P}posts p
     LEFT JOIN ${P}wc_product_meta_lookup ml ON ml.product_id = p.ID
     WHERE ${where}
     ORDER BY p.post_title ASC`,
    params
  );

  return rows;
}

async function fetchVariations(productIds, search) {
  if (!productIds.length) return [];

  const params = [productIds];
  let searchClause = '';

  if (search) {
    searchClause = `
      AND (
        v.post_title LIKE ?
        OR pm_sku.meta_value LIKE ?
        OR pm_size.meta_value LIKE ?
      )
    `;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const [rows] = await pool.query(
    `SELECT
       v.post_parent AS product_id,
       v.ID AS variation_id,
       v.post_title AS name,
       pm_price.meta_value AS price,
       pm_reg.meta_value AS regular_price,
       pm_sale.meta_value AS sale_price,
       pm_sku.meta_value AS sku,
       pm_size.meta_value AS size
     FROM ${P}posts v
     LEFT JOIN ${P}postmeta pm_price
       ON pm_price.post_id = v.ID AND pm_price.meta_key = '_price'
     LEFT JOIN ${P}postmeta pm_reg
       ON pm_reg.post_id = v.ID AND pm_reg.meta_key = '_regular_price'
     LEFT JOIN ${P}postmeta pm_sale
       ON pm_sale.post_id = v.ID AND pm_sale.meta_key = '_sale_price'
     LEFT JOIN ${P}postmeta pm_sku
       ON pm_sku.post_id = v.ID AND pm_sku.meta_key = '_sku'
     LEFT JOIN ${P}postmeta pm_size
       ON pm_size.post_id = v.ID AND pm_size.meta_key = 'attribute_pa_size'
     WHERE v.post_type = 'product_variation'
       AND v.post_status NOT IN ('trash', 'auto-draft')
       AND v.post_parent IN (?)
       ${searchClause}
     ORDER BY v.menu_order ASC, v.ID ASC`,
    params
  );

  return rows;
}

function buildRow(product, rowData, gstPercent) {
  const sellingPrice = resolvePrice(
    rowData.regular_price,
    rowData.sale_price,
    rowData.price
  );
  const amounts = splitInclusive(sellingPrice, gstPercent);

  return {
    product_name: product.name,
    sku: rowData.sku || product.sku || '',
    variant_label: rowData.variant_label || '—',
    price: amounts.price,
    gst: amounts.gst,
    total: amounts.total,
  };
}

async function getGstReport(req) {
  const search = (req.query.search || '').trim();
  const sort = SORT_HANDLERS[req.query.sort] ? req.query.sort : 'name_asc';

  const products = await fetchProducts(search);
  const productIds = products.map((product) => Number(product.id));

  const [metaMap, typeMap, variations] = await Promise.all([
    fetchProductMetaMap(productIds),
    fetchProductTypes(productIds),
    fetchVariations(productIds, search),
  ]);

  const variationsByProduct = new Map();
  for (const variation of variations) {
    const productId = Number(variation.product_id);
    if (!variationsByProduct.has(productId)) {
      variationsByProduct.set(productId, []);
    }
    variationsByProduct.get(productId).push(variation);
  }

  const items = [];

  for (const product of products) {
    const productId = Number(product.id);
    const meta = metaMap.get(productId) || {};
    const gstPercent = resolveGstPercent(meta, product.tax_status);
    const productType = typeMap.get(productId) || 'simple';
    const productVariations = variationsByProduct.get(productId) || [];

    if (productType === 'variable' && productVariations.length) {
      for (const variation of productVariations) {
        items.push(
          buildRow(product, {
            regular_price: variation.regular_price,
            sale_price: variation.sale_price,
            price: variation.price,
            sku: variation.sku,
            variant_label: buildVariantLabel(variation),
          }, gstPercent)
        );
      }
      continue;
    }

    items.push(
      buildRow(product, {
        regular_price: meta._regular_price,
        sale_price: meta._sale_price,
        price: meta._price,
        sku: product.sku,
        variant_label: '—',
      }, gstPercent)
    );
  }

  items.sort(SORT_HANDLERS[sort]);

  return {
    items,
    counts: {
      products: products.length,
      variants: items.length,
    },
  };
}

module.exports = { getGstReport };
