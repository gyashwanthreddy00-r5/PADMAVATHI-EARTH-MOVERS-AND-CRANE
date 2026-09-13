import type { PurchaseOrder, PurchaseOrderItem } from '@/types';
import { formatCurrency, formatDate, type ExportCompanyInfo } from '@/lib/utils';
import { exportToExcelProfessional } from '@/lib/excelExport';
import { PO_CGST_PERCENT, PO_SGST_PERCENT } from '@/lib/poOrderManagement';

export interface PoPrintCompany extends ExportCompanyInfo {
  signature_path?: string | null;
  authorized_signatory?: string | null;
}

/** Opens a professional printable Purchase Order in a new tab and triggers print. */
export function printPurchaseOrder(company: PoPrintCompany, po: PurchaseOrder, customerName: string, customerAddress: string | null | undefined, items: PurchaseOrderItem[]) {
  const win = window.open('', '_blank');
  if (!win) return;

  const rowsHtml = items.map(it => `<tr>
    <td>${it.sl_no}</td>
    <td style="text-align:left">${it.vehicle_type}</td>
    <td style="text-align:left">${it.remarks ?? '-'}</td>
    <td>${it.quantity}</td>
    <td style="text-align:right">${formatCurrency(it.unit_rate)}</td>
    <td style="text-align:right">${formatCurrency(it.taxable_amount)}</td>
    <td style="text-align:right">${formatCurrency(it.cgst_amount)}</td>
    <td style="text-align:right">${formatCurrency(it.sgst_amount)}</td>
    <td style="text-align:right;font-weight:600">${formatCurrency(it.total_amount)}</td>
  </tr>`).join('');

  win.document.write(`<!doctype html>
<html><head><title>Purchase Order ${po.po_number}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; padding: 24px; color: #111; }
  .co { text-align: center; font-weight: 800; font-size: 18px; text-transform: uppercase; }
  .addr { text-align: center; font-size: 12px; color: #333; margin-top: 2px; }
  h2.title { text-align: center; text-decoration: underline; margin: 16px 0; font-size: 15px; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; margin: 0 0 14px; font-size: 13px; border: 1px solid #ccc; padding: 10px 14px; border-radius: 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }
  th, td { border: 1px solid #333; padding: 5px 7px; text-align: center; }
  th { background: #f2c94c; font-weight: 700; text-transform: uppercase; font-size: 11px; }
  tr:nth-child(even) td { background: #fafafa; }
  .totals { margin-top: 10px; width: 320px; margin-left: auto; font-size: 13px; }
  .totals td { border: none; text-align: right; padding: 3px 6px; }
  .totals .grand { font-weight: 800; border-top: 2px solid #333; }
  .sign { margin-top: 60px; text-align: right; font-size: 13px; }
  @media print { body { padding: 0; } }
</style>
</head><body>
  <div class="co">${company.company_name}</div>
  ${company.address ? `<div class="addr">${company.address}${company.gstin ? ' &middot; GSTIN: ' + company.gstin : ''}</div>` : ''}
  <h2 class="title">Purchase Order</h2>
  <div class="meta">
    <span><b>Customer:</b> ${customerName}</span>
    <span><b>PO Number:</b> ${po.po_number}</span>
    ${customerAddress ? `<span><b>Address:</b> ${customerAddress}</span>` : '<span></span>'}
    <span><b>PO Date:</b> ${formatDate(po.po_date)}</span>
    <span><b>Valid From:</b> ${po.valid_from ? formatDate(po.valid_from) : '-'}</span>
    <span><b>Valid To:</b> ${po.valid_to ? formatDate(po.valid_to) : '-'}</span>
    <span><b>Status:</b> ${po.status}</span>
    <span><b>Generated:</b> ${new Date().toLocaleDateString('en-IN')}</span>
  </div>
  <table>
    <thead><tr>
      <th>Sl.No</th><th>Ton / Vehicle Type</th><th>Remarks</th><th>Qty</th><th>Rate</th>
      <th>Taxable</th><th>CGST ${PO_CGST_PERCENT}%</th><th>SGST ${PO_SGST_PERCENT}%</th><th>Total</th>
    </tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <table class="totals">
    <tr><td>Total Taxable</td><td>${formatCurrency(po.taxable_total)}</td></tr>
    <tr><td>Total CGST</td><td>${formatCurrency(po.cgst_total)}</td></tr>
    <tr><td>Total SGST</td><td>${formatCurrency(po.sgst_total)}</td></tr>
    <tr class="grand"><td>Grand Total</td><td>${formatCurrency(po.grand_total)}</td></tr>
    <tr><td>Utilized</td><td>${formatCurrency(po.utilized_amount)}</td></tr>
    <tr><td>Remaining</td><td>${formatCurrency(po.remaining_amount)}</td></tr>
  </table>
  <div class="sign">
    <p style="font-weight:bold;margin:0 0 4px">FOR ${company.company_name.toUpperCase()}</p>
    ${company.signature_path ? `<img src="${company.signature_path}" alt="Signature" style="max-height:36px;margin:2px 0"/>` : '<div style="height:36px"></div>'}
    ${company.authorized_signatory ? `<p style="margin:2px 0">${company.authorized_signatory}</p>` : ''}
    <p style="font-weight:bold;margin:4px 0 0">AUTHORISED SIGNATORY</p>
  </div>
</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}

/** Downloads a formatted .xls export of one Purchase Order's items + totals. */
export function exportPurchaseOrderToExcel(company: ExportCompanyInfo, po: PurchaseOrder, customerName: string, items: PurchaseOrderItem[]) {
  const headers = ['Sl.No', 'Ton / Vehicle Type', 'Remarks', 'Quantity', 'Unit Rate', 'Taxable Amount', `CGST ${PO_CGST_PERCENT}%`, `SGST ${PO_SGST_PERCENT}%`, 'Total Amount'];
  const dataRows = items.map(it => [it.sl_no, it.vehicle_type, it.remarks ?? '', it.quantity, it.unit_rate, it.taxable_amount, it.cgst_amount, it.sgst_amount, it.total_amount]);
  const totalRow = ['', 'TOTAL', '', '', '', po.taxable_total, po.cgst_total, po.sgst_total, po.grand_total];
  const dateRange = `Customer: ${customerName} | PO Number: ${po.po_number} | PO Date: ${formatDate(po.po_date)} | Status: ${po.status} | Grand Total: ${formatCurrency(po.grand_total)} | Utilized: ${formatCurrency(po.utilized_amount)} | Remaining: ${formatCurrency(po.remaining_amount)}`;
  exportToExcelProfessional(
    `PO-${po.po_number}`.replace(/[/\\?%*:|"<>]/g, '-'),
    `Purchase Order - ${po.po_number}`,
    company,
    dateRange,
    headers,
    dataRows,
    totalRow,
    [4, 5, 6, 7, 8],
    [],
    [3],
  );
}
