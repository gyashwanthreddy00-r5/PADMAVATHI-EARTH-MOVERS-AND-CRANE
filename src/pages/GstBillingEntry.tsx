import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/Toast';
import { Field, Button, inputClass, LoadingSpinner, ConfirmDialog, Modal } from '@/components/ui/common';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { DatePicker } from '@/components/ui/DatePicker';
import { formatCurrency, formatDate, todayISO, classNames, amountInWords } from '@/lib/utils';
import { findRateMasterForVehicle } from '@/lib/rateLookup';
import { computeBillingLineAmounts, round2 } from '@/lib/gstBillingCalc';
import { printGstBillingData, exportGstBillingDataToExcel } from '@/lib/gstBillingExport';
import { getEffectivePoStatus, round2 as poRound2 } from '@/lib/poOrderManagement';
import { PoRequestModal } from '@/components/PoRequestModal';
import { Plus, Trash2, Pencil, AlertTriangle, ArrowLeft, Printer, Download, Save, X, ChevronRight, Mail } from 'lucide-react';
import type { Customer, RateMaster, InvoiceSettings, PoRateType, Vehicle, Invoice, InvoiceBillingLine, PurchaseOrder, PurchaseOrderStatus } from '@/types';

type VehicleLite = Pick<Vehicle, 'id' | 'registration_number' | 'tons' | 'type' | 'capacity'>;
type Step = 'select' | 'entries';

const CGST_PERCENT = 9;
const SGST_PERCENT = 9;
const IGST_PERCENT = 18;

// Description of Services labels for the generated Tax Invoice PDF — capacity/type
// only, never a registration number (multiple vehicles of the same capacity are
// meant to be grouped into one row; see buildInvoiceItems below).
function craneDescriptionLabel(vehicleType: string, ton: number | null): string {
  if (vehicleType === 'JCB') return 'JCB';
  if (ton != null) {
    const tonNum = Number(ton);
    const tonStr = Number.isInteger(tonNum) ? String(tonNum) : String(round2(tonNum));
    return `${tonStr} TON CRANE`;
  }
  return vehicleType ? vehicleType.toUpperCase() : 'CRANE';
}

interface GeneratedInvoiceItem {
  description: string;
  quantity: number;
  rate: number;
  unit: string;
  amount: number;
  calculation_details: string;
}

/**
 * Builds the Description of Services rows for the generated Tax Invoice, grouped by
 * Capacity + Billing Type + Hour Stage — never one row per working-day entry, and
 * never a registration number in the description. Quantities/rates/amounts are
 * derived entirely from each line's own already-computed first/second hour amounts
 * (themselves sourced from Rate Master via computeBillingLineAmounts when the line
 * was added) — nothing here is hardcoded.
 */
function buildInvoiceItems(lines: InvoiceBillingLine[]): GeneratedInvoiceItem[] {
  interface HourlyGroup { label: string; firstQty: number; firstAmt: number; firstRates: Set<number>; firstRateSample: number; secondQty: number; secondAmt: number; secondRates: Set<number>; secondRateSample: number; }
  interface FlatGroup { label: string; qty: number; amt: number; rates: Set<number>; rateSample: number; unit: string; }

  const hourlyGroups = new Map<string, HourlyGroup>();
  const flatGroups = new Map<string, FlatGroup>();

  // Quantities accumulate at full precision (never rounded mid-way) so that, when a
  // group's rate needs to be derived from amount/quantity (see pickRate below), it
  // reproduces the exact Rate Master rate instead of drifting off it (e.g. 900.90
  // instead of 900.00) purely because an intermediate quantity got rounded to 2dp
  // before being used as a divisor.
  for (const l of lines) {
    const label = craneDescriptionLabel(l.vehicle_type, l.ton);
    if (l.rate_type === 'Hourly') {
      const totalHoursLine = (Number(l.hours) || 0) + (Number(l.minutes) || 0) / 60;
      const firstQty = Math.min(totalHoursLine, 1);
      const secondQty = Math.max(totalHoursLine - 1, 0);
      const r1 = Number(l.first_hour_rate) || 0;
      const r2 = Number(l.second_hour_rate) || 0;
      const g = hourlyGroups.get(label) ?? {
        label, firstQty: 0, firstAmt: 0, firstRates: new Set<number>(), firstRateSample: r1,
        secondQty: 0, secondAmt: 0, secondRates: new Set<number>(), secondRateSample: r2,
      };
      g.firstQty += firstQty;
      g.firstAmt = round2(g.firstAmt + (Number(l.first_hour_amount) || 0));
      g.firstRates.add(r1);
      g.secondQty += secondQty;
      g.secondAmt = round2(g.secondAmt + (Number(l.second_hour_amount) || 0));
      g.secondRates.add(r2);
      hourlyGroups.set(label, g);
    } else if (l.rate_type === 'Monthly') {
      // Monthly — one row per capacity, described as "{label} MONTHLY RENTAL"
      // with a MONTH unit and decimal quantity (e.g. 1.50 MONTH), never split
      // into First/Second Hour like Hourly or plain like Daily.
      const monthLabel = `${label} MONTHLY RENTAL`;
      const months = Math.max(0.01, Number(l.days) || 1);
      const monthlyRate = Number(l.first_hour_rate) || 0;
      const amt = round2(monthlyRate * months);
      const g = flatGroups.get(monthLabel) ?? { label: monthLabel, qty: 0, amt: 0, rates: new Set<number>(), rateSample: monthlyRate, unit: 'MONTH' };
      g.qty += months;
      g.amt = round2(g.amt + amt);
      g.rates.add(monthlyRate);
      flatGroups.set(monthLabel, g);
    } else {
      // Daily — one row per capacity, no First/Second Hour split.
      const days = Math.max(1, Number(l.days) || 1);
      const dayRate = Number(l.first_hour_rate) || 0;
      const amt = round2(dayRate * days);
      const g = flatGroups.get(label) ?? { label, qty: 0, amt: 0, rates: new Set<number>(), rateSample: dayRate, unit: 'DAY' };
      g.qty += days;
      g.amt = round2(g.amt + amt);
      g.rates.add(dayRate);
      flatGroups.set(label, g);
    }
  }

  // The rate shown is always the exact Rate Master value snapshotted on the line(s) -
  // never a derived/rounded figure - as long as every line in the group agrees on it
  // (the normal case, since Rate Master is keyed by capacity). Only if lines in the
  // same capacity group genuinely disagree (e.g. the rate changed between two working
  // dates) does this fall back to an amount/quantity blend, using the full-precision
  // quantity so it still reproduces the true rate exactly when possible.
  const pickRate = (rates: Set<number>, amt: number, qty: number, sample: number): number =>
    rates.size <= 1 ? sample : (qty > 0 ? round2(amt / qty) : sample);

  const items: GeneratedInvoiceItem[] = [];
  hourlyGroups.forEach(g => {
    if (g.firstQty > 0) {
      const rate = pickRate(g.firstRates, g.firstAmt, g.firstQty, g.firstRateSample);
      const qty = round2(g.firstQty);
      items.push({
        description: `${g.label} FIRST HOUR`, quantity: qty, rate, unit: 'HR', amount: g.firstAmt,
        calculation_details: `${g.label} First Hour: ${qty.toFixed(2)} hr x ${formatCurrency(rate)} = ${formatCurrency(g.firstAmt)}`,
      });
    }
    if (g.secondQty > 0) {
      const rate = pickRate(g.secondRates, g.secondAmt, g.secondQty, g.secondRateSample);
      const qty = round2(g.secondQty);
      items.push({
        description: `${g.label} SECOND HOUR`, quantity: qty, rate, unit: 'HR', amount: g.secondAmt,
        calculation_details: `${g.label} Second Hour: ${qty.toFixed(2)} hr x ${formatCurrency(rate)} = ${formatCurrency(g.secondAmt)}`,
      });
    }
  });
  flatGroups.forEach(g => {
    const rate = pickRate(g.rates, g.amt, g.qty, g.rateSample);
    const qty = round2(g.qty);
    items.push({
      description: g.label, quantity: qty, rate, unit: g.unit, amount: g.amt,
      calculation_details: `${g.label}: ${qty} ${g.unit} x ${formatCurrency(rate)} = ${formatCurrency(g.amt)}`,
    });
  });
  return items;
}

export default function GstBillingEntry({ invoiceId, onDone }: { invoiceId?: string | null; onDone: () => void }) {
  const { show } = useToast();

  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [vehicles, setVehicles] = useState<VehicleLite[]>([]);
  const [rateMasterRows, setRateMasterRows] = useState<RateMaster[]>([]);
  const [invoiceSettings, setInvoiceSettings] = useState<InvoiceSettings | null>(null);

  // Two-step workflow: pick the customer + confirm the invoice number first,
  // then move to the actual working-day entry screen. Nothing is written to
  // the database on Continue - the invoice row is still only created lazily
  // on the first captured entry (see saveLine) - Continue just moves the UI
  // forward, so opening/backing out of either step never wastes anything.
  const [step, setStep] = useState<Step>('select');
  const [customerId, setCustomerId] = useState('');
  const [placeOfWork, setPlaceOfWork] = useState('');
  const [previewInvoiceNumber, setPreviewInvoiceNumber] = useState('');

  // PO Orders integration — optional, isolated feature. When the selected customer has
  // an Active Purchase Order, this dropdown lets the user draw the invoice's taxable
  // amount against it; if none is selected, invoice generation works exactly as before.
  const [availablePos, setAvailablePos] = useState<PurchaseOrder[]>([]);
  const [selectedPoId, setSelectedPoId] = useState('');
  // When resuming an invoice that already has a utilization record, this holds that
  // record's PO id + amount - used only to compute the correct "available headroom"
  // for the PO-exceeded check below (a resumed invoice's own prior deduction is part
  // of its own room, not a competing use of the PO's balance).
  const [existingPoUtilization, setExistingPoUtilization] = useState<{ poId: string; amount: number } | null>(null);
  // Shown after a successful save when the invoice's taxable amount exceeded the
  // selected PO's available headroom - the invoice itself is never blocked or
  // partially deducted (see proceedSaveInvoice); this is purely informational and
  // offers "Request New PO" as the next step.
  const [poInsufficientWarning, setPoInsufficientWarning] = useState<{ po: PurchaseOrder; headroom: number; invoiceAmount: number } | null>(null);
  const [poRequestModalOpen, setPoRequestModalOpen] = useState(false);

  // activeInvoice is null until the user's first "Capture Trip" click actually
  // inserts a real invoice row - merely opening/selecting a customer/vehicle
  // never touches the database, so backing out never leaves an empty invoice
  // or wastes an invoice number.
  const [activeInvoice, setActiveInvoice] = useState<Invoice | null>(null);
  const [lines, setLines] = useState<InvoiceBillingLine[]>([]);

  // Add / Edit Billing Entry form
  const [entDate, setEntDate] = useState(todayISO());
  const [entVehicleId, setEntVehicleId] = useState('');
  const [entRateType, setEntRateType] = useState<PoRateType>('Hourly');
  const [entHours, setEntHours] = useState('');
  const [entMinutes, setEntMinutes] = useState('');
  const [entDays, setEntDays] = useState('1');
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [savingLine, setSavingLine] = useState(false);
  const [deleteLineId, setDeleteLineId] = useState<string | null>(null);

  // Invoice Details - Invoice Number is auto-generated; Billed Date defaults to
  // today but can be changed, and can still be set later once the invoice exists.
  const [billDateDraft, setBillDateDraft] = useState(todayISO());
  const [gstType, setGstType] = useState<'cgst_sgst' | 'igst' | 'no_tax'>('cgst_sgst');
  // Up & Down Transportation Charges — merged into a single checkbox + amount (the
  // separate Up/Down fields and their own DB columns still exist for old invoices;
  // this form only ever writes the combined amount into up_transportation_*, and
  // always clears down_transportation_* to disabled/0 going forward).
  const [upEnabled, setUpEnabled] = useState(false);
  const [upAmount, setUpAmount] = useState('');
  // Operator Batha — invoice-level charge (Rate x Quantity = Amount), not per billing
  // entry. Positioned after Up & Down Transportation on the generated invoice.
  const [operatorBathaEnabled, setOperatorBathaEnabled] = useState(false);
  const [operatorBathaRate, setOperatorBathaRate] = useState('');
  const [operatorBathaQuantity, setOperatorBathaQuantity] = useState('');
  const [additionalEnabled, setAdditionalEnabled] = useState(false);
  const [additionalAmount, setAdditionalAmount] = useState('');
  const [additionalDescription, setAdditionalDescription] = useState('');
  // Discount — flat ₹ amount deducted from the taxable amount BEFORE GST (see
  // pretax_discount_enabled/pretax_discount_amount). Distinct from the existing
  // discount_enabled/discount_percent post-GST rebate used elsewhere in the app.
  const [preTaxDiscountEnabled, setPreTaxDiscountEnabled] = useState(false);
  const [preTaxDiscountAmount, setPreTaxDiscountAmount] = useState('');
  const [savingInvoice, setSavingInvoice] = useState(false);

  useEffect(() => { init(); }, []);

  async function init() {
    setLoading(true);
    const [custRes, vehRes, rateRes, settingsRes] = await Promise.all([
      supabase.from('customers').select('*').eq('active', true).order('name'),
      supabase.from('vehicles').select('id,registration_number,tons,type,capacity').eq('active', true).order('registration_number'),
      supabase.from('rate_master').select('*').in('status', ['Active', 'Closed']),
      supabase.from('invoice_settings').select('*').limit(1).maybeSingle(),
    ]);
    setCustomers((custRes.data ?? []) as Customer[]);
    setVehicles((vehRes.data ?? []) as VehicleLite[]);
    setRateMasterRows((rateRes.data ?? []) as RateMaster[]);
    setInvoiceSettings(settingsRes.data as InvoiceSettings | null);

    if (invoiceId) {
      await loadInvoice(invoiceId);
    }
    setLoading(false);
  }

  async function loadInvoice(id: string) {
    const { data: inv, error: invErr } = await supabase.from('invoices').select('*').eq('id', id).single();
    if (invErr || !inv) { show(invErr?.message ?? 'Invoice not found.', 'error'); return; }
    const invoice = inv as Invoice;
    setActiveInvoice(invoice);
    setCustomerId(invoice.customer_id ?? '');
    setPlaceOfWork(invoice.place_of_work ?? '');
    setBillDateDraft(invoice.invoice_date || todayISO());
    setGstType(invoice.tax_type ?? (invoice.igst_amount > 0 ? 'igst' : 'cgst_sgst'));
    // Older invoices may have separate Up + Down amounts saved from before these were
    // merged into one field — combine them so editing one never silently drops the
    // Down portion.
    const combinedTransport = round2((Number(invoice.up_transportation_amount) || 0) + (Number(invoice.down_transportation_amount) || 0));
    setUpEnabled(invoice.up_transportation_enabled || invoice.down_transportation_enabled);
    setUpAmount(combinedTransport ? String(combinedTransport) : '');
    setOperatorBathaEnabled(invoice.operator_batha_enabled ?? false);
    setOperatorBathaRate(invoice.operator_batha_rate ? String(invoice.operator_batha_rate) : '');
    setOperatorBathaQuantity(invoice.operator_batha_quantity ? String(invoice.operator_batha_quantity) : '');
    setAdditionalEnabled(invoice.additional_charges_enabled ?? false);
    setAdditionalAmount(invoice.additional_charges_amount ? String(invoice.additional_charges_amount) : '');
    setAdditionalDescription(invoice.additional_charges_description ?? '');
    setPreTaxDiscountEnabled(invoice.pretax_discount_enabled ?? false);
    setPreTaxDiscountAmount(invoice.pretax_discount_amount ? String(invoice.pretax_discount_amount) : '');
    setStep('entries');
    await fetchLines(id);
  }

  async function fetchLines(id: string) {
    const { data, error } = await supabase.from('invoice_billing_lines').select('*').eq('invoice_id', id).order('sort_order');
    if (error) { show(error.message, 'error'); return; }
    setLines((data ?? []) as InvoiceBillingLine[]);
  }

  const selectedCustomer = customers.find(c => c.id === customerId) ?? null;
  const vehiclesById = useMemo(() => new Map(vehicles.map(v => [v.id, v])), [vehicles]);

  function rateFor(vehicleId: string, workingDate: string): RateMaster | null {
    const v = vehiclesById.get(vehicleId);
    if (!v) return null;
    return findRateMasterForVehicle({ type: v.type, capacity: v.capacity }, rateMasterRows, workingDate);
  }

  // ---------------- Invoice-number preview (non-consuming) ----------------
  // Shows the customer the number their invoice WILL get, the moment they
  // pick a customer - without reserving/consuming it. The real number is
  // only generated (via next_pcs_invoice_number) inside saveLine(), at the
  // moment the first billing entry is actually captured, so it's the same
  // number shown here all the way through - nothing is regenerated later.
  useEffect(() => {
    if (!customerId || activeInvoice) { setPreviewInvoiceNumber(''); return; }
    let cancelled = false;
    supabase.rpc('peek_pcs_invoice_number', { p_invoice_date: todayISO() }).then(({ data }) => {
      if (!cancelled && typeof data === 'string') setPreviewInvoiceNumber(data);
    });
    return () => { cancelled = true; };
  }, [customerId, activeInvoice]);

  // PO Orders integration — fetch this customer's Purchase Orders and offer only the
  // ones currently Active (status re-derived from the raw fields, not the possibly
  // stale stored column) for selection. Resets the selection whenever the customer
  // changes so a PO never carries over to a different customer's invoice.
  //
  // Keyed on `invoiceId` (a stable prop, only set when RESUMING an existing invoice)
  // rather than `activeInvoice?.id` deliberately — activeInvoice only comes into
  // existence partway through a brand-new invoice (on its first captured line), and
  // keying on it here would re-run this effect at that moment and wipe out a PO the
  // user had already picked in the 'select' step, before any utilization row exists
  // to restore it from.
  useEffect(() => {
    setSelectedPoId('');
    setExistingPoUtilization(null);
    if (!customerId) { setAvailablePos([]); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('purchase_orders').select('*').eq('customer_id', customerId);
      if (cancelled) return;
      const allPos = (data ?? []) as PurchaseOrder[];
      let active = allPos.filter(p => getEffectivePoStatus(p) === 'Active');

      // Resuming an existing invoice that already has a PO utilization record —
      // restore that exact selection, even if the PO itself is no longer Active
      // (e.g. it has since become Completed), so simply reopening and re-saving the
      // invoice doesn't look like "no PO selected" and reverse a still-correct
      // deduction (see applyPoUtilization's reconciliation logic below).
      if (invoiceId) {
        const { data: utilRows } = await supabase.from('purchase_order_utilization').select('purchase_order_id, utilized_amount').eq('invoice_id', invoiceId);
        if (cancelled) return;
        const linkedRow = (utilRows ?? [])[0] as { purchase_order_id: string; utilized_amount: number } | undefined;
        if (linkedRow) {
          const linkedPo = allPos.find(p => p.id === linkedRow.purchase_order_id);
          if (linkedPo && !active.some(p => p.id === linkedRow.purchase_order_id)) active = [...active, linkedPo];
          setAvailablePos(active);
          setSelectedPoId(linkedRow.purchase_order_id);
          setExistingPoUtilization({ poId: linkedRow.purchase_order_id, amount: Number(linkedRow.utilized_amount) || 0 });
          return;
        }
      }
      setAvailablePos(active);
    })();
    return () => { cancelled = true; };
  }, [customerId, invoiceId]);

  const selectedPo = availablePos.find(p => p.id === selectedPoId) ?? null;

  function goBack() {
    onDone();
  }

  function goToEntries() {
    if (!customerId) { show('Please select a customer.', 'error'); return; }
    setStep('entries');
  }

  // ---------------- Add / Edit Billing Entry ----------------

  function resetEntryForm() {
    setEntDate(todayISO()); setEntVehicleId(''); setEntRateType('Hourly'); setEntHours(''); setEntMinutes('');
    setEntDays('1');
    setEditingLineId(null);
  }

  function startEditLine(l: InvoiceBillingLine) {
    setEditingLineId(l.id);
    setEntDate(l.working_date);
    setEntVehicleId(l.vehicle_id ?? '');
    setEntRateType(l.rate_type);
    setEntHours(l.rate_type === 'Daily' ? '' : String(l.hours));
    setEntMinutes(l.rate_type === 'Daily' ? '' : String(l.minutes));
    setEntDays(l.rate_type === 'Daily' ? String(l.days || 1) : '1');
  }

  const selectedEntVehicle = entVehicleId ? vehiclesById.get(entVehicleId) ?? null : null;
  const entRate = (entDate && entVehicleId) ? rateFor(entVehicleId, entDate) : null;
  // Shared by Full Day's "No. of Days" and Monthly's "Quantity (Months)" - Monthly
  // allows decimals (1.5, 3.25), Daily is whole numbers by convention but nothing here
  // forces that since Math.max never truncates.
  const entDaysNum = Math.max(entRateType === 'Monthly' ? 0.01 : 1, Number(entDays) || 1);
  const entCalc = (entDate && entVehicleId)
    ? computeBillingLineAmounts(entRateType, entRateType === 'Hourly' ? Number(entHours) || 0 : 0, entRateType === 'Hourly' ? Number(entMinutes) || 0 : 0, entRate, entDaysNum)
    : null;
  const canSaveLine = !!(entDate && entVehicleId && (entRateType !== 'Hourly' ? Number(entDays) > 0 : (entHours !== '' || entMinutes !== '')) && entCalc?.rateFound);

  async function saveLine() {
    if (savingLine) return;
    if (!selectedEntVehicle || !entCalc || !entCalc.rateFound) return;
    if (!customerId) { show('Please select a customer.', 'error'); return; }
    setSavingLine(true);
    const { data: { user } } = await supabase.auth.getUser();

    // Lazily create the invoice on the FIRST captured entry only - opening
    // this screen, picking a customer/vehicle, or backing out never inserts
    // anything and never consumes an invoice number.
    let invoice = activeInvoice;
    let justCreatedInvoice = false;
    if (!invoice) {
      const { data: invNum, error: numErr } = await supabase.rpc('next_pcs_invoice_number', { p_invoice_date: todayISO() });
      if (numErr || !invNum) { show(numErr?.message ?? 'Could not generate invoice number.', 'error'); setSavingLine(false); return; }
      const cust = selectedCustomer;
      const { data: newInv, error: invErr } = await supabase.from('invoices').insert({
        invoice_number: invNum,
        invoice_date: todayISO(),
        invoice_type: 'GST',
        customer_id: customerId,
        customer_name: cust?.name ?? null,
        customer_address: cust?.address ?? null,
        customer_gstin: cust?.gstin ?? null,
        customer_email: cust?.email ?? null,
        customer_phone: cust?.phone ?? null,
        place_of_work: placeOfWork.trim() || null,
        taxable_amount: 0, cgst_percent: 0, sgst_percent: 0, igst_percent: 0,
        cgst_amount: 0, sgst_amount: 0, igst_amount: 0, total_gst: 0, grand_total: 0,
        batha: 0,
        payment_status: 'Pending',
        is_cancelled: false,
        consignee_name: cust?.name ?? null,
        consignee_address: cust?.address ?? null,
        consignee_gstin: cust?.gstin ?? null,
        consignee_state: cust?.state ?? null,
        consignee_state_code: cust?.state_code ?? null,
        amount_received: 0,
        balance_amount: 0,
        final_payable_amount: 0,
        invoice_status: 'Draft',
        up_transportation_enabled: false,
        up_transportation_amount: 0,
        down_transportation_enabled: false,
        down_transportation_amount: 0,
        created_by: user?.id ?? null,
      }).select().single();
      if (invErr || !newInv) { show(invErr?.message ?? 'Could not start invoice.', 'error'); setSavingLine(false); return; }
      invoice = newInv as Invoice;
      justCreatedInvoice = true;
    }

    const hours = entRateType === 'Hourly' ? Number(entHours) || 0 : 0;
    const minutes = entRateType === 'Hourly' ? Number(entMinutes) || 0 : 0;
    const days = entRateType !== 'Hourly' ? entDaysNum : 1;
    const payload = {
      invoice_id: invoice.id,
      working_date: entDate,
      vehicle_id: selectedEntVehicle.id,
      vehicle_number: selectedEntVehicle.registration_number,
      vehicle_type: selectedEntVehicle.type,
      ton: selectedEntVehicle.tons,
      rate_type: entRateType,
      hours, minutes, days,
      first_hour_rate: entCalc.firstRate,
      second_hour_rate: entCalc.secondRate,
      first_hour_amount: entCalc.firstAmt,
      second_hour_amount: entCalc.secondAmt,
      batha: 0,
      total_amount: round2(entCalc.rentalAmount ?? 0),
    };
    const result = editingLineId
      ? await supabase.from('invoice_billing_lines').update(payload).eq('id', editingLineId)
      : await supabase.from('invoice_billing_lines').insert({ ...payload, sort_order: lines.length, created_by: user?.id ?? null });
    if (result.error) {
      // The line never made it in - if we just created the invoice for this
      // capture, undo that too so a failed capture never leaves an empty
      // invoice behind or wastes the invoice number.
      if (justCreatedInvoice) await supabase.from('invoices').delete().eq('id', invoice.id);
      show(result.error.message, 'error');
      setSavingLine(false);
      return;
    }
    if (justCreatedInvoice) setActiveInvoice(invoice);
    show(editingLineId ? 'Working day updated.' : 'Trip captured.', 'success');
    resetEntryForm();
    const { data: freshLines } = await supabase.from('invoice_billing_lines').select('*').eq('invoice_id', invoice.id).order('sort_order');
    const updated = (freshLines ?? []) as InvoiceBillingLine[];
    setLines(updated);
    await syncInvoiceTotals(updated, undefined, invoice);
    setSavingLine(false);
  }

  async function handleDeleteLine() {
    if (!deleteLineId || !activeInvoice) return;
    const { error } = await supabase.from('invoice_billing_lines').delete().eq('id', deleteLineId);
    if (error) { show(error.message, 'error'); setDeleteLineId(null); return; }
    show('Working day removed.', 'success');
    const updated = lines.filter(l => l.id !== deleteLineId);
    setLines(updated);
    if (editingLineId === deleteLineId) resetEntryForm();
    await syncInvoiceTotals(updated);
    setDeleteLineId(null);
  }

  // ---------------- Totals + persistence ----------------

  const totals = useMemo(() => {
    const totalHours = round2(lines.reduce((s, l) => s + l.hours + l.minutes / 60, 0));
    const rentalSubtotal = round2(lines.reduce((s, l) => s + l.total_amount, 0));
    const up = upEnabled ? Number(upAmount) || 0 : 0;
    const operatorBatha = operatorBathaEnabled ? round2((Number(operatorBathaRate) || 0) * (Number(operatorBathaQuantity) || 0)) : 0;
    const additional = additionalEnabled ? Number(additionalAmount) || 0 : 0;
    const preDiscountTaxable = round2(rentalSubtotal + up + operatorBatha + additional);
    // Discount is deducted before GST, and can never take the taxable amount below 0.
    const discount = preTaxDiscountEnabled ? Math.min(Math.max(Number(preTaxDiscountAmount) || 0, 0), preDiscountTaxable) : 0;
    const taxable = round2(preDiscountTaxable - discount);
    const cgstAmt = gstType === 'cgst_sgst' ? round2(taxable * CGST_PERCENT / 100) : 0;
    const sgstAmt = gstType === 'cgst_sgst' ? round2(taxable * SGST_PERCENT / 100) : 0;
    const igstAmt = gstType === 'igst' ? round2(taxable * IGST_PERCENT / 100) : 0;
    const totalGst = round2(cgstAmt + sgstAmt + igstAmt);
    const grandTotal = round2(taxable + totalGst);
    const gstLabel = gstType === 'cgst_sgst' ? `GST (CGST ${CGST_PERCENT}% + SGST ${SGST_PERCENT}%)` : gstType === 'igst' ? `GST (IGST ${IGST_PERCENT}%)` : 'No Tax';
    return { totalHours, rentalSubtotal, up, operatorBatha, additional, discount, taxable, cgstAmt, sgstAmt, igstAmt, totalGst, grandTotal, gstLabel };
  }, [lines, upEnabled, upAmount, operatorBathaEnabled, operatorBathaRate, operatorBathaQuantity, additionalEnabled, additionalAmount, preTaxDiscountEnabled, preTaxDiscountAmount, gstType]);

  /** Recomputes and persists totals + rebuilds invoice_items - called after every line add/edit/delete and from Save Invoice. Returns whether the invoice row itself was saved successfully. */
  async function syncInvoiceTotals(currentLines: InvoiceBillingLine[], opts?: { billDate?: string | null; finalize?: boolean }, invoiceOverride?: Invoice): Promise<boolean> {
    const invoice = invoiceOverride ?? activeInvoice;
    if (!invoice) return false;
    const totalHours = round2(currentLines.reduce((s, l) => s + l.hours + l.minutes / 60, 0));
    const rentalSubtotal = round2(currentLines.reduce((s, l) => s + l.total_amount, 0));
    const up = upEnabled ? Number(upAmount) || 0 : 0;
    const operatorBathaRateNum = operatorBathaEnabled ? Number(operatorBathaRate) || 0 : 0;
    const operatorBathaQuantityNum = operatorBathaEnabled ? Number(operatorBathaQuantity) || 0 : 0;
    const operatorBatha = round2(operatorBathaRateNum * operatorBathaQuantityNum);
    const additional = additionalEnabled ? Number(additionalAmount) || 0 : 0;
    const preDiscountTaxable = round2(rentalSubtotal + up + operatorBatha + additional);
    const discount = preTaxDiscountEnabled ? Math.min(Math.max(Number(preTaxDiscountAmount) || 0, 0), preDiscountTaxable) : 0;
    const taxable = round2(preDiscountTaxable - discount);
    const cgstAmt = gstType === 'cgst_sgst' ? round2(taxable * CGST_PERCENT / 100) : 0;
    const sgstAmt = gstType === 'cgst_sgst' ? round2(taxable * SGST_PERCENT / 100) : 0;
    const igstAmt = gstType === 'igst' ? round2(taxable * IGST_PERCENT / 100) : 0;
    const totalGst = round2(cgstAmt + sgstAmt + igstAmt);
    const grandTotal = round2(taxable + totalGst);

    const billDate = opts?.billDate !== undefined ? opts.billDate : invoice.invoice_date;
    const vehicleList = Array.from(new Set(currentLines.map(l => l.vehicle_number))).join(', ');

    const updatePayload = {
      invoice_date: billDate || invoice.invoice_date,
      total_hours: totalHours,
      description: `${currentLines.length} working-day entr${currentLines.length === 1 ? 'y' : 'ies'}${vehicleList ? ' - ' + vehicleList : ''}`,
      motor_vehicle_numbers: vehicleList || null,
      taxable_amount: taxable,
      tax_type: gstType,
      cgst_percent: gstType === 'cgst_sgst' ? CGST_PERCENT : 0,
      sgst_percent: gstType === 'cgst_sgst' ? SGST_PERCENT : 0,
      igst_percent: gstType === 'igst' ? IGST_PERCENT : 0,
      cgst_amount: cgstAmt, sgst_amount: sgstAmt, igst_amount: igstAmt,
      total_gst: totalGst, grand_total: grandTotal,
      balance_amount: grandTotal, final_payable_amount: grandTotal,
      amount_in_words: amountInWords(grandTotal),
      up_transportation_enabled: up > 0, up_transportation_amount: up,
      // Down Transportation is retired (merged into Up & Down Transportation Charges
      // above) - always cleared going forward, never written to separately.
      down_transportation_enabled: false, down_transportation_amount: 0,
      operator_batha_enabled: operatorBatha > 0, operator_batha_rate: operatorBathaRateNum, operator_batha_quantity: operatorBathaQuantityNum,
      batha: operatorBatha,
      additional_charges_enabled: additional > 0, additional_charges_amount: additional,
      additional_charges_description: additionalDescription.trim() || null,
      pretax_discount_enabled: discount > 0, pretax_discount_amount: discount,
      invoice_status: (opts?.finalize && billDate) ? 'Generated' as const : invoice.invoice_status,
    };
    const { error: updErr } = await supabase.from('invoices').update(updatePayload).eq('id', invoice.id);
    if (updErr) { show(updErr.message, 'error'); return false; }
    setActiveInvoice({ ...invoice, ...updatePayload });

    // Rebuild invoice_items from scratch so Print/PDF/email always reflect current lines
    await supabase.from('invoice_items').delete().eq('invoice_id', invoice.id);
    const hsnSac = invoiceSettings?.hsn_sac || '997319';
    const items: { invoice_id: string; sl_no: number; description: string; hsn_sac: string; quantity: number; rate: number; unit: string; amount: number; batha: number; calculation_details: string }[] = [];
    // Description of Services — grouped by Capacity + Billing Type + Hour Stage
    // (never one row per working-day entry, never a registration number in the
    // description); see buildInvoiceItems above. Operator Batha is invoice-level,
    // not per-entry; see the single line pushed below.
    for (const gi of buildInvoiceItems(currentLines)) {
      items.push({
        invoice_id: invoice.id, sl_no: items.length + 1, description: gi.description,
        hsn_sac: hsnSac, quantity: gi.quantity, rate: gi.rate,
        unit: gi.unit, amount: gi.amount, batha: 0,
        calculation_details: gi.calculation_details,
      });
    }
    if (up > 0) {
      items.push({ invoice_id: invoice.id, sl_no: items.length + 1, description: 'UP AND DOWN TRANSPORTATION CHARGES', hsn_sac: invoiceSettings?.hsn_sac || '997319', quantity: 1, rate: up, unit: 'NOS', amount: up, batha: 0, calculation_details: `Up and Down Transportation: ${formatCurrency(up)}` });
    }
    if (operatorBatha > 0) {
      items.push({
        invoice_id: invoice.id, sl_no: items.length + 1, description: 'OPERATOR BATHA',
        hsn_sac: hsnSac, quantity: operatorBathaQuantityNum, rate: operatorBathaRateNum,
        unit: 'NOS', amount: operatorBatha, batha: operatorBatha,
        calculation_details: `Operator Batha: ${operatorBathaQuantityNum} x ${formatCurrency(operatorBathaRateNum)} = ${formatCurrency(operatorBatha)}`,
      });
    }
    if (additional > 0) {
      items.push({ invoice_id: invoice.id, sl_no: items.length + 1, description: (additionalDescription.trim() || 'ADDITIONAL CHARGES').toUpperCase(), hsn_sac: invoiceSettings?.hsn_sac || '997319', quantity: 1, rate: additional, unit: 'NOS', amount: additional, batha: 0, calculation_details: `Additional Charges: ${formatCurrency(additional)}` });
    }
    if (discount > 0) {
      // Shown as its own negative line so the printed invoice explains why the Total
      // (already net of this discount via taxable_amount) is lower than the sum of
      // the positive lines above it.
      items.push({ invoice_id: invoice.id, sl_no: items.length + 1, description: 'DISCOUNT', hsn_sac: invoiceSettings?.hsn_sac || '997319', quantity: 1, rate: -discount, unit: 'NOS', amount: -discount, batha: 0, calculation_details: `Discount: -${formatCurrency(discount)}` });
    }
    if (items.length > 0) {
      const { error: itemsErr } = await supabase.from('invoice_items').insert(items);
      if (itemsErr) show(itemsErr.message, 'error');
    }
    return true;
  }

  function saveInvoice() {
    if (!activeInvoice) return;
    if (lines.length === 0) { show('Please add at least one billing entry before saving the invoice.', 'error'); return; }
    // PO Orders integration — the balance check MUST happen BEFORE any save/finalize
    // write, not after. If the selected PO's available headroom is insufficient, we
    // stop here and ask for confirmation via poInsufficientWarning; proceedSaveInvoice
    // (the only place that writes invoice_status: 'Generated'/applies PO utilization)
    // is never called until the user explicitly clicks Continue in that dialog - so an
    // unconfirmed insufficient-balance attempt never finalizes/saves anything. On a
    // resumed invoice that already utilized this same PO, that prior amount is added
    // back as headroom — it's this invoice's own room, not a competing deduction (see
    // applyPoUtilization's reconciliation logic).
    if (selectedPo) {
      const priorOwnAmount = existingPoUtilization?.poId === selectedPo.id ? existingPoUtilization.amount : 0;
      const availableHeadroom = poRound2(selectedPo.remaining_amount + priorOwnAmount);
      if (totals.taxable > availableHeadroom) {
        setPoInsufficientWarning({ po: selectedPo, headroom: availableHeadroom, invoiceAmount: totals.taxable });
        return;
      }
    }
    void proceedSaveInvoice({});
  }

  /** "Continue" on the PO Balance Insufficient confirmation — the only path that
   *  finalizes/saves the invoice despite an insufficient PO balance; skips the PO
   *  deduction (never partial, never an incorrect utilization row). */
  function confirmSaveDespiteInsufficientPo() {
    const warning = poInsufficientWarning;
    if (!warning) return;
    setPoInsufficientWarning(null);
    void proceedSaveInvoice({ skipPoDeduction: true, insufficientPo: warning.po });
  }

  /** Cancel/close on the PO Balance Insufficient confirmation — nothing has been
   *  saved, so this only dismisses the dialog and leaves the user on the entries
   *  screen to adjust the invoice or PO selection; it must never navigate away. */
  function cancelInsufficientPoWarning() {
    setPoInsufficientWarning(null);
  }

  async function proceedSaveInvoice(opts: { skipPoDeduction?: boolean; insufficientPo?: PurchaseOrder }) {
    if (!activeInvoice) return;
    setSavingInvoice(true);
    const saved = await syncInvoiceTotals(lines, { billDate: billDateDraft || null, finalize: true });
    setSavingInvoice(false);
    if (!saved) return;
    // Only on a successful save: show the toast, then redirect to Customer Invoices so
    // the new invoice is visible in the list immediately - never redirect on failure.
    show('Invoice Saved Successfully.', 'success');
    if (opts.skipPoDeduction) {
      // User confirmed Continue despite insufficient PO balance - do NOT deduct, do
      // NOT touch any existing purchase_order_utilization row for this invoice. The
      // invoice itself still saves in full with all its own amounts unchanged.
      onDone();
      return;
    }
    // Always reconciles (not only when a PO is currently selected) so that removing
    // a previously-selected PO on a resumed invoice correctly reverses its old
    // deduction too - see applyPoUtilization's doc comment.
    await applyPoUtilization(selectedPo?.id ?? null, totals.taxable, activeInvoice.id, activeInvoice.invoice_number ?? '', billDateDraft || activeInvoice.invoice_date || todayISO());
    onDone();
  }

  /**
   * Deducts this invoice's taxable amount from the selected PO's remaining balance and
   * logs one po_utilization row - called only AFTER the invoice itself has already been
   * saved successfully. Never throws: per spec, a PO update failure must never undo or
   * invalidate an already-saved invoice, so any error here is surfaced as a standalone
   * warning toast instead of being allowed to affect the caller's success path.
   */
  /** Adds `delta` (positive or negative) to one PO's utilized/remaining amount and
   *  recomputes its status - the single place that ever mutates a PO's running
   *  balance, so every caller stays consistent. */
  async function adjustPoBalance(poId: string, delta: number): Promise<number> {
    const { data: poRow, error } = await supabase.from('purchase_orders').select('*').eq('id', poId).single();
    if (error || !poRow) throw error ?? new Error('Purchase Order not found');
    const newUtilized = poRound2((Number(poRow.utilized_amount) || 0) + delta);
    const newRemaining = poRound2((Number(poRow.grand_total) || 0) - newUtilized);
    const status: PurchaseOrderStatus = getEffectivePoStatus({ remaining_amount: newRemaining, valid_to: poRow.valid_to });
    const { error: updErr } = await supabase.from('purchase_orders').update({ utilized_amount: newUtilized, remaining_amount: newRemaining, status, updated_at: new Date().toISOString() }).eq('id', poId);
    if (updErr) throw updErr;
    return newRemaining;
  }

  /**
   * Reconciles this invoice's PO utilization to match its CURRENT selected PO and
   * taxable amount - called after every successful save, not just the first one.
   * GST invoices can be reopened and re-saved (see the "resume" flow in
   * Invoices.tsx), so a naive "always add" would double-deduct the same invoice
   * every time it's re-saved. Instead: look up any utilization row already linked
   * to this invoice_id (there is ever at most one), and:
   *   - same PO as before -> adjust the PO by only the DELTA between the old and
   *     new amount (handles the invoice's amount changing between saves);
   *   - different PO (or PO removed) -> fully reverse the old PO's deduction, then
   *     apply the new one (if any) to the newly selected PO.
   * Never throws - a PO update failure must never affect the already-saved invoice,
   * only surface as a warning toast.
   */
  async function applyPoUtilization(poId: string | null, amount: number, invoiceId: string, invoiceNumber: string, invoiceDate: string) {
    try {
      const { data: existingRows, error: existErr } = await supabase.from('purchase_order_utilization').select('*').eq('invoice_id', invoiceId);
      if (existErr) throw existErr;
      const existing = (existingRows ?? [])[0] ?? null;

      if (existing && poId && existing.purchase_order_id === poId) {
        const delta = poRound2(amount - Number(existing.utilized_amount));
        if (Math.abs(delta) < 0.005) return; // nothing actually changed since the last save
        const newRemaining = await adjustPoBalance(poId, delta);
        const { error: updErr } = await supabase.from('purchase_order_utilization').update({
          utilized_amount: amount, balance_after: newRemaining, invoice_number: invoiceNumber, invoice_date: invoiceDate,
        }).eq('id', existing.id);
        if (updErr) throw updErr;
        return;
      }

      if (existing) {
        await adjustPoBalance(existing.purchase_order_id, -Number(existing.utilized_amount));
        const { error: delErr } = await supabase.from('purchase_order_utilization').delete().eq('id', existing.id);
        if (delErr) throw delErr;
      }

      if (poId) {
        const newRemaining = await adjustPoBalance(poId, amount);
        const { error: insErr } = await supabase.from('purchase_order_utilization').insert({
          purchase_order_id: poId, invoice_id: invoiceId, invoice_number: invoiceNumber, invoice_date: invoiceDate,
          utilized_amount: amount, balance_after: newRemaining,
        });
        if (insErr) throw insErr;
      }
    } catch (e) {
      console.error('PO utilization update failed:', e);
      show('Invoice saved, but the PO balance could not be updated automatically. Please adjust it manually in PO Orders.', 'error');
    }
  }

  function handlePrint() {
    if (!activeInvoice) return;
    printGstBillingData({
      companyName: invoiceSettings ? 'PADMAVATHI EARTH MOVERS AND CRANE SERVICES' : 'Company',
      customerName: selectedCustomer?.name ?? activeInvoice.customer_name ?? '',
      customerGstin: selectedCustomer?.gstin ?? activeInvoice.customer_gstin,
      invoiceNumber: activeInvoice.invoice_number,
      billDate: activeInvoice.invoice_date,
      gstLabel: totals.gstLabel,
    }, lines, totals.totalGst);
  }
  function handleExport() {
    if (!activeInvoice) return;
    exportGstBillingDataToExcel({
      companyName: 'PADMAVATHI EARTH MOVERS AND CRANE SERVICES',
      customerName: selectedCustomer?.name ?? activeInvoice.customer_name ?? '',
      customerGstin: selectedCustomer?.gstin ?? activeInvoice.customer_gstin,
      invoiceNumber: activeInvoice.invoice_number,
      billDate: activeInvoice.invoice_date,
      gstLabel: totals.gstLabel,
    }, lines, totals.totalGst);
  }

  if (loading) return <LoadingSpinner />;

  const invoiceNoDisplay = activeInvoice?.invoice_number || previewInvoiceNumber;

  return (
    <div className="space-y-4">
      <button onClick={goBack} className="flex items-center gap-1.5 text-sm font-semibold text-blue-700 hover:text-blue-800">
        <ArrowLeft className="w-4 h-4" />Back to Invoices
      </button>

      <div>
        <h1 className="text-lg font-bold text-slate-800">New GST Invoice</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {step === 'select'
            ? 'Select a customer to see their invoice number, then continue to add working days.'
            : 'Add working-day entries below - nothing is saved until you click Capture Trip.'}
        </p>
      </div>

      {step === 'select' ? (
        <div className="bg-white border border-slate-200 rounded-xl p-4 max-w-xl">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-3">Select Customer</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Customer" required>
              <SearchableSelect
                value={customerId}
                onChange={setCustomerId}
                options={customers.map(c => ({ value: c.id, label: c.name }))}
                placeholder="Select customer"
                disabled={!!activeInvoice}
              />
            </Field>
            <Field label="Place of Work">
              <input type="text" className={inputClass()} value={placeOfWork} onChange={e => setPlaceOfWork(e.target.value)} placeholder="Optional" disabled={!!activeInvoice} />
            </Field>
          </div>
          {selectedCustomer && (
            <div className="mt-3 p-3 bg-blue-50 border border-blue-100 rounded-lg grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-slate-500">Name: </span><span className="font-medium text-slate-800">{selectedCustomer.name}</span></div>
              <div><span className="text-slate-500">GSTIN: </span><span className="font-medium">{selectedCustomer.gstin ?? '-'}</span></div>
              <div><span className="text-slate-500">Address: </span><span className="font-medium">{selectedCustomer.address ?? '-'}</span></div>
              <div><span className="text-slate-500">State: </span><span className="font-medium">{selectedCustomer.state ?? '-'}</span></div>
              <div><span className="text-slate-500">Phone: </span><span className="font-medium">{selectedCustomer.phone ?? '-'}</span></div>
              <div><span className="text-slate-500">Email: </span><span className="font-medium">{selectedCustomer.email ?? '-'}</span></div>
              {invoiceNoDisplay && (
                <div className="col-span-2 pt-1 mt-1 border-t border-dashed border-blue-200">
                  <span className="text-slate-500">Invoice No: </span>
                  <span className="font-bold text-blue-700">{invoiceNoDisplay}</span>
                </div>
              )}
            </div>
          )}
          {availablePos.length > 0 && (
            <div className="mt-3">
              <Field label="Select PO Number (Optional)" hint="This customer has an Active Purchase Order. Selecting one will deduct this invoice's taxable amount from its remaining balance after saving.">
                <SearchableSelect
                  value={selectedPoId}
                  onChange={setSelectedPoId}
                  options={[{ value: '', label: 'No PO - invoice as usual' }, ...availablePos.map(p => ({ value: p.id, label: `${p.po_number} - ${formatDate(p.po_date)} - ${formatCurrency(p.grand_total)} - Remaining ${formatCurrency(p.remaining_amount)}` }))]}
                  placeholder="No PO - invoice as usual"
                  disabled={!!activeInvoice}
                />
              </Field>
            </div>
          )}
          <div className="flex justify-end mt-4">
            <Button onClick={goToEntries} disabled={!customerId}>
              Continue<ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      ) : (
        <>
          <button onClick={() => setStep('select')} className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-700">
            <ArrowLeft className="w-4 h-4" />Back
          </button>

          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Customer Information</p>
              <div className="flex items-center gap-2">
                {selectedPo && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-100">
                    PO: {selectedPo.po_number} (Remaining {formatCurrency(selectedPo.remaining_amount)})
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-100">
                  Invoice No: {invoiceNoDisplay || '-'}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
              <div><span className="text-slate-500">Name: </span><span className="font-semibold text-slate-800">{selectedCustomer?.name ?? activeInvoice?.customer_name}</span></div>
              <div><span className="text-slate-500">GSTIN: </span><span className="font-medium">{selectedCustomer?.gstin ?? activeInvoice?.customer_gstin ?? '-'}</span></div>
              <div><span className="text-slate-500">Address: </span><span className="font-medium">{selectedCustomer?.address ?? activeInvoice?.customer_address ?? '-'}</span></div>
              <div><span className="text-slate-500">State: </span><span className="font-medium">{selectedCustomer?.state ?? '-'}</span></div>
              <div><span className="text-slate-500">Phone: </span><span className="font-medium">{selectedCustomer?.phone ?? activeInvoice?.customer_phone ?? '-'}</span></div>
              <div><span className="text-slate-500">Email: </span><span className="font-medium">{selectedCustomer?.email ?? activeInvoice?.customer_email ?? '-'}</span></div>
              <div><span className="text-slate-500">Place of Work: </span><span className="font-medium">{placeOfWork || '-'}</span></div>
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{editingLineId ? 'Edit Billing Entry' : 'Add Billing Entry'}</p>
              {editingLineId && <button onClick={resetEntryForm} className="text-xs font-semibold text-slate-500 hover:text-slate-700 flex items-center gap-1"><X className="w-3.5 h-3.5" />Cancel edit</button>}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 items-end">
              <Field label="Working Date" required>
                <DatePicker value={entDate} onChange={setEntDate} />
              </Field>
              <div className="lg:col-span-2">
                <Field label="Vehicle" required>
                  <SearchableSelect
                    value={entVehicleId}
                    onChange={setEntVehicleId}
                    options={vehicles.map(v => ({ value: v.id, label: `${v.registration_number} - ${v.type}${v.tons ? ' ' + v.tons + ' Ton' : ''}` }))}
                    placeholder="Select vehicle"
                  />
                </Field>
              </div>
              <Field label="Ton / Type">
                <div className={classNames(inputClass(), 'bg-slate-100 text-slate-500')}>{selectedEntVehicle ? (selectedEntVehicle.type === 'JCB' ? 'JCB' : `${selectedEntVehicle.tons ?? '-'} Ton · Crane`) : '-'}</div>
              </Field>
              <Field label="Rate Type" required>
                <select className={inputClass()} value={entRateType} onChange={e => setEntRateType(e.target.value as PoRateType)}>
                  <option value="Hourly">Hourly</option>
                  <option value="Daily">Full Day</option>
                  <option value="Monthly">Monthly</option>
                </select>
              </Field>
              {entRateType === 'Hourly' ? (
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Hours"><input type="number" min="0" className={inputClass()} value={entHours} onChange={e => setEntHours(e.target.value)} placeholder="3" /></Field>
                  <Field label="Minutes"><input type="number" min="0" max="59" className={inputClass()} value={entMinutes} onChange={e => setEntMinutes(e.target.value)} placeholder="20" /></Field>
                </div>
              ) : entRateType === 'Daily' ? (
                <Field label="No. of Days" required>
                  <input type="number" min="1" step="1" className={inputClass()} value={entDays} onChange={e => setEntDays(e.target.value)} placeholder="1" />
                </Field>
              ) : (
                <Field label="Quantity (Months)" required>
                  <input type="number" min="0.01" step="0.01" className={inputClass()} value={entDays} onChange={e => setEntDays(e.target.value)} placeholder="1" />
                </Field>
              )}
            </div>

            {entVehicleId && entDate && (
              <div className="flex flex-wrap gap-4 mt-3 text-sm">
                {entCalc?.rateFound ? (
                  entRateType === 'Daily' ? (
                    <>
                      <span className="text-slate-500">No. of Days: <b className="text-slate-800">{entDaysNum}</b></span>
                      <span className="text-slate-500">Full Day Rate: <b className="text-slate-800">{formatCurrency(entCalc.firstRate)} / day</b></span>
                      <span className="text-emerald-700 font-semibold">Rental Amount: {formatCurrency(entCalc.rentalAmount)}</span>
                    </>
                  ) : entRateType === 'Monthly' ? (
                    <>
                      <span className="text-slate-500">Quantity: <b className="text-slate-800">{entDaysNum} month{entDaysNum === 1 ? '' : 's'}</b></span>
                      <span className="text-slate-500">Monthly Rate: <b className="text-slate-800">{formatCurrency(entCalc.firstRate)} / month</b></span>
                      <span className="text-emerald-700 font-semibold">Rental Amount: {formatCurrency(entCalc.rentalAmount)}</span>
                    </>
                  ) : (
                    <>
                      <span className="text-slate-500">1st Hr Rate: <b className="text-slate-800">{formatCurrency(entCalc.firstRate)}</b></span>
                      <span className="text-slate-500">2nd Hr Rate: <b className="text-slate-800">{formatCurrency(entCalc.secondRate)}</b></span>
                      <span className="text-slate-500">1st Hr Amt: <b className="text-slate-800">{formatCurrency(entCalc.firstAmt)}</b></span>
                      <span className="text-slate-500">2nd Hr Amt: <b className="text-slate-800">{formatCurrency(entCalc.secondAmt)}</b></span>
                      <span className="text-emerald-700 font-semibold">Total: {formatCurrency(entCalc.rentalAmount)}</span>
                    </>
                  )
                ) : (
                  <span className="text-red-600 font-semibold flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4" />
                    {entCalc?.reason === 'monthly_rate_missing'
                      ? 'Monthly rate not configured in Rate Master.'
                      : `No applicable rate found for this vehicle/ton/type${entRateType === 'Daily' ? ' (Full Day Rate)' : entRateType === 'Monthly' ? ' (Monthly Rate)' : ''} in Rate Master.`}
                  </span>
                )}
              </div>
            )}

            <div className="flex justify-end mt-3">
              <Button onClick={saveLine} disabled={!canSaveLine || savingLine}>
                {editingLineId ? <Pencil className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                {savingLine ? 'Saving...' : editingLineId ? 'Update Billing Entry' : (activeInvoice ? 'Add Billing Entry' : 'Capture Trip')}
              </Button>
            </div>
          </div>

          {activeInvoice && (
            <>
              <div className="overflow-x-auto border border-slate-200 rounded-xl bg-white">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-amber-50">
                      {['S.No', 'Description / Particulars', 'Vehicle No.', 'Qty / Tons', 'Rate', 'Amount', 'Action'].map((h, i) => (
                        <th key={i} className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-wide text-slate-700 border border-amber-100 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.length === 0 ? (
                      <tr><td colSpan={7} className="py-10 text-center text-slate-400">No billing entries added yet.</td></tr>
                    ) : lines.map((l, idx) => {
                      const isFullDay = l.rate_type === 'Daily';
                      const isJcb = l.vehicle_type === 'JCB';
                      const lineDays = Math.max(1, Number(l.days) || 1);
                      const particulars = isFullDay
                        ? `${formatDate(l.working_date)} - Full Day${lineDays > 1 ? ` × ${lineDays}` : ''}`
                        : `${formatDate(l.working_date)} - ${l.hours} Hr ${l.minutes} Min`;
                      const rateDisplay = isFullDay
                        ? `${formatCurrency(l.first_hour_rate)}${lineDays > 1 ? ` × ${lineDays}` : ''}`
                        : `${formatCurrency(l.first_hour_rate)} / ${formatCurrency(l.second_hour_rate)}`;
                      return (
                        <tr key={l.id} className={classNames(idx % 2 ? 'bg-slate-50' : 'bg-white', editingLineId === l.id && 'ring-2 ring-inset ring-blue-300')}>
                          <td className="border border-slate-100 px-2 py-1.5 text-center tabular-nums">{idx + 1}</td>
                          <td className="border border-slate-100 px-2 py-1.5 whitespace-nowrap">{particulars}</td>
                          <td className="border border-slate-100 px-2 py-1.5 text-center whitespace-nowrap">{l.vehicle_number}</td>
                          <td className="border border-slate-100 px-2 py-1.5 text-center tabular-nums">{isJcb ? 'JCB' : (l.ton ?? '-')}</td>
                          <td className="border border-slate-100 px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{rateDisplay}</td>
                          <td className="border border-slate-100 px-2 py-1.5 text-right tabular-nums font-bold">{formatCurrency(l.total_amount)}</td>
                          <td className="border border-slate-100 px-2 py-1.5 text-center whitespace-nowrap">
                            <button onClick={() => startEditLine(l)} className="p-1 text-slate-400 hover:text-blue-600 rounded" title="Edit"><Pencil className="w-3.5 h-3.5" /></button>
                            <button onClick={() => setDeleteLineId(l.id)} className="p-1 text-slate-400 hover:text-red-600 rounded" title="Remove"><Trash2 className="w-3.5 h-3.5" /></button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-1">Billed Date &amp; Tax Type</p>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Billed Date">
                        <DatePicker value={billDateDraft} onChange={setBillDateDraft} />
                      </Field>
                      <Field label="Tax Type">
                        <select className={inputClass()} value={gstType} onChange={e => setGstType(e.target.value as 'cgst_sgst' | 'igst' | 'no_tax')}>
                          <option value="cgst_sgst">SGST + CGST (9% + 9%, Intra-state)</option>
                          <option value="igst">IGST (18%, Inter-state)</option>
                          <option value="no_tax">No Tax</option>
                        </select>
                      </Field>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-1">Operator Batha</p>
                    <div className="flex items-center gap-2 mb-2">
                      <input type="checkbox" checked={operatorBathaEnabled} onChange={e => setOperatorBathaEnabled(e.target.checked)} />
                      <span className="text-sm text-slate-600">Apply Operator Batha</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Rate">
                        <input type="number" min="0" className={inputClass()} value={operatorBathaRate} onChange={e => setOperatorBathaRate(e.target.value)} disabled={!operatorBathaEnabled} placeholder="0.00" />
                      </Field>
                      <Field label="Quantity">
                        <input type="number" min="0" className={inputClass()} value={operatorBathaQuantity} onChange={e => setOperatorBathaQuantity(e.target.value)} disabled={!operatorBathaEnabled} placeholder="0" />
                      </Field>
                    </div>
                    {operatorBathaEnabled && (Number(operatorBathaRate) > 0 && Number(operatorBathaQuantity) > 0) && (
                      <p className="text-xs text-slate-500 mt-1.5">Amount: <b className="text-slate-700">{formatCurrency(round2((Number(operatorBathaRate) || 0) * (Number(operatorBathaQuantity) || 0)))}</b></p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-1">Charges</p>
                    <div className="grid grid-cols-1 gap-3">
                      <Field label="Up & Down Transportation Charges">
                        <div className="flex items-center gap-2">
                          <input type="checkbox" checked={upEnabled} onChange={e => setUpEnabled(e.target.checked)} />
                          <input type="number" className={inputClass()} value={upAmount} onChange={e => setUpAmount(e.target.value)} disabled={!upEnabled} placeholder="Amount" />
                        </div>
                      </Field>
                      <Field label="Additional Charges">
                        <div className="flex items-center gap-2">
                          <input type="checkbox" checked={additionalEnabled} onChange={e => setAdditionalEnabled(e.target.checked)} />
                          <input type="number" className={inputClass()} value={additionalAmount} onChange={e => setAdditionalAmount(e.target.value)} disabled={!additionalEnabled} placeholder="Amount" />
                          <input type="text" className={inputClass()} value={additionalDescription} onChange={e => setAdditionalDescription(e.target.value)} disabled={!additionalEnabled} placeholder="Description (optional)" />
                        </div>
                      </Field>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-1">Discount</p>
                    <div className="grid grid-cols-1 gap-3">
                      <Field label="Apply Discount">
                        <div className="flex items-center gap-2">
                          <input type="checkbox" checked={preTaxDiscountEnabled} onChange={e => setPreTaxDiscountEnabled(e.target.checked)} />
                          <input type="number" min="0" step="0.01" className={inputClass()} value={preTaxDiscountAmount} onChange={e => setPreTaxDiscountAmount(e.target.value)} disabled={!preTaxDiscountEnabled} placeholder="Discount Amount" />
                        </div>
                      </Field>
                    </div>
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Bill Summary</p>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between text-slate-500"><span>Total of Billing Entries</span><b className="text-slate-800 tabular-nums">{formatCurrency(totals.rentalSubtotal)}</b></div>
                    {totals.operatorBatha > 0 && <div className="flex justify-between text-slate-500"><span>Operator Batha</span><b className="text-slate-800 tabular-nums">{formatCurrency(totals.operatorBatha)}</b></div>}
                    {totals.up > 0 && <div className="flex justify-between text-slate-500"><span>Up &amp; Down Transportation Charges</span><b className="text-slate-800 tabular-nums">{formatCurrency(totals.up)}</b></div>}
                    {totals.additional > 0 && <div className="flex justify-between text-slate-500"><span>Additional Charges</span><b className="text-slate-800 tabular-nums">{formatCurrency(totals.additional)}</b></div>}
                    {totals.discount > 0 && <div className="flex justify-between text-red-600"><span>Discount</span><b className="tabular-nums">− {formatCurrency(totals.discount)}</b></div>}
                    <div className="flex justify-between pt-1.5 border-t border-dashed border-slate-200 text-slate-700"><span className="font-semibold">Taxable Amount</span><b className="tabular-nums">{formatCurrency(totals.taxable)}</b></div>
                    {gstType === 'cgst_sgst' && (
                      <>
                        <div className="flex justify-between text-slate-500"><span>SGST @ {SGST_PERCENT}%</span><b className="text-slate-800 tabular-nums">{formatCurrency(totals.sgstAmt)}</b></div>
                        <div className="flex justify-between text-slate-500"><span>CGST @ {CGST_PERCENT}%</span><b className="text-slate-800 tabular-nums">{formatCurrency(totals.cgstAmt)}</b></div>
                      </>
                    )}
                    {gstType === 'igst' && (
                      <div className="flex justify-between text-slate-500"><span>IGST @ {IGST_PERCENT}%</span><b className="text-slate-800 tabular-nums">{formatCurrency(totals.igstAmt)}</b></div>
                    )}
                    {gstType === 'no_tax' && (
                      <div className="flex justify-between text-slate-500"><span>Tax</span><b className="text-slate-800 tabular-nums">No Tax</b></div>
                    )}
                    <div className="flex justify-between pt-1.5 border-t border-dashed border-slate-200">
                      <span className="font-bold text-slate-700">Grand Total</span>
                      <span className="font-bold text-blue-700 tabular-nums">{formatCurrency(totals.grandTotal)}</span>
                    </div>
                  </div>
                  {/* Print/Excel intentionally not offered here - this is the
                      pre-generation entry screen. Both remain available on the
                      generated invoice via Customer Invoices' own Print/Excel
                      actions once Save Invoice has created it. */}
                  <div className="pt-1">
                    <Button onClick={saveInvoice} disabled={savingInvoice} className="w-full justify-center"><Save className="w-4 h-4" />{savingInvoice ? 'Saving...' : 'Save Invoice'}</Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}

      <ConfirmDialog
        open={!!deleteLineId}
        onClose={() => setDeleteLineId(null)}
        onConfirm={handleDeleteLine}
        title="Remove Working Day"
        message="This billing entry will be deleted permanently and totals will recalculate."
        confirmText="Remove"
        danger
      />

      <Modal
        open={!!poInsufficientWarning && !poRequestModalOpen}
        onClose={cancelInsufficientPoWarning}
        title="PO Balance Insufficient"
        size="sm"
        footer={<>
          <Button variant="secondary" onClick={cancelInsufficientPoWarning} disabled={savingInvoice}>Cancel</Button>
          <Button variant="outline" onClick={() => setPoRequestModalOpen(true)} disabled={savingInvoice}><Mail className="w-4 h-4" />Request New PO</Button>
          <Button onClick={confirmSaveDespiteInsufficientPo} disabled={savingInvoice}>{savingInvoice ? 'Saving...' : 'Continue'}</Button>
        </>}
      >
        {poInsufficientWarning && (
          <div className="space-y-3 text-sm">
            <p className="flex items-center gap-1.5 font-bold text-red-600"><AlertTriangle className="w-4 h-4" />PO BALANCE INSUFFICIENT</p>
            <div className="space-y-1.5 p-3 bg-red-50 border border-red-100 rounded-lg">
              <div className="flex justify-between"><span className="text-slate-500">Current PO Balance</span><b className="tabular-nums">{formatCurrency(poInsufficientWarning.headroom)}</b></div>
              <div className="flex justify-between"><span className="text-slate-500">Invoice Amount</span><b className="tabular-nums">{formatCurrency(poInsufficientWarning.invoiceAmount)}</b></div>
              <div className="flex justify-between pt-1.5 border-t border-dashed border-red-200"><span className="font-semibold text-red-700">Shortfall</span><b className="tabular-nums text-red-700">{formatCurrency(round2(poInsufficientWarning.invoiceAmount - poInsufficientWarning.headroom))}</b></div>
            </div>
            <p className="text-xs text-slate-500">
              This invoice has not been saved yet. Click Continue to save it in full — this amount will NOT be deducted from PO {poInsufficientWarning.po.po_number} because it exceeds the available balance. You can request an additional PO first, or Cancel to adjust the invoice or PO selection.
            </p>
          </div>
        )}
      </Modal>

      <PoRequestModal
        open={poRequestModalOpen}
        onClose={() => setPoRequestModalOpen(false)}
        customers={customers}
        initial={poInsufficientWarning ? {
          customerId: poInsufficientWarning.po.customer_id,
          poNumber: poInsufficientWarning.po.po_number,
          currentBalance: poInsufficientWarning.headroom,
          requiredInvoiceAmount: poInsufficientWarning.invoiceAmount,
        } : null}
      />
    </div>
  );
}
