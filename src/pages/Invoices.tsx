import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useLang } from '@/context/LangContext';
import { useToast } from '@/components/ui/Toast';
import { useSettings } from '@/context/SettingsContext';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Modal, ConfirmDialog, StatusBadge, Button, Field, inputClass, LoadingSpinner } from '@/components/ui/common';
import {
  Plus, Printer, Eye, FileText,
  CheckCircle2, ArrowLeft, IndianRupee, X, Trash2,
  Search, Mail, Zap, ChevronRight, FileEdit, Bell, Send, Clock, AlertCircle,
} from 'lucide-react';
import {
  formatCurrency, formatDate, amountInWords, todayISO, buildInvoiceLineDescription, classNames, addDays,
} from '@/lib/utils';
import { invoiceDocHTML, type PrintCopyType, type InvoiceDocType } from '@/components/InvoiceDocument';
import { calculateDiscount, validateDiscountPercentage, round2 } from '@/lib/discountCalc';
import { findRateMasterForVehicle } from '@/lib/rateLookup';
import { useAuth } from '@/context/AuthContext';
import { TripEntryForm, type MultiVehicleTripFormData, type VehicleEntryData } from '@/components/TripEntryForm';
import GstBillingEntry from '@/pages/GstBillingEntry';
import { DatePicker } from '@/components/ui/DatePicker';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import {
  computeReminderRows, buildReminderTemplateVars, replaceReminderVars, getReminderEmailErrorMessage,
  type ReminderRowData,
} from '@/lib/reminderCalc';
import type {
  InvoiceWithRelations, InvoiceItem, InvoicePayment,
  Customer, InvoiceSettings, InvoiceStatus, RateMaster, VehicleType, Vehicle,
  InvoiceReminder, ReminderSettings,
} from '@/types';

type Step = 'list' | 'step1' | 'step2';

interface InvoicesProps {
  initialTab?: Step;
}

/** Shared by both Full Statement (all of a customer's invoices in the selected
 * date/status filter) and Balance Statement (this customer's outstanding invoices
 * only) — one mapping, not two, so their numbers can never drift apart. */
function toStatementRow(inv: InvoiceWithRelations) {
  const payable = inv.discount_enabled ? Number(inv.final_payable_amount ?? inv.grand_total) : Number(inv.grand_total);
  const received = Number(inv.amount_received) || 0;
  const balance = Math.max(0, Math.round((payable - received) * 100) / 100);
  // Received Date comes from the actual invoice_payments transactions — never from
  // invoice/billed/generated/today's date. Sorted oldest-first; an invoice with several
  // part-payments shows every distinct date it actually received money on.
  const paymentDates = Array.from(new Set((inv.payments ?? []).map(p => p.payment_date))).sort();
  const receivedDateLabel = paymentDates.length === 0 ? '—' : paymentDates.map(d => formatDate(d)).join(', ');
  return { inv, payable, received, balance, paymentDates, receivedDateLabel };
}

type StatementRow = ReturnType<typeof toStatementRow>;

function computeStatementTotals(rows: StatementRow[]) {
  return {
    count: rows.length,
    totalAmount: rows.reduce((s, r) => s + r.payable, 0),
    totalReceived: rows.reduce((s, r) => s + r.received, 0),
    totalPending: rows.reduce((s, r) => s + r.balance, 0),
    paidCount: rows.filter(r => r.balance <= 0).length,
    partialCount: rows.filter(r => r.received > 0 && r.balance > 0).length,
    unpaidCount: rows.filter(r => r.received <= 0).length,
  };
}

function getEmailErrorMessage(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes('testing emails') || normalized.includes('verify a domain') || normalized.includes('testing mode')) {
    return 'Email delivery is still in testing mode. A sending domain must be verified before invoices can be sent to customers.';
  }
  return message;
}

// Some older invoice_vehicles rows don't carry a snapshot of the hourly
// rate (first_hour_rate / second_hour_rate are 0/null) even though the
// rental amount was correctly billed. When that happens, look up the
// applicable Rate Master record so the printed/viewed/emailed invoice can
// still show the "1st Hr + N Hr + Min" breakdown instead of collapsing to
// a flat "Full Day Amt" line. This only fills in-memory display fields -
// it never writes back to the database.
function fillMissingHourlyRatesFromRateMaster(
  invoicesData: InvoiceWithRelations[],
  rateMasterRates: RateMaster[],
): InvoiceWithRelations[] {
  if (rateMasterRates.length === 0) return invoicesData;
  return invoicesData.map(inv => {
    const invoiceVehicles = inv.invoiceVehicles;
    if (!invoiceVehicles || invoiceVehicles.length === 0) return inv;
    let changed = false;
    const updatedVehicles = invoiceVehicles.map(iv => {
      const rateType = iv.rate_type ?? 'Hourly';
      const hasRates = (Number(iv.first_hour_rate) || 0) > 0 || (Number(iv.second_hour_rate) || 0) > 0;
      if (rateType !== 'Hourly' || hasRates) return iv;
      const tripDate = iv.sessions?.[0]?.in_time || inv.trip_date || inv.invoice_date;
      const rm = findRateMasterForVehicle(
        { type: (iv.vehicle_type ?? iv.vehicle?.type ?? '') as VehicleType, capacity: iv.capacity_tons ?? iv.capacity },
        rateMasterRates,
        tripDate,
      );
      if (!rm) return iv;
      changed = true;
      return { ...iv, first_hour_rate: rm.first_hour_rate, second_hour_rate: rm.second_hour_rate };
    });
    return changed ? { ...inv, invoiceVehicles: updatedVehicles } : inv;
  });
}

function convertInvoiceToFormData(inv: InvoiceWithRelations): MultiVehicleTripFormData {
  const vehicles: VehicleEntryData[] = (inv.invoiceVehicles ?? []).map(v => ({
    vehicle_id: v.vehicle_id ?? '',
    vehicle_number: v.vehicle_number,
    vehicle_type: v.vehicle_type,
    vehicle_type_filter: (v.vehicle_type === 'JCB' ? 'JCB' : 'Crane') as VehicleEntryData['vehicle_type_filter'],
    vehicle_capacity: v.capacity,
    driver_id: v.driver_id ?? '',
    driver_name: v.driver_name,
    place_of_work: v.place_of_work ?? '',
    rate_type: (v.rate_type as VehicleEntryData['rate_type']) ?? 'Hourly',
    tons: v.capacity_tons ?? '',
    sessions: (v.sessions ?? []).map(s => ({
      in_time: s.in_time ? s.in_time.slice(0, 16) : null,
      out_time: s.out_time ? s.out_time.slice(0, 16) : null,
      opening_hour_meter: s.opening_hour_meter ?? null,
      closing_hour_meter: s.closing_hour_meter ?? null,
      remarks: s.remarks ?? '',
    })),
    batha: Number(v.batha) || 0,
    total_hours: Number(v.total_hours) || 0,
    rental_amount: Number(v.rental_amount) || 0,
    total_amount: Number(v.vehicle_total) || 0,
    rate_master_id: v.rate_master_id,
    rate_version: v.rate_version,
    capacity_tons: v.capacity_tons,
    first_hour_rate: v.first_hour_rate,
    second_hour_rate: v.second_hour_rate,
    third_hour_rate_snapshot: v.third_hour_rate_snapshot,
    fourth_hour_rate_snapshot: v.fourth_hour_rate_snapshot,
    fifth_hour_rate_snapshot: v.fifth_hour_rate_snapshot,
    weekly_rate_snapshot: v.weekly_rate_snapshot,
    daily_rate_snapshot: v.daily_rate_snapshot,
    monthly_rate_snapshot: v.monthly_rate_snapshot,
    batha_snapshot: v.batha_snapshot,
  }));
  if (vehicles.length > 0 && (!vehicles[0].sessions || vehicles[0].sessions.length === 0)) {
    vehicles[0].sessions = [{ in_time: null, out_time: null, opening_hour_meter: null, closing_hour_meter: null, remarks: '' }];
  }
  return {
    trip_date: inv.trip_date ?? inv.invoice_date,
    place_of_work: inv.place_of_work ?? '',
    customer_id: inv.customer_id,
    vehicles,
    up_transportation_enabled: inv.up_transportation_enabled ?? false,
    up_transportation_amount: Number(inv.up_transportation_amount) || 0,
    down_transportation_enabled: inv.down_transportation_enabled ?? false,
    down_transportation_amount: Number(inv.down_transportation_amount) || 0,
    remarks: inv.remarks ?? null,
    total_hours: Number(inv.total_hours) || 0,
    total_amount: Number(inv.grand_total) || 0,
    total_batha: Number(inv.batha) || 0,
    total_rental: Number(inv.rate) || 0,
  };
}

export default function Invoices({ initialTab = 'list' }: InvoicesProps = {}) {
  const { t } = useLang();
  const { show } = useToast();
  const { settings } = useSettings();
  const { isAdmin } = useAuth();
  const [step, setStep] = useState<Step>(initialTab);
  const [showNewGstFlow, setShowNewGstFlow] = useState(false);
  const [resumeGstInvoiceId, setResumeGstInvoiceId] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<InvoiceWithRelations[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoiceSettings, setInvoiceSettings] = useState<InvoiceSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewInvoice, setViewInvoice] = useState<InvoiceWithRelations | null>(null);
  const [viewItems, setViewItems] = useState<InvoiceItem[]>([]);
  const [viewPayments, setViewPayments] = useState<InvoicePayment[]>([]);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Record Company Payment — customer-wise, not invoice-wise. Clicking the ₹ button on
  // any of a customer's invoices opens this with that customer's full outstanding
  // invoice list (oldest first); saving auto-allocates the amount across them FIFO
  // (see recordCompanyPayment) instead of asking which invoice to pay.
  const [companyPaymentModal, setCompanyPaymentModal] = useState<{ customerId: string; customerName: string; outstandingInvoices: StatementRow[]; totalOutstanding: number } | null>(null);
  const [recordingCompanyPayment, setRecordingCompanyPayment] = useState(false);
  const [companyPaymentForm, setCompanyPaymentForm] = useState({ amount: null as number | null, payment_date: todayISO(), reference: '', remarks: '' });
  const [invoiceSearch, setInvoiceSearch] = useState('');
  // Click-to-open list of vehicles for a multi-vehicle invoice row - stores that
  // row's invoice id, or null when no popup is open. Closed by any outside click.
  const [vehiclesPopupId, setVehiclesPopupId] = useState<string | null>(null);
  useEffect(() => {
    if (!vehiclesPopupId) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.vehicles-popup-trigger')) setVehiclesPopupId(null);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [vehiclesPopupId]);
  const [customerSearchMode, setCustomerSearchMode] = useState<'invoice' | 'customer'>('invoice');
  const [emailSending, setEmailSending] = useState(false);
  const [printCopyModal, setPrintCopyModal] = useState<InvoiceWithRelations | null>(null);
  const [printCopyItems, setPrintCopyItems] = useState<InvoiceItem[]>([]);
  const [printDocType, setPrintDocType] = useState<InvoiceDocType>('tax');

  // Edit Invoice Details (top-right print block: delivery note, reference, buyer's order,
  // dispatch, destination, vehicle list, terms of delivery, etc.)
  const [editDetailsModal, setEditDetailsModal] = useState<InvoiceWithRelations | null>(null);
  const [editDetailsForm, setEditDetailsForm] = useState({
    delivery_note: '', terms_of_payment: '', reference_no: '', reference_date: '',
    buyer_order_no: '', buyer_order_date: '', dispatch_doc_no: '', delivery_note_date: '',
    dispatched_through: '', destination: '', bill_of_lading_no: '', motor_vehicle_numbers: '',
    terms_of_delivery_days: 28,
  });
  const [savingDetails, setSavingDetails] = useState(false);

  // Capture Trip state
  const [capturing, setCapturing] = useState(false);
  const [generateInvoiceModal, setGenerateInvoiceModal] = useState<InvoiceWithRelations | null>(null);
  const [generateInvoiceDate, setGenerateInvoiceDate] = useState(todayISO());
  const [generatingInvoiceNo, setGeneratingInvoiceNo] = useState(false);

  // Step 1 state
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [referenceNo, setReferenceNo] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [invoiceSelection, setInvoiceSelection] = useState<'cgst_sgst' | 'igst'>('cgst_sgst');
  const [previewInvoiceNo, setPreviewInvoiceNo] = useState('');

  // Step 2 state
  const [addGst, setAddGst] = useState(true);
  const [gstType, setGstType] = useState<'cgst_sgst' | 'igst'>('cgst_sgst');
  const [cgstPercent, setCgstPercent] = useState(9);
  const [sgstPercent, setSgstPercent] = useState(9);
  const [igstPercent, setIgstPercent] = useState(18);
  const [remarks, setRemarks] = useState('Being hire charges of crane and JCB.');
  const [discountEnabled, setDiscountEnabled] = useState(false);
  const [discountPercent, setDiscountPercent] = useState(0);
  // Kept in state (not just a fetchAll-local var) so print/view/email can pass them into
  // invoiceDocHTML for the live Rate Master fallback on legacy lines with no captured
  // rate snapshot at all (see liveHourlyRateLabel in invoiceDocData.ts).
  const [rateMasterRows, setRateMasterRows] = useState<RateMaster[]>([]);
  const [vehiclesList, setVehiclesList] = useState<Pick<Vehicle, 'registration_number' | 'type' | 'capacity'>[]>([]);

  // Customer Statement - bank-statement-style view of one customer's invoices, built
  // entirely from the invoices already loaded via FULL_INVOICE_SELECT (amount_received
  // is kept in sync by recordCompanyPayment, see openCompanyPayment/recordCompanyPayment
  // below - the same source the payment modal itself already trusts, so no separate
  // payments re-summing is needed here). Empty statementCustomerId means "not in
  // statement mode" - the existing flat invoice list/search below is shown unchanged
  // in that case.
  const [statementCustomerId, setStatementCustomerId] = useState('');
  const [statementFrom, setStatementFrom] = useState('');
  const [statementTo, setStatementTo] = useState('');
  const [statementStatus, setStatementStatus] = useState<'All' | 'Paid' | 'Partially Paid' | 'Pending' | 'Outstanding'>('All');
  const [sendingStatement, setSendingStatement] = useState(false);
  const [sendingFullStatement, setSendingFullStatement] = useState(false);

  // Send Balance Statement's "Also Send Invoices" toggle — OFF by default, so Send
  // Balance Statement sends only the balance statement sheet unless explicitly opted in.
  const [alsoSendInvoices, setAlsoSendInvoices] = useState(false);

  // Reminders — moved in from the old standalone Balance Reminders page (see
  // reminderCalc.ts). Data is loaded for all invoices in fetchAll; the rows shown here
  // are always filtered down to the selected statement customer (see
  // customerReminderRows below), so reminder info never leaks across customers.
  const [reminders, setReminders] = useState<InvoiceReminder[]>([]);
  const [reminderSettings, setReminderSettings] = useState<ReminderSettings | null>(null);
  const [reminderPreviewRow, setReminderPreviewRow] = useState<ReminderRowData | null>(null);
  const [reminderPreviewSubject, setReminderPreviewSubject] = useState('');
  const [reminderPreviewBody, setReminderPreviewBody] = useState('');
  const [sendingReminder, setSendingReminder] = useState(false);
  // "Payment Reminders" button reveals the Day 1/10/20 reminder options below it.
  const [showReminders, setShowReminders] = useState(false);

  // Date Quick Filter — defaults to 'Custom' with empty statementFrom/statementTo, which
  // is exactly the pre-existing "no date filter" behavior, so the default invoice list
  // is unchanged. 'Today'/'Yesterday' just drive the SAME statementFrom/statementTo state
  // the existing Date From/To pickers already filter on (see statementRows below) — no
  // separate filtering logic needed, so this can never drift from the existing inclusive
  // From/To range filter.
  type DateQuickFilter = 'Today' | 'Yesterday' | 'Custom';
  const [dateQuickFilter, setDateQuickFilter] = useState<DateQuickFilter>('Custom');

  function applyDateQuickFilter(option: DateQuickFilter) {
    setDateQuickFilter(option);
    // Local business date, not UTC — same todayISO()/addDays() helpers already used
    // everywhere else in the app (e.g. default Payment Date, invoice date defaults).
    if (option === 'Today') {
      const d = todayISO();
      setStatementFrom(d);
      setStatementTo(d);
    } else if (option === 'Yesterday') {
      const d = addDays(todayISO(), -1);
      setStatementFrom(d);
      setStatementTo(d);
    }
    // 'Custom' leaves statementFrom/statementTo exactly as they are — whatever the last
    // Today/Yesterday pick left them at, now editable via the Date From/To pickers.
  }

  const FULL_INVOICE_SELECT = '*, customer:customers!invoices_customer_id_fkey(*), items:invoice_items(*, trip:trips!invoice_items_trip_entry_id_fkey(id,rate_type,total_hours,rental_amount,trip_date,place_of_work,capacity_tons,first_hour_rate,second_hour_rate,weekly_rate_snapshot,daily_rate_snapshot,monthly_rate_snapshot,vehicle:vehicles!trips_vehicle_id_fkey(id,registration_number,type,capacity))), payments:invoice_payments(*), invoiceVehicles:invoice_vehicles(*, vehicle:vehicles!invoice_vehicles_vehicle_id_fkey(id,registration_number,type,capacity), driver:employees!invoice_vehicles_driver_id_fkey(id,name,role), sessions:invoice_vehicle_sessions(*)), billingLines:invoice_billing_lines(id)';

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [invRes, custRes, isRes, rateMasterRes, vehiclesRes, remRes, remSettingsRes] = await Promise.all([
      // Customer Invoices shows GST invoices and Monthly Full-Time Contract invoices —
      // Cash/UPI bills have their own page. Monthly Contract invoices were previously
      // excluded here entirely (this was a GST-only filter), which is why they never
      // appeared even though Contracts.tsx was already creating real invoice rows for
      // them (invoice_type = 'MONTHLY_CONTRACT').
      supabase
        .from('invoices')
        .select(FULL_INVOICE_SELECT)
        .in('invoice_type', ['GST', 'MONTHLY_CONTRACT'])
        .order('invoice_date', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase.from('customers').select('*').order('name'),
      supabase.from('invoice_settings').select('*').limit(1).maybeSingle(),
      supabase.from('rate_master').select('*').in('status', ['Active', 'Closed']),
      supabase.from('vehicles').select('registration_number,type,capacity'),
      // Moved in from the old standalone Balance Reminders page — Customer Statements
      // now surfaces this same reminder data, scoped per selected customer.
      supabase.from('invoice_reminders').select('*'),
      supabase.from('reminder_settings').select('*').limit(1).maybeSingle(),
    ]);
    if (invRes.error) show(t('error') + ': ' + invRes.error.message, 'error');
    const rawInvoices = (invRes.data ?? []) as unknown as InvoiceWithRelations[];
    const rateMasterRates = (rateMasterRes.data ?? []) as RateMaster[];
    setInvoices(fillMissingHourlyRatesFromRateMaster(rawInvoices, rateMasterRates));
    setCustomers(custRes.data ?? []);
    setInvoiceSettings(isRes.data as InvoiceSettings | null);
    setRateMasterRows(rateMasterRates);
    setVehiclesList((vehiclesRes.data ?? []) as Pick<Vehicle, 'registration_number' | 'type' | 'capacity'>[]);
    setReminders((remRes.data ?? []) as InvoiceReminder[]);
    setReminderSettings(remSettingsRes.data as ReminderSettings | null);
    setLoading(false);
  }, [show, t, FULL_INVOICE_SELECT]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    if (invoiceSettings) {
      setAddGst(invoiceSettings.add_gst_by_default);
      setCgstPercent(invoiceSettings.cgst_percent);
      setSgstPercent(invoiceSettings.sgst_percent);
      setIgstPercent(invoiceSettings.igst_percent);
    }
  }, [invoiceSettings]);

  const selectedCustomer = useMemo(
    () => customers.find(c => c.id === selectedCustomerId) ?? null,
    [customers, selectedCustomerId],
  );

  const filteredCustomers = useMemo(() => {
    if (!customerSearch.trim()) return customers;
    const q = customerSearch.toLowerCase();
    return customers.filter(c =>
      c.name?.toLowerCase().includes(q) ||
      (c.company_name ?? '').toLowerCase().includes(q) ||
      (c.phone ?? '').toLowerCase().includes(q) ||
      (c.email ?? '').toLowerCase().includes(q)
    );
  }, [customers, customerSearch]);

  const filteredInvoices = useMemo(() => {
    if (!invoiceSearch.trim()) return invoices.slice(0, 8);
    const q = invoiceSearch.toLowerCase();
    if (customerSearchMode === 'invoice') {
      return invoices.filter(i => i.invoice_number?.toLowerCase().includes(q));
    }
    return invoices.filter(i =>
      (i.customer_name ?? '').toLowerCase().includes(q) ||
      (i.customer?.name ?? '').toLowerCase().includes(q) ||
      (i.customer?.company_name ?? '').toLowerCase().includes(q)
    );
  }, [invoices, invoiceSearch, customerSearchMode]);

  const selectedStatementCustomer = customers.find(c => c.id === statementCustomerId) ?? null;

  // Full Statement data — every invoice for this customer within the selected Date
  // Quick Filter/Status (paid AND pending) — exactly the existing Customer Statement
  // table/Print Statement, unchanged.
  const statementRows = useMemo(() => {
    if (!statementCustomerId) return [];
    return invoices
      .filter(inv => inv.customer_id === statementCustomerId && !inv.is_cancelled && !!inv.invoice_number)
      .filter(inv => !statementFrom || inv.invoice_date >= statementFrom)
      .filter(inv => !statementTo || inv.invoice_date <= statementTo)
      .map(toStatementRow)
      .filter(row => {
        if (statementStatus === 'All') return true;
        if (statementStatus === 'Outstanding') return row.balance > 0;
        return row.inv.payment_status === statementStatus;
      })
      .sort((a, b) => a.inv.invoice_date.localeCompare(b.inv.invoice_date));
  }, [invoices, statementCustomerId, statementFrom, statementTo, statementStatus]);

  const statementSummary = useMemo(() => computeStatementTotals(statementRows), [statementRows]);

  // Balance Statement data — this customer's outstanding invoices across their FULL
  // history, deliberately independent of the Date Quick Filter/Status dropdown above.
  // A balance statement means "what they owe right now", not "what's in whatever date
  // window happens to be selected" — paid invoices never appear here.
  const balanceStatementRows = useMemo(() => {
    if (!statementCustomerId) return [];
    return invoices
      .filter(inv => inv.customer_id === statementCustomerId && !inv.is_cancelled && !!inv.invoice_number)
      .map(toStatementRow)
      .filter(row => row.balance > 0)
      .sort((a, b) => a.inv.invoice_date.localeCompare(b.inv.invoice_date));
  }, [invoices, statementCustomerId]);

  const balanceStatementSummary = useMemo(() => computeStatementTotals(balanceStatementRows), [balanceStatementRows]);

  // Reminders, scoped to the selected statement customer only — computed from the SAME
  // invoices/reminders/reminderSettings already loaded above, via the shared
  // computeReminderRows (moved from the old Balance Reminders page, not duplicated).
  const customerReminderRows = useMemo(() => {
    if (!statementCustomerId) return [];
    return computeReminderRows(invoices, reminders, reminderSettings)
      .filter(r => r.invoice.customer_id === statementCustomerId);
  }, [invoices, reminders, reminderSettings, statementCustomerId]);

  const reminderSummary = useMemo(() => ({
    day10Due: customerReminderRows.filter(r => r.stage === 10 && r.status === 'Due').length,
    day20Due: customerReminderRows.filter(r => r.stage === 20 && r.status === 'Due').length,
    sentCount: customerReminderRows.filter(r => r.status === 'Sent').length,
  }), [customerReminderRows]);

  // Only Due (10+/20+ days overdue) or already-Sent reminders are ever shown here — a
  // reminder must never appear before its stage's day threshold is actually reached.
  const visibleReminderRows = useMemo(
    () => customerReminderRows.filter(r => r.status === 'Due' || r.status === 'Sent'),
    [customerReminderRows],
  );

  function openReminderPreview(row: ReminderRowData) {
    if (!reminderSettings) { show('Reminder settings are not configured yet.', 'error'); return; }
    const subjectTemplate = row.stage === 10 ? reminderSettings.day10_subject : reminderSettings.day20_subject;
    const bodyTemplate = row.stage === 10 ? reminderSettings.day10_body : reminderSettings.day20_body;
    const vars = buildReminderTemplateVars(row, settings);
    setReminderPreviewRow(row);
    setReminderPreviewSubject(replaceReminderVars(subjectTemplate, vars));
    setReminderPreviewBody(replaceReminderVars(bodyTemplate, vars));
  }

  async function sendReminderPreview() {
    if (!reminderPreviewRow) return;
    const email = reminderPreviewRow.invoice.customer?.email ?? reminderPreviewRow.invoice.customer_email;
    if (!email) { show('This customer does not have an email address configured. Please add an email in Customer Master.', 'error'); return; }
    setSendingReminder(true);
    try {
      const html = invoiceDocHTML(reminderPreviewRow.invoice, reminderPreviewRow.invoice.items ?? [], settings, invoiceSettings, 'master', 'tax', rateMasterRows, vehiclesList);
      const { data, error } = await supabase.functions.invoke('process-reminders', {
        body: {
          action: 'send_manual',
          invoiceId: reminderPreviewRow.invoice.id,
          reminderStage: reminderPreviewRow.stage,
          subjectOverride: reminderPreviewSubject,
          bodyOverride: reminderPreviewBody,
          html,
        },
      });
      if (error) {
        let msg = 'Unable to send reminder. Please try again.';
        if (error.context && typeof error.context.json === 'function') {
          try {
            const errBody = await error.context.json();
            if (errBody?.error) msg = errBody.error;
          } catch { /* fall through */ }
        } else if (typeof error.message === 'string' && error.message.length > 0) {
          msg = error.message;
        }
        show(getReminderEmailErrorMessage(msg), 'error');
      } else if (data?.error) {
        show(getReminderEmailErrorMessage(data.error), 'error');
      } else {
        show(`Day ${reminderPreviewRow.stage} reminder sent to ${email}.`, 'success');
        setReminderPreviewRow(null);
        await fetchAll();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to send reminder. Please try again.';
      show(getReminderEmailErrorMessage(msg), 'error');
    }
    setSendingReminder(false);
  }

  // Fetch preview invoice number when customer is selected (does NOT consume the number)
  useEffect(() => {
    if (selectedCustomerId) {
      supabase.rpc('peek_pcs_invoice_number', { p_invoice_date: todayISO() })
        .then(({ data, error }) => {
          if (!error && data) setPreviewInvoiceNo(data as string);
          else setPreviewInvoiceNo('');
        });
    } else {
      setPreviewInvoiceNo('');
    }
  }, [selectedCustomerId]);

  // ===== STEP 1: NEXT button validation =====
  const handleNext = async () => {
    if (!selectedCustomerId) { show('Please select a customer', 'error'); return; }
    setGstType(invoiceSelection);
    setStep('step2');
  };

  // ===== STEP 2: CAPTURE TRIP (save to DB without invoice number) =====
  const captureTrip = async (data: MultiVehicleTripFormData) => {
    if (!selectedCustomerId) { show('Customer is required', 'error'); return; }
    if (data.vehicles.length === 0) { show('At least one vehicle is required.', 'error'); return; }
    if (data.total_amount <= 0) { show('Total amount must be greater than zero.', 'error'); return; }
    setCapturing(true);

    try {
      const cust = selectedCustomer;
      const firstVehicle = data.vehicles[0];
      const vNumbers = data.vehicles.map(v => v.vehicle_number).filter(Boolean).join(', ');
      const desc = `${vNumbers} - ${data.place_of_work} - ${data.vehicles.length} vehicle(s)`.trim();

      const draftPayload = {
        invoice_number: null,
        invoice_date: data.trip_date,
        invoice_type: 'GST' as const,
        customer_id: selectedCustomerId,
        customer_name: cust?.name ?? null,
        customer_address: cust?.address ?? null,
        customer_gstin: cust?.gstin ?? null,
        customer_email: cust?.email ?? null,
        customer_phone: cust?.phone ?? null,
        trip_id: null,
        trip_date: data.trip_date,
        vehicle_id: firstVehicle?.vehicle_id || null,
        vehicle_number: vNumbers || null,
        driver_name: firstVehicle?.driver_name ?? null,
        place_of_work: data.place_of_work,
        opening_hour_meter: null,
        closing_hour_meter: null,
        total_hours: data.total_hours,
        rate_type: firstVehicle?.rate_type ?? 'Hourly',
        description: desc,
        hours: data.total_hours,
        rate: data.total_rental,
        taxable_amount: data.total_amount,
        cgst_percent: 0, sgst_percent: 0, igst_percent: 0,
        cgst_amount: 0, sgst_amount: 0, igst_amount: 0, total_gst: 0,
        grand_total: data.total_amount,
        batha: data.total_batha,
        up_transportation_enabled: data.up_transportation_enabled,
        up_transportation_amount: data.up_transportation_enabled ? Number(data.up_transportation_amount) || 0 : 0,
        down_transportation_enabled: data.down_transportation_enabled,
        down_transportation_amount: data.down_transportation_enabled ? Number(data.down_transportation_amount) || 0 : 0,
        payment_status: 'Pending' as const,
        payment_mode: null,
        reference_no: referenceNo.trim() || null,
        amount_received: 0,
        balance_amount: data.total_amount,
        invoice_status: 'Draft' as InvoiceStatus,
        remarks: remarks || null,
      };

      const { data: invData, error: invErr } = await supabase
        .from('invoices')
        .insert(draftPayload)
        .select('id')
        .single();
      if (invErr) throw new Error(invErr.message);
      const invoiceId = invData.id;

      // Save all vehicle entries with sessions
      for (let i = 0; i < data.vehicles.length; i++) {
        const ve = data.vehicles[i];
        const { data: vehRow, error: vehErr } = await supabase.from('invoice_vehicles').insert({
          invoice_id: invoiceId,
          vehicle_id: ve.vehicle_id || null,
          vehicle_number: ve.vehicle_number,
          vehicle_type: ve.vehicle_type,
          capacity: ve.vehicle_capacity,
          driver_id: ve.driver_id || null,
          driver_name: ve.driver_name,
          place_of_work: ve.place_of_work,
          rate_type: ve.rate_type,
          total_hours: ve.total_hours,
          rental_amount: ve.rental_amount,
          batha: ve.batha,
          vehicle_total: ve.total_amount,
          rate_master_id: ve.rate_master_id,
          rate_version: ve.rate_version,
          capacity_tons: ve.capacity_tons,
          first_hour_rate: ve.first_hour_rate,
          second_hour_rate: ve.second_hour_rate,
          third_hour_rate_snapshot: ve.third_hour_rate_snapshot,
          fourth_hour_rate_snapshot: ve.fourth_hour_rate_snapshot,
          fifth_hour_rate_snapshot: ve.fifth_hour_rate_snapshot,
          weekly_rate_snapshot: ve.weekly_rate_snapshot,
          daily_rate_snapshot: ve.daily_rate_snapshot,
          monthly_rate_snapshot: ve.monthly_rate_snapshot,
          batha_snapshot: ve.batha_snapshot,
          sort_order: i,
        }).select('id').single();
        if (vehErr) throw new Error(vehErr.message);

        if (ve.sessions && ve.sessions.length > 0) {
          const sessionRows = ve.sessions.map((s, idx) => ({
            invoice_vehicle_id: vehRow.id,
            session_number: idx + 1,
            in_time: s.in_time ? new Date(s.in_time).toISOString() : null,
            out_time: s.out_time ? new Date(s.out_time).toISOString() : null,
            opening_hour_meter: s.opening_hour_meter ?? null,
            closing_hour_meter: s.closing_hour_meter ?? null,
            remarks: s.remarks ?? null,
            duration_minutes: 0,
          }));
          const { error: sessErr } = await supabase.from('invoice_vehicle_sessions').insert(sessionRows);
          if (sessErr) console.error('Session save error:', sessErr);
        }
      }

      show('Trip captured successfully.', 'success');
      setSelectedCustomerId('');
      setReferenceNo('');
      setInvoiceSelection('cgst_sgst');
      setPreviewInvoiceNo('');
      await fetchAll();
      setStep('list');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to capture trip';
      console.error('Capture trip error:', err);
      show(msg, 'error');
    }
    setCapturing(false);
  };

  // ===== GENERATE INVOICE FROM LIST (uses global PCS sequence) =====
  const openGenerateInvoice = (inv: InvoiceWithRelations) => {
    setGenerateInvoiceModal(inv);
    setGenerateInvoiceDate(inv.invoice_date ?? todayISO());
    setDiscountEnabled(false);
    setDiscountPercent(0);
  };

  const confirmGenerateInvoice = async () => {
    if (!generateInvoiceModal) return;
    const inv = generateInvoiceModal;
    if (inv.invoice_status !== 'Draft' || inv.invoice_number) {
      show(`This trip has already been invoiced as ${inv.invoice_number}.`, 'error');
      setGenerateInvoiceModal(null);
      return;
    }

    if (discountEnabled) {
      const pctErr = validateDiscountPercentage(discountPercent);
      if (pctErr) { show(pctErr, 'error'); return; }
      if (!discountPercent || discountPercent <= 0) {
        show('Discount is ON but percentage is empty. Please enter a discount percentage or turn discount OFF.', 'error'); return;
      }
    }
    setGeneratingInvoiceNo(true);
    try {
      // Generate the global PCS invoice number atomically
      const { data: newInvNum, error: rpcError } = await supabase.rpc('next_pcs_invoice_number', {
        p_invoice_date: generateInvoiceDate,
      });
      if (rpcError || !newInvNum) throw new Error('Unable to generate invoice number');

      const cust = customers.find(c => c.id === inv.customer_id);
      const formData = convertInvoiceToFormData(inv);

      // Recalculate line items for GST
      const rebuiltLineItems: { sl_no: number; description: string; hsn_sac: string; quantity: number; rate: number; unit: string; amount: number; batha: number; calculation_details: string }[] = [];
      formData.vehicles.forEach((ve, idx) => {
        const firstSessionDate = ve.sessions && ve.sessions.length > 0 && ve.sessions[0].in_time
          ? ve.sessions[0].in_time
          : formData.trip_date;
        const tr = {
          rate_type: ve.rate_type,
          total_hours: ve.total_hours,
          rental_amount: ve.rental_amount,
          trip_date: formData.trip_date,
          work_date: firstSessionDate,
          place_of_work: ve.place_of_work || formData.place_of_work,
          capacity_tons: ve.capacity_tons,
          first_hour_rate: ve.first_hour_rate,
          second_hour_rate: ve.second_hour_rate,
          weekly_rate_snapshot: ve.weekly_rate_snapshot,
          daily_rate_snapshot: ve.daily_rate_snapshot,
          monthly_rate_snapshot: ve.monthly_rate_snapshot,
          vehicle: { registration_number: ve.vehicle_number, type: ve.vehicle_type, capacity: ve.vehicle_capacity },
        };
        const { description, calculation_details } = buildInvoiceLineDescription(tr);
        const rentalAmount = Number(ve.rental_amount) || 0;
        const batha = Number(ve.batha) || 0;
        let unit = 'nos';
        if (ve.rate_type === 'Daily') unit = 'day';
        else if (ve.rate_type === 'Monthly') unit = 'month';
        rebuiltLineItems.push({
          sl_no: idx + 1, description, hsn_sac: invoiceSettings?.hsn_sac || '997319',
          quantity: 1, rate: rentalAmount, unit, amount: Math.round(rentalAmount * 100) / 100, batha,
          calculation_details,
        });
      });

      const totalBatha = Math.round(rebuiltLineItems.reduce((s, li) => s + li.batha, 0) * 100) / 100;
      const upAmt = formData.up_transportation_enabled ? Number(formData.up_transportation_amount) || 0 : 0;
      const downAmt = formData.down_transportation_enabled ? Number(formData.down_transportation_amount) || 0 : 0;
      const rentalTotal = Math.round(rebuiltLineItems.reduce((s, li) => s + li.amount, 0) * 100) / 100;
      const baseAmount = Math.round((rentalTotal + totalBatha + upAmt + downAmt) * 100) / 100;

      const cgstAmt = addGst && gstType === 'cgst_sgst' ? Math.round(baseAmount * cgstPercent / 100 * 100) / 100 : 0;
      const sgstAmt = addGst && gstType === 'cgst_sgst' ? Math.round(baseAmount * sgstPercent / 100 * 100) / 100 : 0;
      const igstAmt = addGst && gstType === 'igst' ? Math.round(baseAmount * igstPercent / 100 * 100) / 100 : 0;
      const totalTax = cgstAmt + sgstAmt + igstAmt;
      const grandTotal = Math.round((baseAmount + totalTax) * 100) / 100;
      const disc = calculateDiscount({ grandTotal, discountEnabled, discountPercentage: discountPercent });
      const finalPayable = disc.finalPayableAmount;

      const now = new Date();
      const fy = now.getMonth() >= 3
        ? `${now.getFullYear()}-${String((now.getFullYear() + 1) % 100).padStart(2, '0')}`
        : `${now.getFullYear() - 1}-${String(now.getFullYear() % 100).padStart(2, '0')}`;

      const declaration = invoiceSettings?.declaration ||
        'We declare that this invoice shows the actual price of the services described and that all particulars are true and correct.';

      // Update the draft invoice with the generated number + GST details
      const updatePayload = {
        invoice_number: newInvNum,
        invoice_date: generateInvoiceDate,
        taxable_amount: baseAmount,
        cgst_percent: addGst && gstType === 'cgst_sgst' ? cgstPercent : 0,
        sgst_percent: addGst && gstType === 'cgst_sgst' ? sgstPercent : 0,
        igst_percent: addGst && gstType === 'igst' ? igstPercent : 0,
        cgst_amount: cgstAmt,
        sgst_amount: sgstAmt,
        igst_amount: igstAmt,
        total_gst: totalTax,
        grand_total: grandTotal,
        discount_enabled: discountEnabled,
        discount_percent: discountEnabled ? discountPercent : 0,
        discount_amount: disc.discountAmount,
        final_payable_amount: finalPayable,
        balance_amount: finalPayable,
        invoice_status: 'Generated' as InvoiceStatus,
        financial_year: fy,
        consignee_name: cust?.name ?? inv.customer_name ?? null,
        consignee_address: cust?.address ?? null,
        consignee_gstin: cust?.gstin ?? null,
        consignee_state: cust?.state ?? null,
        consignee_state_code: cust?.state_code ?? null,
        motor_vehicle_numbers: formData.vehicles.map(v => v.vehicle_number).filter(Boolean).join(', ') || null,
        amount_in_words: amountInWords(finalPayable),
        declaration,
      };

      const { error: invErr } = await supabase.from('invoices').update(updatePayload).eq('id', inv.id);
      if (invErr) throw new Error(invErr.message);

      // Insert invoice_items (the draft didn't have any)
      const allItems = [...rebuiltLineItems];
      if (totalBatha > 0) {
        allItems.push({
          sl_no: allItems.length + 1, description: 'OPERATOR BATHA',
          hsn_sac: invoiceSettings?.hsn_sac || '997319', quantity: 1, rate: totalBatha,
          unit: 'nos', amount: totalBatha, batha: totalBatha,
          calculation_details: `Operator Batha: ${formatCurrency(totalBatha)}`,
        });
      }
      if (upAmt > 0) {
        allItems.push({
          sl_no: allItems.length + 1, description: 'UP TRANSPORTATION CHARGES',
          hsn_sac: invoiceSettings?.hsn_sac || '997319', quantity: 1, rate: upAmt,
          unit: 'nos', amount: upAmt, batha: 0,
          calculation_details: `UP Transportation: ${formatCurrency(upAmt)}`,
        });
      }
      if (downAmt > 0) {
        allItems.push({
          sl_no: allItems.length + 1, description: 'DOWN TRANSPORTATION CHARGES',
          hsn_sac: invoiceSettings?.hsn_sac || '997319', quantity: 1, rate: downAmt,
          unit: 'nos', amount: downAmt, batha: 0,
          calculation_details: `DOWN Transportation: ${formatCurrency(downAmt)}`,
        });
      }

      const itemRows = allItems.map(li => ({
        invoice_id: inv.id,
        trip_entry_id: null,
        sl_no: li.sl_no,
        description: li.description,
        hsn_sac: li.hsn_sac,
        quantity: li.quantity,
        rate: li.rate,
        unit: li.unit,
        amount: li.amount,
        batha: li.batha,
        calculation_details: li.calculation_details,
      }));
      const { error: itemsErr } = await supabase.from('invoice_items').insert(itemRows);
      if (itemsErr) console.error('Invoice items insert error:', itemsErr);

      show(`Invoice ${newInvNum} generated successfully.`, 'success');
      await scheduleReminders(inv.id);
      setGenerateInvoiceModal(null);
      await fetchAll();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to generate invoice';
      console.error('Generate invoice error:', err);
      show(msg, 'error');
    }
    setGeneratingInvoiceNo(false);
  };

  const handleCancel = async () => {
    if (!cancelId) return;
    const { error } = await supabase
      .from('invoices')
      .update({ invoice_status: 'Cancelled' as InvoiceStatus })
      .eq('id', cancelId);
    if (error) show(t('saveError'), 'error');
    else { show('Invoice cancelled', 'success'); fetchAll(); }
    setCancelId(null);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      const { data: vehIds } = await supabase.from('invoice_vehicles').select('id').eq('invoice_id', deleteId);
      if (vehIds && vehIds.length > 0) {
        await supabase.from('invoice_vehicle_sessions').delete().in('invoice_vehicle_id', vehIds.map(r => r.id));
        await supabase.from('invoice_vehicles').delete().in('id', vehIds.map(r => r.id));
      }
      await supabase.from('invoice_items').delete().eq('invoice_id', deleteId);
      await supabase.from('invoice_payments').delete().eq('invoice_id', deleteId);
      const { error } = await supabase.from('invoices').delete().eq('id', deleteId);
      if (error) throw error;
      show('Invoice deleted successfully', 'success');
      fetchAll();
    } catch {
      show('Failed to delete invoice', 'error');
    }
    setDeleting(false);
    setDeleteId(null);
  };

  const newBalanceAfterCompanyPayment = useMemo(() => {
    if (!companyPaymentModal) return 0;
    const amt = companyPaymentForm.amount ?? 0;
    return round2(companyPaymentModal.totalOutstanding - amt);
  }, [companyPaymentModal, companyPaymentForm.amount]);

  // Clicking ₹ on any of a customer's invoices opens this against their FULL
  // outstanding balance (every unpaid/partially-paid invoice, oldest first) - never a
  // single invoice - matching Customer Statement's own balanceStatementRows filter
  // exactly, just parameterized by customer instead of hardcoded to the one currently
  // selected in statement mode.
  const openCompanyPayment = (customerId: string) => {
    const cust = customers.find(c => c.id === customerId);
    const outstandingInvoices = invoices
      .filter(inv => inv.customer_id === customerId && !inv.is_cancelled && !!inv.invoice_number)
      .map(toStatementRow)
      .filter(row => row.balance > 0)
      .sort((a, b) => a.inv.invoice_date.localeCompare(b.inv.invoice_date));
    const totalOutstanding = round2(outstandingInvoices.reduce((s, r) => s + r.balance, 0));
    setCompanyPaymentModal({ customerId, customerName: cust?.name ?? '-', outstandingInvoices, totalOutstanding });
    // Amount Received is always manual entry - never pre-filled with the outstanding
    // balance (that figure is shown above purely as information).
    setCompanyPaymentForm({ amount: null, payment_date: todayISO(), reference: '', remarks: '' });
  };

  // Records one customer_payments header row, then FIFO-allocates the amount across
  // that customer's oldest unpaid invoices first as ordinary invoice_payments rows
  // (tagged with the header's id) - the exact same rows/columns Settlement Report,
  // Customer Billing Report, statements and reminders already read, so every one of
  // them reflects this automatically with no changes of their own needed. Each
  // touched invoice's amount_received/balance/status is updated with the same logic
  // the old per-invoice Record Payment used, just looped over every invoice touched.
  const recordCompanyPayment = async () => {
    if (!companyPaymentModal || recordingCompanyPayment) return;
    const amt = companyPaymentForm.amount ?? 0;
    if (amt <= 0) { show('Enter a valid amount greater than 0', 'error'); return; }
    if (amt > companyPaymentModal.totalOutstanding + 0.01) {
      show(`Payment cannot exceed the outstanding balance of ${formatCurrency(companyPaymentModal.totalOutstanding)}.`, 'error');
      return;
    }
    setRecordingCompanyPayment(true);

    const { data: header, error: headerErr } = await supabase.from('customer_payments').insert({
      customer_id: companyPaymentModal.customerId,
      payment_date: companyPaymentForm.payment_date,
      // Company payments are always a receipt into the bank - never
      // literal cash - so this is fixed rather than user-selected.
      payment_mode: 'Credit',
      amount: amt,
      reference: companyPaymentForm.reference || null,
      notes: companyPaymentForm.remarks || null,
    }).select().single();
    if (headerErr || !header) { show(headerErr?.message ?? t('saveError'), 'error'); setRecordingCompanyPayment(false); return; }

    let remaining = amt;
    const allocations: { invoice_id: string; amount: number; row: StatementRow }[] = [];
    for (const row of companyPaymentModal.outstandingInvoices) {
      if (remaining <= 0) break;
      const alloc = round2(Math.min(remaining, row.balance));
      if (alloc <= 0) continue;
      allocations.push({ invoice_id: row.inv.id, amount: alloc, row });
      remaining = round2(remaining - alloc);
    }

    const { error: payErr } = await supabase.from('invoice_payments').insert(
      allocations.map(a => ({
        invoice_id: a.invoice_id,
        amount: a.amount,
        payment_date: companyPaymentForm.payment_date,
        payment_mode: 'Credit',
        reference: companyPaymentForm.reference || null,
        remarks: companyPaymentForm.remarks || null,
        customer_payment_id: header.id,
      })),
    );
    if (payErr) { show(payErr.message, 'error'); setRecordingCompanyPayment(false); return; }

    // Each inserted invoice_payments row above triggers the DB's
    // sync_invoice_payment_to_bank trigger, which recomputes this invoice's
    // amount_received/balance_amount/invoice_status/payment_status directly
    // from the invoice_payments ledger - no client-side update needed here.

    show(`Payment of ${formatCurrency(amt)} recorded and allocated across ${allocations.length} invoice${allocations.length === 1 ? '' : 's'}.`, 'success');
    setCompanyPaymentModal(null);
    setRecordingCompanyPayment(false);
    setCompanyPaymentForm({ amount: null, payment_date: todayISO(), reference: '', remarks: '' });
    fetchAll();
  };

  const computeVehicleNumbersJoined = (inv: InvoiceWithRelations): string =>
    Array.from(new Set((inv.invoiceVehicles ?? []).map(v => v.vehicle_number).filter(Boolean))).join(', ');

  const openEditDetails = (inv: InvoiceWithRelations) => {
    setEditDetailsModal(inv);
    setEditDetailsForm({
      delivery_note: inv.delivery_note ?? '',
      terms_of_payment: inv.terms_of_payment || invoiceSettings?.default_payment_terms || '',
      reference_no: inv.reference_no || inv.invoice_number || '',
      reference_date: inv.reference_date || inv.invoice_date || '',
      buyer_order_no: inv.buyer_order_no ?? '',
      buyer_order_date: inv.buyer_order_date ?? '',
      dispatch_doc_no: inv.dispatch_doc_no ?? '',
      delivery_note_date: inv.delivery_note_date ?? '',
      dispatched_through: inv.dispatched_through ?? '',
      destination: inv.destination ?? '',
      bill_of_lading_no: inv.bill_of_lading_no ?? '',
      motor_vehicle_numbers: inv.motor_vehicle_numbers || computeVehicleNumbersJoined(inv),
      terms_of_delivery_days: inv.terms_of_delivery_days || 28,
    });
  };

  const saveEditDetails = async () => {
    if (!editDetailsModal) return;
    setSavingDetails(true);
    const f = editDetailsForm;
    const { error } = await supabase.from('invoices').update({
      delivery_note: f.delivery_note.trim() || null,
      terms_of_payment: f.terms_of_payment.trim() || null,
      reference_no: f.reference_no.trim() || null,
      reference_date: f.reference_date || null,
      buyer_order_no: f.buyer_order_no.trim() || null,
      buyer_order_date: f.buyer_order_date || null,
      dispatch_doc_no: f.dispatch_doc_no.trim() || null,
      delivery_note_date: f.delivery_note_date || null,
      dispatched_through: f.dispatched_through.trim() || null,
      destination: f.destination.trim() || null,
      bill_of_lading_no: f.bill_of_lading_no.trim() || null,
      motor_vehicle_numbers: f.motor_vehicle_numbers.trim() || null,
      terms_of_delivery_days: Math.max(1, Number(f.terms_of_delivery_days) || 28),
    }).eq('id', editDetailsModal.id);
    setSavingDetails(false);
    if (error) { show(error.message, 'error'); return; }
    show('Invoice details saved.', 'success');
    setEditDetailsModal(null);
    await fetchAll();
  };

  const openPrintCopyModal = (inv: InvoiceWithRelations, items: InvoiceItem[]) => {
    setPrintCopyModal(inv);
    setPrintCopyItems(items);
    setPrintDocType('tax');
  };

  const printInIframe = (html: string) => {
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
      document.body.removeChild(iframe);
      show('Unable to open print dialog', 'error');
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
        } catch {
          show('Unable to open print dialog', 'error');
        }
        setTimeout(() => {
          if (iframe.parentNode) document.body.removeChild(iframe);
        }, 1000);
      }, 350);
    };
  };

  const combineInvoiceCopiesHTML = (docs: string[]): string => {
    const head = docs[0].match(/<head>[\s\S]*?<\/head>/)?.[0] ?? '<head></head>';
    const bodies = docs.map(html => html.match(/<body>([\s\S]*?)<\/body>/)?.[1] ?? '');
    const pages = bodies
      .map((body, idx) => `<div style="${idx < bodies.length - 1 ? 'page-break-after: always; break-after: page;' : ''}">${body}</div>`)
      .join('');
    return `<!DOCTYPE html><html>${head}<body>${pages}</body></html>`;
  };

  const doPrint = (inv: InvoiceWithRelations, items: InvoiceItem[], copyType: PrintCopyType, docType: InvoiceDocType = 'tax') => {
    if (copyType === 'all') {
      const docs = (['master', 'duplicate', 'extra'] as const).map(ct =>
        invoiceDocHTML(inv, items, settings, invoiceSettings, ct, docType, rateMasterRows, vehiclesList)
      );
      const combinedHtml = combineInvoiceCopiesHTML(docs);
      printInIframe(combinedHtml);
    } else {
      const html = invoiceDocHTML(inv, items, settings, invoiceSettings, copyType, docType, rateMasterRows, vehiclesList);
      printInIframe(html);
    }
  };

  const sendEmail = async (inv: InvoiceWithRelations) => {
    const email = inv.customer?.email ?? inv.customer_email;
    if (!email) {
      show('This customer does not have an email address configured. Please add an email in Customer Master.', 'error');
      return;
    }
    setEmailSending(true);
    try {
      const html = invoiceDocHTML(inv, inv.items ?? [], settings, invoiceSettings, 'master', 'tax', rateMasterRows, vehiclesList);
      const { data, error } = await supabase.functions.invoke('send-invoice-email', {
        body: { invoiceId: inv.id, html },
      });
      if (error) {
        let msg = 'Unable to send invoice. Please try again.';
        if (error.context && typeof error.context.json === 'function') {
          try {
            const errBody = await error.context.json();
            if (errBody?.error) msg = errBody.error;
          } catch { /* fall through to default */ }
        } else if (typeof error.message === 'string' && error.message.length > 0) {
          msg = error.message;
        }
        show(getEmailErrorMessage(msg), 'error');
      } else if (data?.sentTo) {
        show(`Invoice sent successfully to ${data.sentTo}`, 'success');
        await fetchAll();
      } else {
        show('Invoice sent successfully', 'success');
        await fetchAll();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to send invoice. Please try again.';
      show(getEmailErrorMessage(msg), 'error');
    }
    setEmailSending(false);
  };

  // Builds a statement HTML document from whichever row set/summary/heading is passed
  // in — Print Statement and Send Full Statement pass statementRows/statementSummary
  // (paid + pending, current Date Quick Filter/Status), Send Balance Statement passes
  // balanceStatementRows/balanceStatementSummary (outstanding only, all-time). One
  // template, so every one of these always matches what's actually on screen/selected.
  const buildStatementHtml = (rows: StatementRow[], summary: ReturnType<typeof computeStatementTotals>, heading: string, periodLabelOverride?: string): string | null => {
    if (!selectedStatementCustomer) return null;
    const cust = selectedStatementCustomer;
    const rowsHtml = rows.map((r, idx) => `<tr>
      <td style="text-align:center">${idx + 1}</td>
      <td>${formatDate(r.inv.invoice_date)}</td>
      <td>${r.inv.invoice_number}</td>
      <td style="text-align:right">${formatCurrency(r.payable)}</td>
      <td style="text-align:right">${formatCurrency(r.received)}</td>
      <td class="${r.receivedDateLabel === '—' ? 'muted' : ''}">${r.receivedDateLabel}</td>
      <td style="text-align:right">${formatCurrency(r.balance)}</td>
    </tr>`).join('');
    const periodLabel = periodLabelOverride ?? ((statementFrom || statementTo) ? `${statementFrom ? formatDate(statementFrom) : 'Start'} &ndash; ${statementTo ? formatDate(statementTo) : 'Today'}` : 'All Time');
    const overallStatus = summary.totalPending <= 0 && summary.count > 0 ? 'Paid'
      : summary.totalReceived > 0 ? 'Partially Paid' : 'Unpaid';
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${heading} - ${cust.name}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; padding: 14mm 12mm; color: #1a1a1a; font-size: 11px; }
  .co { text-align: center; font-weight: 800; font-size: 17px; text-transform: uppercase; letter-spacing: 0.3px; }
  .addr { text-align: center; font-size: 10px; color: #444; margin-top: 2px; line-height: 1.5; }
  h2 { text-align: center; font-size: 13px; letter-spacing: 1.5px; margin: 12px -8mm 10px -8mm; padding: 5px 8mm; border-top: 1.5px solid #000; border-bottom: 1.5px solid #000; text-transform: uppercase; }
  .meta-wrap { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 10px; }
  .cust { font-size: 11px; line-height: 1.6; }
  .cust .lbl { color: #666; display: inline-block; min-width: 90px; }
  .cust .nm { font-weight: 700; font-size: 12px; }
  .gen { text-align: right; font-size: 10px; color: #555; }
  table { width: 100%; border-collapse: collapse; font-size: 10.5px; margin-top: 6px; }
  th, td { border: 1px solid #999; padding: 4px 6px; }
  th { background: #f0f0f0; text-transform: uppercase; font-size: 9px; text-align: center; }
  td:first-child, th:first-child { text-align: center; }
  td.muted { color: #999; text-align: center; }
  tfoot td { font-weight: 700; background: #f7f7f7; border-top: 1.5px solid #000; }
  .summary { margin-top: 14px; width: 260px; margin-left: auto; font-size: 11px; }
  .summary h3 { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid #000; padding-bottom: 3px; margin: 0 0 6px; }
  .summary .row { display: flex; justify-content: space-between; padding: 2px 0; }
  .summary .row.total { border-top: 1.5px solid #000; margin-top: 4px; padding-top: 5px; font-weight: 800; font-size: 12px; }
  .summary .row.bal { color: #b91c1c; font-weight: 700; }
  .status-badge { display: inline-block; font-size: 9px; font-weight: 700; padding: 2px 8px; border-radius: 3px; margin-top: 4px; text-transform: uppercase; }
  .status-Paid { background: #dcfce7; color: #15803d; }
  .status-Partially-Paid { background: #fef9c3; color: #a16207; }
  .status-Unpaid { background: #fee2e2; color: #b91c1c; }
  .foot-note { margin-top: 10px; font-size: 9px; color: #777; }
  .page-frame { border: 1.5px solid #000; padding: 8mm; min-height: 270mm; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
  @media print { body { padding: 0; } @page { size: A4; margin: 10mm; } }
</style></head><body>
  <div class="page-frame">
  ${settings?.logo_url ? `<div style="text-align:center;margin-bottom:4px"><img src="${settings.logo_url}" alt="Logo" style="max-height:46px"/></div>` : ''}
  <div class="co">${settings?.company_name ?? ''}</div>
  ${settings?.address ? `<div class="addr">${settings.address.replace(/\n/g, ', ')}</div>` : ''}
  <div class="addr">${[settings?.phone ? 'Ph: ' + settings.phone : '', settings?.email ?? '', settings?.gstin ? 'GSTIN: ' + settings.gstin : ''].filter(Boolean).join(' &middot; ')}</div>
  <h2>${heading}</h2>
  <div class="meta-wrap">
    <div class="cust">
      <div class="nm">${cust.name}</div>
      ${cust.gstin ? `<div><span class="lbl">GSTIN:</span>${cust.gstin}</div>` : ''}
      ${cust.phone ? `<div><span class="lbl">Phone:</span>${cust.phone}</div>` : ''}
      ${cust.address ? `<div><span class="lbl">Address:</span>${cust.address}</div>` : ''}
      <div><span class="lbl">Statement Period:</span>${periodLabel}</div>
    </div>
    <div class="gen">Generated On:<br/><strong>${formatDate(todayISO())}</strong></div>
  </div>
  <table>
    <thead><tr><th>Sl.No</th><th>Invoice Date</th><th>Invoice Number</th><th>Total Amount</th><th>Received Amount</th><th>Received Date</th><th>Balance Amount</th></tr></thead>
    <tbody>${rowsHtml || '<tr><td colspan="7" style="text-align:center;padding:16px">No invoices found for this period/filter.</td></tr>'}</tbody>
    ${rows.length > 0 ? `<tfoot><tr><td colspan="3">TOTAL (${summary.count} invoice${summary.count === 1 ? '' : 's'})</td><td style="text-align:right">${formatCurrency(summary.totalAmount)}</td><td style="text-align:right">${formatCurrency(summary.totalReceived)}</td><td></td><td style="text-align:right">${formatCurrency(summary.totalPending)}</td></tr></tfoot>` : ''}
  </table>
  <div class="summary">
    <h3>Account Summary</h3>
    <div class="row"><span>Total Billing Amount</span><b>${formatCurrency(summary.totalAmount)}</b></div>
    <div class="row"><span>Total Received Amount</span><b>${formatCurrency(summary.totalReceived)}</b></div>
    <div class="row total bal"><span>Outstanding Balance</span><b>${formatCurrency(summary.totalPending)}</b></div>
    <div style="text-align:right"><span class="status-badge status-${overallStatus.replace(/\s/g, '-')}">${overallStatus}</span></div>
  </div>
  <div class="foot-note">E.&amp;O.E. This statement is generated from our records as of the date above.</div>
  </div>
</body></html>`;
    return html;
  };

  // Reuses the same printInIframe pipeline every other print button on this page
  // already uses — a plain HTML statement, not a new PDF-generation path. Unchanged:
  // still prints exactly what's on screen (paid + pending, current filters).
  const printStatement = () => {
    const html = buildStatementHtml(statementRows, statementSummary, 'Customer Account Statement');
    if (html) printInIframe(html);
  };

  // Balance Statement — outstanding invoices only (balanceStatementRows already
  // excludes every fully-paid invoice), optionally with each one's own invoice PDF
  // attached too when "Also Send Invoices" is checked.
  const sendBalanceStatement = async () => {
    if (!selectedStatementCustomer) return;
    const email = selectedStatementCustomer.email;
    if (!email) {
      show('This customer does not have an email address configured. Please add an email in Customer Master.', 'error');
      return;
    }
    if (balanceStatementRows.length === 0) {
      show('This customer has no outstanding (unpaid/partially paid) invoices to send.', 'error');
      return;
    }
    setSendingStatement(true);
    try {
      // Every attachment here (the statement summary and each invoice) is sent as raw HTML
      // and rendered server-side via Browserless (real Chromium) — the same path the
      // single-invoice Email action uses — instead of being pre-rendered client-side with
      // html2pdf.js/html2canvas, which only approximate the layout. This keeps the emailed
      // statement PDF pixel-identical to Print Statement, same as buildStatementHtml()
      // already guarantees for the two HTML sources being byte-for-byte the same markup.
      const pdfHtmls: { filename: string; html: string }[] = [];
      const html = buildStatementHtml(balanceStatementRows, balanceStatementSummary, 'Balance Statement', 'Outstanding (All Time)');
      if (html) {
        const filename = `Balance_Statement_${selectedStatementCustomer.name.replace(/[^a-zA-Z0-9]+/g, '_')}.pdf`;
        pdfHtmls.push({ filename, html });
      }
      if (alsoSendInvoices) {
        for (const r of balanceStatementRows) {
          const invHtml = invoiceDocHTML(r.inv, r.inv.items ?? [], settings, invoiceSettings, 'master', 'tax', rateMasterRows, vehiclesList);
          pdfHtmls.push({ filename: `Invoice_${r.inv.invoice_number}.pdf`, html: invHtml });
        }
      }
      const { data, error } = await supabase.functions.invoke('send-balance-statement', {
        body: { customerId: selectedStatementCustomer.id, invoiceIds: balanceStatementRows.map(r => r.inv.id), pdfHtmls, statementLabel: 'Balance Statement' },
      });
      if (error) {
        let msg = 'Unable to send balance statement. Please try again.';
        if (error.context && typeof error.context.json === 'function') {
          try {
            const errBody = await error.context.json();
            if (errBody?.error) msg = errBody.error;
          } catch { /* fall through to default */ }
        } else if (typeof error.message === 'string' && error.message.length > 0) {
          msg = error.message;
        }
        show(getEmailErrorMessage(msg), 'error');
      } else if (data?.sentTo) {
        show(`Balance statement sent to ${data.sentTo}`, 'success');
      } else {
        show('Balance statement sent successfully', 'success');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to send balance statement. Please try again.';
      show(getEmailErrorMessage(msg), 'error');
    }
    setSendingStatement(false);
  };

  // Full Statement — every invoice (paid + pending) for the currently selected Date
  // Quick Filter/Status, i.e. exactly what's shown in the Customer Statement table and
  // printed by Print Statement. No per-invoice attachments — just the one statement PDF.
  const sendFullStatement = async () => {
    if (!selectedStatementCustomer) return;
    const email = selectedStatementCustomer.email;
    if (!email) {
      show('This customer does not have an email address configured. Please add an email in Customer Master.', 'error');
      return;
    }
    if (statementRows.length === 0) {
      show('There are no invoices to include in this statement for the current filters.', 'error');
      return;
    }
    setSendingFullStatement(true);
    try {
      // Rendered server-side via Browserless (real Chromium), same as Send Balance
      // Statement, so this PDF is pixel-identical to Print Statement too.
      const pdfHtmls: { filename: string; html: string }[] = [];
      const html = buildStatementHtml(statementRows, statementSummary, 'Full Statement');
      if (html) {
        const periodSlug = (statementFrom || statementTo) ? `${statementFrom || 'start'}_to_${statementTo || 'today'}` : 'all-time';
        const filename = `Full_Statement_${selectedStatementCustomer.name.replace(/[^a-zA-Z0-9]+/g, '_')}_${periodSlug}.pdf`;
        pdfHtmls.push({ filename, html });
      }
      // "Also Send Invoices" applies to both statement actions - attach every invoice
      // this Full Statement lists (paid + pending, current filters), not just the
      // outstanding ones Send Balance Statement uses.
      if (alsoSendInvoices) {
        for (const r of statementRows) {
          const invHtml = invoiceDocHTML(r.inv, r.inv.items ?? [], settings, invoiceSettings, 'master', 'tax', rateMasterRows, vehiclesList);
          pdfHtmls.push({ filename: `Invoice_${r.inv.invoice_number}.pdf`, html: invHtml });
        }
      }
      const { data, error } = await supabase.functions.invoke('send-balance-statement', {
        body: { customerId: selectedStatementCustomer.id, invoiceIds: statementRows.map(r => r.inv.id), pdfHtmls, statementLabel: 'Full Statement' },
      });
      if (error) {
        let msg = 'Unable to send full statement. Please try again.';
        if (error.context && typeof error.context.json === 'function') {
          try {
            const errBody = await error.context.json();
            if (errBody?.error) msg = errBody.error;
          } catch { /* fall through to default */ }
        } else if (typeof error.message === 'string' && error.message.length > 0) {
          msg = error.message;
        }
        show(getEmailErrorMessage(msg), 'error');
      } else if (data?.sentTo) {
        show(`Full statement sent to ${data.sentTo}`, 'success');
      } else {
        show('Full statement sent successfully', 'success');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to send full statement. Please try again.';
      show(getEmailErrorMessage(msg), 'error');
    }
    setSendingFullStatement(false);
  };

  const scheduleReminders = async (invoiceId: string) => {
    try {
      await supabase.functions.invoke('process-reminders', {
        body: { action: 'schedule', invoiceId },
      });
    } catch { /* non-blocking */ }
  };

  const viewInvoiceData = useMemo(() => {
    if (!viewInvoice) return null;
    const items = viewItems.length > 0 ? viewItems : (viewInvoice.items ?? []);
    return { invoice: viewInvoice, items };
  }, [viewInvoice, viewItems]);

  const getVehicleDisplay = (inv: InvoiceWithRelations): string => {
    if (inv.invoiceVehicles && inv.invoiceVehicles.length > 0) {
      const count = inv.invoiceVehicles.length;
      const parts = inv.invoiceVehicles.map(v => {
        const type = v.vehicle_type ? `${v.vehicle_type} - ` : '';
        return `${type}${v.vehicle_number ?? ''}`;
      }).filter(x => x.replace(/.*-\s*/, '').length > 0);
      return parts.length > 0 ? parts.join(', ') : `${count} Vehicle${count > 1 ? 's' : ''}`;
    }
    return inv.vehicle_number || inv.motor_vehicle_numbers || '-';
  };

  const columns: Column<InvoiceWithRelations>[] = [
    { key: 'invoice_date', header: 'Date', sortable: true, render: i => formatDate(i.invoice_date) },
    { key: 'customer_name', header: t('customer'), render: i => i.customer_name ?? i.customer?.name ?? '-' },
    { key: 'vehicle_number', header: 'Vehicle(s)', render: i => {
      const ivCount = i.invoiceVehicles?.length ?? 0;
      // GST Billing Entry invoices have no invoiceVehicles rows - their multiple
      // vehicles only exist as a comma-joined string on motor_vehicle_numbers.
      const motorList = (i.motor_vehicle_numbers ?? '').split(',').map(s => s.trim()).filter(Boolean);
      const labels = ivCount > 1
        ? i.invoiceVehicles!.map(v => `${v.vehicle_type ? v.vehicle_type + ' - ' : ''}${v.vehicle_number ?? ''}`).filter(Boolean)
        : (ivCount === 0 && motorList.length > 1 ? motorList : null);
      if (labels) {
        const isOpen = vehiclesPopupId === i.id;
        return (
          <div className="relative vehicles-popup-trigger inline-block">
            <button
              type="button"
              onClick={() => setVehiclesPopupId(isOpen ? null : i.id)}
              className="font-medium text-blue-600 hover:underline"
            >
              {labels.length} Vehicles
            </button>
            {isOpen && (
              <div className="absolute z-50 mt-1 left-0 min-w-[180px] bg-white border border-slate-200 rounded-lg shadow-lg py-1.5">
                {labels.map((l, idx) => (
                  <div key={idx} className="px-3 py-1 text-sm text-slate-700 whitespace-nowrap">{l}</div>
                ))}
              </div>
            )}
          </div>
        );
      }
      return <span>{getVehicleDisplay(i)}</span>;
    }},
    { key: 'grand_total', header: 'Trip Total', align: 'right', sortable: true, render: i => <span className="font-semibold">{formatCurrency(i.grand_total)}</span> },
    {
      key: 'invoice_status', header: 'Invoice Status',
      render: i => {
        if (i.invoice_status === 'Draft' || !i.invoice_number) {
          return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border bg-slate-100 text-slate-600 border-slate-200">Not Invoiced</span>;
        }
        return <StatusBadge status={i.invoice_status} />;
      },
    },
    { key: 'invoice_number', header: 'Invoice No.', render: i => i.invoice_number ?? <span className="text-slate-400">-</span> },
    {
      key: 'actions', header: t('actions'), align: 'center',
      render: i => {
        const isDraft = i.invoice_status === 'Draft' || !i.invoice_number;
        // GST Billing Entry assigns a real invoice_number at the very first captured
        // line (see GstBillingEntry.tsx saveLine) - well before the invoice is
        // finalized - so a Draft that already has one can only have come from that
        // flow, even if its billing lines are currently empty (e.g. all deleted).
        // Route it back to Continue Billing rather than the old trip-based Generate
        // Invoice flow, whose "already invoiced" guard rejects any Draft that already
        // carries a number since its own drafts never get one this early.
        const isNewFlowDraft = isDraft && (!!i.invoice_number || (i.billingLines?.length ?? 0) > 0);
        return (
          <div className="flex justify-center gap-1">
            <button onClick={() => { setViewInvoice(i); setViewItems(i.items ?? []); setViewPayments(i.payments ?? []); }} className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md" title="View"><Eye className="w-4 h-4" /></button>
            {isNewFlowDraft ? (
              <button onClick={() => { setResumeGstInvoiceId(i.id); setShowNewGstFlow(true); }} className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-md" title="Continue Billing"><Zap className="w-4 h-4" /></button>
            ) : isDraft ? (
              <button onClick={() => openGenerateInvoice(i)} className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-md" title="Generate Invoice"><Zap className="w-4 h-4" /></button>
            ) : (
              <>
                <button onClick={() => openPrintCopyModal(i, i.items ?? [])} className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md" title="Print"><Printer className="w-4 h-4" /></button>
                <button onClick={() => openEditDetails(i)} className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-md" title="Edit Invoice Details"><FileEdit className="w-4 h-4" /></button>
                <button onClick={() => sendEmail(i)} className="p-1.5 text-slate-500 hover:text-purple-600 hover:bg-purple-50 rounded-md" title="Email"><Mail className="w-4 h-4" /></button>
                {i.invoice_status !== 'Cancelled' && i.invoice_status !== 'Paid' && (
                  <button onClick={() => i.customer_id && openCompanyPayment(i.customer_id)} className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-md" title="Record payment received from this customer/company and automatically adjust outstanding invoices."><IndianRupee className="w-4 h-4" /></button>
                )}
              </>
            )}
            {i.invoice_status !== 'Cancelled' && !isDraft && (
              <button onClick={() => setCancelId(i.id)} className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-md" title="Cancel"><X className="w-4 h-4" /></button>
            )}
            {isAdmin && (
              <button onClick={() => setDeleteId(i.id)} className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-md" title="Delete"><Trash2 className="w-4 h-4" /></button>
            )}
          </div>
        );
      },
    },
  ];

  if (loading) return <LoadingSpinner />;

  if (showNewGstFlow) {
    return <GstBillingEntry invoiceId={resumeGstInvoiceId} onDone={() => { setShowNewGstFlow(false); setResumeGstInvoiceId(null); fetchAll(); }} />;
  }

  // ===== STEP 1: Customer Selection =====
  if (step === 'step1') {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <button onClick={() => setStep('list')} className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-lg font-semibold text-slate-800">{t('gstCompanyBilling')}</h2>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 space-y-6">
          <div>
            <h3 className="text-base font-bold text-slate-800 mb-1">Create Trip</h3>
            <p className="text-sm text-slate-500">Select a customer to begin capturing a trip.</p>
          </div>

          {/* Customer Searchable Dropdown */}
          <Field label="Customer" required>
            <div className="relative">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  <input
                    type="text"
                    className={`${inputClass()} pl-9`}
                    placeholder="Search / Select Customer"
                    value={selectedCustomer ? selectedCustomer.name : customerSearch}
                    onChange={e => {
                      setSelectedCustomerId('');
                      setCustomerSearch(e.target.value);
                      setShowCustomerDropdown(true);
                    }}
                    onFocus={() => setShowCustomerDropdown(true)}
                    onBlur={() => setTimeout(() => setShowCustomerDropdown(false), 200)}
                  />
                </div>
              </div>
              {showCustomerDropdown && !selectedCustomer && (
                <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
                  {filteredCustomers.length === 0 ? (
                    <div className="p-4 text-center text-sm text-slate-400">No customers found</div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {filteredCustomers.map(c => (
                        <button
                          key={c.id}
                          type="button"
                          disabled={!!selectedCustomerId}
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => {
                            setSelectedCustomerId(c.id);
                            setCustomerSearch('');
                            setShowCustomerDropdown(false);
                          }}
                          className="w-full text-left p-3 hover:bg-blue-50 transition-colors disabled:opacity-50 disabled:cursor-default"
                        >
                          <p className="text-sm font-medium text-slate-800">{c.name}</p>
                          {c.company_name && <p className="text-xs text-slate-500">{c.company_name}</p>}
                          {c.phone && <p className="text-xs text-slate-400">{c.phone}</p>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </Field>

          {/* Selected Customer Info */}
          {selectedCustomer && (
            <div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-slate-500">Name: </span><span className="font-medium text-slate-800">{selectedCustomer.name}</span></div>
                <div><span className="text-slate-500">Phone: </span><span className="font-medium">{selectedCustomer.phone ?? '-'}</span></div>
                <div><span className="text-slate-500">Email: </span><span className="font-medium">{selectedCustomer.email ?? '-'}</span></div>
                <div><span className="text-slate-500">GSTIN: </span><span className="font-medium">{selectedCustomer.gstin ?? '-'}</span></div>
              </div>
            </div>
          )}

          {/* Auto-generated Invoice Number (read-only preview) */}
          {previewInvoiceNo && (
            <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-200">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-emerald-600" />
                <span className="text-sm text-slate-600">Invoice Number</span>
              </div>
              <div className="mt-1 text-lg font-bold text-emerald-700 tracking-wide">{previewInvoiceNo}</div>
              <p className="text-xs text-slate-400 mt-1">Auto-generated. This number will be assigned when the bill is saved.</p>
            </div>
          )}

          {/* Invoice Selection */}
          <Field label="Invoice Selection">
            <select
              className={inputClass()}
              value={invoiceSelection}
              onChange={e => setInvoiceSelection(e.target.value as 'cgst_sgst' | 'igst')}
            >
              <option value="cgst_sgst">Intra-State (CGST + SGST)</option>
              <option value="igst">Inter-State (IGST)</option>
            </select>
          </Field>

          {/* Reference No. */}
          <Field label="Reference No.">
            <input
              type="text"
              className={inputClass()}
              value={referenceNo}
              onChange={e => setReferenceNo(e.target.value)}
              placeholder="REF-001, PO-12345, WORK-2026-001"
            />
          </Field>

          {/* NEXT Button */}
          <div className="flex justify-end">
            <Button onClick={handleNext}>
              NEXT <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ===== STEP 2: Trip Entry Form + Capture Trip =====
  if (step === 'step2') {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={() => setStep('step1')} className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-lg font-semibold text-slate-800">Add New Trip Entries</h2>
        </div>

        {/* Customer Summary Bar */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-slate-500 block text-xs">Reference No.</span>
              <span className="font-medium">{referenceNo || '-'}</span>
            </div>
            <div>
              <span className="text-slate-500 block text-xs">Customer</span>
              <span className="font-medium">{selectedCustomer?.name ?? '-'}</span>
            </div>
            <div>
              <span className="text-slate-500 block text-xs">Phone</span>
              <span className="font-medium">{selectedCustomer?.phone ?? '-'}</span>
            </div>
            <div>
              <span className="text-slate-500 block text-xs">GST Type</span>
              <span className="font-medium">{gstType === 'cgst_sgst' ? 'Intra-State (CGST+SGST)' : 'Inter-State (IGST)'}</span>
            </div>
          </div>
        </div>

        {/* Trip Entry Form */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <TripEntryForm
            onSubmit={captureTrip}
            onCancel={() => setStep('step1')}
            submitLabel="Capture Trip"
            submitting={capturing}
            lockedCustomerId={selectedCustomerId}
          />
        </div>
      </div>
    );
  }

  // ===== LIST TAB =====
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div />
        <div className="flex gap-2">
          <Button onClick={() => setShowNewGstFlow(true)}>
            <Plus className="w-4 h-4" />New GST Invoice
          </Button>
        </div>
      </div>

      {/* Customer Statement - the primary way to review a customer's billing position:
          pick a customer to see every invoice they have in one bank-statement-style
          ledger with running totals, instead of hunting through the flat invoice list. */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Customer Statement</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <Field label="Customer / Company">
            <SearchableSelect
              value={statementCustomerId}
              onChange={setStatementCustomerId}
              placeholder="Select a customer to view their statement"
              searchPlaceholder="Search customer..."
              options={customers.map(c => ({ value: c.id, label: c.name, searchText: `${c.name} ${c.phone ?? ''}` }))}
            />
          </Field>
          <Field label="Date Quick Filter">
            <select
              className={inputClass()}
              value={dateQuickFilter}
              onChange={e => applyDateQuickFilter(e.target.value as DateQuickFilter)}
            >
              <option value="Today">Today</option>
              <option value="Yesterday">Yesterday</option>
              <option value="Custom">Custom</option>
            </select>
          </Field>
          {dateQuickFilter === 'Custom' ? (
            <>
              <Field label="Date From">
                <DatePicker value={statementFrom} onChange={setStatementFrom} />
              </Field>
              <Field label="Date To">
                <DatePicker value={statementTo} onChange={setStatementTo} />
              </Field>
            </>
          ) : (
            <div className="sm:col-span-2 lg:col-span-2">
              <Field label="Selected Date Range">
                <div className={classNames(inputClass(), 'bg-slate-100 text-slate-500')}>
                  {formatDate(statementFrom)}{statementTo !== statementFrom ? ` – ${formatDate(statementTo)}` : ''}
                </div>
              </Field>
            </div>
          )}
          <Field label="Status">
            <select className={inputClass()} value={statementStatus} onChange={e => setStatementStatus(e.target.value as typeof statementStatus)}>
              <option value="All">All</option>
              <option value="Paid">Paid</option>
              <option value="Partially Paid">Partially Paid</option>
              <option value="Pending">Pending</option>
              <option value="Outstanding">Outstanding (Balance &gt; 0)</option>
            </select>
          </Field>
        </div>

        {statementCustomerId && selectedStatementCustomer && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
              <div className="bg-slate-50 rounded-lg border border-slate-200 p-3">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Total Invoices</div>
                <div className="text-xl font-bold text-slate-800">{statementSummary.count}</div>
              </div>
              <div className="bg-slate-50 rounded-lg border border-slate-200 p-3">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Total Amount</div>
                <div className="text-xl font-bold text-slate-800">{formatCurrency(statementSummary.totalAmount)}</div>
              </div>
              <div className="bg-emerald-50 rounded-lg border border-emerald-200 p-3">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Received</div>
                <div className="text-xl font-bold text-emerald-600">{formatCurrency(statementSummary.totalReceived)}</div>
              </div>
              <div className="bg-red-50 rounded-lg border border-red-200 p-3">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Pending</div>
                <div className="text-xl font-bold text-red-600">{formatCurrency(statementSummary.totalPending)}</div>
              </div>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-xs uppercase text-slate-600">
                    <th className="text-center px-3 py-2 border-b border-slate-200">Sl. No.</th>
                    <th className="text-left px-3 py-2 border-b border-slate-200">Date</th>
                    <th className="text-left px-3 py-2 border-b border-slate-200">Invoice Number</th>
                    <th className="text-right px-3 py-2 border-b border-slate-200">Total Amt</th>
                    <th className="text-right px-3 py-2 border-b border-slate-200">Received Amt</th>
                    <th className="text-left px-3 py-2 border-b border-slate-200">Received Date</th>
                    <th className="text-right px-3 py-2 border-b border-slate-200">Balance Amt</th>
                    <th className="text-center px-3 py-2 border-b border-slate-200">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {statementRows.length === 0 ? (
                    <tr><td colSpan={8} className="text-center py-8 text-slate-400">
                      {(dateQuickFilter !== 'Custom' || statementFrom || statementTo) ? 'No invoices found for the selected date range.' : 'No invoices found for this customer/period/filter.'}
                    </td></tr>
                  ) : statementRows.map((r, idx) => (
                    <tr key={r.inv.id} className={idx % 2 ? 'bg-slate-50' : 'bg-white'}>
                      <td className="text-center px-3 py-1.5 border-b border-slate-100">{idx + 1}</td>
                      <td className="px-3 py-1.5 border-b border-slate-100">{formatDate(r.inv.invoice_date)}</td>
                      <td className="px-3 py-1.5 border-b border-slate-100 font-medium text-slate-700">{r.inv.invoice_number}</td>
                      <td className="text-right px-3 py-1.5 border-b border-slate-100">{formatCurrency(r.payable)}</td>
                      <td className="text-right px-3 py-1.5 border-b border-slate-100 text-emerald-600">{formatCurrency(r.received)}</td>
                      <td className={classNames('px-3 py-1.5 border-b border-slate-100 text-xs', r.receivedDateLabel === '-' ? 'text-slate-400' : 'text-slate-600')}>{r.receivedDateLabel}</td>
                      <td className={classNames('text-right px-3 py-1.5 border-b border-slate-100 font-semibold', r.balance > 0 ? 'text-red-600' : 'text-slate-400')}>{formatCurrency(r.balance)}</td>
                      <td className="text-center px-3 py-1.5 border-b border-slate-100">
                        <button onClick={() => { setViewInvoice(r.inv); setViewItems(r.inv.items ?? []); setViewPayments(r.inv.payments ?? []); }} className="p-1 text-slate-400 hover:text-blue-600" title="View"><Eye className="w-4 h-4" /></button>
                        <button onClick={() => openPrintCopyModal(r.inv, r.inv.items ?? [])} className="p-1 text-slate-400 hover:text-blue-600" title="Print"><Printer className="w-4 h-4" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {statementRows.length > 0 && (
                  <tfoot>
                    <tr className="bg-slate-100 font-bold">
                      <td colSpan={3} className="px-3 py-2">TOTAL</td>
                      <td className="text-right px-3 py-2">{formatCurrency(statementSummary.totalAmount)}</td>
                      <td className="text-right px-3 py-2 text-emerald-700">{formatCurrency(statementSummary.totalReceived)}</td>
                      <td />
                      <td className="text-right px-3 py-2 text-red-700">{formatCurrency(statementSummary.totalPending)}</td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
              <div className="text-sm text-slate-600">
                <span className="font-semibold text-slate-700">Balance Statement</span> (outstanding only, all-time):{' '}
                {balanceStatementRows.length === 0
                  ? <span className="text-slate-400">no outstanding invoices</span>
                  : <>{balanceStatementRows.length} invoice{balanceStatementRows.length === 1 ? '' : 's'}, <b className="text-red-600">{formatCurrency(balanceStatementSummary.totalPending)}</b> due</>}
              </div>
              <label className="flex items-center gap-1.5 text-sm text-slate-600">
                <input type="checkbox" checked={alsoSendInvoices} onChange={e => setAlsoSendInvoices(e.target.checked)} className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                Also Send Invoices
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button variant="secondary" onClick={() => setStatementCustomerId('')}>Back to All Invoices</Button>
              <Button variant="outline" onClick={printStatement}><Printer className="w-4 h-4" />Print Statement</Button>
              <Button variant="outline" onClick={sendBalanceStatement} disabled={sendingStatement || balanceStatementRows.length === 0}><Mail className="w-4 h-4" />{sendingStatement ? 'Sending...' : 'Send Balance Statement'}</Button>
              <Button onClick={sendFullStatement} disabled={sendingFullStatement || statementRows.length === 0}><Mail className="w-4 h-4" />{sendingFullStatement ? 'Sending...' : 'Send Full Statement'}</Button>
            </div>

            {/* Reminders — moved in from the old standalone Balance Reminders page,
                scoped to this one selected customer (see customerReminderRows above). */}
            <div className="pt-2 border-t border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500 flex items-center gap-1.5"><Bell className="w-3.5 h-3.5" />Reminders</p>
                <Button variant="outline" onClick={() => setShowReminders(v => !v)}>
                  <Bell className="w-4 h-4" />Payment Reminders
                </Button>
              </div>

              {showReminders && (
              <>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-50 rounded-lg border border-slate-200 p-3">
                  <div className="flex items-center gap-1.5 mb-1"><Clock className="w-3.5 h-3.5 text-amber-500" /><span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Day 10 Due</span></div>
                  <div className="text-lg font-bold text-slate-800">{reminderSummary.day10Due}</div>
                </div>
                <div className="bg-slate-50 rounded-lg border border-slate-200 p-3">
                  <div className="flex items-center gap-1.5 mb-1"><AlertCircle className="w-3.5 h-3.5 text-amber-500" /><span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Day 20 Due</span></div>
                  <div className="text-lg font-bold text-slate-800">{reminderSummary.day20Due}</div>
                </div>
              </div>

              {visibleReminderRows.length === 0 ? (
                <p className="text-sm text-slate-400 py-2">No reminders applicable for this customer/period.</p>
              ) : (
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-xs uppercase text-slate-600">
                        <th className="text-left px-3 py-2 border-b border-slate-200">Invoice No</th>
                        <th className="text-right px-3 py-2 border-b border-slate-200">Balance</th>
                        <th className="text-center px-3 py-2 border-b border-slate-200">Reminder</th>
                        <th className="text-left px-3 py-2 border-b border-slate-200">Due Date</th>
                        <th className="text-center px-3 py-2 border-b border-slate-200">Status</th>
                        <th className="text-center px-3 py-2 border-b border-slate-200">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleReminderRows.map(r => (
                        <tr key={`${r.invoice.id}-${r.stage}`} className="hover:bg-slate-50">
                          <td className="px-3 py-1.5 border-b border-slate-100 text-blue-700 font-medium whitespace-nowrap">{r.invoice.invoice_number}</td>
                          <td className="text-right px-3 py-1.5 border-b border-slate-100 font-semibold text-red-600">{formatCurrency(r.balance)}</td>
                          <td className="text-center px-3 py-1.5 border-b border-slate-100 whitespace-nowrap">Day {r.stage}</td>
                          <td className="px-3 py-1.5 border-b border-slate-100 whitespace-nowrap">{formatDate(r.dueDate)}</td>
                          <td className="text-center px-3 py-1.5 border-b border-slate-100">
                            <span className={classNames('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border',
                              r.status === 'Due' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                              r.status === 'Sent' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                              'bg-slate-100 text-slate-600 border-slate-200')}>{r.status}</span>
                          </td>
                          <td className="text-center px-3 py-1.5 border-b border-slate-100">
                            <button onClick={() => openReminderPreview(r)} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md">
                              {r.status === 'Sent' ? <><Eye className="w-3.5 h-3.5" />Send Again</> : <><Send className="w-3.5 h-3.5" />Send</>}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Reminder Preview / Confirm / Send Modal — reused from the old Balance Reminders
          page; the email is not sent until Send Email is clicked. */}
      <Modal
        open={!!reminderPreviewRow}
        onClose={() => setReminderPreviewRow(null)}
        title={`Day ${reminderPreviewRow?.stage ?? ''} Reminder Preview`}
        size="lg"
        closeOnBackdropClick={false}
        footer={
          <>
            <Button variant="secondary" onClick={() => setReminderPreviewRow(null)}>Cancel</Button>
            <Button onClick={sendReminderPreview} disabled={sendingReminder}><Send className="w-4 h-4" />{sendingReminder ? 'Sending...' : 'Send Email'}</Button>
          </>
        }
      >
        {reminderPreviewRow && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-sm p-3 bg-slate-50 rounded-lg border border-slate-200">
              <div><span className="text-slate-500">Customer: </span><b>{reminderPreviewRow.invoice.customer?.name ?? reminderPreviewRow.invoice.customer_name}</b></div>
              <div><span className="text-slate-500">Invoice: </span><b>{reminderPreviewRow.invoice.invoice_number}</b></div>
              <div><span className="text-slate-500">Balance: </span><b className="text-red-600">{formatCurrency(reminderPreviewRow.balance)}</b></div>
              <div><span className="text-slate-500">Email: </span><b>{reminderPreviewRow.invoice.customer?.email ?? reminderPreviewRow.invoice.customer_email ?? <span className="text-red-500">Not on file</span>}</b></div>
            </div>
            <Field label="Subject">
              <input type="text" className={inputClass()} value={reminderPreviewSubject} onChange={e => setReminderPreviewSubject(e.target.value)} />
            </Field>
            <Field label="Body" hint="You can edit this before sending — the saved Day templates in Settings are not changed.">
              <textarea className={inputClass()} rows={10} value={reminderPreviewBody} onChange={e => setReminderPreviewBody(e.target.value)} />
            </Field>
          </div>
        )}
      </Modal>

      {!statementCustomerId && (
        <>
          {/* Search Controls */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex gap-2">
                <button
                  onClick={() => setCustomerSearchMode('invoice')}
                  className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${customerSearchMode === 'invoice' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >Search by Invoice</button>
                <button
                  onClick={() => setCustomerSearchMode('customer')}
                  className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${customerSearchMode === 'customer' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >Search by Customer</button>
              </div>
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  className={`${inputClass()} pl-9`}
                  placeholder={customerSearchMode === 'invoice' ? 'Search by invoice number...' : 'Search by customer name or company...'}
                  value={invoiceSearch}
                  onChange={e => setInvoiceSearch(e.target.value)}
                />
              </div>
              {invoiceSearch && (
                <button onClick={() => setInvoiceSearch('')} className="px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700">Clear</button>
              )}
            </div>
          </div>

          <DataTable
            columns={columns}
            data={filteredInvoices}
            showSerialNumber
          />
        </>
      )}

      {/* View Invoice Modal */}
      <Modal
        open={!!viewInvoiceData}
        onClose={() => { setViewInvoice(null); setViewItems([]); setViewPayments([]); }}
        title={viewInvoiceData?.invoice.invoice_number ? `Invoice ${viewInvoiceData.invoice.invoice_number}` : 'Captured Trip'}
        size="xl"
        closeOnBackdropClick={false}
        footer={
          <>
            <Button variant="secondary" onClick={() => { setViewInvoice(null); setViewItems([]); setViewPayments([]); }}>{t('close')}</Button>
            {viewInvoiceData && (
              <>
                {(() => {
                  const modalIsDraft = viewInvoiceData.invoice.invoice_status === 'Draft' || !viewInvoiceData.invoice.invoice_number;
                  // Same routing as the list's action column - a Draft that already has an
                  // invoice_number can only be a GST Billing Entry draft (it assigns one at
                  // the first captured line, before finalizing), so it goes to Continue
                  // Billing even with 0 lines currently, never to the old trip-based flow.
                  const modalIsNewFlowDraft = modalIsDraft && (!!viewInvoiceData.invoice.invoice_number || (viewInvoiceData.invoice.billingLines?.length ?? 0) > 0);
                  if (modalIsNewFlowDraft) {
                    return (
                      <Button onClick={() => { setViewInvoice(null); setViewItems([]); setResumeGstInvoiceId(viewInvoiceData.invoice.id); setShowNewGstFlow(true); }}>
                        <Zap className="w-4 h-4" />Continue Billing
                      </Button>
                    );
                  }
                  if (modalIsDraft) {
                    return (
                      <Button onClick={() => { setViewInvoice(null); setViewItems([]); openGenerateInvoice(viewInvoiceData.invoice); }}>
                        <Zap className="w-4 h-4" />Generate Invoice
                      </Button>
                    );
                  }
                  return null;
                })()}
                {!(viewInvoiceData.invoice.invoice_status === 'Draft' || !viewInvoiceData.invoice.invoice_number) && (
                  <>
                    <Button variant="outline" onClick={() => openPrintCopyModal(viewInvoiceData.invoice, viewInvoiceData.items)}>
                      <Printer className="w-4 h-4" />{t('print')}
                    </Button>
                    <Button variant="outline" onClick={() => sendEmail(viewInvoiceData.invoice)} disabled={emailSending}>
                      <Mail className="w-4 h-4" />{emailSending ? 'Sending...' : 'Email'}
                    </Button>
                    {viewInvoiceData.invoice.invoice_status !== 'Cancelled' && viewInvoiceData.invoice.invoice_status !== 'Paid' && (
                      <Button onClick={() => { if (viewInvoiceData.invoice.customer_id) openCompanyPayment(viewInvoiceData.invoice.customer_id); setViewInvoice(null); }} title="Record payment received from this customer/company and automatically adjust outstanding invoices.">
                        <IndianRupee className="w-4 h-4" />Record Company Payment
                      </Button>
                    )}
                  </>
                )}
              </>
            )}
          </>
        }
      >
        {viewInvoiceData && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm flex-wrap">
              {viewInvoiceData.invoice.invoice_status === 'Draft' || !viewInvoiceData.invoice.invoice_number ? (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border bg-slate-100 text-slate-600 border-slate-200">Not Invoiced</span>
              ) : (
                <StatusBadge status={viewInvoiceData.invoice.invoice_status} />
              )}
              <span className="text-slate-500">|</span>
              <span className="text-slate-600">Grand Total: <span className="font-medium">{formatCurrency(viewInvoiceData.invoice.grand_total)}</span></span>
              {viewInvoiceData.invoice.discount_enabled && (
                <>
                  <span className="text-slate-500">|</span>
                  <span className="text-red-600">Discount ({viewInvoiceData.invoice.discount_percent}%): -{formatCurrency(Number(viewInvoiceData.invoice.discount_amount) || 0)}</span>
                  <span className="text-slate-500">|</span>
                  <span className="text-blue-700 font-medium">Net Payable: {formatCurrency(Number(viewInvoiceData.invoice.final_payable_amount ?? viewInvoiceData.invoice.grand_total))}</span>
                </>
              )}
              {viewInvoiceData.invoice.invoice_number && (
                <>
                  <span className="text-slate-500">|</span>
                  <span className="text-slate-600">Received: <span className="text-emerald-600 font-medium">{formatCurrency(viewInvoiceData.invoice.amount_received)}</span></span>
                  <span className="text-slate-500">|</span>
                  <span className="text-slate-600">Balance: <span className="text-red-600 font-medium">{formatCurrency(Math.max(0, Number(viewInvoiceData.invoice.discount_enabled ? viewInvoiceData.invoice.final_payable_amount ?? viewInvoiceData.invoice.grand_total : viewInvoiceData.invoice.grand_total) - Number(viewInvoiceData.invoice.amount_received)))}</span></span>
                </>
              )}
              {viewInvoiceData.invoice.email_status === 'SENT' && (
                <>
                  <span className="text-slate-500">|</span>
                  <span className="text-blue-600 font-medium flex items-center gap-1"><Mail className="w-3 h-3" />Sent{viewInvoiceData.invoice.email_sent_to ? ` to ${viewInvoiceData.invoice.email_sent_to}` : ''}</span>
                </>
              )}
            </div>

            {/* Trip details summary */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm bg-slate-50 p-3 rounded-lg">
              <div><span className="text-slate-500 font-medium">Customer: </span><span className="font-medium text-slate-700">{viewInvoiceData.invoice.customer_name ?? viewInvoiceData.invoice.customer?.name ?? '-'}</span></div>
              <div><span className="text-slate-500 font-medium">Date: </span><span className="font-medium text-slate-700">{formatDate(viewInvoiceData.invoice.trip_date ?? viewInvoiceData.invoice.invoice_date)}</span></div>
              <div><span className="text-slate-500 font-medium">Vehicles: </span><span className="font-medium text-slate-700">{getVehicleDisplay(viewInvoiceData.invoice)}</span></div>
              <div><span className="text-slate-500 font-medium">Place of Work: </span><span className="font-medium text-slate-700">{viewInvoiceData.invoice.place_of_work ?? '-'}</span></div>
            </div>

            {viewPayments.length > 0 && (
              <details className="text-sm" open>
                <summary className="cursor-pointer font-semibold text-slate-700 mb-1">Payment History ({viewPayments.length})</summary>
                <table className="w-full mt-2">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className="px-2 py-1 text-xs text-left border border-slate-200">Payment Date</th>
                      <th className="px-2 py-1 text-xs text-right border border-slate-200">Amount</th>
                      <th className="px-2 py-1 text-xs text-left border border-slate-200">Mode</th>
                      <th className="px-2 py-1 text-xs text-left border border-slate-200">Reference</th>
                      <th className="px-2 py-1 text-xs text-right border border-slate-200">Remaining Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewPayments.map((p, idx) => {
                      const totalAfter = viewPayments.slice(0, idx + 1).reduce((s, pp) => s + Number(pp.amount), 0);
                      const payableForRemaining = viewInvoiceData?.invoice.discount_enabled ? Number(viewInvoiceData.invoice.final_payable_amount ?? viewInvoiceData.invoice.grand_total) : Number(viewInvoiceData?.invoice.grand_total ?? 0);
                      const remaining = Math.max(0, payableForRemaining - totalAfter);
                      return (
                        <tr key={p.id}>
                          <td className="px-2 py-1 text-xs border border-slate-200">{formatDate(p.payment_date)}</td>
                          <td className="px-2 py-1 text-xs text-right border border-slate-200">{formatCurrency(p.amount)}</td>
                          <td className="px-2 py-1 text-xs border border-slate-200">{p.payment_mode ?? '-'}</td>
                          <td className="px-2 py-1 text-xs border border-slate-200">{p.reference ?? '-'}</td>
                          <td className="px-2 py-1 text-xs text-right border border-slate-200">{formatCurrency(remaining)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-100 font-semibold">
                      <td className="px-2 py-1 text-xs border border-slate-200" colSpan={1}>Total</td>
                      <td className="px-2 py-1 text-xs text-right border border-slate-200">{formatCurrency(viewPayments.reduce((s, p) => s + Number(p.amount), 0))}</td>
                      <td className="px-2 py-1 text-xs border border-slate-200" colSpan={2}></td>
                      <td className="px-2 py-1 text-xs text-right border border-slate-200">{formatCurrency(Math.max(0, (viewInvoiceData?.invoice.discount_enabled ? Number(viewInvoiceData.invoice.final_payable_amount ?? viewInvoiceData.invoice.grand_total) : Number(viewInvoiceData?.invoice.grand_total ?? 0)) - viewPayments.reduce((s, p) => s + Number(p.amount), 0)))}</td>
                    </tr>
                  </tfoot>
                </table>
              </details>
            )}
            {viewInvoiceData.invoice.invoice_number && viewInvoiceData.items.length > 0 && (
              <div className="border border-slate-300 rounded-lg overflow-hidden bg-white">
                <iframe
                  title="Invoice Preview"
                  srcDoc={invoiceDocHTML(viewInvoiceData.invoice, viewInvoiceData.items, settings, invoiceSettings, 'master', 'tax', rateMasterRows, vehiclesList)}
                  className="w-full"
                  style={{ height: '70vh', border: 'none' }}
                />
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Generate Invoice Modal */}
      <Modal
        open={!!generateInvoiceModal}
        onClose={() => setGenerateInvoiceModal(null)}
        title="Generate Invoice"
        size="sm"
        closeOnBackdropClick={false}
        footer={
          <>
            <Button variant="secondary" onClick={() => setGenerateInvoiceModal(null)}>{t('cancel')}</Button>
            <Button onClick={confirmGenerateInvoice} disabled={generatingInvoiceNo}>
              {generatingInvoiceNo ? <><FileText className="w-4 h-4 animate-spin" />Generating...</> : <><Zap className="w-4 h-4" />Generate</>}
            </Button>
          </>
        }
      >
        {generateInvoiceModal && (
          <div className="space-y-4">
            <div className="p-3 bg-slate-50 rounded-lg text-sm space-y-1">
              <div className="flex justify-between"><span className="text-slate-500">Customer:</span><span className="font-medium">{generateInvoiceModal.customer_name ?? generateInvoiceModal.customer?.name ?? '-'}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Trip Date:</span><span className="font-medium">{formatDate(generateInvoiceModal.trip_date ?? generateInvoiceModal.invoice_date)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Vehicles:</span><span className="font-medium">{getVehicleDisplay(generateInvoiceModal)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Trip Total:</span><span className="font-medium">{formatCurrency(Number(generateInvoiceModal.grand_total))}</span></div>
            </div>

            <Field label="Invoice Date" required>
              <DatePicker
                value={generateInvoiceDate}
                onChange={v => setGenerateInvoiceDate(v)}
              />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Add GST">
                <label className="flex items-center gap-2 mt-2">
                  <input type="checkbox" checked={addGst} onChange={e => setAddGst(e.target.checked)} className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                  <span className="text-sm text-slate-600">Apply GST</span>
                </label>
              </Field>
              {addGst && (
                <div className="col-span-2">
                  <div className="flex gap-4 mb-2">
                    <label className="flex items-center gap-2 text-sm text-slate-600">
                      <input type="radio" name="gst_type_gen" checked={gstType === 'cgst_sgst'} onChange={() => setGstType('cgst_sgst')} className="w-4 h-4 text-blue-600" />
                      Intra-State (CGST+SGST)
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-600">
                      <input type="radio" name="gst_type_gen" checked={gstType === 'igst'} onChange={() => setGstType('igst')} className="w-4 h-4 text-blue-600" />
                      Inter-State (IGST)
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {gstType === 'cgst_sgst' && (
                      <>
                        <Field label={t('cgstPercent')}>
                          <input type="number" step="0.01" className={inputClass()} value={cgstPercent} onChange={e => setCgstPercent(Number(e.target.value))} />
                        </Field>
                        <Field label={t('sgstPercent')}>
                          <input type="number" step="0.01" className={inputClass()} value={sgstPercent} onChange={e => setSgstPercent(Number(e.target.value))} />
                        </Field>
                      </>
                    )}
                    {gstType === 'igst' && (
                      <Field label="IGST %">
                        <input type="number" step="0.01" className={inputClass()} value={igstPercent} onChange={e => setIgstPercent(Number(e.target.value))} />
                      </Field>
                    )}
                  </div>
                </div>
              )}
              <Field label={t('remarks')}>
                <input className={inputClass()} value={remarks} onChange={e => setRemarks(e.target.value)} />
              </Field>
            </div>

            <div className="border-t border-slate-200 pt-4 space-y-2">
              <div className="flex items-center gap-3">
                <input type="checkbox" id="discount-enabled-inv" checked={discountEnabled} onChange={e => setDiscountEnabled(e.target.checked)} className="w-4 h-4 accent-blue-600" />
                <label htmlFor="discount-enabled-inv" className="text-sm font-semibold text-slate-700">Apply Discount</label>
                {discountEnabled && (
                  <div className="flex items-center gap-2 ml-auto">
                    <label className="text-sm text-slate-600">Discount (%):</label>
                    <input type="number" min={0} max={100} step="0.5" className={inputClass() + ' w-24'} value={discountPercent} onChange={e => setDiscountPercent(Number(e.target.value))} placeholder="e.g. 5" />
                  </div>
                )}
              </div>
              {discountEnabled && (
                <p className="text-xs text-slate-500">Discount will be applied to the grand total (including GST). The final payable amount will be shown on the generated invoice.</p>
              )}
            </div>

            <p className="text-xs text-slate-500">A unique invoice number will be generated automatically using the global sequence (e.g. PCS/DD-MM-YYYY/NNN).</p>
          </div>
        )}
      </Modal>

      {/* Record Company Payment — customer-wise, auto-allocated FIFO across every
          outstanding invoice (oldest first), not a single selected invoice. */}
      <Modal
        open={!!companyPaymentModal}
        onClose={() => setCompanyPaymentModal(null)}
        title="Record Company Payment"
        size="sm"
        closeOnBackdropClick={false}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCompanyPaymentModal(null)}>{t('cancel')}</Button>
            <Button onClick={recordCompanyPayment} disabled={recordingCompanyPayment}><CheckCircle2 className="w-4 h-4" />{recordingCompanyPayment ? 'Saving...' : 'Save Payment'}</Button>
          </>
        }
      >
        {companyPaymentModal && (
          <div className="space-y-4">
            <div className="p-3 bg-slate-50 rounded-lg text-sm space-y-1">
              <div className="flex justify-between"><span className="text-slate-500">Customer / Company:</span><span className="font-medium">{companyPaymentModal.customerName}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Outstanding Invoices:</span><span className="font-medium">{companyPaymentModal.outstandingInvoices.length}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Total Outstanding Balance:</span><span className="text-red-600 font-medium">{formatCurrency(companyPaymentModal.totalOutstanding)}</span></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount Received" required>
                <input type="number" step="0.01" min="0" className={inputClass()} value={companyPaymentForm.amount ?? ''} onChange={e => setCompanyPaymentForm(f => ({ ...f, amount: e.target.value === '' ? null : Number(e.target.value) }))} placeholder="Enter Amount Received" />
              </Field>
              <Field label="Payment Date" required>
                <DatePicker value={companyPaymentForm.payment_date} onChange={v => setCompanyPaymentForm(f => ({ ...f, payment_date: v }))} />
              </Field>
              <div className="col-span-2">
                <Field label="Reference Number">
                  <input className={inputClass()} value={companyPaymentForm.reference} onChange={e => setCompanyPaymentForm(f => ({ ...f, reference: e.target.value }))} placeholder="Bank transaction / UTR / cheque reference (optional)" />
                </Field>
              </div>
              <div className="col-span-2">
                <Field label="Notes">
                  <input className={inputClass()} value={companyPaymentForm.remarks} onChange={e => setCompanyPaymentForm(f => ({ ...f, remarks: e.target.value }))} placeholder="Optional" />
                </Field>
              </div>
            </div>
            {companyPaymentForm.amount != null && companyPaymentForm.amount > 0 && (
              <div className="p-3 bg-blue-50 rounded-lg text-sm space-y-1.5 border border-blue-100">
                <div className="flex justify-between"><span className="text-slate-500">Total Outstanding:</span><span className="font-medium">{formatCurrency(companyPaymentModal.totalOutstanding)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Remaining Balance After Payment:</span><span className={newBalanceAfterCompanyPayment <= 0 ? 'text-emerald-600 font-bold' : 'text-red-600 font-medium'}>{formatCurrency(Math.max(0, newBalanceAfterCompanyPayment))}</span></div>
                <div className="pt-1.5 border-t border-blue-100 space-y-1">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Auto-Allocation (oldest invoice first)</p>
                  {(() => {
                    let remaining = companyPaymentForm.amount ?? 0;
                    return companyPaymentModal.outstandingInvoices.map(row => {
                      const alloc = Math.max(0, Math.min(remaining, row.balance));
                      remaining = Math.round((remaining - alloc) * 100) / 100;
                      if (alloc <= 0) return null;
                      const willBePaid = alloc >= row.balance - 0.01;
                      return (
                        <div key={row.inv.id} className="flex justify-between text-xs">
                          <span className="text-slate-600">{row.inv.invoice_number} {willBePaid ? <span className="text-emerald-600 font-semibold">(Fully Paid)</span> : <span className="text-amber-600 font-semibold">(Partially Paid)</span>}</span>
                          <span className="font-medium text-slate-800 tabular-nums">{formatCurrency(alloc)}</span>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!cancelId}
        onClose={() => setCancelId(null)}
        onConfirm={handleCancel}
        title="Cancel Invoice"
        message="Are you sure you want to cancel this invoice? This action cannot be undone. The invoice will remain in the system for audit purposes."
        confirmText="Cancel Invoice"
        danger
      />

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Trip / Invoice"
        message="This will permanently delete the record, its vehicles, sessions, line items, and payment records. This action cannot be undone."
        confirmText={deleting ? 'Deleting...' : 'Delete Permanently'}
        danger
      />

      {/* Print Copy Selection Modal */}
      <Modal
        open={!!printCopyModal}
        onClose={() => setPrintCopyModal(null)}
        title="Select Invoice Copy"
        size="sm"
        closeOnBackdropClick={false}
        footer={
          <Button variant="secondary" onClick={() => setPrintCopyModal(null)}>{t('cancel')}</Button>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-600">Select which copy to print for invoice <strong>{printCopyModal?.invoice_number}</strong>.</p>
          <div className="space-y-2">
            {([['master', 'Master Copy'], ['duplicate', 'Duplicate Copy'], ['extra', 'Extra Copy'], ['all', 'All 3 Copies']] as const).map(([value, label]) => (
              <button
                key={value}
                onClick={() => {
                  if (printCopyModal) {
                    doPrint(printCopyModal, printCopyItems, value);
                    setPrintCopyModal(null);
                  }
                }}
                className="w-full text-left p-3 border border-slate-200 rounded-lg hover:bg-blue-50 hover:border-blue-300 transition-colors font-medium text-slate-700"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </Modal>

      {/* Edit Invoice Details Modal - the top-right print block's editable fields */}
      <Modal
        open={!!editDetailsModal}
        onClose={() => !savingDetails && setEditDetailsModal(null)}
        title="Edit Invoice Details"
        size="lg"
        closeOnBackdropClick={false}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditDetailsModal(null)} disabled={savingDetails}>{t('cancel')}</Button>
            <Button onClick={saveEditDetails} disabled={savingDetails}>{savingDetails ? 'Saving...' : 'Save Invoice Details'}</Button>
          </>
        }
      >
        {editDetailsModal && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 p-3 bg-slate-50 rounded-lg border border-slate-200">
              <Field label="Invoice No."><div className={classNames(inputClass(), 'bg-slate-100 text-slate-500')}>{editDetailsModal.invoice_number}</div></Field>
              <Field label="Billing Date"><div className={classNames(inputClass(), 'bg-slate-100 text-slate-500')}>{formatDate(editDetailsModal.invoice_date)}</div></Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Delivery Note">
                <input className={inputClass()} value={editDetailsForm.delivery_note} onChange={e => setEditDetailsForm(f => ({ ...f, delivery_note: e.target.value }))} />
              </Field>
              <Field label="Mode/Terms of Payment">
                <input className={inputClass()} value={editDetailsForm.terms_of_payment} onChange={e => setEditDetailsForm(f => ({ ...f, terms_of_payment: e.target.value }))} placeholder={invoiceSettings?.default_payment_terms || 'e.g. 7 days'} />
              </Field>
              <Field label="Reference No.">
                <input className={inputClass()} value={editDetailsForm.reference_no} onChange={e => setEditDetailsForm(f => ({ ...f, reference_no: e.target.value }))} />
              </Field>
              <Field label="Reference Date">
                <DatePicker value={editDetailsForm.reference_date} onChange={v => setEditDetailsForm(f => ({ ...f, reference_date: v }))} />
              </Field>
              <Field label="Buyer's Order No.">
                <input className={inputClass()} value={editDetailsForm.buyer_order_no} onChange={e => setEditDetailsForm(f => ({ ...f, buyer_order_no: e.target.value }))} />
              </Field>
              <Field label="Buyer's Order Date">
                <DatePicker value={editDetailsForm.buyer_order_date} onChange={v => setEditDetailsForm(f => ({ ...f, buyer_order_date: v }))} />
              </Field>
              <Field label="Dispatch Doc No.">
                <input className={inputClass()} value={editDetailsForm.dispatch_doc_no} onChange={e => setEditDetailsForm(f => ({ ...f, dispatch_doc_no: e.target.value }))} />
              </Field>
              <Field label="Delivery Note Date">
                <DatePicker value={editDetailsForm.delivery_note_date} onChange={v => setEditDetailsForm(f => ({ ...f, delivery_note_date: v }))} />
              </Field>
              <Field label="Dispatched through">
                <input className={inputClass()} value={editDetailsForm.dispatched_through} onChange={e => setEditDetailsForm(f => ({ ...f, dispatched_through: e.target.value }))} />
              </Field>
              <Field label="Destination">
                <input className={inputClass()} value={editDetailsForm.destination} onChange={e => setEditDetailsForm(f => ({ ...f, destination: e.target.value }))} placeholder="e.g. Hyderabad" />
              </Field>
              <Field label="Bill of Lading/LR-RR No.">
                <input className={inputClass()} value={editDetailsForm.bill_of_lading_no} onChange={e => setEditDetailsForm(f => ({ ...f, bill_of_lading_no: e.target.value }))} />
              </Field>
              <Field label="Terms of Delivery (Days)">
                <input type="number" min="1" className={inputClass()} value={editDetailsForm.terms_of_delivery_days} onChange={e => setEditDetailsForm(f => ({ ...f, terms_of_delivery_days: Number(e.target.value) || 28 }))} />
              </Field>
            </div>

            <Field label="Due Date">
              <div className={classNames(inputClass(), 'bg-slate-100 text-slate-500')}>
                {editDetailsModal.invoice_date ? formatDate(addDays(editDetailsModal.invoice_date, Math.max(1, Number(editDetailsForm.terms_of_delivery_days) || 28))) : '-'}
                <span className="text-xs ml-1">(auto-calculated from Billing Date + Terms of Delivery)</span>
              </div>
            </Field>

            <Field label="Motor Vehicle No.">
              <div className="flex gap-2">
                <input className={inputClass()} value={editDetailsForm.motor_vehicle_numbers} onChange={e => setEditDetailsForm(f => ({ ...f, motor_vehicle_numbers: e.target.value }))} placeholder="Comma-separated vehicle numbers" />
                <Button variant="outline" onClick={() => setEditDetailsForm(f => ({ ...f, motor_vehicle_numbers: computeVehicleNumbersJoined(editDetailsModal) }))}>
                  Auto-fill
                </Button>
              </div>
              <p className="text-xs text-slate-500 mt-1">Auto-fill collects unique vehicle numbers from this invoice's billing entries. Edit freely to override.</p>
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}

function formatDurationShort(hours: number): string {
  if (!hours || hours <= 0) return '-';
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
