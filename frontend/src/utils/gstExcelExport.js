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

function applyBold(row, size) {
  row.font = { bold: true, size: size || 11 };
}

function buildFilename(filter = {}) {
  const period = filter.period || 'today';

  switch (period) {
    case 'date':
      return `gst-date-${filter.date || 'report'}.xlsx`;
    case 'range':
      return `gst-${filter.date_from || 'from'}-to-${filter.date_to || 'to'}.xlsx`;
    case 'week':
      return 'gst-this-week.xlsx';
    case 'month': {
      const monthSlug =
        MONTH_NAMES[(filter.month || 1) - 1]?.toLowerCase() || `month-${filter.month}`;
      return `gst-${monthSlug}-${filter.year || 'year'}.xlsx`;
    }
    case 'year':
      return `gst-${filter.year || 'year'}.xlsx`;
    case 'today':
    default:
      return `gst-today-${new Date().toISOString().slice(0, 10)}.xlsx`;
  }
}

function excelDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date;
}

export async function downloadGstExcel({ filter, items = [] }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Brassleaf Admin';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('GST Report', {
    views: [{ state: 'frozen', ySplit: 0 }],
  });

  let rowIndex = 1;

  const titleRow = sheet.getRow(rowIndex++);
  titleRow.getCell(1).value = 'GST Report';
  applyBold(titleRow, 14);
  titleRow.height = 22;

  rowIndex++;

  if (filter?.label) {
    const labelRow = sheet.getRow(rowIndex++);
    labelRow.getCell(1).value = 'Period:';
    labelRow.getCell(1).font = { bold: true };
    labelRow.getCell(2).value = filter.label;
    rowIndex++;
  }

  const tableHeaderRowNum = rowIndex;
  const tableHeader = sheet.getRow(rowIndex++);
  const headers = [
    'S.No',
    'Date',
    'Invoice Number',
    'Order Number',
    'Product Name',
    'Product SKU/HSN Code',
    'Quantity',
    'Rate',
    'Value',
    'Tax',
    'Taxable Value',
    'SGST %',
    'CGST %',
    'IGST %',
    'SGST Amount',
    'CGST Amount',
    'IGST Amount',
    'Total GST',
    'Net Value',
  ];

  headers.forEach((header, index) => {
    const cell = tableHeader.getCell(index + 1);
    cell.value = header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0F766E' },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' },
    };
  });
  tableHeader.height = 24;

  items.forEach((item, index) => {
    const row = sheet.getRow(rowIndex++);
    row.getCell(1).value = index + 1;
    row.getCell(2).value = excelDate(item.date);
    row.getCell(3).value = item.invoice_number || '—';
    row.getCell(4).value = item.order_number || '';
    row.getCell(5).value = item.product_name || '';
    row.getCell(6).value = item.sku_hsn || '—';
    row.getCell(7).value = Number(item.quantity) || 0;
    row.getCell(8).value = Number(item.rate) || 0;
    row.getCell(9).value = Number(item.value) || 0;
    row.getCell(10).value = Number(item.tax_amount ?? item.total_gst) || 0;
    row.getCell(11).value = Number(item.taxable_value) || 0;
    row.getCell(12).value = Number(item.sgst_percent) || 0;
    row.getCell(13).value = Number(item.cgst_percent) || 0;
    row.getCell(14).value = Number(item.igst_percent) || 0;
    row.getCell(15).value = Number(item.sgst_amount) || 0;
    row.getCell(16).value = Number(item.cgst_amount) || 0;
    row.getCell(17).value = Number(item.igst_amount) || 0;
    row.getCell(18).value = Number(item.total_gst) || 0;
    row.getCell(19).value = Number(item.net_value) || 0;

    row.getCell(1).numFmt = '#,##0';
    row.getCell(2).numFmt = 'dd-mm-yyyy';
    row.getCell(7).numFmt = '#,##0';
    row.getCell(8).numFmt = '₹#,##0.00';
    row.getCell(9).numFmt = '₹#,##0.00';
    row.getCell(10).numFmt = '₹#,##0.00';
    row.getCell(11).numFmt = '₹#,##0.00';
    row.getCell(12).numFmt = '0.##';
    row.getCell(13).numFmt = '0.##';
    row.getCell(14).numFmt = '0.##';
    row.getCell(15).numFmt = '₹#,##0.00';
    row.getCell(16).numFmt = '₹#,##0.00';
    row.getCell(17).numFmt = '₹#,##0.00';
    row.getCell(18).numFmt = '₹#,##0.00';
    row.getCell(19).numFmt = '₹#,##0.00';

    for (let col = 1; col <= 19; col += 1) {
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
    { width: 14 },
    { width: 16 },
    { width: 14 },
    { width: 28 },
    { width: 20 },
    { width: 10 },
    { width: 12 },
    { width: 12 },
    { width: 10 },
    { width: 14 },
    { width: 10 },
    { width: 10 },
    { width: 10 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
  ];

  if (items.length > 0) {
    sheet.autoFilter = {
      from: { row: tableHeaderRowNum, column: 1 },
      to: { row: tableHeaderRowNum, column: 19 },
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
  link.download = buildFilename(filter);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
