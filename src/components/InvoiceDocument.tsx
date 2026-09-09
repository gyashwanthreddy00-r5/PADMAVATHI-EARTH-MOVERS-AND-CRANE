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
  // Optional — lets older invoice lines with no captured rate snapshot still show a real
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
  // per-invoice overrides (see Invoices.tsx "Edit Invoice Details") — inv.reference_no /
  // inv.reference_date win once a user has set them.
  const refNo = inv.reference_no || inv.invoice_number;
  const refDate = inv.reference_date || inv.invoice_date;
  const referenceNoAndDate = refNo ? `${refNo} dt. ${formatDate(refDate)}` : null;
  // Mode/Terms of Payment: the per-invoice override (inv.terms_of_payment) wins once set;
  // otherwise falls back to the company-wide Invoice Settings default so it stays in sync
  // automatically when that setting changes.
  const modeTermsOfPayment = inv.terms_of_payment || invoiceSettings?.default_payment_terms || null;
  // Terms of Delivery: editable day-count per invoice (defaults to 28 — no separate
  // "configurable setting" for this exists), due date always computed from it, never a
  // hardcoded calendar date.
  const termDays = inv.terms_of_delivery_days || 28;
  const deliveryDueDate = inv.invoice_date ? formatDate(addDays(inv.invoice_date, termDays)) : null;
  const termsOfDelivery = deliveryDueDate ? `${termDays} Days (Due by ${deliveryDueDate})` : `${termDays} Days`;

  const addrLine = (lines: string[]) => lines.map(l => `<p style="margin:1px 0">${l}</p>`).join('');

  // Description of Services shows only the service description — never the
  // hour-by-hour rate/amount breakdown (that stays available on row.calcLines
  // for callers that want it, e.g. the app's own invoice edit view).
  const itemsRows = itemRows.map(row => isProforma ? `<tr>
      <td style="text-align:center">${row.slNo}</td>
      <td>${row.description}</td>
      <td style="text-align:center">${row.hsnSac}</td>
      <td style="text-align:center">${row.quantityLabel}</td>
      <td style="text-align:center">${row.unit}</td>
      <td style="text-align:right;font-weight:bold">${formatNumber(row.amount)}</td>
    </tr>` : `<tr>
      <td style="text-align:center">${row.slNo}</td>
      <td>${row.description}</td>
      <td style="text-align:center">${row.hsnSac}</td>
      <td style="text-align:center">${row.quantityLabel}</td>
      <td style="text-align:right">${row.rateLabel}</td>
      <td style="text-align:center">${row.unit}</td>
      <td style="text-align:right;font-weight:bold">${formatNumber(row.amount)}</td>
    </tr>`).join('');

  const totalQty = itemRows.reduce((s, r) => s + (Number(r.quantity) || 0), 0);
  const totalQtyUnits = Array.from(new Set(itemRows.map(r => r.unit).filter(Boolean)));
  const totalQtyLabel = `${formatNumber(Math.round(totalQty * 100) / 100)}${totalQtyUnits.length === 1 ? ' ' + totalQtyUnits[0] : ''}`;

  // Every row occupies the same 4-column grid (label|value|label|value) so column
  // boundaries line up top to bottom — a single-field row spans its value across the
  // remaining 3 columns (colspan) instead of only 1 of 4, which is what let single-field
  // rows collapse to half-width and drift out of alignment with the paired rows above/below.
  const metaRow = (label: string, val: string | null | undefined) =>
    `<tr><td class="dg-lbl">${label}</td><td class="dg-val" colspan="3">${val ?? ''}</td></tr>`;
  const metaRowPair = (label1: string, val1: string | null | undefined, label2: string, val2: string | null | undefined) =>
    `<tr><td class="dg-lbl">${label1}</td><td class="dg-val">${val1 ?? ''}</td><td class="dg-lbl">${label2}</td><td class="dg-val">${val2 ?? ''}</td></tr>`;

  // Proforma keeps a plain, tax-inclusive Total row — no CGST/SGST rows, no
  // HSN-wise GST summary table. Tax Invoice reproduces TallyPrime's own layout:
  // CGST/SGST appended as plain rows directly under the item rows (inside the
  // same bordered item table, not a separate boxed "card"), then a Total row,
  // then — further down, after Amount Chargeable in words — a second, genuinely
  // separate HSN-wise GST summary table (see gstSummaryHtml below), exactly as
  // a physical TallyPrime GST Tax Invoice prints it.
  const totalRowHtml = isProforma ? `
    <tr>
      <td colspan="3" style="text-align:right;font-weight:bold;border-top:2px solid #000">Total</td>
      <td style="border-top:2px solid #000"></td>
      <td style="border-top:2px solid #000"></td>
      <td style="text-align:right;font-weight:bold;border-top:2px solid #000">${formatNumber(finalPayable)}</td>
    </tr>` : `
    <tr>
      <td colspan="6"></td>
      <td style="text-align:right">${formatNumber(taxable)}</td>
    </tr>
    ${isIgst
      ? (igstAmt > 0 ? `<tr><td colspan="4" style="text-align:right;font-style:italic">IGST ${inv.igst_percent}%</td><td style="text-align:right">${inv.igst_percent}</td><td style="text-align:center">%</td><td style="text-align:right">${formatNumber(igstAmt)}</td></tr>` : '')
      : `${cgstAmt > 0 ? `<tr><td colspan="4" style="text-align:right;font-style:italic">CGST ${inv.cgst_percent}%</td><td style="text-align:right">${inv.cgst_percent}</td><td style="text-align:center">%</td><td style="text-align:right">${formatNumber(cgstAmt)}</td></tr>` : ''}
         ${sgstAmt > 0 ? `<tr><td colspan="4" style="text-align:right;font-style:italic">SGST ${inv.sgst_percent}%</td><td style="text-align:right">${inv.sgst_percent}</td><td style="text-align:center">%</td><td style="text-align:right">${formatNumber(sgstAmt)}</td></tr>` : ''}`
    }
    ${inv.discount_enabled ? `<tr><td colspan="6" style="text-align:right;color:#dc2626">Discount (${inv.discount_percent}%)</td><td style="text-align:right;color:#dc2626">-${formatNumber(Number(inv.discount_amount) || 0)}</td></tr>` : ''}
    <tr>
      <td colspan="3" style="font-weight:bold;border-top:2px solid #000;border-bottom:2px solid #000">Total</td>
      <td style="text-align:center;font-weight:bold;border-top:2px solid #000;border-bottom:2px solid #000">${totalQtyLabel}</td>
      <td style="border-top:2px solid #000;border-bottom:2px solid #000"></td>
      <td style="border-top:2px solid #000;border-bottom:2px solid #000"></td>
      <td style="text-align:right;font-weight:bold;font-size:12px;border-top:2px solid #000;border-bottom:2px solid #000">&#8377;${formatNumber(finalPayable)}</td>
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

  // HSN-wise GST summary — a second, separate bordered table (not merged into
  // the item table), exactly as TallyPrime prints it below Amount Chargeable.
  const gstSummaryHtml = (!isProforma && totalTax > 0) ? `
  <table class="gst-sum">
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
  <p style="margin:3px 0"><strong>Tax Amount (in words):</strong> INR ${amountInWords(totalTax)}</p>` : '';

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
  table.hdr { width: 100%; border-collapse: collapse; border: 1px solid #000; }
  table.hdr > tr > td { vertical-align: top; padding: 0; }
  .hdr-left { width: 55%; border-right: 1px solid #000; }
  .hdr-left > div { padding: 4px 6px; border-bottom: 1px solid #000; }
  .hdr-left > div:last-child { border-bottom: none; }
  .hdr-left h3 { font-size: 10px; margin: 0 0 2px 0; font-weight: bold; color: #000; }
  .hdr-left .nm { font-weight: bold; font-size: 11px; margin: 1px 0; color: #000; }
  /* table-layout: fixed + the colgroup on this table (see markup) is what keeps every
     row's label/value column boundaries lined up top to bottom, regardless of how long
     an individual value is (e.g. a multi-vehicle Motor Vehicle No. list) — long content
     wraps inside its own cell instead of growing that row's columns wider than the rest. */
  table.dg { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.dg td.dg-lbl { font-size: 9px; color: #000; padding: 3px 4px; border-bottom: 1px solid #999; border-right: 1px solid #999; vertical-align: top; word-wrap: break-word; overflow-wrap: break-word; line-height: 1.3; }
  table.dg td.dg-val { font-size: 10px; font-weight: bold; color: #000; padding: 3px 4px; border-bottom: 1px solid #999; vertical-align: top; word-wrap: break-word; overflow-wrap: break-word; word-break: break-word; line-height: 1.3; }
  table.dg tr:last-child td { border-bottom: none; }
  .party { padding: 6px 6px; font-size: 10px; vertical-align: top; }
  .party h3 { font-size: 9px; text-transform: uppercase; margin: 0 0 3px 0; border-bottom: 1px solid #ccc; padding-bottom: 2px; font-weight: bold; color: #000; }
  .party .nm { font-weight: bold; font-size: 11px; margin: 2px 0; color: #000; }
  .party p { margin: 1px 0; color: #000; }
  table.it { width: 100%; border-collapse: collapse; margin: 0; table-layout: fixed; border: 1px solid #000; }
  table.it th { background: #f0f0f0 !important; color: #000; padding: 4px 4px; font-size: 9px; border: 1px solid #000; font-weight: bold; text-align: center; }
  /* Only vertical column separators inside the Description of Services area —
     no horizontal line between the service row, the taxable subtotal spacer,
     or CGST/SGST (Tally's open/clean look). Only the header row and the final
     Total row set their own border-top/border-bottom where a horizontal line
     is actually wanted. */
  table.it td { padding: 4px 4px; border-left: 1px solid #999; border-right: 1px solid #999; border-top: none; border-bottom: none; font-size: 10px; font-variant-numeric: tabular-nums; color: #000; word-wrap: break-word; overflow-wrap: break-word; }
  table.it td:nth-child(2) { line-height: 1.4; }
  table.gst-sum { width: 100%; border-collapse: collapse; font-size: 9px; margin-top: 6px; }
  table.gst-sum th, table.gst-sum td { border: 1px solid #999; padding: 3px 4px; text-align: center; color: #000; }
  table.gst-sum th { background: #f0f0f0 !important; font-weight: bold; }
  .bot-left { padding: 6px 6px 0 0; }
  .bot-right { padding: 6px 0 0 6px; border-left: 1px solid #ccc; }
  .bot h3 { font-size: 9px; text-transform: uppercase; margin: 0 0 3px 0; font-weight: bold; color: #000; }
  .bot p { margin: 2px 0; font-size: 10px; color: #000; }
  .sign-r { text-align: right; margin-top: 16px; }
  .sign-r p { margin: 2px 0; font-size: 10px; color: #000; }
  .footer { text-align: center; margin-top: 6px; font-size: 8px; color: #444; border-top: 1px solid #999; padding-top: 3px; }
  @media print {
    body { font-size: 11px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .inv { width: 100%; max-width: 100%; }
    table.it th, table.gst-sum th { background: #f0f0f0 !important; color: #000 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .sign, .bot { break-inside: avoid; }
  }
</style></head><body>
<div class="inv">

  <table class="layout"><tr>
    <td style="width:100%"></td>
    <td class="copy-label" style="width:140px;white-space:nowrap">
      ${copyLabel ? `<span>(${copyLabel})</span>` : ''}
    </td>
  </tr></table>

  <div class="ti-heading">
    <h2>${isProforma ? 'Proforma Invoice' : 'Tax Invoice'}</h2>
  </div>

  <table class="hdr"><tr>
    <td class="hdr-left">
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
    </td>
    <td style="width:45%">
      <table class="dg">
        <colgroup><col style="width:22%"/><col style="width:28%"/><col style="width:22%"/><col style="width:28%"/></colgroup>
        <tbody>
      ${metaRowPair('Invoice No.', inv.invoice_number, 'Dated', formatDate(inv.invoice_date))}
      ${metaRowPair('Delivery Note', inv.delivery_note, 'Mode/Terms of Payment', modeTermsOfPayment)}
      ${metaRow('Reference No. &amp; Date', referenceNoAndDate)}
      ${metaRowPair("Buyer's Order No.", inv.buyer_order_no, 'Dated', inv.buyer_order_date ? formatDate(inv.buyer_order_date) : null)}
      ${metaRowPair('Dispatch Doc No.', inv.dispatch_doc_no, 'Delivery Note Date', inv.delivery_note_date ? formatDate(inv.delivery_note_date) : null)}
      ${metaRow('Dispatched through', inv.dispatched_through)}
      ${metaRow('Destination', inv.destination)}
      ${metaRow('Bill of Lading/LR-RR No.', inv.bill_of_lading_no)}
      ${metaRow('Motor Vehicle No.', inv.motor_vehicle_numbers || vehicleNumbersJoined)}
      ${metaRow('Terms of Delivery', termsOfDelivery)}
        </tbody>
      </table>
    </td>
  </tr></table>

  <table class="it">
    <colgroup>
      ${isProforma
        ? '<col style="width:4%"/><col style="width:44%"/><col style="width:10%"/><col style="width:14%"/><col style="width:8%"/><col style="width:20%"/>'
        : '<col style="width:4%"/><col style="width:31%"/><col style="width:9%"/><col style="width:15%"/><col style="width:15%"/><col style="width:6%"/><col style="width:20%"/>'}
    </colgroup>
    <thead>
      <tr>
        <th>Sl No.</th><th>Description of Services</th><th>HSN/SAC</th>
        <th>Quantity</th>${isProforma ? '' : '<th>Rate</th>'}<th>per</th><th>Amount</th>
      </tr>
    </thead>
    <tbody>${itemsRows}${totalRowHtml}</tbody>
  </table>

  ${amountWordsBlockHtml}
  ${gstSummaryHtml}

  <table class="layout bot" style="margin-top:6px"><tr>
    <td class="bot-left" style="width:55%">
      <p><strong>Remarks:</strong></p>
      <p>${inv.remarks ?? ''}</p>
      <h3 style="margin-top:8px">Declaration</h3>
      <p>${declaration}</p>
    </td>
    <td class="bot-right" style="width:45%">
      ${hasBank ? `
      <h3>Company's Bank Details</h3>
      ${bankAcctName ? `<p>A/c Holder's Name: ${bankAcctName}</p>` : ''}
      ${bankName ? `<p>Bank Name: ${bankName}</p>` : ''}
      ${bankAcctNo ? `<p>A/c No.: ${bankAcctNo}</p>` : ''}
      ${bankBranch || bankIfsc ? `<p>Branch &amp; IFS Code: ${[bankBranch, bankIfsc].filter(Boolean).join(' - ')}</p>` : ''}` : ''}
      <div class="sign-r">
        <p>for ${compName}</p>
        ${compSign ? `<img src="${compSign}" alt="Signature" style="max-height:45px;max-width:120px;margin:3px 0"/>` : '<br/><br/><br/>'}
        <p><strong>Authorised Signatory</strong></p>
        ${compAuth ? `<p>${compAuth}</p>` : ''}
      </div>
    </td>
  </tr></table>

  ${!isProforma ? `<p style="text-align:center;margin-top:4px">Received: &#8377;${formatNumber(received)} &nbsp;|&nbsp; Balance: &#8377;${formatNumber(balance)}</p>` : ''}
  <div class="footer">This is a Computer Generated Invoice</div>
</div>
</body></html>`;
}
