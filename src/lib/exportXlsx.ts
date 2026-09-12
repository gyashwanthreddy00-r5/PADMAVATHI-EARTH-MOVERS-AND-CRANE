import ExcelJS from 'exceljs';
import type { ExportCompanyInfo } from '@/lib/utils';

// App-wide real-.xlsx export - drop-in replacement for the old exportToExcelWithCompany()
// (which wrote plain CSV, so it could never support merged cells, auto column widths, or
// an actual Excel Table). Same signature as the function it replaces, so every page's
// "Export Excel" button gets a real letterhead-style workbook with an auto-formatted
// Excel Table (banded rows + filter dropdowns) with no per-page changes beyond the call
// site itself.

const HEADER_FILL = 'FFD9EAF7';
const TOTAL_FILL = 'FFE2F0D9';
const THIN = { style: 'thin' as const };
const HAIR = { style: 'hair' as const };
const MEDIUM = { style: 'medium' as const };
const NUMBER_FMT = '#,##0.##';

export function buildXlsxWithCompany(
  title: string,
  company: ExportCompanyInfo,
  dateRange: string,
  generatedDate: string,
  filters: string,
  headers: string[],
  dataRows: (string | number)[][],
  totalRow?: (string | number)[],
): ExcelJS.Workbook {
  const numCols = headers.length;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(title.replace(/[[\]*/\\?:]/g, '').slice(0, 31) || 'Sheet1', {
    views: [{ showGridLines: false }],
    pageSetup: { orientation: numCols > 7 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    headerFooter: { oddFooter: `&C${title}&RPage &P of &N` },
  });

  const addMergedRow = (text: string, opts: { size?: number; bold?: boolean } = {}) => {
    const row = ws.addRow([text]);
    ws.mergeCells(row.number, 1, row.number, numCols);
    row.font = { bold: opts.bold ?? false, size: opts.size ?? 11 };
    row.alignment = { horizontal: 'center', vertical: 'middle' };
    return row;
  };

  addMergedRow(company.company_name, { size: 16, bold: true }).height = 22;
  if (company.address) addMergedRow(company.address, { size: 10 });
  const contactParts = [
    company.phone ? `Phone: ${company.phone}` : null,
    company.email ? `Email: ${company.email}` : null,
    company.gstin ? `GSTIN: ${company.gstin}` : null,
    company.pan ? `PAN: ${company.pan}` : null,
  ].filter(Boolean);
  if (contactParts.length > 0) addMergedRow(contactParts.join('  |  '), { size: 9 });
  ws.addRow([]);
  addMergedRow(title, { size: 13, bold: true }).height = 18;
  if (dateRange) { const r = ws.addRow(['Date Range:', dateRange]); r.getCell(1).font = { bold: true }; }
  if (generatedDate) { const r = ws.addRow(['Generated:', generatedDate]); r.getCell(1).font = { bold: true }; }
  if (filters) { const r = ws.addRow(['Filters:', filters]); r.getCell(1).font = { bold: true }; }
  ws.addRow([]);

  const tableStartRow = ws.rowCount + 1;
  // A real Excel Table needs at least one data row - with none, fall back to a plain
  // styled header row so the sheet still renders sensibly instead of erroring.
  if (dataRows.length > 0) {
    ws.addTable({
      name: 'ExportTable',
      ref: `A${tableStartRow}`,
      headerRow: true,
      totalsRow: false,
      style: { theme: 'TableStyleMedium2', showRowStripes: true },
      columns: headers.map(h => ({
        name: h || ' ',
        filterButton: true,
        style: {
          numFmt: NUMBER_FMT,
          alignment: { vertical: 'middle', wrapText: true },
          border: { left: THIN, right: THIN, bottom: HAIR },
        },
      })),
      rows: dataRows,
    });
  } else {
    ws.addRow(headers);
  }

  const headerRow = ws.getRow(tableStartRow);
  headerRow.height = 26;
  headerRow.eachCell({ includeEmpty: true }, cell => {
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.border = { top: MEDIUM, bottom: MEDIUM, left: MEDIUM, right: MEDIUM };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });

  if (dataRows.length === 0) {
    const emptyRow = ws.addRow(['No records found.']);
    ws.mergeCells(emptyRow.number, 1, emptyRow.number, numCols);
    emptyRow.alignment = { horizontal: 'center' };
    emptyRow.font = { italic: true, color: { argb: 'FF888888' } };
  }

  if (totalRow) {
    const totalRowNum = ws.rowCount + 1;
    const tr = ws.getRow(totalRowNum);
    totalRow.forEach((v, idx) => { tr.getCell(idx + 1).value = v; });
    tr.eachCell({ includeEmpty: true }, cell => {
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_FILL } };
      cell.border = { top: MEDIUM, bottom: MEDIUM };
      if (typeof cell.value === 'number') cell.numFmt = NUMBER_FMT;
    });
  }

  // Auto column width - widest of header/data/total in that column, clamped so one long
  // outlier value can't blow out the whole sheet.
  ws.columns.forEach((col, idx) => {
    let max = String(headers[idx] ?? '').length;
    dataRows.forEach(r => {
      const v = r[idx];
      if (v !== undefined && v !== null) max = Math.max(max, String(v).length);
    });
    if (totalRow && totalRow[idx] !== undefined && totalRow[idx] !== null) {
      max = Math.max(max, String(totalRow[idx]).length);
    }
    col.width = Math.min(Math.max(max + 2, 10), 40);
  });

  return wb;
}

export async function exportToXlsxWithCompany(
  filename: string,
  title: string,
  company: ExportCompanyInfo,
  dateRange: string,
  generatedDate: string,
  filters: string,
  headers: string[],
  dataRows: (string | number)[][],
  totalRow?: (string | number)[],
): Promise<void> {
  const wb = buildXlsxWithCompany(title, company, dateRange, generatedDate, filters, headers, dataRows, totalRow);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.replace(/\.csv$/i, '.xlsx');
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
