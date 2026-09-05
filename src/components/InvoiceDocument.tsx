import type { InvoiceWithRelations, InvoiceItem, CompanySettings, InvoiceSettings, InvoiceVehicle } from '@/types';
import { formatNumber, formatDate, amountInWords, buildInvoiceLineDescription } from '@/lib/utils';
import { calcSessionAmount } from '@/lib/rentalCalc';
import { calculateDiscount } from '@/lib/discountCalc';

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

  let taxable = Number(inv.taxable_amount);
  let cgstAmt = Number(inv.cgst_amount);
  let sgstAmt = Number(inv.sgst_amount);
  let igstAmt = Number(inv.igst_amount);
  let totalTax = cgstAmt + sgstAmt + igstAmt;
  let grand = Number(inv.grand_total);
  const received = Number(inv.amount_received);
  let finalPayable = inv.discount_enabled ? Number(inv.final_payable_amount ?? grand) : grand;
  let balance = Math.max(0, finalPayable - received);
  const isIgst = igstAmt > 0;

  const declaration = inv.declaration ||
    invoiceSettings?.declaration ||
    'We declare that this invoice shows the actual price of the services described and that all particulars are true and correct.';

  let words = inv.amount_in_words ?? amountInWords(inv.discount_enabled ? finalPayable : grand);

  const addrLine = (lines: string[]) => lines.map(l => `<p style="margin:1px 0">${l}</p>`).join('');

  const copyLabel = COPY_LABELS[copyType] ?? '';

  // Build line items dynamically from all items (rental, batha, transportation)
  // Match rental items to invoiceVehicles to compute correct quantity for Daily rate type
  const invVehicles = inv.invoiceVehicles ?? [];
  let vehicleIdx = 0;
  let rentalDelta = 0;
  const itemsRows = items.map((it, idx) => {
    const descUpper = (it.description ?? '').toUpperCase();
    const isBatha = descUpper.includes('BATHA');
    const isTransport = descUpper.includes('TRANSPORT');
    const isRental = !isBatha && !isTransport;

    let desc = it.description ?? '';
    let calcDetails = it.calculation_details ?? '';
    let quantity = Number(it.quantity) || 1;
    let rate = Number(it.rate) || 0;
    let unit = it.unit ?? 'nos';
    let amount = Number(it.amount) || 0;

    if (isRental) {
      const iv = invVehicles[vehicleIdx];
      vehicleIdx++;
      if (iv) {
        const rateType = iv.rate_type ?? '';
        const dailyRate = Number(iv.daily_rate_snapshot) || 0;
        const rentalAmount = Number(iv.rental_amount) || 0;
        const sessionCount = (iv.sessions ?? []).length;

        // Derive work date from the first session's in_time, else fall back to trip/invoice date
        const sessions = (iv.sessions ?? []);
        const firstSessionDate = sessions.length > 0 && sessions[0].in_time
          ? sessions[0].in_time
          : (it.trip?.trip_date ?? inv.trip_date ?? inv.invoice_date);

        const tr = {
          rate_type: rateType as 'Hourly' | 'Daily' | 'Weekly' | 'Monthly',
          total_hours: Number(iv.total_hours) || 0,
          rental_amount: rentalAmount,
          trip_date: it.trip?.trip_date ?? inv.trip_date ?? inv.invoice_date ?? '',
          work_date: firstSessionDate,
          place_of_work: iv.place_of_work ?? '',
          capacity_tons: iv.capacity_tons,
          first_hour_rate: iv.first_hour_rate,
          second_hour_rate: iv.second_hour_rate,
          weekly_rate_snapshot: iv.weekly_rate_snapshot,
          daily_rate_snapshot: iv.daily_rate_snapshot,
          monthly_rate_snapshot: iv.monthly_rate_snapshot,
          vehicle: { registration_number: iv.vehicle_number, type: iv.vehicle_type, capacity: iv.capacity },
        };
        const rebuilt = buildInvoiceLineDescription(tr);
        desc = rebuilt.description;
        calcDetails = rebuilt.calculation_details;

        if (rateType === 'Daily') {
          if (sessionCount > 0) {
            quantity = sessionCount;
          } else if (dailyRate > 0) {
            quantity = Math.round((rentalAmount / dailyRate) * 100) / 100;
          }
          rate = dailyRate;
          unit = 'day';
        }

        // For Hourly rate: the stored rental_amount is the base rental, and the
        // session hourly calculation is additional. Final amount = base + hourly.
        if (rateType === 'Hourly') {
          const r1 = Number(iv.first_hour_rate) || 0;
          const r2 = Number(iv.second_hour_rate) || 0;
          const dRate = Number(iv.daily_rate_snapshot) || 0;
          const totalMinutes = Math.round(Number(iv.total_hours) * 60);
          const hourlyAmount = calcSessionAmount(totalMinutes, r1, r2, dRate);
          if (hourlyAmount > 0 && rentalAmount > 0 && Math.abs(hourlyAmount - rentalAmount) > 0.01) {
            amount = Math.round((rentalAmount + hourlyAmount) * 100) / 100;
          }
        }
      } else if (it.trip) {
        const rebuilt = buildInvoiceLineDescription(it.trip);
        desc = rebuilt.description;
        calcDetails = rebuilt.calculation_details;
      }
    }

    // Hide Operator Batha line when amount is 0
    if (isBatha && (Number(it.amount) || 0) === 0) return '';

    const calcLines = calcDetails ? calcDetails.split('\n').filter(Boolean).map(l => l.replace(/Rental Amount =/g, 'Full Day Amt =')) : [];
    const calcHtml = calcLines.length > 0
      ? `<div style="margin-top:3px;font-size:9px;color:#333;line-height:1.5">${calcLines.map(l => `<div>${l}</div>`).join('')}</div>`
      : '';
    rentalDelta += amount - (Number(it.amount) || 0);
    return `<tr>
      <td style="text-align:center">${idx + 1}</td>
      <td>${desc}${calcHtml}</td>
      <td style="text-align:center">${it.hsn_sac ?? invoiceSettings?.hsn_sac ?? '997319'}</td>
      <td style="text-align:center">${formatNumber(quantity)}</td>
      <td style="text-align:center">${unit}</td>
      <td style="text-align:right;font-weight:bold">${formatNumber(amount)}</td>
    </tr>`;
  }).join('');

  // Recalculate totals with corrected line amounts
  if (Math.abs(rentalDelta) > 0.01) {
    taxable = Math.round((taxable + rentalDelta) * 100) / 100;
    cgstAmt = Math.round(taxable * Number(inv.cgst_percent) / 100 * 100) / 100;
    sgstAmt = Math.round(taxable * Number(inv.sgst_percent) / 100 * 100) / 100;
    igstAmt = Math.round(taxable * Number(inv.igst_percent) / 100 * 100) / 100;
    totalTax = cgstAmt + sgstAmt + igstAmt;
    grand = Math.round((taxable + totalTax) * 100) / 100;
    if (inv.discount_enabled) {
      const disc = calculateDiscount({ grandTotal: grand, discountEnabled: true, discountPercentage: inv.discount_percent });
      finalPayable = disc.finalPayableAmount;
    } else {
      finalPayable = grand;
    }
    balance = Math.max(0, finalPayable - received);
    words = amountInWords(inv.discount_enabled ? finalPayable : grand);
  }

  const metaRow = (label: string, val: string | null | undefined) =>
    val ? `<tr><td style="font-weight:bold;width:140px;vertical-align:top">${label}</td><td style="vertical-align:top">${val}</td></tr>` : '';

  const hasBank = bankName || bankAcctName || bankAcctNo || bankIfsc;

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Tax Invoice - ${inv.invoice_number}</title>
<style>
  @page { size: A4 portrait; margin: 10mm; }
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Telugu:wght@400;600;700&display=swap');
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: 'Noto Sans Telugu', 'Arial', 'Helvetica', sans-serif; font-size: 11px; color: #000; margin: 0; padding: 0; line-height: 1.4; }
  .inv { width: 100%; max-width: 100%; margin: 0 auto; }
  table.layout { width: 100%; border-collapse: collapse; }
  table.layout td { vertical-align: top; }
  h1 { font-size: 16px; margin: 0 0 2px 0; text-transform: uppercase; font-weight: bold; letter-spacing: 0.02em; color: #000; }
  p { margin: 1px 0; font-size: 10px; color: #000; }
  .copy-label { text-align: right; }
  .copy-label span { font-size: 11px; font-weight: bold; letter-spacing: 1px; border: 1px solid #000; padding: 3px 10px; display: inline-block; }
  .ti-heading { text-align: center; margin: 6px 0 4px 0; }
  .ti-heading h2 { font-size: 16px; margin: 0; letter-spacing: 2px; font-weight: bold; color: #000; }
  .hdr-bottom { border-bottom: 1px solid #000; padding-bottom: 4px; }
  .meta-col { font-size: 10px; font-variant-numeric: tabular-nums; }
  .party { padding: 6px 6px; font-size: 10px; vertical-align: top; }
  .party h3 { font-size: 9px; text-transform: uppercase; margin: 0 0 3px 0; border-bottom: 1px solid #ccc; padding-bottom: 2px; font-weight: bold; color: #000; }
  .party .nm { font-weight: bold; font-size: 11px; margin: 2px 0; color: #000; }
  .party p { margin: 1px 0; color: #000; }
  table.it { width: 100%; border-collapse: collapse; margin: 0; }
  table.it th { background: #f0f0f0 !important; color: #000; padding: 5px 4px; font-size: 9px; text-transform: uppercase; border: 1px solid #999; font-weight: bold; letter-spacing: 0.02em; }
  table.it td { padding: 5px 4px; border: 1px solid #ccc; font-size: 10px; font-variant-numeric: tabular-nums; color: #000; }
  table.it td:nth-child(1) { text-align: center; width: 32px; }
  table.it td:nth-child(2) { line-height: 1.4; }
  table.it td:nth-child(3) { text-align: center; width: 60px; }
  table.it td:nth-child(4) { text-align: center; width: 48px; }
  table.it td:nth-child(5) { text-align: center; width: 40px; }
  table.it td:nth-child(6) { text-align: right; width: 90px; }
  .tax-left { padding: 6px 6px; border-right: 1px solid #ccc; }
  .tax-right { padding: 6px 6px; }
  table.tt { width: 100%; border-collapse: collapse; font-size: 9px; }
  table.tt th { background: #f0f0f0 !important; padding: 3px; border: 1px solid #ccc; text-align: center; font-weight: bold; color: #000; }
  table.tt td { padding: 3px; border: 1px solid #ccc; text-align: center; color: #000; }
  table.gt { width: 100%; border-collapse: collapse; }
  table.gt td { padding: 4px 5px; font-size: 11px; border: none; font-variant-numeric: tabular-nums; color: #000; }
  table.gt .lbl { text-align: left; }
  table.gt .val { text-align: right; }
  table.gt .grand { font-weight: bold; font-size: 13px; border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 5px 5px; font-variant-numeric: tabular-nums; color: #000; }
  .amt-words { font-size: 10px; margin: 5px 0; padding: 3px 5px; border: 1px solid #ccc; background: #fafafa !important; font-weight: bold; color: #000; }
  .bot-left { padding: 0 6px 0 0; }
  .bot-right { padding: 0 0 0 6px; border-left: 1px solid #ccc; min-height: 60px; }
  .bot h3 { font-size: 9px; text-transform: uppercase; margin: 0 0 3px 0; font-weight: bold; color: #000; }
  .bot p { margin: 2px 0; font-size: 10px; color: #000; }
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

  <table class="layout hdr-top"><tr>
    <td style="width:100%">
      ${compLogo ? `<img src="${compLogo}" alt="Logo" style="max-height:45px;max-width:110px;margin-bottom:2px"/>` : ''}
      <h1>${compName}</h1>
      ${addrLine(compAddr)}
      ${compGstin ? `<p><strong>GSTIN/UIN:</strong> ${compGstin}</p>` : ''}
      ${compState ? `<p><strong>State Name:</strong> ${compState}${compStateCode ? `, Code: ${compStateCode}` : ''}</p>` : ''}
      ${compEmail ? `<p><strong>E-Mail:</strong> ${compEmail}</p>` : ''}
      ${compPhone ? `<p><strong>Phone:</strong> ${compPhone}</p>` : ''}
      ${compPan ? `<p><strong>PAN:</strong> ${compPan}</p>` : ''}
    </td>
    <td class="copy-label" style="width:140px;white-space:nowrap">
      ${copyLabel ? `<span>${copyLabel}</span>` : ''}
    </td>
  </tr></table>

  <div class="ti-heading">
    <h2>TAX INVOICE</h2>
  </div>

  <div class="hdr-bottom"></div>

  <table class="layout meta"><tr>
    <td class="meta-col" style="border-right:1px solid #ccc;padding-right:6px;width:50%">
      <table class="layout"><tbody>
      ${metaRow('Invoice No.', inv.invoice_number)}
      ${metaRow('Dated', formatDate(inv.invoice_date))}
      ${metaRow('Mode/Terms of Payment', inv.terms_of_payment)}
      ${metaRow('Reference No. & Date', inv.reference_no)}
      ${metaRow("Buyer's Order No.", inv.buyer_order_no)}
      ${metaRow('Dispatch Doc No.', inv.dispatch_doc_no)}
      ${metaRow('Delivery Note Date', inv.delivery_note_date ? formatDate(inv.delivery_note_date) : null)}
      </tbody></table>
    </td>
    <td class="meta-col" style="padding-left:6px;width:50%">
      <table class="layout"><tbody>
      ${metaRow('Destination', inv.destination)}
      ${metaRow('Motor Vehicle No.', inv.motor_vehicle_numbers)}
      ${metaRow('Vehicle Type', (inv.invoiceVehicles ?? []).map(v => v.vehicle_type).filter(Boolean).join(', ') || null)}
      ${metaRow('Delivery Note', inv.delivery_note)}
      ${metaRow('Financial Year', inv.financial_year)}
      </tbody></table>
    </td>
  </tr></table>
  <div style="border-bottom:1px solid #000"></div>

  <table class="layout parties"><tr>
    <td class="party" style="border-right:1px solid #ccc;width:50%">
      <h3>Consignee (Ship To)</h3>
      <p class="nm">${conName}</p>
      ${addrLine(conAddr)}
      ${conGstin && conGstin !== '-' ? `<p><strong>GSTIN/UIN:</strong> ${conGstin}</p>` : ''}
      ${conState && conState !== '-' ? `<p><strong>State Name:</strong> ${conState}${conStateCode && conStateCode !== '-' ? `, Code: ${conStateCode}` : ''}</p>` : ''}
    </td>
    <td class="party" style="width:50%">
      <h3>Buyer (Bill To)</h3>
      <p class="nm">${cName}</p>
      ${addrLine(cAddr)}
      ${cGstin && cGstin !== '-' ? `<p><strong>GSTIN/UIN:</strong> ${cGstin}</p>` : ''}
      ${cState && cState !== '-' ? `<p><strong>State Name:</strong> ${cState}${cStateCode && cStateCode !== '-' ? `, Code: ${cStateCode}` : ''}</p>` : ''}
    </td>
  </tr></table>
  <div style="border-bottom:1px solid #000"></div>

  <table class="it">
    <thead>
      <tr>
        <th>Sl No.</th><th>Description of Services</th><th>HSN/SAC</th>
        <th>Quantity</th><th>Per</th><th>Amount</th>
      </tr>
    </thead>
    <tbody>${itemsRows}</tbody>
  </table>

  <table class="layout tax-area tax-break"><tr>
    <td class="tax-left" style="width:50%">
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
    </td>
    <td class="tax-right" style="width:50%">
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
    </td>
  </tr></table>
  <div style="border-bottom:1px solid #000"></div>

  <table class="layout bot"><tr>
    <td class="bot-left" style="width:50%">
      <h3>Declaration</h3>
      <p>${declaration}</p>
    </td>
    <td class="bot-right" style="width:50%">
      ${hasBank ? `
      <h3>Company's Bank Details</h3>
      ${bankAcctName ? `<p><strong>A/c Holder's Name:</strong> ${bankAcctName}</p>` : ''}
      ${bankName ? `<p><strong>Bank Name:</strong> ${bankName}</p>` : ''}
      ${bankAcctNo ? `<p><strong>A/c No.:</strong> ${bankAcctNo}</p>` : ''}
      ${bankBranch || bankIfsc ? `<p><strong>Branch &amp; IFSC:</strong> ${[bankBranch, bankIfsc].filter(Boolean).join(' - ')}</p>` : ''}` : '<p>&nbsp;</p>'}
    </td>
  </tr></table>

  <table class="layout sign" style="margin-top:12px;min-height:70px"><tr>
    <td style="width:50%"></td>
    <td class="sign-r" style="width:50%">
      <p>for ${compName}</p>
      ${compSign ? `<img src="${compSign}" alt="Signature" style="max-height:50px;max-width:130px;margin:3px 0"/>` : '<br/><br/><br/>'}
      <p><strong>Authorized Signatory</strong></p>
      ${compAuth ? `<p>${compAuth}</p>` : ''}
    </td>
  </tr></table>

  <div class="footer">This is a Computer Generated Invoice</div>
</div>
</body></html>`;
}
