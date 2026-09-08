import ExcelJS from 'exceljs';

function applyBold(row, size) {
  row.font = { bold: true, size: size || 11 };
}

export async function downloadGstExcel({ items = [] }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Brassleaf Admin';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('GST Products', {
    views: [{ state: 'frozen', ySplit: 0 }],
  });

  let rowIndex = 1;

  const titleRow = sheet.getRow(rowIndex++);
  titleRow.getCell(1).value = 'GST Product Report';
  applyBold(titleRow, 14);
  titleRow.height = 22;

  rowIndex += 2;

  const detailsHeading = sheet.getRow(rowIndex++);
  detailsHeading.getCell(1).value = 'Product Details';
  applyBold(detailsHeading, 12);

  const tableHeaderRowNum = rowIndex;
  const tableHeader = sheet.getRow(rowIndex++);
  const headers = ['S.No', 'Product Name', 'SKU', 'Size / Variant', 'Price', 'GST', 'Total'];

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

  items.forEach((item, index) => {
    const row = sheet.getRow(rowIndex++);
    row.getCell(1).value = index + 1;
    row.getCell(2).value = item.product_name || '';
    row.getCell(3).value = item.sku || '';
    row.getCell(4).value = item.variant_label || '—';
    row.getCell(5).value = Number(item.price) || 0;
    row.getCell(6).value = Number(item.gst) || 0;
    row.getCell(7).value = Number(item.total) || 0;

    row.getCell(1).numFmt = '#,##0';
    row.getCell(5).numFmt = '₹#,##0.00';
    row.getCell(6).numFmt = '₹#,##0.00';
    row.getCell(7).numFmt = '₹#,##0.00';

    for (let col = 1; col <= 7; col += 1) {
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
    { width: 16 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
  ];

  if (items.length > 0) {
    sheet.autoFilter = {
      from: { row: tableHeaderRowNum, column: 1 },
      to: { row: tableHeaderRowNum, column: 7 },
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
  link.download = 'gst-products.xlsx';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
