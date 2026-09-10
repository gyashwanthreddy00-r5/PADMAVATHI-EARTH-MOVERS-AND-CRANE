import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/Toast';
import { Field, Button, inputClass, LoadingSpinner, ConfirmDialog } from '@/components/ui/common';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { DatePicker } from '@/components/ui/DatePicker';
import { formatCurrency, formatDate, todayISO, classNames, amountInWords, buildInvoiceLineDescription } from '@/lib/utils';
import { findRateMasterForVehicle } from '@/lib/rateLookup';
import { computeBillingLineAmounts, round2 } from '@/lib/gstBillingCalc';
import { printGstBillingData, exportGstBillingDataToExcel } from '@/lib/gstBillingExport';
import { Plus, Trash2, Pencil, AlertTriangle, ArrowLeft, Printer, Download, Save, X, ChevronRight } from 'lucide-react';
import type { Customer, RateMaster, InvoiceSettings, PoRateType, Vehicle, Invoice, InvoiceBillingLine } from '@/types';

type VehicleLite = Pick<Vehicle, 'id' | 'registration_number' | 'tons' | 'type' | 'capacity'>;
type Step = 'select' | 'entries';

const CGST_PERCENT = 9;
const SGST_PERCENT = 9;
const IGST_PERCENT = 18;

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
  const [entBatha, setEntBatha] = useState('');
  const [bathaTouched, setBathaTouched] = useState(false);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [savingLine, setSavingLine] = useState(false);
  const [deleteLineId, setDeleteLineId] = useState<string | null>(null);

  // Invoice Details - Invoice Number is auto-generated; Billed Date defaults to
  // today but can be changed, and can still be set later once the invoice exists.
  const [billDateDraft, setBillDateDraft] = useState(todayISO());
  const [gstType, setGstType] = useState<'cgst_sgst' | 'igst' | 'no_tax'>('cgst_sgst');
  const [upEnabled, setUpEnabled] = useState(false);
  const [upAmount, setUpAmount] = useState('');
  const [downEnabled, setDownEnabled] = useState(false);
  const [downAmount, setDownAmount] = useState('');
  const [additionalEnabled, setAdditionalEnabled] = useState(false);
  const [additionalAmount, setAdditionalAmount] = useState('');
  const [additionalDescription, setAdditionalDescription] = useState('');
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
    setUpEnabled(invoice.up_transportation_enabled);
    setUpAmount(invoice.up_transportation_amount ? String(invoice.up_transportation_amount) : '');
    setDownEnabled(invoice.down_transportation_enabled);
    setDownAmount(invoice.down_transportation_amount ? String(invoice.down_transportation_amount) : '');
    setAdditionalEnabled(invoice.additional_charges_enabled ?? false);
    setAdditionalAmount(invoice.additional_charges_amount ? String(invoice.additional_charges_amount) : '');
    setAdditionalDescription(invoice.additional_charges_description ?? '');
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
    setEntBatha(''); setBathaTouched(false);
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
    setEntBatha(String(Number(l.batha) || 0));
    setBathaTouched(true);
  }

  const selectedEntVehicle = entVehicleId ? vehiclesById.get(entVehicleId) ?? null : null;
  const entRate = (entDate && entVehicleId) ? rateFor(entVehicleId, entDate) : null;
  const entDaysNum = Math.max(1, Number(entDays) || 1);
  const entCalc = (entDate && entVehicleId)
    ? computeBillingLineAmounts(entRateType, entRateType === 'Daily' ? 0 : Number(entHours) || 0, entRateType === 'Daily' ? 0 : Number(entMinutes) || 0, entRate, entDaysNum)
    : null;
  const canSaveLine = !!(entDate && entVehicleId && (entRateType === 'Daily' ? Number(entDays) > 0 : (entHours !== '' || entMinutes !== '')) && entCalc?.rateFound);
  const entBathaNum = Number(entBatha) || 0;
  // For Full Day entries, entBatha is the PER-DAY Batha rate (auto-filled from Rate
  // Master) — the total Batha amount scales with No. of Days, same as Rental Amount.
  // Hourly entries keep entBatha as a single flat amount for the entry, unchanged.
  const entBathaAmount = entRateType === 'Daily' ? round2(entBathaNum * entDaysNum) : entBathaNum;
  const entTotalWithBatha = (entCalc?.rentalAmount ?? 0) + entBathaAmount;

  // Batha auto-fills from Rate Master whenever the resolved rate changes,
  // but only until the user edits it by hand for this specific entry.
  useEffect(() => {
    if (!bathaTouched) setEntBatha(entRate ? String(Number(entRate.batha) || 0) : '');
  }, [entRate?.id, entRate?.batha, bathaTouched]);

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

    const hours = entRateType === 'Daily' ? 0 : Number(entHours) || 0;
    const minutes = entRateType === 'Daily' ? 0 : Number(entMinutes) || 0;
    const days = entRateType === 'Daily' ? entDaysNum : 1;
    // batha stays the RATE (per-day for Full Day, flat for Hourly — unchanged);
    // entBathaAmount is the days-scaled total actually billed for this line.
    const batha = entBathaNum;
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
      batha,
      total_amount: round2((entCalc.rentalAmount ?? 0) + entBathaAmount),
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
    const down = downEnabled ? Number(downAmount) || 0 : 0;
    const additional = additionalEnabled ? Number(additionalAmount) || 0 : 0;
    const taxable = round2(rentalSubtotal + up + down + additional);
    const cgstAmt = gstType === 'cgst_sgst' ? round2(taxable * CGST_PERCENT / 100) : 0;
    const sgstAmt = gstType === 'cgst_sgst' ? round2(taxable * SGST_PERCENT / 100) : 0;
    const igstAmt = gstType === 'igst' ? round2(taxable * IGST_PERCENT / 100) : 0;
    const totalGst = round2(cgstAmt + sgstAmt + igstAmt);
    const grandTotal = round2(taxable + totalGst);
    const gstLabel = gstType === 'cgst_sgst' ? `GST (CGST ${CGST_PERCENT}% + SGST ${SGST_PERCENT}%)` : gstType === 'igst' ? `GST (IGST ${IGST_PERCENT}%)` : 'No Tax';
    return { totalHours, rentalSubtotal, up, down, additional, taxable, cgstAmt, sgstAmt, igstAmt, totalGst, grandTotal, gstLabel };
  }, [lines, upEnabled, upAmount, downEnabled, downAmount, additionalEnabled, additionalAmount, gstType]);

  /** Recomputes and persists totals + rebuilds invoice_items - called after every line add/edit/delete and from Save Invoice. Returns whether the invoice row itself was saved successfully. */
  async function syncInvoiceTotals(currentLines: InvoiceBillingLine[], opts?: { billDate?: string | null; finalize?: boolean }, invoiceOverride?: Invoice): Promise<boolean> {
    const invoice = invoiceOverride ?? activeInvoice;
    if (!invoice) return false;
    const totalHours = round2(currentLines.reduce((s, l) => s + l.hours + l.minutes / 60, 0));
    const rentalSubtotal = round2(currentLines.reduce((s, l) => s + l.total_amount, 0));
    const up = upEnabled ? Number(upAmount) || 0 : 0;
    const down = downEnabled ? Number(downAmount) || 0 : 0;
    const additional = additionalEnabled ? Number(additionalAmount) || 0 : 0;
    const taxable = round2(rentalSubtotal + up + down + additional);
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
      down_transportation_enabled: down > 0, down_transportation_amount: down,
      additional_charges_enabled: additional > 0, additional_charges_amount: additional,
      additional_charges_description: additionalDescription.trim() || null,
      invoice_status: (opts?.finalize && billDate) ? 'Generated' as const : invoice.invoice_status,
    };
    const { error: updErr } = await supabase.from('invoices').update(updatePayload).eq('id', invoice.id);
    if (updErr) { show(updErr.message, 'error'); return false; }
    setActiveInvoice({ ...invoice, ...updatePayload });

    // Rebuild invoice_items from scratch so Print/PDF/email always reflect current lines
    await supabase.from('invoice_items').delete().eq('invoice_id', invoice.id);
    const hsnSac = invoiceSettings?.hsn_sac || '997319';
    const items: { invoice_id: string; sl_no: number; description: string; hsn_sac: string; quantity: number; rate: number; unit: string; amount: number; batha: number; calculation_details: string }[] = [];
    currentLines.forEach(l => {
      if (l.rate_type !== 'Daily') {
        // Hourly — completely unchanged: single combined line (rental + its flat Batha).
        const { description, calculation_details } = buildInvoiceLineDescription({
          rate_type: l.rate_type,
          total_hours: l.hours + l.minutes / 60,
          rental_amount: l.total_amount,
          trip_date: l.working_date,
          work_date: l.working_date,
          place_of_work: placeOfWork.trim() || '',
          capacity_tons: l.ton != null ? String(l.ton) : null,
          first_hour_rate: l.first_hour_rate,
          second_hour_rate: l.second_hour_rate,
          weekly_rate_snapshot: null,
          daily_rate_snapshot: null,
          monthly_rate_snapshot: null,
          vehicle: { registration_number: l.vehicle_number, type: l.vehicle_type, capacity: l.ton },
        });
        items.push({
          invoice_id: invoice.id, sl_no: items.length + 1, description,
          hsn_sac: hsnSac, quantity: 1, rate: l.total_amount,
          unit: 'nos', amount: l.total_amount, batha: 0,
          calculation_details,
        });
        return;
      }

      // Full Day: Rental Amount = No. of Days x per-day Rate (the Rate itself is never
      // multiplied/changed) and, when Batha applies, a separate "OPERATOR BATHA" line of
      // Quantity = No. of Days x per-day Batha rate — the same rental/batha split the
      // app already uses for the old Invoices flow's combined Operator Batha line (see
      // invoiceCalc.ts), just per line instead of per invoice.
      const days = Math.max(1, Number(l.days) || 1);
      const dayRate = Number(l.first_hour_rate) || 0;
      const bathaPerDay = Number(l.batha) || 0;
      const rentalAmount = round2(dayRate * days);
      const bathaAmount = round2(bathaPerDay * days);

      const { description, calculation_details } = buildInvoiceLineDescription({
        rate_type: l.rate_type,
        total_hours: 0,
        rental_amount: rentalAmount,
        trip_date: l.working_date,
        work_date: l.working_date,
        place_of_work: placeOfWork.trim() || '',
        capacity_tons: l.ton != null ? String(l.ton) : null,
        first_hour_rate: l.first_hour_rate,
        second_hour_rate: l.second_hour_rate,
        weekly_rate_snapshot: null,
        daily_rate_snapshot: l.first_hour_rate,
        monthly_rate_snapshot: null,
        vehicle: { registration_number: l.vehicle_number, type: l.vehicle_type, capacity: l.ton },
      });

      items.push({
        invoice_id: invoice.id, sl_no: items.length + 1, description,
        hsn_sac: hsnSac, quantity: days, rate: dayRate,
        unit: 'day', amount: rentalAmount, batha: 0,
        calculation_details,
      });
      if (bathaAmount > 0) {
        items.push({
          invoice_id: invoice.id, sl_no: items.length + 1, description: 'OPERATOR BATHA',
          hsn_sac: hsnSac, quantity: days, rate: bathaPerDay,
          unit: 'day', amount: bathaAmount, batha: bathaAmount,
          calculation_details: `Operator Batha: ${days} day${days > 1 ? 's' : ''} x ${formatCurrency(bathaPerDay)} = ${formatCurrency(bathaAmount)}`,
        });
      }
    });
    if (up > 0) {
      items.push({ invoice_id: invoice.id, sl_no: items.length + 1, description: 'UP TRANSPORTATION CHARGES', hsn_sac: invoiceSettings?.hsn_sac || '997319', quantity: 1, rate: up, unit: 'nos', amount: up, batha: 0, calculation_details: `UP Transportation: ${formatCurrency(up)}` });
    }
    if (down > 0) {
      items.push({ invoice_id: invoice.id, sl_no: items.length + 1, description: 'DOWN TRANSPORTATION CHARGES', hsn_sac: invoiceSettings?.hsn_sac || '997319', quantity: 1, rate: down, unit: 'nos', amount: down, batha: 0, calculation_details: `DOWN Transportation: ${formatCurrency(down)}` });
    }
    if (additional > 0) {
      items.push({ invoice_id: invoice.id, sl_no: items.length + 1, description: additionalDescription.trim() || 'ADDITIONAL CHARGES', hsn_sac: invoiceSettings?.hsn_sac || '997319', quantity: 1, rate: additional, unit: 'nos', amount: additional, batha: 0, calculation_details: `Additional Charges: ${formatCurrency(additional)}` });
    }
    if (items.length > 0) {
      const { error: itemsErr } = await supabase.from('invoice_items').insert(items);
      if (itemsErr) show(itemsErr.message, 'error');
    }
    return true;
  }

  async function saveInvoice() {
    if (!activeInvoice) return;
    if (lines.length === 0) { show('Please add at least one billing entry before saving the invoice.', 'error'); return; }
    setSavingInvoice(true);
    const saved = await syncInvoiceTotals(lines, { billDate: billDateDraft || null, finalize: true });
    setSavingInvoice(false);
    if (!saved) return;
    show('Invoice saved.', 'success');
    onDone();
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
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-100">
                Invoice No: {invoiceNoDisplay || '-'}
              </span>
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
              <Field label="Vehicle" required>
                <SearchableSelect
                  value={entVehicleId}
                  onChange={v => { setEntVehicleId(v); setBathaTouched(false); }}
                  options={vehicles.map(v => ({ value: v.id, label: `${v.registration_number} - ${v.type}${v.tons ? ' ' + v.tons + ' Ton' : ''}` }))}
                  placeholder="Select vehicle"
                />
              </Field>
              <Field label="Ton / Type">
                <div className={classNames(inputClass(), 'bg-slate-100 text-slate-500')}>{selectedEntVehicle ? (selectedEntVehicle.type === 'JCB' ? 'JCB' : `${selectedEntVehicle.tons ?? '-'} Ton · Crane`) : '-'}</div>
              </Field>
              <Field label="Rate Type" required>
                <select className={inputClass()} value={entRateType} onChange={e => setEntRateType(e.target.value as PoRateType)}>
                  <option value="Hourly">Hourly</option>
                  <option value="Daily">Full Day</option>
                </select>
              </Field>
              {entRateType === 'Hourly' ? (
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Hours"><input type="number" min="0" className={inputClass()} value={entHours} onChange={e => setEntHours(e.target.value)} placeholder="3" /></Field>
                  <Field label="Minutes"><input type="number" min="0" max="59" className={inputClass()} value={entMinutes} onChange={e => setEntMinutes(e.target.value)} placeholder="20" /></Field>
                </div>
              ) : (
                <Field label="No. of Days" required>
                  <input type="number" min="1" step="1" className={inputClass()} value={entDays} onChange={e => setEntDays(e.target.value)} placeholder="1" />
                </Field>
              )}
              <Field label="Batha">
                <input type="number" min="0" className={inputClass()} value={entBatha} onChange={e => { setEntBatha(e.target.value); setBathaTouched(true); }} placeholder="0" />
              </Field>
            </div>

            {entVehicleId && entDate && (
              <div className="flex flex-wrap gap-4 mt-3 text-sm">
                {entCalc?.rateFound ? (
                  entRateType === 'Daily' ? (
                    <>
                      <span className="text-slate-500">No. of Days: <b className="text-slate-800">{entDaysNum}</b></span>
                      <span className="text-slate-500">Full Day Rate: <b className="text-slate-800">{formatCurrency(entCalc.firstRate)} / day</b></span>
                      <span className="text-slate-500">Rental Amount: <b className="text-slate-800">{formatCurrency(entCalc.rentalAmount)}</b></span>
                      <span className="text-slate-500">Batha: <b className="text-slate-800">{formatCurrency(entBathaNum)} / day</b></span>
                      <span className="text-slate-500">Batha Amount: <b className="text-slate-800">{formatCurrency(entBathaAmount)}</b></span>
                      <span className="text-emerald-700 font-semibold">Total: {formatCurrency(entTotalWithBatha)}</span>
                    </>
                  ) : (
                    <>
                      <span className="text-slate-500">1st Hr Rate: <b className="text-slate-800">{formatCurrency(entCalc.firstRate)}</b></span>
                      <span className="text-slate-500">2nd Hr Rate: <b className="text-slate-800">{formatCurrency(entCalc.secondRate)}</b></span>
                      <span className="text-slate-500">1st Hr Amt: <b className="text-slate-800">{formatCurrency(entCalc.firstAmt)}</b></span>
                      <span className="text-slate-500">2nd Hr Amt: <b className="text-slate-800">{formatCurrency(entCalc.secondAmt)}</b></span>
                      <span className="text-slate-500">Batha: <b className="text-slate-800">{formatCurrency(entBathaNum)}</b></span>
                      <span className="text-emerald-700 font-semibold">Total: {formatCurrency(entTotalWithBatha)}</span>
                    </>
                  )
                ) : (
                  <span className="text-red-600 font-semibold flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" />No applicable rate found for this vehicle/ton/type{entRateType === 'Daily' ? ' (Full Day Rate)' : ''} in Rate Master.</span>
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
                      const lineBathaTotal = isFullDay ? round2((Number(l.batha) || 0) * lineDays) : (Number(l.batha) || 0);
                      return (
                        <tr key={l.id} className={classNames(idx % 2 ? 'bg-slate-50' : 'bg-white', editingLineId === l.id && 'ring-2 ring-inset ring-blue-300')}>
                          <td className="border border-slate-100 px-2 py-1.5 text-center tabular-nums">{idx + 1}</td>
                          <td className="border border-slate-100 px-2 py-1.5 whitespace-nowrap">{particulars}</td>
                          <td className="border border-slate-100 px-2 py-1.5 text-center whitespace-nowrap">{l.vehicle_number}</td>
                          <td className="border border-slate-100 px-2 py-1.5 text-center tabular-nums">{isJcb ? 'JCB' : (l.ton ?? '-')}</td>
                          <td className="border border-slate-100 px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{rateDisplay}{lineBathaTotal > 0 && <span className="block text-[11px] text-slate-400">+ Batha {formatCurrency(lineBathaTotal)}{isFullDay && lineDays > 1 ? ` (${formatCurrency(l.batha)} × ${lineDays})` : ''}</span>}</td>
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
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-1">Charges</p>
                    <div className="grid grid-cols-1 gap-3">
                      <Field label="Up Transportation">
                        <div className="flex items-center gap-2">
                          <input type="checkbox" checked={upEnabled} onChange={e => setUpEnabled(e.target.checked)} />
                          <input type="number" className={inputClass()} value={upAmount} onChange={e => setUpAmount(e.target.value)} disabled={!upEnabled} placeholder="Amount" />
                        </div>
                      </Field>
                      <Field label="Down Transportation">
                        <div className="flex items-center gap-2">
                          <input type="checkbox" checked={downEnabled} onChange={e => setDownEnabled(e.target.checked)} />
                          <input type="number" className={inputClass()} value={downAmount} onChange={e => setDownAmount(e.target.value)} disabled={!downEnabled} placeholder="Amount" />
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
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Bill Summary</p>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between text-slate-500"><span>Total of Billing Entries</span><b className="text-slate-800 tabular-nums">{formatCurrency(totals.rentalSubtotal)}</b></div>
                    {totals.up > 0 && <div className="flex justify-between text-slate-500"><span>Up Transportation</span><b className="text-slate-800 tabular-nums">{formatCurrency(totals.up)}</b></div>}
                    {totals.down > 0 && <div className="flex justify-between text-slate-500"><span>Down Transportation</span><b className="text-slate-800 tabular-nums">{formatCurrency(totals.down)}</b></div>}
                    {totals.additional > 0 && <div className="flex justify-between text-slate-500"><span>Additional Charges</span><b className="text-slate-800 tabular-nums">{formatCurrency(totals.additional)}</b></div>}
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
    </div>
  );
}
