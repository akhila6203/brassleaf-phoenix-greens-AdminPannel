import ExcelJS from 'exceljs';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const PERIOD_LABELS = {
  today: 'Today',
  date: 'Date',
  range: 'Date Range',
  week: 'This Week',
  month: 'Month',
  year: 'Year',
};

function formatIsoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getWeekRangeIso() {
  const ref = new Date();
  ref.setHours(0, 0, 0, 0);
  const dow = ref.getDay();
  const daysFromMonday = dow === 0 ? 6 : dow - 1;
  const monday = new Date(ref);
  monday.setDate(ref.getDate() - daysFromMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: formatIsoDate(monday), end: formatIsoDate(sunday) };
}

function buildFilename({ period, filter, selectedDate,dateFrom,
  dateTo, selectedYear, selectedMonth, yearFilter }) {
  switch (period) {
    case 'date':
      return `inventory-date-${filter?.date || selectedDate}.xlsx`;
    case 'range': {
    const from =
      filter?.date_from ||
      dateFrom;

    const to =
      filter?.date_to ||
      dateTo;

    return `inventory-${from}-to-${to}.xlsx`;
  }
    case 'month': {
      const year = filter?.year || selectedYear;
      const month = filter?.month || selectedMonth;
      const monthSlug = MONTH_NAMES[month - 1]?.toLowerCase() || `month-${month}`;
      return `inventory-${monthSlug}-${year}.xlsx`;
    }
    case 'year':
      return `inventory-year-${filter?.year || yearFilter}.xlsx`;
    case 'week': {
      const { start, end } = getWeekRangeIso();
      return `inventory-week-${start}-to-${end}.xlsx`;
    }
    case 'today':
    default:
      return `inventory-today-${formatIsoDate(new Date())}.xlsx`;
  }
}

function buildFilterRows({ period, filter, selectedDate, dateFrom,
  dateTo, selectedYear, selectedMonth, yearFilter }) {
  const rows = [['Period:', PERIOD_LABELS[period] || period]];

  if (period === 'date') {
    rows.push(['Selected Date:', filter?.date || selectedDate]);
  } else if (period === 'range') {
  const from =
    filter?.date_from ||
    dateFrom;

  const to =
    filter?.date_to ||
    dateTo;

  rows.push(['From Date:', from]);
  rows.push(['To Date:', to]);
}else if (period === 'month') {
    const year = filter?.year || selectedYear;
    const month = filter?.month || selectedMonth;
    rows.push(['Year:', year]);
    rows.push(['Month:', MONTH_NAMES[month - 1] || month]);
  } else if (period === 'year') {
    rows.push(['Year:', filter?.year || yearFilter]);
  } else if (period === 'today') {
    rows.push(['Date:', formatIsoDate(new Date())]);
  } else if (period === 'week') {
    const { start, end } = getWeekRangeIso();
    rows.push(['Date Range:', `${start} to ${end}`]);
  }

  return rows;
}

function productUnitPrice(product) {
  const units = Number(product.units_sold) || 0;
  const sales = Number(product.sales_amount) || 0;
  if (units <= 0) return null;
  return Math.round((sales / units) * 100) / 100;
}

function applyBold(row, size) {
  row.font = { bold: true, size: size || 11 };
}

export async function downloadInventoryExcel({
  filter,
  summary,
  products = [],
  period,
  selectedDate,
  dateFrom,
  dateTo,
  selectedYear,
  selectedMonth,
  yearFilter,
}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Brassleaf Admin';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Inventory', {
    views: [{ state: 'frozen', ySplit: 0 }],
  });

  let rowIndex = 1;

  const titleRow = sheet.getRow(rowIndex++);
  titleRow.getCell(1).value = 'Inventory Report';
  applyBold(titleRow, 14);
  titleRow.height = 22;

  rowIndex++;

  for (const [label, value] of buildFilterRows({
    period,
    filter,
    selectedDate,
    dateFrom,
  dateTo,
    selectedYear,
    selectedMonth,
    yearFilter,
  })) {
    const row = sheet.getRow(rowIndex++);
    row.getCell(1).value = label;
    row.getCell(1).font = { bold: true };
    row.getCell(2).value = value;
  }

  rowIndex++;

  const summaryHeading = sheet.getRow(rowIndex++);
  summaryHeading.getCell(1).value = 'Inventory Summary';
  applyBold(summaryHeading, 12);

  const summaryRows = [
    ['Total Units Sold', Number(summary?.total_units_sold) || 0],
    ['Total Products Sold', Number(summary?.total_products_sold) || 0],
    ['Total Sales', Number(summary?.total_sales) || 0],
    ['Orders', Number(summary?.orders) || 0],
  ];

  for (const [label, value] of summaryRows) {
    const row = sheet.getRow(rowIndex++);
    row.getCell(1).value = label;
    row.getCell(1).font = { bold: true };
    row.getCell(2).value = value;
    if (label === 'Total Sales') {
      row.getCell(2).numFmt = '₹#,##0';
    } else {
      row.getCell(2).numFmt = '#,##0';
    }
  }

  rowIndex += 2;

  const detailsHeading = sheet.getRow(rowIndex++);
  detailsHeading.getCell(1).value = 'Product Details';
  applyBold(detailsHeading, 12);

  const tableHeaderRowNum = rowIndex;
  const tableHeader = sheet.getRow(rowIndex++);
  const headers = ['S.No', 'Product Name', 'SKU', 'Price', 'Units Sold', 'Sales Amount'];
  headers.forEach((header, index) => {
    const cell = tableHeader.getCell(index + 1);
    cell.value = header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0F766E' },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' },
    };
  });
  tableHeader.height = 20;

  products.forEach((product, index) => {
    const row = sheet.getRow(rowIndex++);
    const price = productUnitPrice(product);

    row.getCell(1).value = index + 1;
    row.getCell(2).value = product.name || '';
    row.getCell(3).value = product.sku || '';
    row.getCell(4).value = price;
    row.getCell(5).value = Number(product.units_sold) || 0;
    row.getCell(6).value = Number(product.sales_amount) || 0;

    row.getCell(1).numFmt = '#,##0';
    row.getCell(4).numFmt = price == null ? '@' : '₹#,##0.00';
    row.getCell(5).numFmt = '#,##0';
    row.getCell(6).numFmt = '₹#,##0';

    if (price == null) {
      row.getCell(4).value = '—';
    }

    for (let col = 1; col <= 6; col += 1) {
      row.getCell(col).border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      };
    }
  });

  sheet.columns = [
    { width: 8 },
    { width: 34 },
    { width: 16 },
    { width: 14 },
    { width: 14 },
    { width: 16 },
  ];

  if (products.length > 0) {
    sheet.autoFilter = {
      from: { row: tableHeaderRowNum, column: 1 },
      to: { row: tableHeaderRowNum, column: 6 },
    };
    sheet.views = [{ state: 'frozen', ySplit: tableHeaderRowNum }];
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = buildFilename({
    period,
    filter,
    selectedDate,
    dateFrom,
dateTo,
    selectedYear,
    selectedMonth,
    yearFilter,
  });
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
