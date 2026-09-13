import type { InvoiceWithRelations, InvoiceItem, CompanySettings, InvoiceSettings, RateMaster, Vehicle } from '@/types';
import { formatNumber, formatDate, amountInWords, addDays } from '@/lib/utils';
import { prepareInvoiceData, type PrintCopyType } from '@/lib/invoiceDocData';

export type { PrintCopyType };

export type InvoiceDocType = 'tax' | 'proforma';

export function invoiceDocHTML(
  inv: InvoiceWithRelations,
  items: InvoiceItem[],
  settings: CompanySettings | null,
  invoiceSettings: InvoiceSettings | null,
  copyType: string = 'master',
  docType: InvoiceDocType = 'tax',
  // Optional - lets older invoice lines with no captured rate snapshot still show a real
  // 1st/2nd-hour rate via a live Rate Master lookup instead of a derived (amount ÷ qty)
  // figure. See prepareInvoiceData / liveHourlyRateLabel in invoiceDocData.ts.
  rateMasterRows: RateMaster[] = [],
  vehiclesList: Pick<Vehicle, 'registration_number' | 'type' | 'capacity'>[] = [],
): string {
  const isProforma = docType === 'proforma';
  const d = prepareInvoiceData(inv, items, settings, invoiceSettings, copyType, rateMasterRows, vehiclesList);
  const {
    compName, compAddr, compGstin, compState, compStateCode, compEmail, compPhone, compPan, compLogo, compSign, compAuth,
    bankName, bankAcctName, bankAcctNo, bankBranch, bankIfsc, hasBank,
    cName, cAddr, cGstin, cState, cStateCode,
    conName, conAddr, conGstin, conState, conStateCode,
    taxable, cgstAmt, sgstAmt, igstAmt, totalTax, received, finalPayable, balance, isIgst,
    declaration, words, copyLabel, hsnSacDefault, vehicleNumbersJoined, itemRows,
  } = d;

  // Reference No. & Date default to this invoice's own number/date but are editable
  // per-invoice overrides (see Invoices.tsx "Edit Invoice Details") - inv.reference_no /
  // inv.reference_date win once a user has set them.
  const refNo = inv.reference_no || inv.invoice_number;
  const refDate = inv.reference_date || inv.invoice_date;
  const referenceNoAndDate = refNo ? `${refNo} dt. ${formatDate(refDate)}` : null;
  // Mode/Terms of Payment: the per-invoice override (inv.terms_of_payment) wins once set;
  // otherwise falls back to the company-wide Invoice Settings default so it stays in sync
  // automatically when that setting changes.
  const modeTermsOfPayment = inv.terms_of_payment || invoiceSettings?.default_payment_terms || null;
  // Terms of Delivery: editable day-count per invoice (defaults to 28 - no separate
  // "configurable setting" for this exists), due date always computed from it, never a
  // hardcoded calendar date.
  const termDays = inv.terms_of_delivery_days || 28;
  const deliveryDueDate = inv.invoice_date ? formatDate(addDays(inv.invoice_date, termDays)) : null;
  const termsOfDelivery = deliveryDueDate ? `${termDays} Days (Due by ${deliveryDueDate})` : `${termDays} Days`;

  const addrLine = (lines: string[]) => lines.map(l => `<p style="margin:1px 0">${l}</p>`).join('');

  // Description of Services shows only the service description - never the
  // hour-by-hour rate/amount breakdown (that stays available on row.calcLines
  // for callers that want it, e.g. the app's own invoice edit view).
  const itemsRows = itemRows.map(row => isProforma ? `<tr>
      <td class="nowrap-cell" style="text-align:center">${row.slNo}</td>
      <td>${row.description}</td>
      <td class="nowrap-cell" style="text-align:center">${row.hsnSac}</td>
      <td class="nowrap-cell" style="text-align:center">${row.quantityLabel}</td>
      <td class="nowrap-cell" style="text-align:center">${row.unit}</td>
      <td class="nowrap-cell" style="text-align:right;font-weight:bold">${formatNumber(row.amount)}</td>
    </tr>` : `<tr>
      <td class="nowrap-cell" style="text-align:center">${row.slNo}</td>
      <td>${row.description}</td>
      <td class="nowrap-cell" style="text-align:center">${row.hsnSac}</td>
      <td class="nowrap-cell" style="text-align:center">${row.quantityLabel}</td>
      <td class="nowrap-cell" style="text-align:right">${row.rateLabel}</td>
      <td class="nowrap-cell" style="text-align:center">${row.unit}</td>
      <td class="nowrap-cell" style="text-align:right;font-weight:bold">${formatNumber(row.amount)}</td>
    </tr>`).join('');

  const totalQty = itemRows.reduce((s, r) => s + (Number(r.quantity) || 0), 0);
  const totalQtyUnits = Array.from(new Set(itemRows.map(r => r.unit).filter(Boolean)));
  const totalQtyLabel = `${formatNumber(Math.round(totalQty * 100) / 100)}${totalQtyUnits.length === 1 ? ' ' + totalQtyUnits[0] : ''}`;

  // The item table keeps a fixed, physical-form-sized "box" (TABLE_TARGET_HEIGHT) by
  // filling whatever is left over with a blank spacer row - but only ever a real
  // remainder, never a fixed amount piled on top of however much content already
  // exists. A rough per-row height estimate (description text length -> wrapped line
  // count) decides how much of that budget is already used; only the true leftover
  // becomes the spacer, so a heavier invoice (more lines, more items) naturally uses
  // less spacer and only overflows to a next page once it genuinely needs to.
  const CHARS_PER_DESC_LINE = 60;
  const estimateItemRowPx = (desc: string) => {
    const lines = Math.max(1, Math.ceil((desc?.length || 1) / CHARS_PER_DESC_LINE));
    return 8 + lines * 15;
  };
  const itemRowsEstPx = itemRows.reduce((sum, r) => sum + estimateItemRowPx(r.description), 0);
  const taxRowCount = (!isProforma ? ((isIgst ? (igstAmt > 0 ? 1 : 0) : (cgstAmt > 0 ? 1 : 0) + (sgstAmt > 0 ? 1 : 0)) + (inv.discount_enabled ? 1 : 0)) : 0);
  const TABLE_TARGET_PX = 420;
  const usedTablePx = 30 /* thead */ + itemRowsEstPx + taxRowCount * 22 + 30 /* Total row */;
  const tableSpacerPx = Math.max(0, TABLE_TARGET_PX - usedTablePx);

  // Each metadata field is its own label-above-value cell (matching a physical TallyPrime
  // GST invoice), not label-beside-value - metaRow is a single full-width cell (its row has
  // just one dg-cell, which - since .dg-row is table-layout:fixed - already spans the full
  // row width on its own, no extra sizing needed), metaRowPair is two cells side by side
  // sharing one row (with a divider between them).
  const dgCell = (label: string, val: string | null | undefined) =>
    `<div class="dg-cell"><div class="dg-lbl-text">${label}</div><div class="dg-val-text">${val || '&nbsp;'}</div></div>`;
  const metaRow = (label: string, val: string | null | undefined) =>
    `<div class="dg-row">${dgCell(label, val)}</div>`;
  const metaRowPair = (label1: string, val1: string | null | undefined, label2: string, val2: string | null | undefined) =>
    `<div class="dg-row">${dgCell(label1, val1)}${dgCell(label2, val2)}</div>`;

  // Proforma keeps a plain, tax-inclusive Total row - no CGST/SGST rows, no
  // HSN-wise GST summary table. Tax Invoice reproduces TallyPrime's own layout:
  // CGST/SGST appended as plain rows directly under the item rows (inside the
  // same bordered item table, not a separate boxed "card"), then a Total row,
  // then - further down, after Amount Chargeable in words - a second, genuinely
  // separate HSN-wise GST summary table (see gstSummaryHtml below), exactly as
  // a physical TallyPrime GST Tax Invoice prints it.
  const totalRowHtml = isProforma ? `
    <tr>
      <td colspan="3" style="text-align:right;font-weight:bold;border-top:1px solid #000">Total</td>
      <td style="border-top:1px solid #000"></td>
      <td style="border-top:1px solid #000"></td>
      <td style="text-align:right;font-weight:bold;border-top:1px solid #000">${formatNumber(finalPayable)}</td>
    </tr>` : `
    <tr>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
      <td style="text-align:right;font-weight:bold">${formatNumber(taxable)}</td>
    </tr>
    ${isIgst
      ? (igstAmt > 0 ? `<tr><td></td><td style="text-align:right;font-style:italic">IGST ${inv.igst_percent}%</td><td></td><td></td><td style="text-align:right">${inv.igst_percent}</td><td style="text-align:center">%</td><td style="text-align:right">${formatNumber(igstAmt)}</td></tr>` : '')
      : `${cgstAmt > 0 ? `<tr><td></td><td style="text-align:right;font-style:italic">CGST ${inv.cgst_percent}%</td><td></td><td></td><td style="text-align:right">${inv.cgst_percent}</td><td style="text-align:center">%</td><td style="text-align:right">${formatNumber(cgstAmt)}</td></tr>` : ''}
         ${sgstAmt > 0 ? `<tr><td></td><td style="text-align:right;font-style:italic">SGST ${inv.sgst_percent}%</td><td></td><td></td><td style="text-align:right">${inv.sgst_percent}</td><td style="text-align:center">%</td><td style="text-align:right">${formatNumber(sgstAmt)}</td></tr>` : ''}`
    }
    ${inv.discount_enabled ? `<tr><td colspan="6" style="text-align:right;color:#dc2626">Discount (${inv.discount_percent}%)</td><td style="text-align:right;color:#dc2626">-${formatNumber(Number(inv.discount_amount) || 0)}</td></tr>` : ''}
    ${tableSpacerPx > 0 ? `<tr><td style="height:${tableSpacerPx}px"></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>` : ''}
    <tr>
      <td style="border-top:1px solid #000;border-bottom:1px solid #000"></td>
      <td style="font-weight:bold;border-top:1px solid #000;border-bottom:1px solid #000">Total</td>
      <td style="border-top:1px solid #000;border-bottom:1px solid #000"></td>
      <td style="border-top:1px solid #000;border-bottom:1px solid #000"></td>
      <td style="border-top:1px solid #000;border-bottom:1px solid #000"></td>
      <td style="border-top:1px solid #000;border-bottom:1px solid #000"></td>
      <td style="text-align:right;font-weight:bold;font-size:12px;border-top:1px solid #000;border-bottom:1px solid #000">&#8377;${formatNumber(finalPayable)}</td>
    </tr>`;

  const amountWordsBlockHtml = `
  <table class="layout" style="margin-top:2px"><tr>
    <td style="width:70%;padding:3px 6px 3px 0">
      <p><strong>Amount Chargeable (in words):</strong></p>
      <p style="font-weight:bold">INR ${words}</p>
    </td>
    <td style="width:30%;padding:3px 0;text-align:right;vertical-align:bottom">
      <p style="font-size:9px">E.&amp;O.E</p>
    </td>
  </tr></table>`;

  // HSN-wise GST summary - a second, separate bordered table (not merged into
  // the item table), exactly as TallyPrime prints it below Amount Chargeable.
  const gstSummaryHtml = (!isProforma && totalTax > 0) ? `
  <table class="gst-sum" style="margin-top:4px">
    <thead>
      <tr>
        <th rowspan="2">HSN/SAC</th><th rowspan="2">Taxable<br/>Value</th>
        ${isIgst
          ? '<th colspan="2">IGST</th>'
          : '<th colspan="2">CGST</th><th colspan="2">SGST/UTGST</th>'}
        <th rowspan="2">Total<br/>Tax Amount</th>
      </tr>
      <tr>
        ${isIgst ? '<th>Rate</th><th>Amount</th>' : '<th>Rate</th><th>Amount</th><th>Rate</th><th>Amount</th>'}
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>${hsnSacDefault}</td>
        <td style="text-align:right">${formatNumber(taxable)}</td>
        ${isIgst
          ? `<td>${inv.igst_percent}%</td><td style="text-align:right">${formatNumber(igstAmt)}</td>`
          : `<td>${inv.cgst_percent}%</td><td style="text-align:right">${formatNumber(cgstAmt)}</td><td>${inv.sgst_percent}%</td><td style="text-align:right">${formatNumber(sgstAmt)}</td>`}
        <td style="text-align:right">${formatNumber(totalTax)}</td>
      </tr>
      <tr style="font-weight:bold">
        <td>Total</td>
        <td style="text-align:right">${formatNumber(taxable)}</td>
        ${isIgst
          ? `<td></td><td style="text-align:right">${formatNumber(igstAmt)}</td>`
          : `<td></td><td style="text-align:right">${formatNumber(cgstAmt)}</td><td></td><td style="text-align:right">${formatNumber(sgstAmt)}</td>`}
        <td style="text-align:right">${formatNumber(totalTax)}</td>
      </tr>
    </tbody>
  </table>
  <p style="margin:2px 0"><strong>Tax Amount (in words):</strong> INR ${amountInWords(totalTax)}</p>` : '';

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${isProforma ? 'Proforma Invoice' : 'Tax Invoice'} - ${inv.invoice_number}</title>
<style>
  @page { size: A4 portrait; margin: 10mm; }
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Telugu:wght@400;600;700&display=swap');
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: 'Noto Sans Telugu', 'Arial', 'Helvetica', sans-serif; font-size: 11px; color: #000; margin: 0; padding: 0; line-height: 1.4; }
  .inv { width: 100%; max-width: 100%; margin: 0 auto; }
  table.layout { width: 100%; border-collapse: collapse; }
  table.layout td { vertical-align: top; }
  h1 { font-size: 15px; margin: 0 0 2px 0; text-transform: uppercase; font-weight: bold; letter-spacing: 0.02em; color: #000; }
  p { margin: 1px 0; font-size: 10px; color: #000; }
  .copy-label { text-align: right; }
  .copy-label span { font-size: 10px; font-weight: bold; font-style: italic; }
  .ti-heading { text-align: center; margin: 2px 0 4px 0; }
  .ti-heading h2 { font-size: 15px; margin: 0; font-weight: bold; color: #000; }
  /* CSS table (not flex) so the shorter side (whichever of hdr-left / hdr-right has less
     content) stretches to match the taller one - a table-cell's border always spans its
     full box, and that box is always the matched row height, so hdr-left's right border
     (and hdr-right's own bottom edge) reach the bottom automatically with no separate
     "stretch the last row" trick needed. Kept as CSS tables rather than flex specifically
     so this HTML can be rasterized by html2canvas for the email PDF - html2canvas does
     not reliably support flexbox, but does support CSS tables. */
  .hdr-flex { display: table; table-layout: fixed; width: 100%; border: 1px solid #000; border-spacing: 0; }
  .hdr-left { display: table-cell; width: 53%; border-right: 1px solid #000; vertical-align: top; }
  .hdr-left > div { padding: 4px 6px; border-bottom: 1px solid #000; }
  .hdr-left > div:last-child { border-bottom: none; }
  .hdr-left h3 { font-size: 10px; margin: 0 0 2px 0; font-weight: bold; color: #000; }
  .hdr-left .nm { font-weight: bold; font-size: 11px; margin: 1px 0; color: #000; }
  /* Each metadata row is a table row of one or two label-above-value cells - a physical
     TallyPrime GST invoice stacks the value directly under its own label rather than
     beside it. */
  .hdr-right { display: table-cell; width: 47%; vertical-align: top; }
  .dg-row { display: table; table-layout: fixed; width: 100%; border-spacing: 0; border-bottom: 1px solid #999; }
  .dg-row:last-child { border-bottom: none; }
  .dg-cell { display: table-cell; padding: 3px 4px; }
  .dg-cell + .dg-cell { border-left: 1px solid #999; }
  .dg-lbl-text { font-size: 8px; color: #000; }
  .dg-val-text { font-size: 10px; font-weight: bold; color: #000; margin-top: 1px; word-wrap: break-word; overflow-wrap: break-word; }
  .party { padding: 6px 6px; font-size: 10px; vertical-align: top; }
  .party h3 { font-size: 9px; text-transform: uppercase; margin: 0 0 3px 0; border-bottom: 1px solid #ccc; padding-bottom: 2px; font-weight: bold; color: #000; }
  .party .nm { font-weight: bold; font-size: 11px; margin: 2px 0; color: #000; }
  .party p { margin: 1px 0; color: #000; }
  /* border-collapse: separate + border-spacing: 0 (not collapse) - each cell draws its own
     left/right border independently instead of merging with its neighbor's, which is what
     was leaving hairline gaps in the vertical column dividers at every row boundary. */
  table.it { width: 100%; border-collapse: separate; border-spacing: 0; margin: 0; table-layout: fixed; border: 1px solid #000; }
  table.it th { background: #f0f0f0 !important; color: #000; padding: 4px 4px; font-size: 9px; border: 1px solid #000; font-weight: bold; text-align: center; }
  /* Only vertical column separators inside the Description of Services area -
     no horizontal line between the service row, the taxable subtotal spacer,
     or CGST/SGST (Tally's open/clean look). Only the header row and the final
     Total row set their own border-top/border-bottom where a horizontal line
     is actually wanted. */
  table.it td { padding: 4px 4px; border-left: 1px solid #999; border-right: 1px solid #999; border-top: none; border-bottom: none; font-size: 10px; font-variant-numeric: tabular-nums; color: #000; vertical-align: top; word-wrap: break-word; overflow-wrap: break-word; }
  table.it td:nth-child(2) { line-height: 1.4; }
  /* Unit (Per) and Sl No. must never wrap - a 3-letter unit like NOS/DAY or the row
     number breaking mid-word looks broken even though the column has room once
     white-space is respected; vertical-align: top above keeps Sl No. pinned to the
     top of the row instead of drifting to center when Description wraps to 2+ lines. */
  table.it td.nowrap-cell { white-space: nowrap; }
  table.gst-sum { width: 100%; border-collapse: collapse; font-size: 9px; margin-top: 4px; }
  table.gst-sum th, table.gst-sum td { border: 1px solid #999; padding: 2px 4px; text-align: center; color: #000; }
  table.gst-sum th { background: #f0f0f0 !important; font-weight: bold; }
  .bot-left { padding: 4px 6px 0 0; }
  .bot-right { padding: 4px 0 0 6px; border-left: 1px solid #ccc; }
  .bot h3 { font-size: 9px; text-transform: uppercase; margin: 0 0 2px 0; font-weight: bold; color: #000; }
  .bot p { margin: 1px 0; font-size: 10px; color: #000; }
  .footer { text-align: center; margin-top: 4px; font-size: 8px; color: #444; border-top: 1px solid #999; padding-top: 2px; }
  @media print {
    body { font-size: 11px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .inv { width: 100%; max-width: 100%; }
    table.it th, table.gst-sum th { background: #f0f0f0 !important; color: #000 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .sign, .bot { break-inside: avoid; }
  }
</style></head><body>
<div class="inv">

  <table class="layout"><tr>
    <td style="width:140px"></td>
    <td class="ti-heading" style="width:auto">
      <h2>${isProforma ? 'Proforma Invoice' : 'Tax Invoice'}</h2>
    </td>
    <td class="copy-label" style="width:140px;white-space:nowrap">
      ${copyLabel ? `<span>(${copyLabel})</span>` : ''}
    </td>
  </tr></table>

  <div class="hdr-flex">
    <div class="hdr-left">
      <div>
        ${compLogo ? `<img src="${compLogo}" alt="Logo" style="max-height:40px;max-width:100px;margin-bottom:2px"/>` : ''}
        <h1>${compName}</h1>
        ${addrLine(compAddr)}
        ${compGstin ? `<p>GSTIN/UIN: ${compGstin}</p>` : ''}
        ${compState ? `<p>State Name: ${compState}${compStateCode ? `, Code: ${compStateCode}` : ''}</p>` : ''}
        ${compEmail ? `<p>E-Mail: ${compEmail}</p>` : ''}
        ${compPhone ? `<p>Phone: ${compPhone}</p>` : ''}
        ${compPan ? `<p>PAN: ${compPan}</p>` : ''}
      </div>
      <div>
        <h3>Consignee (Ship to)</h3>
        <p class="nm">${conName}</p>
        ${addrLine(conAddr)}
        ${conGstin && conGstin !== '-' ? `<p>GSTIN/UIN: ${conGstin}</p>` : ''}
        ${conState && conState !== '-' ? `<p>State Name: ${conState}${conStateCode && conStateCode !== '-' ? `, Code: ${conStateCode}` : ''}</p>` : ''}
      </div>
      <div>
        <h3>Buyer (Bill to)</h3>
        <p class="nm">${cName}</p>
        ${addrLine(cAddr)}
        ${cGstin && cGstin !== '-' ? `<p>GSTIN/UIN: ${cGstin}</p>` : ''}
        ${cState && cState !== '-' ? `<p>State Name: ${cState}${cStateCode && cStateCode !== '-' ? `, Code: ${cStateCode}` : ''}</p>` : ''}
      </div>
    </div>
    <div class="hdr-right">
      ${metaRowPair('Invoice No.', inv.invoice_number, 'Dated', formatDate(inv.invoice_date))}
      ${metaRowPair('Delivery Note', inv.delivery_note, 'Mode/Terms of Payment', modeTermsOfPayment)}
      ${metaRowPair('Reference No. &amp; Date', referenceNoAndDate, 'Other References', null)}
      ${metaRowPair("Buyer's Order No.", inv.buyer_order_no, 'Dated', inv.buyer_order_date ? formatDate(inv.buyer_order_date) : null)}
      ${metaRowPair('Dispatch Doc No.', inv.dispatch_doc_no, 'Delivery Note Date', inv.delivery_note_date ? formatDate(inv.delivery_note_date) : null)}
      ${metaRowPair('Dispatched through', inv.dispatched_through, 'Destination', inv.destination || inv.place_of_work)}
      ${metaRowPair('Bill of Lading/LR-RR No.', inv.bill_of_lading_no, 'Motor Vehicle No.', inv.motor_vehicle_numbers || vehicleNumbersJoined)}
      ${metaRow('Terms of Delivery', termsOfDelivery)}
    </div>
  </div>

  <table class="it">
    <colgroup>
      ${isProforma
        ? '<col style="width:4%"/><col style="width:48%"/><col style="width:9%"/><col style="width:11%"/><col style="width:8%"/><col style="width:20%"/>'
        : '<col style="width:3%"/><col style="width:46%"/><col style="width:7%"/><col style="width:11%"/><col style="width:11%"/><col style="width:7%"/><col style="width:15%"/>'}
    </colgroup>
    <thead>
      <tr>
        <th>Sl No.</th><th>Description of Services</th><th>HSN/SAC</th>
        <th>Quantity</th>${isProforma ? '' : '<th>Rate</th>'}<th>PER</th><th>Amount</th>
      </tr>
    </thead>
    <tbody>${itemsRows}${totalRowHtml}</tbody>
  </table>

  ${amountWordsBlockHtml}
  ${gstSummaryHtml}

  <table class="layout bot" style="margin-top:4px"><tr>
    <td class="bot-left" style="width:55%">
      ${inv.remarks ? `<p><strong>Remarks:</strong></p><p>${inv.remarks}</p>` : ''}
      <h3 style="margin-top:5px">Declaration</h3>
      <p>${declaration}</p>
    </td>
    <td class="bot-right" style="width:45%">
      ${hasBank ? `
      <h3>Company's Bank Details</h3>
      ${bankAcctName ? `<p>A/c Holder's Name: ${bankAcctName}</p>` : ''}
      ${bankName ? `<p>Bank Name: ${bankName}</p>` : ''}
      ${bankAcctNo ? `<p>A/c No.: ${bankAcctNo}</p>` : ''}
      ${bankBranch || bankIfsc ? `<p>Branch &amp; IFS Code: ${[bankBranch, bankIfsc].filter(Boolean).join(' - ')}</p>` : ''}` : ''}
      <div class="sign" style="margin-top:16px;text-align:right">
        <p style="font-weight:bold;margin:0 0 4px">FOR ${compName.toUpperCase()}</p>
        ${compSign ? `<img src="${compSign}" alt="Signature" style="max-height:36px;margin:2px 0"/>` : '<div style="height:36px"></div>'}
        ${compAuth ? `<p style="margin:2px 0">${compAuth}</p>` : ''}
        <p style="font-weight:bold;margin:4px 0 0">AUTHORISED SIGNATORY</p>
      </div>
    </td>
  </tr></table>

  <div class="footer">This is a Computer Generated Invoice</div>
</div>
</body></html>`;
}
