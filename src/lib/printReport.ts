import type { ExportCompanyInfo } from '@/lib/utils';

// Same hidden-iframe print pipeline used elsewhere in the app (Invoices.tsx,
// SettlementReport.tsx, poOrdersExport.ts) - triggers the browser print dialog without
// printing the live page (filters/buttons and all) like window.print() does.
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

// Prints any Reports.tsx report on a clean, letterhead-style page - same layout family as
// Customer Invoices'/Settlement Report's statement prints (company header, title, meta
// row, bordered table, styled total row, full-page border) instead of the raw on-screen
// filters/buttons view. Reuses the exact headers/rows/totalRow already built for Export
// Excel, so print and Excel always show the same data.
export function printReportWithCompany(
  title: string,
  company: ExportCompanyInfo,
  dateRange: string,
  generatedDate: string,
  filters: string,
  headers: string[],
  dataRows: (string | number)[][],
  totalRow?: (string | number)[],
): void {
  const numCols = headers.length;
  const wide = numCols > 7;

  // Numbers here come straight from .reduce() sums elsewhere, which can carry floating-
  // point noise (e.g. 158552.66999999998). Round to at most 2 decimals with Indian digit
  // grouping - but only pad decimals when the value actually has them, so a whole-number
  // count column (Sessions, Days) still shows "2", not "2.00", matching how the on-screen
  // view displays each column type.
  const numFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
  const cell = (c: string | number | undefined | null) => typeof c === 'number' ? numFmt.format(c) : (c ?? '');
  const rowsHtml = dataRows.map(r => `<tr>${r.map(c => `<td>${cell(c)}</td>`).join('')}</tr>`).join('');
  const totalHtml = totalRow
    ? `<tr class="total-row">${totalRow.map(c => `<td>${cell(c)}</td>`).join('')}</tr>`
    : '';

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; padding: 20mm; color: #111; font-size: 11px; }
  .co { text-align: center; font-weight: 800; font-size: 18px; text-transform: uppercase; }
  .addr { text-align: center; font-size: 11px; color: #333; margin-top: 2px; }
  h2 { text-align: center; font-size: 15px; letter-spacing: 1px; margin: 16px 0 8px; text-transform: uppercase; }
  .meta { display: flex; justify-content: space-between; font-size: 11px; color: #444; margin-bottom: 10px; flex-wrap: wrap; gap: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 10.5px; margin-top: 6px; }
  th, td { border: 1px solid #999; padding: 4px 6px; text-align: center; }
  th { background: #d9eaf7; font-weight: 700; text-transform: uppercase; font-size: 9.5px; border: 1px solid #333; }
  tr:nth-child(even) td { background: #fafafa; }
  .total-row td { font-weight: 700; background: #e2f0d9; border-top: 2px solid #333; }
  .page-frame { border: 1.5px solid #000; padding: 8mm; min-height: 265mm; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
  @media print { body { padding: 0; } @page { size: A4 ${wide ? 'landscape' : 'portrait'}; margin: 10mm; } }
</style></head><body>
  <div class="page-frame">
  <div class="co">${company.company_name}</div>
  ${company.address ? `<div class="addr">${company.address}${company.gstin ? ' &middot; GSTIN: ' + company.gstin : ''}</div>` : ''}
  <h2>${title}</h2>
  <div class="meta">
    <span>${dateRange ? `<b>Date Range:</b> ${dateRange}` : ''}</span>
    ${filters ? `<span><b>Filters:</b> ${filters}</span>` : ''}
    <span><b>Generated:</b> ${generatedDate}</span>
  </div>
  <table>
    <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rowsHtml || `<tr><td colspan="${numCols}" style="text-align:center;padding:16px">No records found.</td></tr>`}</tbody>
    ${totalHtml ? `<tfoot>${totalHtml}</tfoot>` : ''}
  </table>
  </div>
</body></html>`;

  printInIframe(html);
}
