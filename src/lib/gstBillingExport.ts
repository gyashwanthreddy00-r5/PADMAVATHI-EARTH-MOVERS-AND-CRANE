import * as XLSX from 'xlsx-js-style';
import type { InvoiceBillingLine } from '@/types';
import { formatCurrency, formatDate } from '@/lib/utils';
import { round2 } from '@/lib/gstBillingCalc';

export interface GstExportContext {
  companyName: string;
  companyAddress?: string | null;
  companyGstin?: string | null;
  customerName: string;
  customerAddress?: string | null;
  customerGstin?: string | null;
  invoiceNumber?: string | null;
  billDate?: string | null;
  gstLabel: string;
}

const HEADERS = [
  'Sl.No', 'Working Date', 'Ton', 'Vehicle No', 'Rate Type', 'Hours', 'Minutes',
  'Rate', 'First Hour Amount', 'Second Hour Amount', 'Total Amount',
];

function cellText(v: number | null): string {
  return v == null ? '' : formatCurrency(v);
}

// Hourly rows show the First Hour Rate / Second Hour Rate pair (from Rate Master) in a
// single Rate column - display only, does not affect First/Second Hour Amount or Total
// Amount, which keep using the existing calculated values.
function rateCellText(l: InvoiceBillingLine): string {
  if (l.rate_type === 'Daily') return '';
  if (l.first_hour_rate == null || l.second_hour_rate == null) return '';
  return `${formatCurrency(l.first_hour_rate)} / ${formatCurrency(l.second_hour_rate)}`;
}

function rowCells(l: InvoiceBillingLine, idx: number): (string | number)[] {
  const isFullDay = l.rate_type === 'Daily';
  return [
    idx + 1,
    formatDate(l.working_date),
    l.ton ?? '',
    l.vehicle_number,
    isFullDay ? 'Full Day' : 'Hourly',
    isFullDay ? '' : l.hours,
    isFullDay ? '' : l.minutes,
    rateCellText(l),
    isFullDay ? '' : cellText(l.first_hour_amount),
    isFullDay ? '' : cellText(l.second_hour_amount),
    cellText(l.total_amount),
  ];
}

function totals(lines: InvoiceBillingLine[], gstAmount: number) {
  const taxable = round2(lines.reduce((s, l) => s + l.total_amount, 0));
  const grand = round2(taxable + gstAmount);
  return { taxable, grand };
}

/** Opens a print-friendly GST billing statement in a new tab and triggers the print dialog. */
export function printGstBillingData(ctx: GstExportContext, lines: InvoiceBillingLine[], gstAmount: number) {
  const { taxable, grand } = totals(lines, gstAmount);
  const win = window.open('', '_blank');
  if (!win) return;

  const rowsHtml = lines.map((l, idx) => `<tr>${rowCells(l, idx).map(c => `<td>${c}</td>`).join('')}</tr>`).join('');

  win.document.write(`<!doctype html>
<html><head><title>${ctx.invoiceNumber || 'GST Invoice'} - Working Day Billing</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; padding: 24px; color: #111; }
  .co { text-align: center; font-weight: 800; font-size: 18px; text-transform: uppercase; }
  .addr { text-align: center; font-size: 12px; color: #333; margin-top: 2px; }
  .meta { display: flex; flex-wrap: wrap; gap: 16px; justify-content: space-between; margin: 16px 0 10px; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { border: 1px solid #333; padding: 4px 6px; text-align: center; white-space: nowrap; }
  th { background: #f2c94c; font-weight: 700; text-transform: uppercase; }
  tr:nth-child(even) td { background: #fafafa; }
  .totals { margin-top: 10px; width: 320px; margin-left: auto; font-size: 13px; }
  .totals td { border: none; text-align: right; padding: 3px 6px; }
  .totals .grand { font-weight: 800; border-top: 2px solid #333; }
  @media print { body { padding: 0; } }
</style>
</head><body>
  <div class="co">${ctx.companyName}</div>
  ${ctx.companyAddress ? `<div class="addr">${ctx.companyAddress}${ctx.companyGstin ? ' &middot; GSTIN: ' + ctx.companyGstin : ''}</div>` : ''}
  <div class="meta">
    <span><b>Customer:</b> ${ctx.customerName}${ctx.customerGstin ? ' (GSTIN: ' + ctx.customerGstin + ')' : ''}</span>
    ${ctx.invoiceNumber ? `<span><b>Invoice No:</b> ${ctx.invoiceNumber}</span>` : '<span><i>Invoice No: not yet assigned</i></span>'}
    ${ctx.billDate ? `<span><b>Bill Date:</b> ${formatDate(ctx.billDate)}</span>` : ''}
    <span><b>Generated:</b> ${new Date().toLocaleDateString('en-IN')}</span>
  </div>
  <table>
    <thead><tr>${HEADERS.map(h => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <table class="totals">
    <tr><td>Taxable Amount</td><td>${formatCurrency(taxable)}</td></tr>
    <tr><td>${ctx.gstLabel}</td><td>${formatCurrency(gstAmount)}</td></tr>
    <tr class="grand"><td>Grand Total</td><td>${formatCurrency(grand)}</td></tr>
  </table>
</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}

/** Downloads a formatted .xlsx GST billing statement for these working-day lines. */
export function exportGstBillingDataToExcel(ctx: GstExportContext, lines: InvoiceBillingLine[], gstAmount: number) {
  const { taxable, grand } = totals(lines, gstAmount);
  const colCount = HEADERS.length;

  const thin = { style: 'thin', color: { rgb: '333333' } } as const;
  const allBorders = { top: thin, bottom: thin, left: thin, right: thin };
  const headerStyle = { font: { bold: true }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, fill: { fgColor: { rgb: 'F2C94C' } }, border: allBorders };
  const cellStyle = { border: allBorders, alignment: { horizontal: 'center', vertical: 'center' } };
  const titleStyle = { font: { bold: true, sz: 14 }, alignment: { horizontal: 'center' } };
  const metaStyle = { font: { bold: true } };

  const aoa: (string | number)[][] = [];
  aoa.push([ctx.companyName]);
  if (ctx.companyAddress) aoa.push([ctx.companyAddress + (ctx.companyGstin ? `   GSTIN: ${ctx.companyGstin}` : '')]);
  aoa.push([]);
  const metaRowCells = [`Customer: ${ctx.customerName}`, '', '', `Invoice No: ${ctx.invoiceNumber || 'Not yet assigned'}`, '', '', `Bill Date: ${ctx.billDate ? formatDate(ctx.billDate) : '-'}`];
  aoa.push(metaRowCells);
  aoa.push([]);
  const headerRowIdx = aoa.length;
  aoa.push(HEADERS);
  lines.forEach((l, idx) => aoa.push(rowCells(l, idx)));
  const totalsStartIdx = aoa.length;
  aoa.push([]);
  aoa.push(['', '', '', '', '', '', '', '', 'Taxable Amount', '', formatCurrency(taxable)]);
  aoa.push(['', '', '', '', '', '', '', '', ctx.gstLabel, '', formatCurrency(gstAmount)]);
  aoa.push(['', '', '', '', '', '', '', '', 'Grand Total', '', formatCurrency(grand)]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: colCount - 1 } },
    ...(ctx.companyAddress ? [{ s: { r: 1, c: 0 }, e: { r: 1, c: colCount - 1 } }] : []),
  ];

  const titleRowRange = ctx.companyAddress ? 2 : 1;
  for (let c = 0; c < colCount; c++) {
    const titleCell = ws[XLSX.utils.encode_cell({ r: 0, c })];
    if (titleCell) titleCell.s = titleStyle;
    if (ctx.companyAddress) {
      const addrCell = ws[XLSX.utils.encode_cell({ r: 1, c })];
      if (addrCell) addrCell.s = { alignment: { horizontal: 'center' } };
    }
  }
  const metaRow = titleRowRange + 1;
  [0, 3, 6].forEach(c => {
    const cell = ws[XLSX.utils.encode_cell({ r: metaRow, c })];
    if (cell) cell.s = metaStyle;
  });

  for (let c = 0; c < colCount; c++) {
    const ref = XLSX.utils.encode_cell({ r: headerRowIdx, c });
    if (ws[ref]) ws[ref].s = headerStyle;
  }
  for (let ri = headerRowIdx + 1; ri < totalsStartIdx; ri++) {
    for (let c = 0; c < colCount; c++) {
      const ref = XLSX.utils.encode_cell({ r: ri, c });
      if (ws[ref]) ws[ref].s = cellStyle;
    }
  }
  for (let ri = totalsStartIdx + 1; ri < aoa.length; ri++) {
    const labelRef = XLSX.utils.encode_cell({ r: ri, c: 8 });
    const valRef = XLSX.utils.encode_cell({ r: ri, c: 10 });
    const isGrand = ri === aoa.length - 1;
    const style = { font: { bold: true, sz: isGrand ? 12 : 11 }, alignment: { horizontal: 'right' } };
    if (ws[labelRef]) ws[labelRef].s = style;
    if (ws[valRef]) ws[valRef].s = style;
  }

  ws['!cols'] = [
    { wch: 6 }, { wch: 12 }, { wch: 6 }, { wch: 14 }, { wch: 9 }, { wch: 7 }, { wch: 7 },
    { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 13 },
  ];
  ws['!printHeader'] = [headerRowIdx];
  ws['!pageSetup'] = { orientation: 'landscape', fitToWidth: 1, fitToHeight: 0 };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'GST Billing');
  const fname = (ctx.invoiceNumber || 'gst-invoice-draft').replace(/[/\\?%*:|"<>]/g, '-');
  XLSX.writeFile(wb, `${fname}-working-data.xlsx`);
}
