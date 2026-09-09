const pool = require('../config/db');
const P = require('../config/prefix');
const { parseList, listResponse } = require('../utils/listParams');
const {
  resolveInventoryPeriod,
  formatKolkataDate,
  toKolkataParts,
} = require('../utils/dateRange');

const SUCCESS_STATUSES = ['wc-processing', 'wc-completed'];

const SORT_MAP = {
  newest: { col: 'o.date_created_gmt', dir: 'DESC' },
  oldest: { col: 'o.date_created_gmt', dir: 'ASC' },
  invoice: { col: 'invoice_number', dir: 'ASC' },
  order: { col: 'o.id', dir: 'DESC' },
  product: { col: 'oi.order_item_name', dir: 'ASC' },
  value_high: { col: 'line_total_num', dir: 'DESC' },
  value_low: { col: 'line_total_num', dir: 'ASC' },
  gst_high: { col: 'line_tax_num', dir: 'DESC' },
  gst_low: { col: 'line_tax_num', dir: 'ASC' },
};

const LINE_ITEM_FROM = `
  FROM ${P}wc_orders o
  INNER JOIN ${P}woocommerce_order_items oi
    ON oi.order_id = o.id
   AND oi.order_item_type = 'line_item'
  LEFT JOIN ${P}woocommerce_order_itemmeta oim_qty
    ON oim_qty.order_item_id = oi.order_item_id
   AND oim_qty.meta_key = '_qty'
  LEFT JOIN ${P}woocommerce_order_itemmeta oim_sub
    ON oim_sub.order_item_id = oi.order_item_id
   AND oim_sub.meta_key = '_line_subtotal'
  LEFT JOIN ${P}woocommerce_order_itemmeta oim_tot
    ON oim_tot.order_item_id = oi.order_item_id
   AND oim_tot.meta_key = '_line_total'
  LEFT JOIN ${P}woocommerce_order_itemmeta oim_tax
    ON oim_tax.order_item_id = oi.order_item_id
   AND oim_tax.meta_key = '_line_tax'
  LEFT JOIN ${P}woocommerce_order_itemmeta oim_sku
    ON oim_sku.order_item_id = oi.order_item_id
   AND oim_sku.meta_key = '_sku'
  LEFT JOIN ${P}woocommerce_order_itemmeta oim_pid
    ON oim_pid.order_item_id = oi.order_item_id
   AND oim_pid.meta_key = '_product_id'
  LEFT JOIN ${P}woocommerce_order_itemmeta oim_size
    ON oim_size.order_item_id = oi.order_item_id
   AND oim_size.meta_key = 'pa_size'
  LEFT JOIN ${P}wcpdf_invoice_number inv
    ON inv.order_id = o.id
  LEFT JOIN ${P}wc_orders_meta invm
    ON invm.order_id = o.id
   AND invm.meta_key = '_wcpdf_invoice_number'
  LEFT JOIN ${P}wc_product_meta_lookup ml
    ON ml.product_id = CAST(oim_pid.meta_value AS UNSIGNED)
  LEFT JOIN ${P}postmeta pm_hsn
    ON pm_hsn.post_id = CAST(oim_pid.meta_value AS UNSIGNED)
   AND pm_hsn.meta_key = 'hsn_prod_id'
`;

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function resolveSort(req) {
  const key = SORT_MAP[req.query.sort] ? req.query.sort : 'newest';
  return SORT_MAP[key];
}

function buildFilterMeta(range) {
  const filter = {
    period: range.period,
    label: range.label,
  };

  if (range.date) filter.date = range.date;
  if (range.date_from) filter.date_from = range.date_from;
  if (range.date_to) filter.date_to = range.date_to;
  if (range.year != null) filter.year = range.year;
  if (range.month != null) filter.month = range.month;

  return filter;
}

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

function buildWhereClause(range, search) {
  const params = [...SUCCESS_STATUSES, range.start, range.end];
  let where = `
    o.type = 'shop_order'
    AND o.status IN (?, ?)
    AND o.date_created_gmt >= ?
    AND o.date_created_gmt <= ?
  `;

  if (search) {
    where += `
      AND (
        oi.order_item_name LIKE ?
        OR COALESCE(NULLIF(oim_sku.meta_value, ''), ml.sku, '') LIKE ?
        OR CAST(o.id AS CHAR) LIKE ?
        OR CAST(COALESCE(inv.calculated_number, invm.meta_value) AS CHAR) LIKE ?
        OR COALESCE(pm_hsn.meta_value, '') LIKE ?
        OR COALESCE(oim_size.meta_value, '') LIKE ?
      )
    `;
    const q = `%${search}%`;
    params.push(q, q, q, q, q, q);
  }

  return { where, params };
}

function formatSkuHsn(sku, hsn) {
  const skuValue = (sku || '').trim();
  const hsnValue = (hsn || '').trim();

  if (skuValue && hsnValue) {
    return `${skuValue} / ${hsnValue}`;
  }
  if (skuValue) return skuValue;
  if (hsnValue) return hsnValue;
  return '—';
}

async function fetchOrderTaxMap(orderIds) {
  const map = new Map();
  if (!orderIds.length) return map;

  const [rows] = await pool.query(
    `SELECT
       oi.order_id,
       oi.order_item_name,
       MAX(CASE WHEN oim.meta_key = 'tax_amount' THEN oim.meta_value END) AS tax_amount,
       MAX(CASE WHEN oim.meta_key = 'rate_percent' THEN oim.meta_value END) AS rate_percent
     FROM ${P}woocommerce_order_items oi
     LEFT JOIN ${P}woocommerce_order_itemmeta oim
       ON oim.order_item_id = oi.order_item_id
     WHERE oi.order_id IN (?)
       AND oi.order_item_type = 'tax'
     GROUP BY oi.order_id, oi.order_item_id, oi.order_item_name`,
    [orderIds]
  );

  for (const row of rows) {
    const orderId = Number(row.order_id);
    if (!map.has(orderId)) {
      map.set(orderId, {
        cgst: 0,
        sgst: 0,
        igst: 0,
        total: 0,
        cgstPercent: 0,
        sgstPercent: 0,
        igstPercent: 0,
      });
    }

    const entry = map.get(orderId);
    const amount = roundMoney(row.tax_amount);
    const rate = Number(row.rate_percent) || 0;
    const name = String(row.order_item_name || '').toUpperCase();

    if (name.includes('IGST')) {
      entry.igst = roundMoney(entry.igst + amount);
      entry.igstPercent = rate || entry.igstPercent;
    } else if (name.includes('SGST')) {
      entry.sgst = roundMoney(entry.sgst + amount);
      entry.sgstPercent = rate || entry.sgstPercent;
    } else if (name.includes('CGST')) {
      entry.cgst = roundMoney(entry.cgst + amount);
      entry.cgstPercent = rate || entry.cgstPercent;
    } else {
      entry.cgst = roundMoney(entry.cgst + amount / 2);
      entry.sgst = roundMoney(entry.sgst + amount / 2);
    }

    entry.total = roundMoney(entry.cgst + entry.sgst + entry.igst);
  }

  return map;
}

function allocateLineTax(lineTax, orderTax) {
  const totalGst = roundMoney(lineTax);
  if (totalGst <= 0) {
    return {
      sgst_amount: 0,
      cgst_amount: 0,
      igst_amount: 0,
      sgst_percent: 0,
      cgst_percent: 0,
      igst_percent: 0,
    };
  }

  if (orderTax.total > 0) {
    let sgstAmount = roundMoney(totalGst * (orderTax.sgst / orderTax.total));
    let cgstAmount = roundMoney(totalGst * (orderTax.cgst / orderTax.total));
    let igstAmount = roundMoney(totalGst * (orderTax.igst / orderTax.total));
    const diff = roundMoney(totalGst - sgstAmount - cgstAmount - igstAmount);

    if (diff !== 0) {
      if (orderTax.igst > 0) igstAmount = roundMoney(igstAmount + diff);
      else if (orderTax.cgst >= orderTax.sgst) cgstAmount = roundMoney(cgstAmount + diff);
      else sgstAmount = roundMoney(sgstAmount + diff);
    }

    return {
      sgst_amount: sgstAmount,
      cgst_amount: cgstAmount,
      igst_amount: igstAmount,
      sgst_percent: orderTax.sgstPercent || (sgstAmount > 0 ? 2.5 : 0),
      cgst_percent: orderTax.cgstPercent || (cgstAmount > 0 ? 2.5 : 0),
      igst_percent: orderTax.igstPercent || (igstAmount > 0 ? orderTax.igstPercent : 0),
    };
  }

  const cgstAmount = roundMoney(totalGst / 2);
  const sgstAmount = roundMoney(totalGst - cgstAmount);

  return {
    sgst_amount: sgstAmount,
    cgst_amount: cgstAmount,
    igst_amount: 0,
    sgst_percent: 2.5,
    cgst_percent: 2.5,
    igst_percent: 0,
  };
}

function mapLineRow(raw, orderTaxMap) {
  const quantity = Number(raw.quantity) || 0;
  const value = roundMoney(raw.line_subtotal || raw.line_total);
  const totalGst = roundMoney(raw.line_tax);
  const rate = quantity > 0 ? roundMoney(value / quantity) : roundMoney(value);
  const netValue = roundMoney(value - totalGst);
  const taxableValue = roundMoney(netValue);

  const orderTax = orderTaxMap.get(Number(raw.order_id)) || {
    cgst: 0,
    sgst: 0,
    igst: 0,
    total: 0,
    cgstPercent: 0,
    sgstPercent: 0,
    igstPercent: 0,
  };

  const split = allocateLineTax(totalGst, orderTax);

  let gstPercent = 0;
  if (taxableValue > 0 && totalGst > 0) {
    gstPercent = roundMoney((totalGst / taxableValue) * 100);
  } else {
    gstPercent = roundMoney(
      split.sgst_percent + split.cgst_percent + split.igst_percent
    );
  }

  const invoiceNumber =
    raw.invoice_number != null && raw.invoice_number !== ''
      ? `#${raw.invoice_number}`
      : '—';

  let productName = raw.product_name || '';
  if (raw.size) {
    productName = productName.includes(String(raw.size))
      ? productName
      : `${productName} (${raw.size})`.trim();
  }

  return {
    order_item_id: raw.order_item_id,
    date: raw.order_date,
    invoice_number: invoiceNumber,
    order_number: `#${raw.order_id}`,
    product_name: productName,
    sku_hsn: formatSkuHsn(raw.sku, raw.hsn),
    quantity,
    rate,
    value,
    tax_amount: totalGst,
    gst_percent: gstPercent,
    taxable_value: taxableValue,
    sgst_percent: split.sgst_percent,
    cgst_percent: split.cgst_percent,
    igst_percent: split.igst_percent,
    sgst_amount: split.sgst_amount,
    cgst_amount: split.cgst_amount,
    igst_amount: split.igst_amount,
    total_gst: totalGst,
    net_value: netValue,
  };
}

async function fetchLineRows(range, search, sort, pagination = null) {
  const { where, params } = buildWhereClause(range, search);

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total ${LINE_ITEM_FROM} WHERE ${where}`,
    params
  );

  const selectSql = `
    SELECT
      oi.order_item_id,
      o.id AS order_id,
      o.date_created_gmt AS order_date,
      COALESCE(inv.calculated_number, CAST(invm.meta_value AS UNSIGNED)) AS invoice_number,
      oi.order_item_name AS product_name,
      COALESCE(NULLIF(oim_sku.meta_value, ''), ml.sku, '') AS sku,
      pm_hsn.meta_value AS hsn,
      oim_size.meta_value AS size,
      CAST(oim_qty.meta_value AS DECIMAL(20, 4)) AS quantity,
      CAST(oim_sub.meta_value AS DECIMAL(20, 4)) AS line_subtotal,
      CAST(oim_tot.meta_value AS DECIMAL(20, 4)) AS line_total,
      CAST(oim_tax.meta_value AS DECIMAL(20, 4)) AS line_tax,
      CAST(oim_tot.meta_value AS DECIMAL(20, 4)) AS line_total_num,
      CAST(oim_tax.meta_value AS DECIMAL(20, 4)) AS line_tax_num
    ${LINE_ITEM_FROM}
    WHERE ${where}
    ORDER BY ${sort.col} ${sort.dir}, oi.order_item_id DESC
  `;

  let rows;
  if (pagination) {
    const [result] = await pool.query(
      `${selectSql} LIMIT ? OFFSET ?`,
      [...params, pagination.limit, pagination.offset]
    );
    rows = result;
  } else {
    const [result] = await pool.query(selectSql, params);
    rows = result;
  }

  const orderIds = [...new Set(rows.map((row) => Number(row.order_id)).filter(Boolean))];
  const orderTaxMap = await fetchOrderTaxMap(orderIds);

  return {
    total: Number(total) || 0,
    rows: rows.map((row) => mapLineRow(row, orderTaxMap)),
  };
}

async function getGstReport(req) {
  const range = resolveInventoryPeriod(req.query);
  const search = (req.query.search || '').trim();
  const sort = resolveSort(req);
  const { page, limit, offset } = parseList(req, {}, 'newest');
  const availableYears = await getAvailableYears();

  if (!range.start || !range.end) {
    return {
      ...listResponse([], 0, page, limit),
      filter: buildFilterMeta(range),
      available_years: availableYears,
    };
  }

  const { total, rows } = await fetchLineRows(range, search, sort, {
    limit,
    offset,
  });

  return {
    ...listResponse(rows, total, page, limit),
    filter: buildFilterMeta(range),
    available_years: availableYears,
  };
}

async function getGstExport(req) {
  const range = resolveInventoryPeriod(req.query);
  const search = (req.query.search || '').trim();
  const sort = resolveSort(req);

  if (!range.start || !range.end) {
    return {
      filter: buildFilterMeta(range),
      data: [],
    };
  }

  const { rows } = await fetchLineRows(range, search, sort);

  return {
    filter: buildFilterMeta(range),
    data: rows,
  };
}

module.exports = { getGstReport, getGstExport };
