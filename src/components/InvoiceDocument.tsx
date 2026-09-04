import type { InvoiceWithRelations, InvoiceItem, CompanySettings, InvoiceSettings } from '@/types';
import { formatNumber, formatDate, amountInWords, buildInvoiceLineDescription } from '@/lib/utils';

export type PrintCopyType = 'master' | 'duplicate' | 'extra' | 'all';

const COPY_LABELS: Record<string, string> = {
  master: 'MASTER COPY',
  duplicate: 'DUPLICATE COPY',
  extra: 'EXTRA COPY',
};

export function invoiceDocHTML(
  inv: InvoiceWithRelations,
  items: InvoiceItem[],
  settings: CompanySettings | null,
  invoiceSettings: InvoiceSettings | null,
  copyType: string = 'master',
): string {
  const compName = settings?.company_name ?? '';
  const compAddr = (settings?.address ?? '').split('\n').filter(Boolean);
  const compGstin = settings?.gstin ?? '';
  const compState = settings?.state ?? '';
  const compStateCode = settings?.state_code ?? '';
  const compEmail = settings?.email ?? '';
  const compPhone = settings?.phone ?? '';
  const compPan = settings?.pan ?? '';
  const compLogo = settings?.logo_url ?? '';
  const compSign = settings?.signature_path ?? '';
  const compAuth = settings?.authorized_signatory ?? '';
  const bankName = settings?.bank_name ?? '';
  const bankAcctName = settings?.bank_account_name ?? '';
  const bankAcctNo = settings?.bank_account_number ?? '';
  const bankBranch = settings?.bank_branch ?? '';
  const bankIfsc = settings?.bank_ifsc ?? '';

  const cName = inv.customer_name ?? inv.customer?.name ?? '-';
  const cAddr = (inv.customer_address ?? inv.customer?.address ?? '').split('\n').filter(Boolean);
  const cGstin = inv.customer_gstin ?? inv.customer?.gstin ?? '-';
  const cState = inv.customer?.state ?? '-';
  const cStateCode = inv.customer?.state_code ?? '-';

  const conName = inv.consignee_name ?? cName;
  const conAddrRaw = inv.consignee_address ?? inv.customer?.address ?? '';
  const conAddr = conAddrRaw.split('\n').filter(Boolean);
  const conGstin = inv.consignee_gstin ?? cGstin;
  const conState = inv.consignee_state ?? cState;
  const conStateCode = inv.consignee_state_code ?? cStateCode;

  const taxable = Number(inv.taxable_amount);
  const cgstAmt = Number(inv.cgst_amount);
  const sgstAmt = Number(inv.sgst_amount);
  const igstAmt = Number(inv.igst_amount);
  const totalTax = cgstAmt + sgstAmt + igstAmt;
  const grand = Number(inv.grand_total);
  const received = Number(inv.amount_received);
  const finalPayable = inv.discount_enabled ? Number(inv.final_payable_amount ?? grand) : grand;
  const balance = Math.max(0, finalPayable - received);
  const isIgst = igstAmt > 0;

  const declaration = inv.declaration ||
    invoiceSettings?.declaration ||
    'We declare that this invoice shows the actual price of the services described and that all particulars are true and correct.';

  const words = inv.amount_in_words ?? amountInWords(inv.discount_enabled ? finalPayable : grand);

  const addrLine = (lines: string[]) => lines.map(l => `<p style="margin:1px 0">${l}</p>`).join('');

  const copyLabel = COPY_LABELS[copyType] ?? '';

  // Build line items dynamically from all items (rental, batha, transportation)
  const itemsRows = items.map((it, idx) => {
    let desc = it.description ?? '';
    let calcDetails = it.calculation_details ?? '';
    if (it.trip && idx === 0) {
      const rebuilt = buildInvoiceLineDescription(it.trip);
      desc = rebuilt.description;
      calcDetails = rebuilt.calculation_details;
    }
    const calcLines = calcDetails ? calcDetails.split('\n').filter(Boolean) : [];
    const calcHtml = calcLines.length > 0
      ? `<div style="margin-top:3px;font-size:9px;color:#333;line-height:1.5">${calcLines.map(l => `<div>${l}</div>`).join('')}</div>`
      : '';
    const amount = Number(it.amount) || 0;
    return `<tr>
      <td style="text-align:center">${idx + 1}</td>
      <td>${desc}${calcHtml}</td>
      <td style="text-align:center">${it.hsn_sac ?? invoiceSettings?.hsn_sac ?? '997319'}</td>
      <td style="text-align:center">${formatNumber(it.quantity ?? 1)}</td>
      <td style="text-align:right">${formatNumber(Number(it.rate) || 0)}</td>
      <td style="text-align:center">${it.unit ?? 'nos'}</td>
      <td style="text-align:right;font-weight:bold">${formatNumber(amount)}</td>
    </tr>`;
  }).join('');

  const metaRow = (label: string, val: string | null | undefined) =>
    val ? `<div style="display:flex;margin:1px 0"><span style="width:140px;font-weight:bold">${label}</span><span>${val}</span></div>` : '';

  const hasBank = bankName || bankAcctName || bankAcctNo || bankIfsc;

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Tax Invoice - ${inv.invoice_number}</title>
<style>
  @page { size: A4 portrait; margin: 10mm; }
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Telugu:wght@400;600;700&display=swap');
  * { box-sizing: border-box; }
  body { font-family: 'Noto Sans Telugu', 'Arial', 'Helvetica', sans-serif; font-size: 11px; color: #000; margin: 0; padding: 0; line-height: 1.4; }
  .inv { width: 100%; max-width: 100%; margin: 0 auto; }
  .hdr-top { display: flex; justify-content: space-between; align-items: flex-start; }
  .hdr-left { flex: 1; }
  .hdr-left h1 { font-size: 16px; margin: 0 0 2px 0; text-transform: uppercase; font-weight: bold; letter-spacing: 0.02em; color: #000; }
  .hdr-left p { margin: 1px 0; font-size: 10px; color: #000; }
  .copy-label { text-align: right; min-width: 130px; }
  .copy-label span { font-size: 11px; font-weight: bold; letter-spacing: 1px; border: 1px solid #000; padding: 3px 10px; display: inline-block; }
  .ti-heading { text-align: center; margin: 6px 0 4px 0; }
  .ti-heading h2 { font-size: 16px; margin: 0; letter-spacing: 2px; font-weight: bold; color: #000; }
  .hdr-bottom { border-bottom: 1px solid #000; padding-bottom: 4px; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 0; margin-top: 4px; border-bottom: 1px solid #000; padding-bottom: 4px; align-items: start; }
  .meta-col { font-size: 10px; font-variant-numeric: tabular-nums; }
  .meta-col:first-child { border-right: 1px solid #ccc; padding-right: 6px; }
  .meta-col:last-child { padding-left: 6px; }
  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 0; margin: 0; border-bottom: 1px solid #000; align-items: stretch; }
  .party { padding: 6px 6px; font-size: 10px; vertical-align: top; }
  .party:first-child { border-right: 1px solid #ccc; }
  .party h3 { font-size: 9px; text-transform: uppercase; margin: 0 0 3px 0; border-bottom: 1px solid #ccc; padding-bottom: 2px; font-weight: bold; color: #000; }
  .party .nm { font-weight: bold; font-size: 11px; margin: 2px 0; color: #000; }
  .party p { margin: 1px 0; color: #000; }
  table.it { width: 100%; border-collapse: collapse; margin: 0; }
  table.it th { background: #f0f0f0; color: #000; padding: 5px 4px; font-size: 9px; text-transform: uppercase; border: 1px solid #999; font-weight: bold; letter-spacing: 0.02em; }
  table.it td { padding: 5px 4px; border: 1px solid #ccc; font-size: 10px; font-variant-numeric: tabular-nums; color: #000; }
  table.it td:nth-child(1) { text-align: center; width: 28px; }
  table.it td:nth-child(2) { line-height: 1.4; }
  table.it td:nth-child(3) { text-align: center; width: 55px; }
  table.it td:nth-child(4) { text-align: center; width: 40px; }
  table.it td:nth-child(5) { text-align: right; width: 60px; }
  table.it td:nth-child(6) { text-align: center; width: 32px; }
  table.it td:nth-child(7) { text-align: right; width: 70px; }
  .tax-area { display: grid; grid-template-columns: 1fr 1fr; gap: 0; margin-top: 0; border-bottom: 1px solid #000; align-items: stretch; }
  .tax-left { padding: 6px 6px; border-right: 1px solid #ccc; }
  .tax-right { padding: 6px 6px; }
  table.tt { width: 100%; border-collapse: collapse; font-size: 9px; }
  table.tt th { background: #f0f0f0; padding: 3px; border: 1px solid #ccc; text-align: center; font-weight: bold; color: #000; }
  table.tt td { padding: 3px; border: 1px solid #ccc; text-align: center; color: #000; }
  table.gt { width: 100%; border-collapse: collapse; }
  table.gt td { padding: 4px 5px; font-size: 11px; border: none; font-variant-numeric: tabular-nums; color: #000; }
  table.gt .lbl { text-align: left; }
  table.gt .val { text-align: right; }
  table.gt .grand { font-weight: bold; font-size: 13px; border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 5px 5px; font-variant-numeric: tabular-nums; color: #000; }
  .amt-words { font-size: 10px; margin: 5px 0; padding: 3px 5px; border: 1px solid #ccc; background: #fafafa; font-weight: bold; color: #000; }
  .bot { display: grid; grid-template-columns: 1fr 1fr; gap: 0; margin-top: 6px; align-items: stretch; }
  .bot-left { padding-right: 6px; }
  .bot-right { padding-left: 6px; border-left: 1px solid #ccc; min-height: 60px; }
  .bot h3 { font-size: 9px; text-transform: uppercase; margin: 0 0 3px 0; font-weight: bold; color: #000; }
  .bot p { margin: 2px 0; font-size: 10px; color: #000; }
  .sign { margin-top: 12px; display: flex; justify-content: space-between; align-items: flex-end; min-height: 70px; }
  .sign-r { text-align: right; }
  .sign-r p { margin: 2px 0; font-size: 10px; color: #000; }
  .footer { text-align: center; margin-top: 6px; font-size: 8px; color: #444; border-top: 1px solid #999; padding-top: 3px; }
  .remarks { font-size: 10px; margin: 3px 0; color: #000; }
  .pay-line { font-size: 11px; margin: 3px 0; font-variant-numeric: tabular-nums; font-weight: bold; color: #000; }
  @media print {
    body { font-size: 11px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .inv { width: 100%; max-width: 100%; }
    table.it th { background: #f0f0f0 !important; color: #000 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    table.tt th { background: #f0f0f0 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .amt-words { background: #fafafa !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .tax-break, .sign, .bot { break-inside: avoid; }
  }
</style></head><body>
<div class="inv">
  <div class="hdr-top">
    <div class="hdr-left">
      ${compLogo ? `<img src="${compLogo}" alt="Logo" style="max-height:45px;max-width:110px;margin-bottom:2px"/>` : ''}
      <h1>${compName}</h1>
      ${addrLine(compAddr)}
      ${compGstin ? `<p><strong>GSTIN/UIN:</strong> ${compGstin}</p>` : ''}
      ${compState ? `<p><strong>State Name:</strong> ${compState}${compStateCode ? `, Code: ${compStateCode}` : ''}</p>` : ''}
      ${compEmail ? `<p><strong>E-Mail:</strong> ${compEmail}</p>` : ''}
      ${compPhone ? `<p><strong>Phone:</strong> ${compPhone}</p>` : ''}
      ${compPan ? `<p><strong>PAN:</strong> ${compPan}</p>` : ''}
    </div>
    <div class="copy-label">
      ${copyLabel ? `<span>${copyLabel}</span>` : ''}
    </div>
  </div>

  <div class="ti-heading">
    <h2>TAX INVOICE</h2>
  </div>

  <div class="hdr-bottom"></div>

  <div class="meta">
    <div class="meta-col">
      ${metaRow('Invoice No.', inv.invoice_number)}
      ${metaRow('Dated', formatDate(inv.invoice_date))}
      ${metaRow('Mode/Terms of Payment', inv.terms_of_payment)}
      ${metaRow('Reference No. & Date', inv.reference_no)}
      ${metaRow("Buyer's Order No.", inv.buyer_order_no)}
      ${metaRow('Dispatch Doc No.', inv.dispatch_doc_no)}
      ${metaRow('Delivery Note Date', inv.delivery_note_date ? formatDate(inv.delivery_note_date) : null)}
    </div>
    <div class="meta-col">
      ${metaRow('Destination', inv.destination)}
      ${metaRow('Motor Vehicle No.', inv.motor_vehicle_numbers)}
      ${metaRow('Vehicle Type', (inv.invoiceVehicles ?? []).map(v => v.vehicle_type).filter(Boolean).join(', ') || null)}
      ${metaRow('Delivery Note', inv.delivery_note)}
      ${metaRow('Financial Year', inv.financial_year)}
    </div>
  </div>

  <div class="parties">
    <div class="party">
      <h3>Consignee (Ship To)</h3>
      <p class="nm">${conName}</p>
      ${addrLine(conAddr)}
      ${conGstin && conGstin !== '-' ? `<p><strong>GSTIN/UIN:</strong> ${conGstin}</p>` : ''}
      ${conState && conState !== '-' ? `<p><strong>State Name:</strong> ${conState}${conStateCode && conStateCode !== '-' ? `, Code: ${conStateCode}` : ''}</p>` : ''}
    </div>
    <div class="party">
      <h3>Buyer (Bill To)</h3>
      <p class="nm">${cName}</p>
      ${addrLine(cAddr)}
      ${cGstin && cGstin !== '-' ? `<p><strong>GSTIN/UIN:</strong> ${cGstin}</p>` : ''}
      ${cState && cState !== '-' ? `<p><strong>State Name:</strong> ${cState}${cStateCode && cStateCode !== '-' ? `, Code: ${cStateCode}` : ''}</p>` : ''}
    </div>
  </div>

  <table class="it">
    <thead>
      <tr>
        <th>Sl No.</th><th>Description of Services</th><th>HSN/SAC</th>
        <th>Quantity</th><th>Rate</th><th>Per</th><th>Amount</th>
      </tr>
    </thead>
    <tbody>${itemsRows}</tbody>
  </table>

  <div class="tax-area tax-break">
    <div class="tax-left">
      <table class="tt">
        <thead>
          <tr>
            <th>HSN/SAC</th><th>Taxable Value</th>
            ${isIgst ? '<th>IGST Rate</th><th>IGST Amt</th>' : '<th>CGST Rate</th><th>CGST Amt</th><th>SGST Rate</th><th>SGST Amt</th>'}
            <th>Total Tax</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${invoiceSettings?.hsn_sac ?? '997319'}</td>
            <td>${formatNumber(taxable)}</td>
            ${isIgst ? `<td>${inv.igst_percent}%</td><td>${formatNumber(igstAmt)}</td>` : `<td>${inv.cgst_percent}%</td><td>${formatNumber(cgstAmt)}</td><td>${inv.sgst_percent}%</td><td>${formatNumber(sgstAmt)}</td>`}
            <td>${formatNumber(totalTax)}</td>
          </tr>
        </tbody>
      </table>
      <div class="amt-words">
        <strong>Amount Chargeable (in words):</strong><br/>INR ${words}
      </div>
      ${inv.remarks ? `<div class="remarks"><strong>Remarks:</strong> ${inv.remarks}</div>` : ''}
    </div>
    <div class="tax-right">
      <table class="gt">
        <tr><td class="lbl">Taxable Amount:</td><td class="val">&#8377;${formatNumber(taxable)}</td></tr>
        ${cgstAmt > 0 ? `<tr><td class="lbl">CGST (${inv.cgst_percent}%):</td><td class="val">&#8377;${formatNumber(cgstAmt)}</td></tr>` : ''}
        ${sgstAmt > 0 ? `<tr><td class="lbl">SGST (${inv.sgst_percent}%):</td><td class="val">&#8377;${formatNumber(sgstAmt)}</td></tr>` : ''}
        ${igstAmt > 0 ? `<tr><td class="lbl">IGST (${inv.igst_percent}%):</td><td class="val">&#8377;${formatNumber(igstAmt)}</td></tr>` : ''}
        <tr class="grand"><td class="lbl"><strong>GRAND TOTAL:</strong></td><td class="val"><strong>&#8377;${formatNumber(grand)}</strong></td></tr>
        ${inv.discount_enabled ? `<tr><td class="lbl" style="color:#dc2626">Discount (${inv.discount_percent}%):</td><td class="val" style="color:#dc2626">-&#8377;${formatNumber(Number(inv.discount_amount) || 0)}</td></tr><tr class="grand" style="color:#1d4ed8"><td class="lbl"><strong>NET PAYABLE:</strong></td><td class="val"><strong>&#8377;${formatNumber(finalPayable)}</strong></td></tr>` : ''}
      </table>
      <div class="pay-line">Received: &#8377;${formatNumber(received)}</div>
      <div class="pay-line">Balance: &#8377;${formatNumber(balance)}</div>
    </div>
  </div>

  <div class="bot">
    <div class="bot-left">
      <h3>Declaration</h3>
      <p>${declaration}</p>
    </div>
    <div class="bot-right">
      ${hasBank ? `
      <h3>Company's Bank Details</h3>
      ${bankAcctName ? `<p><strong>A/c Holder's Name:</strong> ${bankAcctName}</p>` : ''}
      ${bankName ? `<p><strong>Bank Name:</strong> ${bankName}</p>` : ''}
      ${bankAcctNo ? `<p><strong>A/c No.:</strong> ${bankAcctNo}</p>` : ''}
      ${bankBranch || bankIfsc ? `<p><strong>Branch &amp; IFSC:</strong> ${[bankBranch, bankIfsc].filter(Boolean).join(' - ')}</p>` : ''}` : '<p>&nbsp;</p>'}
    </div>
  </div>

  <div class="sign">
    <div></div>
    <div class="sign-r">
      <p>for ${compName}</p>
      ${compSign ? `<img src="${compSign}" alt="Signature" style="max-height:50px;max-width:130px;margin:3px 0"/>` : '<br/><br/><br/>'}
      <p><strong>Authorized Signatory</strong></p>
      ${compAuth ? `<p>${compAuth}</p>` : ''}
    </div>
  </div>

  <div class="footer">This is a Computer Generated Invoice</div>
</div>
</body></html>`;
}
