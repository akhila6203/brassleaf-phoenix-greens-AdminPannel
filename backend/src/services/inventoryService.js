const pool = require('../config/db');
const P = require('../config/prefix');
const { resolveInventoryPeriod, toKolkataParts } = require('../utils/dateRange');

const SUCCESS_STATUSES = ['wc-processing', 'wc-completed'];

const SORT_HANDLERS = {
  most_sold: (a, b) => b.units_sold - a.units_sold || a.name.localeCompare(b.name),
  least_sold: (a, b) => a.units_sold - b.units_sold || a.name.localeCompare(b.name),
  highest_sales: (a, b) => b.sales_amount - a.sales_amount || a.name.localeCompare(b.name),
  lowest_sales: (a, b) => a.sales_amount - b.sales_amount || a.name.localeCompare(b.name),
  name_asc: (a, b) => a.name.localeCompare(b.name),
};

async function getAvailableYears() {
  const today = toKolkataParts(new Date());
  const currentYear = today.year;

  const [rows] = await pool.query(
    `SELECT DISTINCT YEAR(o.date_created_gmt) AS yr
     FROM ${P}wc_orders o
     WHERE o.type = 'shop_order'
       AND o.status IN (?, ?)
     ORDER BY yr DESC`,
    SUCCESS_STATUSES
  );

  const years = rows.map((row) => Number(row.yr)).filter(Boolean);

  if (!years.includes(currentYear)) {
    years.unshift(currentYear);
    years.sort((a, b) => b - a);
  }

  return years.length ? years : [currentYear];
}

async function getProducts(search) {
  const params = [];
  let where = `
    p.post_type = 'product'
    AND p.post_status IN ('publish', 'draft', 'private', 'pending')
  `;

  if (search) {
    where += ` AND (p.post_title LIKE ? OR ml.sku LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`);
  }

  const [rows] = await pool.query(
    `SELECT
       p.ID AS id,
       p.post_title AS name,
       ml.sku,
       att.guid AS image_url
     FROM ${P}posts p
     LEFT JOIN ${P}wc_product_meta_lookup ml ON ml.product_id = p.ID
     LEFT JOIN ${P}postmeta thumb_pm
       ON thumb_pm.post_id = p.ID AND thumb_pm.meta_key = '_thumbnail_id'
     LEFT JOIN ${P}posts att ON att.ID = thumb_pm.meta_value
     WHERE ${where}
     ORDER BY p.post_title ASC`,
    params
  );

  return rows;
}

async function getSalesAggregation(start, end) {
  const [productSales] = await pool.query(
    `SELECT
       pl.product_id,
       SUM(pl.product_qty) AS units_sold,
       ROUND(COALESCE(SUM(pl.product_gross_revenue), 0), 2) AS sales_amount
     FROM ${P}wc_order_product_lookup pl
     JOIN ${P}wc_orders o ON o.id = pl.order_id
     WHERE o.type = 'shop_order'
       AND o.status IN (?, ?)
       AND o.date_created_gmt >= ?
       AND o.date_created_gmt <= ?
     GROUP BY pl.product_id`,
    [...SUCCESS_STATUSES, start, end]
  );

  const [[summaryRow]] = await pool.query(
    `SELECT
       COALESCE(SUM(pl.product_qty), 0) AS total_units_sold,
       COUNT(DISTINCT CASE WHEN pl.product_qty > 0 THEN pl.product_id END) AS total_products_sold,
       ROUND(COALESCE(SUM(pl.product_gross_revenue), 0), 2) AS total_sales
     FROM ${P}wc_order_product_lookup pl
     JOIN ${P}wc_orders o ON o.id = pl.order_id
     WHERE o.type = 'shop_order'
       AND o.status IN (?, ?)
       AND o.date_created_gmt >= ?
       AND o.date_created_gmt <= ?`,
    [...SUCCESS_STATUSES, start, end]
  );

  const [[orderRow]] = await pool.query(
    `SELECT COUNT(DISTINCT o.id) AS orders
     FROM ${P}wc_orders o
     WHERE o.type = 'shop_order'
       AND o.status IN (?, ?)
       AND o.date_created_gmt >= ?
       AND o.date_created_gmt <= ?`,
    [...SUCCESS_STATUSES, start, end]
  );

  const salesMap = new Map();
  for (const row of productSales) {
    salesMap.set(Number(row.product_id), {
      units_sold: Number(row.units_sold) || 0,
      sales_amount: Number(row.sales_amount) || 0,
    });
  }

  return {
    salesMap,
    summary: {
      total_units_sold: Number(summaryRow.total_units_sold) || 0,
      total_products_sold: Number(summaryRow.total_products_sold) || 0,
      total_sales: Number(summaryRow.total_sales) || 0,
      orders: Number(orderRow.orders) || 0,
    },
  };
}

function buildFilterMeta(range) {
  const filter = { period: range.period, label: range.label };

  if (range.date) filter.date = range.date;
  if (range.year != null) filter.year = range.year;
  if (range.month != null) filter.month = range.month;

  return filter;
}

async function getInventory(req) {
  const range = resolveInventoryPeriod(req.query);
  const search = (req.query.search || '').trim();
  const sort = SORT_HANDLERS[req.query.sort] ? req.query.sort : 'most_sold';

  const availableYears = await getAvailableYears();

  if (!range.start || !range.end) {
    return {
      filter: buildFilterMeta(range),
      summary: {
        total_units_sold: 0,
        total_products_sold: 0,
        total_sales: 0,
        orders: 0,
      },
      products: [],
      available_years: availableYears,
    };
  }

  const [products, { salesMap, summary }] = await Promise.all([
    getProducts(search),
    getSalesAggregation(range.start, range.end),
  ]);

  const merged = products.map((product) => {
    const sales = salesMap.get(Number(product.id)) || {
      units_sold: 0,
      sales_amount: 0,
    };

    return {
      id: product.id,
      name: product.name,
      sku: product.sku || '',
      image_url: product.image_url || null,
      units_sold: sales.units_sold,
      sales_amount: sales.sales_amount,
    };
  });

  merged.sort(SORT_HANDLERS[sort]);

  return {
    filter: buildFilterMeta(range),
    summary,
    products: merged,
    available_years: availableYears,
  };
}

module.exports = { getInventory };
