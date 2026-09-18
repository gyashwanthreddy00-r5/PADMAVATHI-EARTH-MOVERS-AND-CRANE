import { supabase } from '@/lib/supabase';
import { round2 } from '@/lib/gstBillingCalc';
import { formatDate } from '@/lib/utils';
import type { Invoice, Purchase, Vendor } from '@/types';

// ============================================================
// This module is a READ-ONLY reporting layer over the EXISTING `invoices`
// (invoice_type = 'GST') and `purchases` tables - it never inserts, updates,
// or deletes a row in either. Nothing here changes GST Billing, Cash/UPI
// Billing, or Purchase behavior; every value below is either read directly
// from those tables or clearly derived (documented at each spot) for
// display purposes only.
// ============================================================

export interface GstFilingMonth {
  /** Calendar month, 1-12. */
  month: number;
  /** Calendar year this month falls in (Apr-Dec => FY start year, Jan-Mar => FY start year + 1). */
  year: number;
  label: string;
}

/** Indian financial year (Apr-Mar) label, e.g. "2026-27" - mirrors the DB's
 *  current_financial_year() SQL function (see supabase/migrations/20260820064756_*)
 *  exactly, just computed client-side for an arbitrary date instead of "now". */
export function financialYearOf(date: Date): string {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const startYear = m >= 4 ? y : y - 1;
  return fyLabel(startYear);
}

export function currentFinancialYear(): string {
  return financialYearOf(new Date());
}

function fyLabel(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/** The GST module has no data before this financial year (GST Billing/Purchase
 *  records predating it aren't in scope for this module), so it's the fixed floor
 *  of the FY dropdown - not derived from today's date. */
const GST_MODULE_BASE_FY_START_YEAR = 2026;

/** Financial years for the FY dropdown: fixed at 2026-27 as the floor, then
 *  automatically extending forward past the current financial year (never a
 *  hardcoded end point) so a new year becomes selectable on its own once the
 *  system date reaches it, with no code change. */
export function recentFinancialYears(futureBuffer = 5): string[] {
  const currentStartYear = Number(currentFinancialYear().split('-')[0]);
  const endYear = Math.max(currentStartYear + futureBuffer, GST_MODULE_BASE_FY_START_YEAR);
  const years: string[] = [];
  for (let startYear = GST_MODULE_BASE_FY_START_YEAR; startYear <= endYear; startYear++) {
    years.push(fyLabel(startYear));
  }
  return years;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The 12 (month, year) pairs an FY label like "2026-27" spans, Apr through Mar. */
export function monthsInFinancialYear(fy: string): GstFilingMonth[] {
  const startYear = Number(fy.split('-')[0]);
  const months: GstFilingMonth[] = [];
  for (let i = 0; i < 12; i++) {
    const m = ((3 + i) % 12) + 1; // 4,5,...,12,1,2,3
    const y = m >= 4 ? startYear : startYear + 1;
    months.push({ month: m, year: y, label: `${MONTH_NAMES[m - 1]} ${y}` });
  }
  return months;
}

export function monthLabel(month: number, year: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** [from, to] ISO date bounds (inclusive) for one calendar month. */
export function monthDateRange(month: number, year: number): { from: string; to: string } {
  const from = `${year}-${pad2(month)}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${pad2(month)}-${pad2(lastDay)}`;
  return { from, to };
}

const GSTIN_RE = /^[0-9A-Z]{15}$/;

export function isValidGstin(v: string | null | undefined): boolean {
  return !!v && GSTIN_RE.test(v.trim().toUpperCase());
}

/** First 2 digits of a GSTIN are the standard GST state code - real data read
 *  off the GSTIN string itself, not app-invented. Returns null when the GSTIN
 *  isn't a plausible 15-char GSTIN. */
export function gstinStateCode(gstin: string | null | undefined): string | null {
  if (!isValidGstin(gstin)) return null;
  return gstin!.trim().toUpperCase().slice(0, 2);
}

// ------------------------------------------------------------
// Sales GST (from existing `invoices`, invoice_type = 'GST')
// ------------------------------------------------------------

export interface SalesGstRow {
  id: string;
  invoiceNumber: string | null;
  invoiceDate: string;
  customerName: string | null;
  customerGstin: string | null;
  placeOfSupply: string | null;
  invoiceValue: number;
  taxableValue: number;
  gstRatePercent: number;
  cgst: number;
  sgst: number;
  igst: number;
  status: string;
  /** Actual collection status derived from invoices.payment_status/amount_received/
   *  balance_amount (kept in sync by the DB's sync_invoice_payment_to_bank trigger
   *  off the real invoice_payments ledger) - distinct from `status` (invoice_status,
   *  the document lifecycle field used by isCounted/error-checks below, untouched).
   *  Draft/Cancelled invoices have no meaningful payment state, so this mirrors
   *  `status` for those instead of claiming a Pending/Received collection state. */
  paymentStatus: 'Received' | 'Partially Received' | 'Pending' | 'Draft' | 'Cancelled';
  /** Comma-joined, formatted date(s) of every real payment against this invoice
   *  (see PAYMENT_DATE_FMT), or '-' when nothing has been received yet. */
  receivedDate: string;
  /** invoices.amount_received - already the correct sum of invoice_payments for
   *  this invoice (trigger-maintained), so this is read directly rather than
   *  re-summed here, which would risk double-counting the same payment. */
  receivedAmount: number;
  balanceAmount: number;
  isCancelled: boolean;
  /** Whether this row counts toward totals: not cancelled and has a real invoice
   *  number - the same rule the rest of the app already uses (see Invoices.tsx's
   *  `!inv.is_cancelled && !!inv.invoice_number` filters). */
  isCounted: boolean;
  b2b: boolean;
  taxType: Invoice['tax_type'];
}

/** Invoice row shape as actually returned by fetchGstInvoicesForMonth's select
 *  below - Invoice itself plus the nested invoice_payments needed only to show
 *  received date(s); amount/balance/status still come from the invoice row's
 *  own already-synced columns, never re-summed from this array. */
type InvoiceWithPaymentDates = Invoice & { payments?: { payment_date: string; amount: number }[] | null };

export async function fetchGstInvoicesForMonth(month: number, year: number): Promise<InvoiceWithPaymentDates[]> {
  const { from, to } = monthDateRange(month, year);
  const { data, error } = await supabase
    .from('invoices')
    .select('*, payments:invoice_payments(payment_date, amount)')
    .eq('invoice_type', 'GST')
    .gte('invoice_date', from)
    .lte('invoice_date', to)
    .order('invoice_date', { ascending: true });
  if (error) throw error;
  return (data ?? []) as InvoiceWithPaymentDates[];
}

function derivePaymentInfo(inv: InvoiceWithPaymentDates): Pick<SalesGstRow, 'paymentStatus' | 'receivedDate' | 'receivedAmount' | 'balanceAmount'> {
  const receivedAmount = round2(Number(inv.amount_received) || 0);
  const balanceAmount = round2(Number(inv.balance_amount) || 0);

  if (inv.invoice_status === 'Cancelled') return { paymentStatus: 'Cancelled', receivedDate: '-', receivedAmount, balanceAmount };
  if (inv.invoice_status === 'Draft') return { paymentStatus: 'Draft', receivedDate: '-', receivedAmount, balanceAmount };

  const paymentStatus: 'Received' | 'Partially Received' | 'Pending' =
    receivedAmount <= 0 ? 'Pending' : balanceAmount <= 0 ? 'Received' : 'Partially Received';

  const dates = Array.from(new Set((inv.payments ?? []).filter(p => Number(p.amount) > 0).map(p => p.payment_date)))
    .sort()
    .map(d => formatDate(d));
  const receivedDate = dates.length > 0 ? dates.join(', ') : '-';

  return { paymentStatus, receivedDate, receivedAmount, balanceAmount };
}

export function toSalesGstRows(invoices: InvoiceWithPaymentDates[]): SalesGstRow[] {
  return invoices.map(inv => {
    const gstRatePercent = inv.tax_type === 'igst'
      ? Number(inv.igst_percent) || 0
      : (Number(inv.cgst_percent) || 0) + (Number(inv.sgst_percent) || 0);
    return {
      id: inv.id,
      invoiceNumber: inv.invoice_number,
      invoiceDate: inv.invoice_date,
      customerName: inv.customer_name,
      customerGstin: inv.customer_gstin,
      placeOfSupply: inv.consignee_state ? `${inv.consignee_state}${inv.consignee_state_code ? ` (${inv.consignee_state_code})` : ''}` : null,
      invoiceValue: Number(inv.grand_total) || 0,
      taxableValue: Number(inv.taxable_amount) || 0,
      gstRatePercent,
      cgst: Number(inv.cgst_amount) || 0,
      sgst: Number(inv.sgst_amount) || 0,
      igst: Number(inv.igst_amount) || 0,
      status: inv.invoice_status,
      ...derivePaymentInfo(inv),
      // The "Cancel Invoice" action in Invoices.tsx sets invoice_status to
      // 'Cancelled' - it does NOT set is_cancelled (which is always inserted
      // false and never flipped for this table anywhere in the app). Checking
      // is_cancelled alone would silently keep cancelled invoices in GST totals.
      isCancelled: inv.is_cancelled || inv.invoice_status === 'Cancelled',
      // A GST invoice is assigned a real invoice_number and inserted as
      // invoice_status 'Draft' the moment its first billing line is added
      // (GstBillingEntry.tsx) - well before the user finishes and Saves it,
      // which is what actually sets it to 'Generated'. An in-progress Draft
      // must not be filed/counted yet.
      isCounted: !inv.is_cancelled && inv.invoice_status !== 'Cancelled' && inv.invoice_status !== 'Draft' && !!inv.invoice_number,
      b2b: isValidGstin(inv.customer_gstin),
      taxType: inv.tax_type,
    };
  });
}

// ------------------------------------------------------------
// Purchase GST (from existing `purchases` + `vendors`)
// ------------------------------------------------------------

export type PurchaseGstSplitBasis = 'intrastate' | 'interstate' | 'unspecified';

export interface PurchaseGstRow {
  id: string;
  vendorName: string;
  vendorGstin: string | null;
  billNo: string | null;
  billDate: string;
  taxableAmount: number;
  gstRatePercent: number;
  cgst: number;
  sgst: number;
  igst: number;
  /** The real, recorded GST amount for this purchase (purchases.gst_amount) -
   *  always known, unlike the cgst/sgst/igst split above which is only a
   *  best-effort derivation and can be 0/0/0 when splitBasis is 'unspecified'.
   *  Summary totals must use this, not cgst+sgst+igst, so an unresolvable
   *  split never silently drops real money out of Total Input GST. */
  gstAmount: number;
  totalAmount: number;
  splitBasis: PurchaseGstSplitBasis;
  itcEligible: boolean;
  itcOverridden: boolean;
  itcReason: string | null;
  /** Actual collection status derived from purchases.paid_amount/balance_amount
   *  (kept in sync by the DB's sync_purchase_payment_ledger_to_bank trigger off
   *  the real purchase_payments ledger). */
  paymentStatus: 'Paid' | 'Partially Paid' | 'Pending';
  paidAmount: number;
  balanceAmount: number;
  /** Comma-joined, formatted date(s)/mode(s)/reference(s)/bank account(s) across
   *  every real (non-cancelled) installment - never combined into one value that
   *  would hide a multi-installment payment's individual details. */
  paidDate: string;
  paymentMode: string;
  referenceNumber: string;
  bankAccount: string;
}

interface PurchaseWithVendor extends Purchase {
  vendor: Pick<Vendor, 'id' | 'name' | 'gst_number'> | null;
  payments?: {
    payment_date: string;
    amount: number;
    payment_mode: string;
    reference_number: string | null;
    is_cancelled: boolean;
    bank_account: { bank_name: string } | null;
  }[] | null;
}

export async function fetchPurchasesForMonth(month: number, year: number): Promise<PurchaseWithVendor[]> {
  const { from, to } = monthDateRange(month, year);
  const { data, error } = await supabase
    .from('purchases')
    .select('*, vendor:vendors(id, name, gst_number), payments:purchase_payments(payment_date, amount, payment_mode, reference_number, is_cancelled, bank_account:bank_accounts(bank_name))')
    .gte('purchase_date', from)
    .lte('purchase_date', to)
    .order('purchase_date', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as PurchaseWithVendor[];
}

function derivePurchasePaymentInfo(p: PurchaseWithVendor): Pick<PurchaseGstRow, 'paymentStatus' | 'paidAmount' | 'balanceAmount' | 'paidDate' | 'paymentMode' | 'referenceNumber' | 'bankAccount'> {
  const paidAmount = round2(Number(p.paid_amount) || 0);
  const balanceAmount = round2(Number(p.balance_amount) || 0);
  const paymentStatus: 'Paid' | 'Partially Paid' | 'Pending' =
    paidAmount <= 0 ? 'Pending' : balanceAmount <= 0 ? 'Paid' : 'Partially Paid';

  const activePayments = (p.payments ?? []).filter(x => !x.is_cancelled && Number(x.amount) > 0);
  const uniqueSorted = (values: (string | null | undefined)[]) =>
    Array.from(new Set(values.filter((v): v is string => !!v)));

  const paidDate = uniqueSorted(activePayments.map(x => x.payment_date)).sort().map(d => formatDate(d)).join(', ') || '-';
  const paymentMode = uniqueSorted(activePayments.map(x => x.payment_mode)).join(', ') || '-';
  const referenceNumber = uniqueSorted(activePayments.map(x => x.reference_number)).join(', ') || '-';
  const bankAccount = uniqueSorted(activePayments.map(x => x.bank_account?.bank_name)).join(', ') || '-';

  return { paymentStatus, paidAmount, balanceAmount, paidDate, paymentMode, referenceNumber, bankAccount };
}

export interface GstPurchaseItcOverride {
  purchase_id: string;
  itc_eligible: boolean;
  reason: string | null;
}

export async function fetchItcOverridesForPurchases(purchaseIds: string[]): Promise<Map<string, GstPurchaseItcOverride>> {
  const map = new Map<string, GstPurchaseItcOverride>();
  if (purchaseIds.length === 0) return map;
  const { data, error } = await supabase
    .from('gst_purchase_itc')
    .select('purchase_id, itc_eligible, reason')
    .in('purchase_id', purchaseIds);
  if (error) throw error;
  (data ?? []).forEach(row => map.set(row.purchase_id, row as GstPurchaseItcOverride));
  return map;
}

/** Splits a purchase's single stored `gst_amount` into CGST/SGST/IGST by comparing
 *  the vendor's GSTIN state-code prefix against the company's - see the "Purchase
 *  GST split" decision in the plan. Never invents a split when the vendor GSTIN is
 *  missing/invalid; callers should flag those via runGstErrorChecks instead. */
export function toPurchaseGstRows(
  purchases: PurchaseWithVendor[],
  companyStateCode: string | null,
  itcOverrides: Map<string, GstPurchaseItcOverride>,
): PurchaseGstRow[] {
  return purchases.map(p => {
    const vendorGstin = p.vendor?.gst_number ?? null;
    const vendorStateCode = gstinStateCode(vendorGstin);
    const gstAmount = Number(p.gst_amount) || 0;
    let splitBasis: PurchaseGstSplitBasis = 'unspecified';
    let cgst = 0, sgst = 0, igst = 0;
    if (vendorStateCode && companyStateCode) {
      if (vendorStateCode === companyStateCode) {
        splitBasis = 'intrastate';
        cgst = round2(gstAmount / 2);
        sgst = round2(gstAmount - cgst);
      } else {
        splitBasis = 'interstate';
        igst = gstAmount;
      }
    }

    const override = itcOverrides.get(p.id);
    const defaultEligible = p.gst_enabled && gstAmount > 0;

    return {
      id: p.id,
      vendorName: p.vendor?.name ?? 'Unknown Vendor',
      vendorGstin,
      billNo: p.bill_no,
      billDate: p.purchase_date,
      ...derivePurchasePaymentInfo(p),
      taxableAmount: Number(p.amount) || 0,
      gstRatePercent: Number(p.gst_rate) || 0,
      cgst, sgst, igst,
      gstAmount,
      totalAmount: Number(p.total_amount) || 0,
      splitBasis,
      itcEligible: override ? override.itc_eligible : defaultEligible,
      itcOverridden: !!override,
      itcReason: override?.reason ?? null,
    };
  });
}

// ------------------------------------------------------------
// Monthly summary (Dashboard / Monthly Summary / GSTR-3B outward+ITC)
// ------------------------------------------------------------

export interface GstMonthlySummary {
  totalSales: number;
  taxableSales: number;
  outputCgst: number;
  outputSgst: number;
  outputIgst: number;
  totalOutputGst: number;
  totalPurchase: number;
  inputCgst: number;
  inputSgst: number;
  inputIgst: number;
  totalInputGst: number;
  netGstPayable: number;
}

export function computeGstSummary(salesRows: SalesGstRow[], purchaseRows: PurchaseGstRow[]): GstMonthlySummary {
  const counted = salesRows.filter(r => r.isCounted);
  const totalSales = round2(counted.reduce((s, r) => s + r.invoiceValue, 0));
  const taxableSales = round2(counted.reduce((s, r) => s + r.taxableValue, 0));
  const outputCgst = round2(counted.reduce((s, r) => s + r.cgst, 0));
  const outputSgst = round2(counted.reduce((s, r) => s + r.sgst, 0));
  const outputIgst = round2(counted.reduce((s, r) => s + r.igst, 0));
  const totalOutputGst = round2(outputCgst + outputSgst + outputIgst);

  const totalPurchase = round2(purchaseRows.reduce((s, r) => s + r.totalAmount, 0));
  const eligible = purchaseRows.filter(r => r.itcEligible);
  const inputCgst = round2(eligible.reduce((s, r) => s + r.cgst, 0));
  const inputSgst = round2(eligible.reduce((s, r) => s + r.sgst, 0));
  const inputIgst = round2(eligible.reduce((s, r) => s + r.igst, 0));
  // Summed from each row's real gst_amount, not from cgst+sgst+igst above - a
  // purchase with an 'unspecified' state split still has a known GST amount
  // even though it can't be broken into CGST/SGST/IGST, so Net GST Payable
  // must not silently drop that eligible ITC just because the split is unknown.
  const totalInputGst = round2(eligible.reduce((s, r) => s + r.gstAmount, 0));

  return {
    totalSales, taxableSales, outputCgst, outputSgst, outputIgst, totalOutputGst,
    totalPurchase, inputCgst, inputSgst, inputIgst, totalInputGst,
    netGstPayable: round2(totalOutputGst - totalInputGst),
  };
}

// ------------------------------------------------------------
// GST Error Check - read-only, never mutates a row
// ------------------------------------------------------------

export type GstIssueSeverity = 'RED' | 'ORANGE' | 'GREEN';

export interface GstIssue {
  severity: GstIssueSeverity;
  source: 'Sales' | 'Purchase';
  reference: string;
  message: string;
}

export function runGstErrorChecks(salesRows: SalesGstRow[], purchaseRows: PurchaseGstRow[]): GstIssue[] {
  const issues: GstIssue[] = [];

  const seenInvoiceNumbers = new Map<string, number>();
  salesRows.forEach(r => {
    if (!r.invoiceNumber) return;
    seenInvoiceNumbers.set(r.invoiceNumber, (seenInvoiceNumbers.get(r.invoiceNumber) ?? 0) + 1);
  });

  salesRows.forEach(r => {
    const ref = r.invoiceNumber ?? `(no number) ${r.invoiceDate}`;
    if (r.isCancelled) {
      issues.push({ severity: 'ORANGE', source: 'Sales', reference: ref, message: 'Cancelled invoice present in this month - excluded from totals, review before filing.' });
    } else if (r.status === 'Draft') {
      issues.push({ severity: 'ORANGE', source: 'Sales', reference: ref, message: 'Invoice is still in Draft status - not yet finalized, excluded from totals until generated.' });
    }
    if (!r.isCounted) return; // remaining checks are about invoices that would otherwise be filed
    // B2C (no GSTIN at all) is valid - only flag when a GSTIN was entered but is malformed.
    if (r.customerGstin && !isValidGstin(r.customerGstin)) {
      issues.push({ severity: 'RED', source: 'Sales', reference: ref, message: 'Customer GSTIN is present but not a valid 15-character GSTIN.' });
    }
    if (r.taxType !== 'no_tax' && r.gstRatePercent <= 0) {
      issues.push({ severity: 'RED', source: 'Sales', reference: ref, message: 'Missing/zero GST rate on a taxable invoice.' });
    }
    if (!r.placeOfSupply) {
      issues.push({ severity: 'ORANGE', source: 'Sales', reference: ref, message: 'Missing customer state / place of supply.' });
    }
    if (r.taxType !== 'no_tax' && (r.cgst + r.sgst + r.igst) <= 0 && r.taxableValue > 0) {
      issues.push({ severity: 'RED', source: 'Sales', reference: ref, message: 'Missing tax amount on a taxable invoice.' });
    }
    if (seenInvoiceNumbers.get(r.invoiceNumber!)! > 1) {
      issues.push({ severity: 'RED', source: 'Sales', reference: ref, message: 'Duplicate invoice number within this month.' });
    }
  });
  salesRows.filter(r => !r.invoiceNumber).forEach(r => {
    issues.push({ severity: 'ORANGE', source: 'Sales', reference: `(no number) ${r.invoiceDate}`, message: 'Invoice has no invoice number assigned - excluded from totals, review before filing.' });
  });

  purchaseRows.forEach(r => {
    const ref = r.billNo ?? `(no bill no) ${r.billDate}`;
    if (!r.vendorGstin) {
      issues.push({ severity: 'ORANGE', source: 'Purchase', reference: ref, message: 'Purchase without vendor GSTIN - CGST/SGST/IGST split could not be determined.' });
    } else if (!isValidGstin(r.vendorGstin)) {
      issues.push({ severity: 'RED', source: 'Purchase', reference: ref, message: 'Vendor GSTIN is present but not a valid 15-character GSTIN.' });
    }
    if (r.totalAmount > r.taxableAmount && (r.cgst + r.sgst + r.igst) <= 0) {
      issues.push({ severity: 'RED', source: 'Purchase', reference: ref, message: 'GST amount is missing on a purchase billed above its taxable amount.' });
    }
  });

  return issues;
}
