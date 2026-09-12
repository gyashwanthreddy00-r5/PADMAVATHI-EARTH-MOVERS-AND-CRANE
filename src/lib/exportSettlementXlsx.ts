import ExcelJS from 'exceljs';
import type { ExportCompanyInfo } from '@/lib/utils';

// Real .xlsx export for Settlement Report - built to match a reference file the user
// supplied (Settlement_Report_Redesigned.xlsx): a letterhead-style company header,
// report title, a genuine Excel Table (autofilter + banded rows, not just styled
// cells) over the data, conditional Paid/Pending coloring, and a totals row.
// Scoped to this page only - every other page's "Export Excel" stays plain CSV.

export interface SettlementReportRow {
  invoice_number: string;
  invoice_date: string;
  reference_no: string;
  customer_name: string;
  vehicle_numbers: string;
  sessions: number;
  grand_total: number;
  amount_received: number;
  balance: number;
  status: string;
  overdue: string;
  payment_count: number;
  last_payment_date: string;
}

const CURRENCY_FMT = '#,##0.00';
const HEADER_FILL = 'FFD9EAF7';
const TOTAL_FILL = 'FFE2F0D9';
const PAID_FILL = 'FFC6EFCE';
const PENDING_FILL = 'FFFFC7CE';
const THIN = { style: 'thin' as const };
const HAIR = { style: 'hair' as const };
const MEDIUM = { style: 'medium' as const };

export function buildSettlementReportWorkbook(
  company: ExportCompanyInfo,
  headers: string[],
  rows: SettlementReportRow[],
  dateRangeLabel: string,
): ExcelJS.Workbook {
  const numCols = headers.length;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Settlement Report', {
    views: [{ showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    headerFooter: { oddFooter: '&CSettlement Report&RPage &P of &N' },
  });

  ws.columns = [20, 15, 16, 25, 30, 10, 15, 16, 15, 13, 12, 11, 16].map(width => ({ width }));

  const addMergedRow = (text: string, opts: { size?: number; bold?: boolean; align?: 'left' | 'center' | 'right' }) => {
    const row = ws.addRow([text]);
    ws.mergeCells(row.number, 1, row.number, numCols);
    row.font = { bold: opts.bold ?? false, size: opts.size ?? 11 };
    row.alignment = { horizontal: opts.align ?? 'center', vertical: 'middle' };
    return row;
  };

  addMergedRow(company.company_name, { size: 18, bold: true }).height = 24;
  if (company.address) addMergedRow(company.address, { size: 11, bold: true });
  const contactParts = [
    company.phone ? `Phone: ${company.phone}` : null,
    company.email ? `Email: ${company.email}` : null,
    company.gstin ? `GSTIN: ${company.gstin}` : null,
  ].filter(Boolean);
  if (contactParts.length > 0) addMergedRow(contactParts.join('  |  '), { size: 10 });
  ws.addRow([]);
  addMergedRow('SETTLEMENT REPORT', { size: 15, bold: true }).height = 20;

  const metaRow = ws.addRow([`Date Range: ${dateRangeLabel}`, ...Array(numCols - 1).fill(''), '']);
  ws.mergeCells(metaRow.number, 1, metaRow.number, Math.ceil(numCols / 2));
  metaRow.getCell(1).font = { bold: true };
  metaRow.getCell(1).alignment = { horizontal: 'left' };
  const genCell = metaRow.getCell(Math.ceil(numCols / 2) + 1);
  genCell.value = `Generated: ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  genCell.font = { bold: true };
  genCell.alignment = { horizontal: 'right' };
  ws.mergeCells(metaRow.number, Math.ceil(numCols / 2) + 1, metaRow.number, numCols);
  ws.addRow([]);
  ws.addRow([]);

  const tableStartRow = ws.rowCount + 1;
  ws.addTable({
    name: 'SettlementRecords',
    ref: `A${tableStartRow}`,
    headerRow: true,
    totalsRow: false,
    style: { theme: 'TableStyleMedium2', showRowStripes: true },
    columns: headers.map((h, idx) => ({
      name: h,
      filterButton: true,
      style: {
        numFmt: idx >= 6 && idx <= 8 ? CURRENCY_FMT : idx === 11 ? '0' : undefined,
        alignment: { vertical: 'middle', wrapText: true },
        border: { left: THIN, right: THIN, bottom: HAIR },
      },
    })),
    rows: rows.map(r => [
      r.invoice_number, r.invoice_date, r.reference_no, r.customer_name, r.vehicle_numbers,
      r.sessions, r.grand_total, r.amount_received, r.balance, r.status, r.overdue,
      r.payment_count, r.last_payment_date,
    ]),
  });

  const headerRow = ws.getRow(tableStartRow);
  headerRow.height = 32;
  headerRow.eachCell({ includeEmpty: true }, cell => {
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.border = { top: MEDIUM, bottom: MEDIUM, left: MEDIUM, right: MEDIUM };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });

  const dataStartRow = tableStartRow + 1;
  const dataEndRow = tableStartRow + rows.length;
  if (rows.length > 0) {
    ws.addConditionalFormatting({
      ref: `J${dataStartRow}:J${dataEndRow}`,
      rules: [
        { type: 'expression', formulae: [`J${dataStartRow}="Paid"`], priority: 1, style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: PAID_FILL } } } },
        { type: 'expression', formulae: [`J${dataStartRow}="Pending"`], priority: 2, style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: PENDING_FILL } } } },
      ],
    });
  }

  const totalRowNum = dataEndRow + 1;
  const totals = [
    'TOTAL', '', '', '', '', '',
    rows.reduce((s, r) => s + r.grand_total, 0),
    rows.reduce((s, r) => s + r.amount_received, 0),
    rows.reduce((s, r) => s + r.balance, 0),
    '', '',
    rows.reduce((s, r) => s + r.payment_count, 0),
    '',
  ];
  const totalRow = ws.getRow(totalRowNum);
  totals.forEach((v, idx) => { totalRow.getCell(idx + 1).value = v as string | number; });
  ws.mergeCells(totalRowNum, 1, totalRowNum, 6);
  totalRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_FILL } };
    cell.border = { top: MEDIUM, bottom: MEDIUM };
    if (colNumber >= 7 && colNumber <= 9) cell.numFmt = CURRENCY_FMT;
    if (colNumber === 12) cell.numFmt = '0';
  });

  ws.addRow([]);
  const noteRow = ws.addRow(['Note: Balance and Status are automatically calculated from Grand Total and Total Received.']);
  ws.mergeCells(noteRow.number, 1, noteRow.number, numCols);
  noteRow.font = { italic: true, size: 9 };
  noteRow.alignment = { horizontal: 'left' };

  return wb;
}

export async function exportSettlementReportXlsx(
  filename: string,
  company: ExportCompanyInfo,
  headers: string[],
  rows: SettlementReportRow[],
  dateRangeLabel: string,
): Promise<void> {
  const wb = buildSettlementReportWorkbook(company, headers, rows, dateRangeLabel);
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
