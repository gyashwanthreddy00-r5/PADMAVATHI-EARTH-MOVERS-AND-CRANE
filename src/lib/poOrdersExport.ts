import * as XLSX from 'xlsx-js-style';
import type { PoWorkingRecord } from '@/types';
import { formatCurrency, formatDate } from '@/lib/utils';
import { round2 } from '@/lib/poOrdersCalc';

export interface PoExportContext {
  companyName: string;
  companyAddress?: string | null;
  companyGstin?: string | null;
  customerName: string;
  poNumber: string;
  /** PO-level - applied to every row in the export, not stored per working record. */
  invoiceNumber?: string | null;
  /** PO-level - applied to every row in the export, not stored per working record. */
  billDate?: string | null;
}

const HEADERS = [
  'Sl.No', 'Working Date', 'Ton', 'Vehicle No', 'VL No', 'Rate Type', 'HR', 'MIN',
  'First Hour Rate', 'Second Hour Rate', 'First Hour Amt', 'Second Hr Amt', 'Total Amt',
  'Invoice Number', 'Bill Date', 'GST 18 %', 'TOTAL AMT',
];

function cellText(v: number | null): string {
  return v == null ? '' : formatCurrency(v);
}

function rowCells(r: PoWorkingRecord, idx: number, ctx: PoExportContext): (string | number)[] {
  const isFullDay = r.rate_type === 'Daily';
  return [
    idx + 1,
    formatDate(r.working_date),
    r.ton,
    r.vehicle_number,
    r.vl_no,
    isFullDay ? 'Full Day' : 'Hourly',
    isFullDay ? '' : r.hours,
    isFullDay ? '' : r.minutes,
    isFullDay ? '' : cellText(r.first_hour_rate),
    isFullDay ? '' : cellText(r.second_hour_rate),
    isFullDay ? '' : cellText(r.first_hour_amount),
    isFullDay ? '' : cellText(r.second_hour_amount),
    cellText(r.subtotal),
    ctx.invoiceNumber ?? '',
    ctx.billDate ? formatDate(ctx.billDate) : '',
    cellText(r.gst_amount),
    cellText(r.total_amount),
  ];
}

function totals(records: PoWorkingRecord[]) {
  const subtotal = round2(records.reduce((s, r) => s + (r.subtotal ?? 0), 0));
  const gst = round2(records.reduce((s, r) => s + (r.gst_amount ?? 0), 0));
  const grand = round2(records.reduce((s, r) => s + (r.total_amount ?? 0), 0));
  return { subtotal, gst, grand };
}

// Same hidden-iframe print pipeline used elsewhere in the app (Invoices.tsx,
// SettlementReport.tsx) - triggers the browser print dialog without opening a new tab.
function printInIframe(html: string) {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = 'none';
  iframe.style.visibility = 'hidden';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    if (iframe.parentNode) document.body.removeChild(iframe);
    return;
  }

  doc.open();
  doc.write(html);
  doc.close();

  iframe.onload = () => {
    setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch { /* ignore */ }
      setTimeout(() => {
        if (iframe.parentNode) document.body.removeChild(iframe);
      }, 1000);
    }, 350);
  };
}

/** Prints a print-friendly Excel-style billing statement on the current page (no new tab). */
export function printPoWorkingData(ctx: PoExportContext, records: PoWorkingRecord[]) {
  const { subtotal, gst, grand } = totals(records);
  const rowsHtml = records.map((r, idx) => `<tr>${rowCells(r, idx, ctx).map(c => `<td>${c}</td>`).join('')}</tr>`).join('');

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${ctx.poNumber} - Working Day Billing</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; padding: 24px; color: #111; }
  .co { text-align: center; font-weight: 800; font-size: 18px; text-transform: uppercase; }
  .addr { text-align: center; font-size: 12px; color: #333; margin-top: 2px; }
  .meta { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin: 16px 0 10px; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; table-layout: fixed; }
  th, td { border: 1px solid #333; padding: 4px 6px; text-align: center; overflow-wrap: break-word; }
  th { background: #f2c94c; font-weight: 700; text-transform: uppercase; }
  tr:nth-child(even) td { background: #fafafa; }
  .totals { margin-top: 10px; width: 320px; margin-left: auto; font-size: 13px; }
  .totals td { border: none; text-align: right; padding: 3px 6px; }
  .totals .grand { font-weight: 800; border-top: 2px solid #333; }
  @media print {
    body { padding: 0; }
    table { font-size: 9px; }
    th, td { padding: 3px 4px; }
    @page { size: A4 landscape; margin: 8mm; }
  }
</style>
</head><body>
  <div class="co">${ctx.companyName}</div>
  ${ctx.companyAddress ? `<div class="addr">${ctx.companyAddress}${ctx.companyGstin ? ' &middot; GSTIN: ' + ctx.companyGstin : ''}</div>` : ''}
  <div class="meta">
    <span><b>Customer:</b> ${ctx.customerName}</span>
    <span><b>Log Book Entry No.:</b> ${ctx.poNumber}</span>
    ${ctx.invoiceNumber ? `<span><b>Invoice No:</b> ${ctx.invoiceNumber}</span>` : ''}
    ${ctx.billDate ? `<span><b>Bill Date:</b> ${formatDate(ctx.billDate)}</span>` : ''}
    <span><b>Generated:</b> ${new Date().toLocaleDateString('en-IN')}</span>
  </div>
  <table>
    <thead><tr>${HEADERS.map(h => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <table class="totals">
    <tr><td>Subtotal</td><td>${formatCurrency(subtotal)}</td></tr>
    <tr><td>GST @ 18%</td><td>${formatCurrency(gst)}</td></tr>
    <tr class="grand"><td>Grand Total</td><td>${formatCurrency(grand)}</td></tr>
  </table>
</body></html>`;
  printInIframe(html);
}

/** Downloads a formatted .xlsx billing statement for this PO's working-day records. */
export function exportPoWorkingDataToExcel(ctx: PoExportContext, records: PoWorkingRecord[]) {
  const { subtotal, gst, grand } = totals(records);
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
  const metaCells = [`Customer: ${ctx.customerName}`, '', '', '', '', `Log Book Entry No.: ${ctx.poNumber}`];
  if (ctx.invoiceNumber) { metaCells[8] = `Invoice No: ${ctx.invoiceNumber}`; }
  if (ctx.billDate) { metaCells[11] = `Bill Date: ${formatDate(ctx.billDate)}`; }
  aoa.push(metaCells);
  aoa.push([]);
  const headerRowIdx = aoa.length;
  aoa.push(HEADERS);
  records.forEach((r, idx) => aoa.push(rowCells(r, idx, ctx)));
  const totalsStartIdx = aoa.length;
  aoa.push([]);
  aoa.push(['', '', '', '', '', '', '', '', '', '', '', '', 'Subtotal', '', '', '', formatCurrency(subtotal)]);
  aoa.push(['', '', '', '', '', '', '', '', '', '', '', '', 'GST @ 18%', '', '', '', formatCurrency(gst)]);
  aoa.push(['', '', '', '', '', '', '', '', '', '', '', '', 'Grand Total', '', '', '', formatCurrency(grand)]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  const titleRowRange = ctx.companyAddress ? 2 : 1;
  const metaRow = titleRowRange + 1;
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: colCount - 1 } },
    ...(ctx.companyAddress ? [{ s: { r: 1, c: 0 }, e: { r: 1, c: colCount - 1 } }] : []),
    // Customer name - merged across the same span "Sl.No" through "VL No" would occupy,
    // so the full name always displays instead of being clipped by the narrow first column.
    { s: { r: metaRow, c: 0 }, e: { r: metaRow, c: 4 } },
  ];

  for (let c = 0; c < colCount; c++) {
    const titleCell = ws[XLSX.utils.encode_cell({ r: 0, c })];
    if (titleCell) titleCell.s = titleStyle;
    if (ctx.companyAddress) {
      const addrCell = ws[XLSX.utils.encode_cell({ r: 1, c })];
      if (addrCell) addrCell.s = { alignment: { horizontal: 'center' } };
    }
  }
  [0, 5].forEach(c => {
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
    const labelRef = XLSX.utils.encode_cell({ r: ri, c: 12 });
    const valRef = XLSX.utils.encode_cell({ r: ri, c: 16 });
    const isGrand = ri === aoa.length - 1;
    const style = { font: { bold: true, sz: isGrand ? 12 : 11 }, alignment: { horizontal: 'right' } };
    if (ws[labelRef]) ws[labelRef].s = style;
    if (ws[valRef]) ws[valRef].s = style;
  }

  ws['!cols'] = [
    { wch: 6 }, { wch: 12 }, { wch: 6 }, { wch: 14 }, { wch: 10 }, { wch: 9 }, { wch: 5 }, { wch: 5 },
    { wch: 12 }, { wch: 13 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
    { wch: 16 }, { wch: 12 }, { wch: 10 }, { wch: 12 },
  ];
  ws['!printHeader'] = [headerRowIdx];
  ws['!pageSetup'] = { orientation: 'landscape', fitToWidth: 1, fitToHeight: 0 };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Log Book Working Data');
  XLSX.writeFile(wb, `${ctx.poNumber.replace(/[/\\?%*:|"<>]/g, '-')}-working-data.xlsx`);
}
