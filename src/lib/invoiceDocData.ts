import type { InvoiceWithRelations, InvoiceItem, CompanySettings, InvoiceSettings } from '@/types';
import { amountInWords, buildInvoiceLineDescription } from '@/lib/utils';
import { calcSessionAmount } from '@/lib/rentalCalc';
import { calculateDiscount } from '@/lib/discountCalc';

// Single source of truth for Master/Duplicate/Extra Copy invoice content and
// figures. Both the print template (InvoiceDocument.tsx) and the email PDF
// generator (invoicePdf.ts) consume this — neither re-derives quantities,
// amounts, tax totals, or line descriptions on its own, so they can never
// drift apart the way they did before.

export type PrintCopyType = 'master' | 'duplicate' | 'extra' | 'all';

export const COPY_LABELS: Record<string, string> = {
  master: 'MASTER COPY',
  duplicate: 'DUPLICATE COPY',
  extra: 'EXTRA COPY',
};

export interface PreparedInvoiceItemRow {
  slNo: number;
  description: string;
  calcLines: string[];
  hsnSac: string;
  quantity: number;
  unit: string;
  amount: number;
}

export interface PreparedInvoiceData {
  compName: string;
  compAddr: string[];
  compGstin: string;
  compState: string;
  compStateCode: string;
  compEmail: string;
  compPhone: string;
  compPan: string;
  compLogo: string;
  compSign: string;
  compAuth: string;
  bankName: string;
  bankAcctName: string;
  bankAcctNo: string;
  bankBranch: string;
  bankIfsc: string;
  hasBank: boolean;
  cName: string;
  cAddr: string[];
  cGstin: string;
  cState: string;
  cStateCode: string;
  conName: string;
  conAddr: string[];
  conGstin: string;
  conState: string;
  conStateCode: string;
  taxable: number;
  cgstAmt: number;
  sgstAmt: number;
  igstAmt: number;
  totalTax: number;
  grand: number;
  received: number;
  finalPayable: number;
  balance: number;
  isIgst: boolean;
  declaration: string;
  words: string;
  copyLabel: string;
  hsnSacDefault: string;
  vehicleTypesJoined: string;
  itemRows: PreparedInvoiceItemRow[];
}

export function prepareInvoiceData(
  inv: InvoiceWithRelations,
  items: InvoiceItem[],
  settings: CompanySettings | null,
  invoiceSettings: InvoiceSettings | null,
  copyType: string = 'master',
): PreparedInvoiceData {
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
  const hasBank = !!(bankName || bankAcctName || bankAcctNo || bankIfsc);

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

  const copyLabel = COPY_LABELS[copyType] ?? '';
  const hsnSacDefault = invoiceSettings?.hsn_sac ?? '997319';
  const vehicleTypesJoined = (inv.invoiceVehicles ?? []).map(v => v.vehicle_type).filter(Boolean).join(', ');

  // Build line items dynamically from all items (rental, batha, transportation).
  // Match rental items to invoiceVehicles to compute correct quantity for Daily rate type.
  const invVehicles = inv.invoiceVehicles ?? [];
  let vehicleIdx = 0;
  let rentalDelta = 0;
  const itemRows: PreparedInvoiceItemRow[] = [];
  items.forEach((it, idx) => {
    const descUpper = (it.description ?? '').toUpperCase();
    const isBatha = descUpper.includes('BATHA');
    const isTransport = descUpper.includes('TRANSPORT');
    const isRental = !isBatha && !isTransport;

    let desc = it.description ?? '';
    let calcDetails = it.calculation_details ?? '';
    let quantity = Number(it.quantity) || 1;
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
    if (isBatha && (Number(it.amount) || 0) === 0) return;

    const calcLines = calcDetails
      ? calcDetails.split('\n').filter(Boolean).map(l => l.replace(/Rental Amount =/g, 'Full Day Amt ='))
      : [];
    rentalDelta += amount - (Number(it.amount) || 0);

    itemRows.push({
      slNo: idx + 1,
      description: desc,
      calcLines,
      hsnSac: it.hsn_sac ?? hsnSacDefault,
      quantity,
      unit,
      amount,
    });
  });

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

  return {
    compName, compAddr, compGstin, compState, compStateCode, compEmail, compPhone, compPan, compLogo, compSign, compAuth,
    bankName, bankAcctName, bankAcctNo, bankBranch, bankIfsc, hasBank,
    cName, cAddr, cGstin, cState, cStateCode,
    conName, conAddr, conGstin, conState, conStateCode,
    taxable, cgstAmt, sgstAmt, igstAmt, totalTax, grand, received, finalPayable, balance, isIgst,
    declaration, words, copyLabel, hsnSacDefault, vehicleTypesJoined,
    itemRows,
  };
}
