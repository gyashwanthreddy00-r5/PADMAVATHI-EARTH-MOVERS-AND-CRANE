import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useLang } from '@/context/LangContext';
import { useToast } from '@/components/ui/Toast';
import { useSettings } from '@/context/SettingsContext';
import { Modal, StatusBadge, Button, Field, inputClass, LoadingSpinner } from '@/components/ui/common';
import {
  Printer, Eye, FileSpreadsheet, IndianRupee, X, Search, Mail,
  CheckCircle2, FileText, ChevronLeft, ChevronRight, Wallet, AlertCircle,
} from 'lucide-react';
import {
  formatCurrency, formatDate, todayISO, exportToExcelWithCompany, buildInvoiceLineDescription,
} from '@/lib/utils';
import { DatePicker } from '@/components/ui/DatePicker';
import { invoiceDocHTML } from '@/components/InvoiceDocument';
import type {
  InvoiceWithRelations, InvoiceItem, InvoicePayment,
  InvoiceSettings, PaymentMode, InvoiceStatus,
} from '@/types';

type SettlementStatus = 'All' | 'Pending' | 'Partially Paid' | 'Paid' | 'Overdue';

interface SettlementRow {
  id: string;
  invoice_number: string;
  invoice_date: string;
  reference_no: string | null;
  customer_name: string | null;
  vehicle_numbers: string | null;
  grand_total: number;
  discount_enabled: boolean;
  discount_percent: number;
  discount_amount: number;
  final_payable_amount: number;
  amount_received: number;
  balance: number;
  status: InvoiceStatus;
  is_overdue: boolean;
  payment_count: number;
  last_payment_date: string | null;
  payments: InvoicePayment[];
  items: InvoiceItem[];
  customer_email: string | null;
  customer: { name: string; email: string | null } | null;
  raw: InvoiceWithRelations;
}

const PAGE_SIZES = [10, 25, 50, 100];

function getEmailErrorMessage(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes('testing emails') || normalized.includes('verify a domain') || normalized.includes('testing mode')) {
    return 'Email delivery is still in testing mode. A sending domain must be verified before invoices can be sent to customers.';
  }
  return message;
}

export default function SettlementReport() {
  const { t } = useLang();
  const { show } = useToast();
  const { settings } = useSettings();

  const [invoices, setInvoices] = useState<InvoiceWithRelations[]>([]);
  const [invoiceSettings, setInvoiceSettings] = useState<InvoiceSettings | null>(null);
  const [loading, setLoading] = useState(true);

  // Filters
  const [searchInvoice, setSearchInvoice] = useState('');
  const [searchCustomer, setSearchCustomer] = useState('');
  const [statusFilter, setStatusFilter] = useState<SettlementStatus>('All');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [paymentDateFrom, setPaymentDateFrom] = useState('');
  const [paymentDateTo, setPaymentDateTo] = useState('');

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Modals
  const [viewInvoice, setViewInvoice] = useState<InvoiceWithRelations | null>(null);
  const [viewItems, setViewItems] = useState<InvoiceItem[]>([]);
  const [viewPayments, setViewPayments] = useState<InvoicePayment[]>([]);
  const [paymentModal, setPaymentModal] = useState<InvoiceWithRelations | null>(null);
  const [paymentForm, setPaymentForm] = useState({
    amount: null as number | null,
    payment_date: todayISO(),
    payment_mode: 'Cash' as PaymentMode,
    reference: '',
    remarks: '',
  });
  const [saving, setSaving] = useState(false);
  const [emailSending, setEmailSending] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [invRes, isRes] = await Promise.all([
      supabase
        .from('invoices')
        .select('*, customer:customers!invoices_customer_id_fkey(*), items:invoice_items(*, trip:trips!invoice_items_trip_entry_id_fkey(id,rate_type,total_hours,rental_amount,trip_date,place_of_work,capacity_tons,first_hour_rate,second_hour_rate,weekly_rate_snapshot,daily_rate_snapshot,monthly_rate_snapshot,sessions:trip_sessions(*),vehicle:vehicles!trips_vehicle_id_fkey(id,registration_number,type,capacity))), payments:invoice_payments(*)')
        .eq('invoice_type', 'GST')
        .eq('is_cancelled', false)
        .order('invoice_date', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase.from('invoice_settings').select('*').limit(1).maybeSingle(),
    ]);
    if (invRes.error) {
      show('Unable to load settlement data: ' + invRes.error.message, 'error');
      setLoading(false);
      return;
    }
    setInvoices((invRes.data ?? []) as unknown as InvoiceWithRelations[]);
    setInvoiceSettings(isRes.data as InvoiceSettings | null);
    setLoading(false);
  }, [show]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Build settlement rows with computed balance from payments
  const settlementRows: SettlementRow[] = useMemo(() => {
    return invoices.map(inv => {
      const payments = (inv.payments ?? []) as InvoicePayment[];
      const sortedPayments = [...payments].sort((a, b) =>
        new Date(a.payment_date).getTime() - new Date(b.payment_date).getTime() ||
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
      const grandTotal = Math.round(Number(inv.grand_total) * 100) / 100;
      const payableAmount = inv.discount_enabled ? Math.round(Number(inv.final_payable_amount ?? inv.grand_total) * 100) / 100 : grandTotal;
      const totalReceived = Math.round(sortedPayments.reduce((sum, p) => sum + Number(p.amount), 0) * 100) / 100;
      const balance = Math.max(0, Math.round((payableAmount - totalReceived) * 100) / 100);

      let status: InvoiceStatus;
      if (totalReceived <= 0) status = 'Pending';
      else if (balance <= 0) status = 'Paid';
      else status = 'Partially Paid';

      const lastPaymentDate = sortedPayments.length > 0
        ? sortedPayments[sortedPayments.length - 1].payment_date
        : null;

      const items = (inv.items ?? []) as InvoiceItem[];
      const vehicleNumbers = Array.from(new Set(
        items.map(it => it.trip?.vehicle?.registration_number).filter(Boolean)
      )).join(', ') || null;

      let isOverdue = false;
      if (status !== 'Paid' && inv.invoice_date) {
        const invDate = new Date(inv.invoice_date);
        const now = new Date();
        const diffDays = Math.floor((now.getTime() - invDate.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays > 30) isOverdue = true;
      }

      return {
        id: inv.id,
        invoice_number: inv.invoice_number,
        invoice_date: inv.invoice_date,
        reference_no: inv.reference_no,
        customer_name: inv.customer_name ?? inv.customer?.name ?? null,
        vehicle_numbers: vehicleNumbers,
        grand_total: grandTotal,
        discount_enabled: inv.discount_enabled,
        discount_percent: inv.discount_percent,
        discount_amount: inv.discount_amount,
        final_payable_amount: inv.discount_enabled ? payableAmount : grandTotal,
        amount_received: totalReceived,
        balance,
        status,
        is_overdue: isOverdue,
        payment_count: sortedPayments.length,
        last_payment_date: lastPaymentDate,
        payments: sortedPayments,
        items,
        customer_email: inv.customer_email ?? inv.customer?.email ?? null,
        customer: inv.customer
          ? { name: inv.customer.name, email: inv.customer.email ?? null }
          : null,
        raw: inv,
      };
    });
  }, [invoices]);

  // Apply filters
  const filteredRows = useMemo(() => {
    let result = settlementRows;

    if (searchInvoice.trim()) {
      const q = searchInvoice.toLowerCase().trim();
      result = result.filter(r => r.invoice_number?.toLowerCase().includes(q));
    }

    if (searchCustomer.trim()) {
      const q = searchCustomer.toLowerCase().trim();
      result = result.filter(r =>
        r.customer_name?.toLowerCase().includes(q) ||
        r.customer?.name?.toLowerCase().includes(q),
      );
    }

    if (statusFilter === 'Overdue') {
      result = result.filter(r => r.is_overdue);
    } else if (statusFilter !== 'All') {
      result = result.filter(r => r.status === statusFilter);
    }

    if (dateFrom) {
      result = result.filter(r => r.invoice_date >= dateFrom);
    }
    if (dateTo) {
      result = result.filter(r => r.invoice_date <= dateTo);
    }

    if (paymentDateFrom) {
      result = result.filter(r => r.last_payment_date && r.last_payment_date >= paymentDateFrom);
    }
    if (paymentDateTo) {
      result = result.filter(r => r.last_payment_date && r.last_payment_date <= paymentDateTo);
    }

    return result;
  }, [settlementRows, searchInvoice, searchCustomer, statusFilter, dateFrom, dateTo, paymentDateFrom, paymentDateTo]);

  // Summary cards
  const summary = useMemo(() => {
    const totalInvoices = filteredRows.length;
    const totalInvoiced = Math.round(filteredRows.reduce((s, r) => s + (r.discount_enabled ? Number(r.final_payable_amount ?? r.grand_total) : r.grand_total), 0) * 100) / 100;
    const totalReceived = Math.round(filteredRows.reduce((s, r) => s + r.amount_received, 0) * 100) / 100;
    const totalOutstanding = Math.round(filteredRows.reduce((s, r) => s + r.balance, 0) * 100) / 100;
    const overdueCount = filteredRows.filter(r => r.is_overdue).length;
    const overdueAmount = Math.round(filteredRows.filter(r => r.is_overdue).reduce((s, r) => s + r.balance, 0) * 100) / 100;
    return { totalInvoices, totalInvoiced, totalReceived, totalOutstanding, overdueCount, overdueAmount };
  }, [filteredRows]);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [searchInvoice, searchCustomer, statusFilter, dateFrom, dateTo, paymentDateFrom, paymentDateTo, pageSize]);

  // Paginate
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginatedRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const clearFilters = () => {
    setSearchInvoice('');
    setSearchCustomer('');
    setStatusFilter('All');
    setDateFrom('');
    setDateTo('');
    setPaymentDateFrom('');
    setPaymentDateTo('');
  };

  // Payment modal helpers
  const currentBalance = useMemo(() => {
    if (!paymentModal) return 0;
    const payments = (paymentModal.payments ?? []) as InvoicePayment[];
    const received = Math.round(payments.reduce((s, p) => s + Number(p.amount), 0) * 100) / 100;
    const payable = paymentModal.discount_enabled ? Number(paymentModal.final_payable_amount ?? paymentModal.grand_total) : Number(paymentModal.grand_total);
    return Math.max(0, Math.round((payable - received) * 100) / 100);
  }, [paymentModal]);

  const newBalanceAfterPayment = useMemo(() => {
    const amt = paymentForm.amount ?? 0;
    return Math.max(0, Math.round((currentBalance - amt) * 100) / 100);
  }, [currentBalance, paymentForm.amount]);

  const openPayment = (inv: InvoiceWithRelations) => {
    setPaymentModal(inv);
    const payments = (inv.payments ?? []) as InvoicePayment[];
    const received = Math.round(payments.reduce((s, p) => s + Number(p.amount), 0) * 100) / 100;
    const payable = inv.discount_enabled ? Number(inv.final_payable_amount ?? inv.grand_total) : Number(inv.grand_total);
    const balance = Math.max(0, Math.round((payable - received) * 100) / 100);
    setPaymentForm({
      amount: balance,
      payment_date: todayISO(),
      payment_mode: 'Cash',
      reference: '',
      remarks: '',
    });
  };

  const recordPayment = async () => {
    if (!paymentModal || paymentForm.amount == null || paymentForm.amount <= 0) {
      show('Enter a valid amount greater than 0', 'error');
      return;
    }
    const payments = (paymentModal.payments ?? []) as InvoicePayment[];
    const received = Math.round(payments.reduce((s, p) => s + Number(p.amount), 0) * 100) / 100;
    const payable = paymentModal.discount_enabled ? Number(paymentModal.final_payable_amount ?? paymentModal.grand_total) : Number(paymentModal.grand_total);
    const balance = Math.round((payable - received) * 100) / 100;

    if (paymentForm.amount > balance) {
      show(`Payment amount cannot exceed the outstanding balance of ${formatCurrency(balance)}.`, 'error');
      return;
    }

    setSaving(true);
    const { error: payErr } = await supabase.from('invoice_payments').insert({
      invoice_id: paymentModal.id,
      amount: paymentForm.amount,
      payment_date: paymentForm.payment_date,
      payment_mode: paymentForm.payment_mode,
      reference: paymentForm.reference || null,
      remarks: paymentForm.remarks || null,
      recorded_by: (await supabase.auth.getUser()).data.user?.email ?? null,
    });

    if (payErr) {
      show('Payment could not be saved: ' + payErr.message, 'error');
      setSaving(false);
      return;
    }

    const newReceived = Math.round((received + paymentForm.amount) * 100) / 100;
    const newBalance = Math.max(0, Math.round((payable - newReceived) * 100) / 100);
    const newStatus: InvoiceStatus = newBalance <= 0 ? 'Paid' : 'Partially Paid';

    const { error: invErr } = await supabase.from('invoices').update({
      amount_received: newReceived,
      balance_amount: newBalance,
      invoice_status: newStatus,
      payment_status: newStatus === 'Paid' ? 'Paid' : 'Pending',
    }).eq('id', paymentModal.id);

    if (invErr) {
      show('Payment was saved but the invoice could not be updated: ' + invErr.message, 'error');
      setSaving(false);
      return;
    }

    show('Payment recorded successfully', 'success');
    setPaymentModal(null);
    setPaymentForm({ amount: null, payment_date: todayISO(), payment_mode: 'Cash', reference: '', remarks: '' });
    setSaving(false);
    await fetchAll();
  };

  // Print
  const printInvoice = (inv: InvoiceWithRelations, items: InvoiceItem[]) => {
    const win = window.open('', '_blank');
    if (!win) { show('Please allow popups to print', 'error'); return; }
    const html = invoiceDocHTML(inv, items, settings, invoiceSettings);
    win.document.write(html.replace('</body></html>', '<script>window.onload = () => { window.print(); }</script></body></html>'));
    win.document.close();
  };

  // Email
  const sendEmail = async (inv: InvoiceWithRelations) => {
    const email = inv.customer_email ?? inv.customer?.email;
    if (!email) {
      show('This customer does not have an email address configured. Please add an email in Customer Master.', 'error');
      return;
    }
    setEmailSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-invoice-email', {
        body: { invoiceId: inv.id },
      });
      if (error) {
        let msg = 'Unable to send invoice. Please try again.';
        if (error.context && typeof error.context.json === 'function') {
          try {
            const errBody = await error.context.json();
            if (errBody?.error) msg = errBody.error;
          } catch { /* fall through */ }
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

  // Excel export for a single invoice
  const exportInvoiceExcel = (inv: InvoiceWithRelations, items: InvoiceItem[]) => {
    const headers = [
      'Invoice Number', 'Invoice Date', 'Reference No.', 'Customer', 'GSTIN',
      'Trip Date', 'Vehicle Number', 'Capacity', 'Driver',
      'Place of Work', 'Sessions', 'Description', 'HSN/SAC',
      'Quantity', 'Rate', 'Amount', 'Batha',
      'Taxable Amount', 'CGST', 'SGST', 'IGST', 'Total Tax', 'Grand Total',
    ];
    const rows: (string | number)[][] = items.map(it => {
      const rebuilt = it.trip ? buildInvoiceLineDescription(it.trip) : null;
      const sessionCount = (it.trip as { sessions?: unknown[] } | null)?.sessions?.length ?? 1;
      return [
        inv.invoice_number, formatDate(inv.invoice_date), inv.reference_no ?? '',
        inv.customer_name ?? inv.customer?.name ?? '', inv.customer_gstin ?? inv.customer?.gstin ?? '',
        '', '', '', '', '',
        sessionCount,
        rebuilt ? rebuilt.description : it.description, it.hsn_sac,
        it.quantity, it.rate, it.amount, it.batha,
        '', '', '', '', '', '',
      ];
    });
    if (rows.length === 0) {
      rows.push([
        inv.invoice_number, formatDate(inv.invoice_date), inv.reference_no ?? '', inv.customer_name ?? '', inv.customer_gstin ?? '',
        '', '', '', '', '', '', '', '', '', '', '', '',
        inv.taxable_amount, inv.cgst_amount, inv.sgst_amount, inv.total_gst, inv.grand_total,
      ]);
    } else {
      rows.push([
        '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
        inv.taxable_amount, inv.cgst_amount, inv.sgst_amount, inv.total_gst, inv.grand_total,
      ]);
    }
    exportToExcelWithCompany(
      `Invoice_${inv.invoice_number}.csv`, 'GST Tax Invoice',
      settings ? { company_name: settings.company_name, address: settings.address, phone: settings.phone, email: settings.email, gstin: settings.gstin } : { company_name: 'Crane ERP' },
      formatDate(inv.invoice_date), '', '', headers, rows,
    );
  };

  // Export all filtered settlement rows
  const exportSettlementExcel = () => {
    const headers = [t('invoiceNumber'), t('invoiceDate'), t('referenceNo'), t('companyCustomer'), t('vehicleNumber'), t('sessions'), t('grandTotal'), t('totalReceived'), t('balance'), t('status'), t('overdue'), t('payments'), t('lastPayment')];
    const rows: (string | number)[][] = filteredRows.map(r => [
      r.invoice_number,
      formatDate(r.invoice_date),
      r.reference_no ?? '',
      r.customer_name ?? '',
      r.vehicle_numbers ?? '',
      r.items.reduce((s, it) => s + ((it.trip as { sessions?: unknown[] } | null)?.sessions?.length ?? 1), 0),
      r.grand_total,
      r.amount_received,
      r.balance,
      r.status,
      r.is_overdue ? 'Yes' : 'No',
      r.payment_count,
      r.last_payment_date ? formatDate(r.last_payment_date) : '',
    ]);
    exportToExcelWithCompany(
      'Settlement_Report.csv', 'Settlement Report',
      settings ? { company_name: settings.company_name, address: settings.address, phone: settings.phone, email: settings.email, gstin: settings.gstin } : { company_name: 'Crane ERP' },
      '', '', '', headers, rows,
    );
  };

  const statusVariant = (status: InvoiceStatus): 'green' | 'amber' | 'gray' | 'red' => {
    if (status === 'Paid') return 'green';
    if (status === 'Partially Paid') return 'amber';
    return 'gray';
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-800">{t('settlementReport')}</h2>
          <p className="text-sm text-slate-500">{t('trackPaymentsBalances')}</p>
        </div>
        <Button variant="outline" onClick={exportSettlementExcel} disabled={filteredRows.length === 0}>
          <FileSpreadsheet className="w-4 h-4" />{t('exportReport')}
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1">
            <FileText className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('totalInvoices')}</span>
          </div>
          <p className="text-2xl font-bold text-slate-800">{summary.totalInvoices}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1">
            <Wallet className="w-4 h-4 text-blue-400" />
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('totalInvoiced')}</span>
          </div>
          <p className="text-2xl font-bold text-slate-800">{formatCurrency(summary.totalInvoiced)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1">
            <IndianRupee className="w-4 h-4 text-emerald-500" />
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('totalReceived')}</span>
          </div>
          <p className="text-2xl font-bold text-emerald-600">{formatCurrency(summary.totalReceived)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1">
            <Wallet className="w-4 h-4 text-red-400" />
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('totalOutstanding')}</span>
          </div>
          <p className="text-2xl font-bold text-red-600">{formatCurrency(summary.totalOutstanding)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1">
            <AlertCircle className="w-4 h-4 text-red-500" />
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('overdue')}</span>
          </div>
          <p className="text-2xl font-bold text-red-600">{summary.overdueCount}</p>
          <p className="text-xs text-red-500 mt-0.5">{formatCurrency(summary.overdueAmount)}</p>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              type="text"
              className={`${inputClass()} pl-9`}
              placeholder={t('searchInvoiceNumber')}
              value={searchInvoice}
              onChange={e => setSearchInvoice(e.target.value)}
            />
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              type="text"
              className={`${inputClass()} pl-9`}
              placeholder={t('searchCompanyCustomer')}
              value={searchCustomer}
              onChange={e => setSearchCustomer(e.target.value)}
            />
          </div>
          <select
            className={inputClass()}
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as SettlementStatus)}
          >
            <option value="All">{t('allStatus')}</option>
            <option value="Pending">Pending</option>
            <option value="Partially Paid">Partially Paid</option>
            <option value="Paid">Paid</option>
            <option value="Overdue">{t('overdue')}</option>
          </select>
          <DatePicker value={dateFrom} onChange={v => setDateFrom(v)} />
          <DatePicker value={dateTo} onChange={v => setDateTo(v)} />
          <Button variant="secondary" onClick={clearFilters}>
            <X className="w-4 h-4" />{t('clearFilters')}
          </Button>
        </div>
        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-slate-100">
          <span className="text-xs font-semibold text-slate-500 whitespace-nowrap">{t('paymentDateFilter')}:</span>
          <div className="max-w-[160px]"><DatePicker value={paymentDateFrom} onChange={v => setPaymentDateFrom(v)} /></div>
          <span className="text-slate-400 text-sm">—</span>
          <div className="max-w-[160px]"><DatePicker value={paymentDateTo} onChange={v => setPaymentDateTo(v)} /></div>
        </div>
      </div>

      {/* Settlement Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {paginatedRows.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-400">
            {t('noInvoicesFound')}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-100">
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-800 uppercase tracking-wider whitespace-nowrap">{t('invoiceNumber')}</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-800 uppercase tracking-wider whitespace-nowrap">{t('invoiceDate')}</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-800 uppercase tracking-wider whitespace-nowrap">{t('referenceNo')}</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-800 uppercase tracking-wider whitespace-nowrap">{t('companyCustomer')}</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-800 uppercase tracking-wider whitespace-nowrap">{t('vehicleNumber')}</th>
                  <th className="text-center px-4 py-3 text-xs font-bold text-slate-800 uppercase tracking-wider whitespace-nowrap">{t('sessions')}</th>
                  <th className="text-right px-4 py-3 text-xs font-bold text-slate-800 uppercase tracking-wider whitespace-nowrap">{t('grandTotal')}</th>
                  <th className="text-right px-4 py-3 text-xs font-bold text-slate-800 uppercase tracking-wider whitespace-nowrap">{t('totalReceived')}</th>
                  <th className="text-right px-4 py-3 text-xs font-bold text-slate-800 uppercase tracking-wider whitespace-nowrap">{t('balance')}</th>
                  <th className="text-center px-4 py-3 text-xs font-bold text-slate-800 uppercase tracking-wider whitespace-nowrap">{t('payments')}</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-800 uppercase tracking-wider whitespace-nowrap">{t('status')}</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-800 uppercase tracking-wider whitespace-nowrap">{t('lastPayment')}</th>
                  <th className="text-right px-4 py-3 text-xs font-bold text-slate-800 uppercase tracking-wider whitespace-nowrap">{t('actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedRows.map(row => (
                  <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 text-sm font-medium text-blue-700 whitespace-nowrap">{row.invoice_number}</td>
                    <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">{formatDate(row.invoice_date)}</td>
                    <td className="px-4 py-3 text-sm text-slate-500 whitespace-nowrap">{row.reference_no ?? '-'}</td>
                    <td className="px-4 py-3 text-sm text-slate-700 whitespace-nowrap">{row.customer_name ?? '-'}</td>
                    <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">{row.vehicle_numbers ?? '-'}</td>
                    <td className="px-4 py-3 text-sm text-center text-slate-600 whitespace-nowrap">{row.items.reduce((s, it) => s + ((it.trip as { sessions?: unknown[] } | null)?.sessions?.length ?? 1), 0)}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-slate-800 text-right whitespace-nowrap">{formatCurrency(row.grand_total)}</td>
                    <td className="px-4 py-3 text-sm text-emerald-600 text-right whitespace-nowrap">{formatCurrency(row.amount_received)}</td>
                    <td className="px-4 py-3 text-sm text-red-600 font-medium text-right whitespace-nowrap">{formatCurrency(row.balance)}</td>
                    <td className="px-4 py-3 text-sm text-center text-slate-600 whitespace-nowrap">{row.payment_count > 0 ? row.payment_count : '-'}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        <StatusBadge status={row.status} variant={statusVariant(row.status)} />
                        {row.is_overdue && <StatusBadge status="Overdue" variant="red" />}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-500 whitespace-nowrap">{row.last_payment_date ? formatDate(row.last_payment_date) : '-'}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => { setViewInvoice(row.raw); setViewItems(row.items); setViewPayments(row.payments); }} className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md" title={t('view')}><Eye className="w-4 h-4" /></button>
                        <button onClick={() => printInvoice(row.raw, row.items)} className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md" title={t('print')}><Printer className="w-4 h-4" /></button>
                        <button onClick={() => exportInvoiceExcel(row.raw, row.items)} className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-md" title={t('export')}><FileSpreadsheet className="w-4 h-4" /></button>
                        <button onClick={() => sendEmail(row.raw)} className="p-1.5 text-slate-500 hover:text-purple-600 hover:bg-purple-50 rounded-md" title={t('email')}><Mail className="w-4 h-4" /></button>
                        {row.status !== 'Paid' && row.status !== 'Cancelled' && (
                          <button onClick={() => openPayment(row.raw)} className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-md" title={t('recordPayment')}><IndianRupee className="w-4 h-4" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {filteredRows.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 flex-wrap gap-2">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <span>{t('rowsPerPage')}:</span>
              <select
                className="border border-slate-200 rounded-md px-2 py-1 text-sm text-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
                value={pageSize}
                onChange={e => setPageSize(Number(e.target.value))}
              >
                {PAGE_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <span className="ml-2">
                {((currentPage - 1) * pageSize) + 1}–{Math.min(currentPage * pageSize, filteredRows.length)} of {filteredRows.length}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm text-slate-500 px-2">{currentPage} / {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* View Invoice Modal */}
      <Modal
        open={!!viewInvoice}
        onClose={() => { setViewInvoice(null); setViewItems([]); setViewPayments([]); }}
        title={`Invoice ${viewInvoice?.invoice_number ?? ''}`}
        size="xl"
        footer={
          <>
            <Button variant="secondary" onClick={() => { setViewInvoice(null); setViewItems([]); setViewPayments([]); }}>{t('close')}</Button>
            {viewInvoice && (
              <>
                <Button variant="outline" onClick={() => printInvoice(viewInvoice, viewItems)}>
                  <Printer className="w-4 h-4" />{t('print')}
                </Button>
                <Button variant="outline" onClick={() => exportInvoiceExcel(viewInvoice, viewItems)}>
                  <FileSpreadsheet className="w-4 h-4" />{t('export')}
                </Button>
                <Button variant="outline" onClick={() => sendEmail(viewInvoice)} disabled={emailSending}>
                  <Mail className="w-4 h-4" />{emailSending ? t('sending') : t('email')}
                </Button>
                {viewInvoice.invoice_status !== 'Cancelled' && viewInvoice.invoice_status !== 'Paid' && (
                  <Button onClick={() => { openPayment(viewInvoice); setViewInvoice(null); }}>
                    <IndianRupee className="w-4 h-4" />{t('recordPayment')}
                  </Button>
                )}
              </>
            )}
          </>
        }
      >
        {viewInvoice && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm flex-wrap">
              <StatusBadge status={viewInvoice.invoice_status} variant={statusVariant(viewInvoice.invoice_status)} />
              <span className="text-slate-500">|</span>
              <span className="text-slate-600">{t('received')}: <span className="text-emerald-600 font-medium">{formatCurrency(viewPayments.reduce((s, p) => s + Number(p.amount), 0))}</span></span>
              <span className="text-slate-500">|</span>
              <span className="text-slate-600">{t('outstandingBalance')}: <span className="text-red-600 font-medium">{formatCurrency(Math.max(0, Number(viewInvoice.discount_enabled ? viewInvoice.final_payable_amount ?? viewInvoice.grand_total : viewInvoice.grand_total) - viewPayments.reduce((s, p) => s + Number(p.amount), 0)))}</span></span>
            </div>

            {viewPayments.length > 0 && (
              <details className="text-sm" open>
                <summary className="cursor-pointer font-semibold text-slate-700 mb-1">{t('paymentHistory')} ({viewPayments.length})</summary>
                <div className="overflow-x-auto mt-2">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-slate-50">
                        <th className="px-3 py-2 text-xs text-left border border-slate-200">{t('paymentDate')}</th>
                        <th className="px-3 py-2 text-xs text-right border border-slate-200">{t('amount')}</th>
                        <th className="px-3 py-2 text-xs text-left border border-slate-200">{t('mode')}</th>
                        <th className="px-3 py-2 text-xs text-left border border-slate-200">{t('reference')}</th>
                        <th className="px-3 py-2 text-xs text-left border border-slate-200">{t('remarks')}</th>
                        <th className="px-3 py-2 text-xs text-right border border-slate-200">{t('remainingBalance')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {viewPayments.map((p, idx) => {
                        const totalAfter = viewPayments.slice(0, idx + 1).reduce((s, pp) => s + Number(pp.amount), 0);
                        const remaining = Math.max(0, Number(viewInvoice.discount_enabled ? viewInvoice.final_payable_amount ?? viewInvoice.grand_total : viewInvoice.grand_total) - totalAfter);
                        return (
                          <tr key={p.id}>
                            <td className="px-3 py-2 text-xs border border-slate-200">{formatDate(p.payment_date)}</td>
                            <td className="px-3 py-2 text-xs text-right border border-slate-200">{formatCurrency(p.amount)}</td>
                            <td className="px-3 py-2 text-xs border border-slate-200">{p.payment_mode ?? '-'}</td>
                            <td className="px-3 py-2 text-xs border border-slate-200">{p.reference ?? '-'}</td>
                            <td className="px-3 py-2 text-xs border border-slate-200">{p.remarks ?? '-'}</td>
                            <td className="px-3 py-2 text-xs text-right border border-slate-200">{formatCurrency(remaining)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-100 font-semibold">
                        <td className="px-3 py-2 text-xs border border-slate-200">{t('total')}</td>
                        <td className="px-3 py-2 text-xs text-right border border-slate-200">{formatCurrency(viewPayments.reduce((s, p) => s + Number(p.amount), 0))}</td>
                        <td className="px-3 py-2 text-xs border border-slate-200" colSpan={3}></td>
                        <td className="px-3 py-2 text-xs text-right border border-slate-200">{formatCurrency(Math.max(0, Number(viewInvoice.discount_enabled ? viewInvoice.final_payable_amount ?? viewInvoice.grand_total : viewInvoice.grand_total) - viewPayments.reduce((s, p) => s + Number(p.amount), 0)))}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <div className="mt-2 flex gap-4 text-sm font-medium flex-wrap">
                  <span>{t('invoiceTotal')}: {formatCurrency(viewInvoice.grand_total)}</span>
                  {viewInvoice.discount_enabled && <span className="text-red-600">Discount ({viewInvoice.discount_percent}%): -{formatCurrency(Number(viewInvoice.discount_amount) || 0)}</span>}
                  {viewInvoice.discount_enabled && <span className="text-blue-700 font-medium">Net Payable: {formatCurrency(Number(viewInvoice.final_payable_amount ?? viewInvoice.grand_total))}</span>}
                  <span className="text-emerald-600">{t('totalReceived')}: {formatCurrency(viewPayments.reduce((s, p) => s + Number(p.amount), 0))}</span>
                  <span className="text-red-600">{t('totalPending')}: {formatCurrency(Math.max(0, Number(viewInvoice.discount_enabled ? viewInvoice.final_payable_amount ?? viewInvoice.grand_total : viewInvoice.grand_total) - viewPayments.reduce((s, p) => s + Number(p.amount), 0)))}</span>
                </div>
              </details>
            )}

            <div className="border border-slate-300 rounded-lg overflow-hidden bg-white">
              <iframe
                title="Invoice Preview"
                srcDoc={invoiceDocHTML(viewInvoice, viewItems, settings, invoiceSettings)}
                className="w-full"
                style={{ height: '70vh', border: 'none' }}
              />
            </div>
          </div>
        )}
      </Modal>

      {/* Payment Modal */}
      <Modal
        open={!!paymentModal}
        onClose={() => setPaymentModal(null)}
        title={t('recordPayment')}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPaymentModal(null)}>{t('cancel')}</Button>
            <Button onClick={recordPayment} disabled={saving}>
              <CheckCircle2 className="w-4 h-4" />{saving ? t('saving') : t('savePayment')}
            </Button>
          </>
        }
      >
        {paymentModal && (
          <div className="space-y-4">
            <div className="p-3 bg-slate-50 rounded-lg text-sm space-y-1">
              <div className="flex justify-between"><span className="text-slate-500">{t('invoiceNo')}:</span><span className="font-medium">{paymentModal.invoice_number}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">{t('grandTotal')}:</span><span>{formatCurrency(paymentModal.grand_total)}</span></div>
              {paymentModal.discount_enabled && <div className="flex justify-between"><span className="text-slate-500">Discount ({paymentModal.discount_percent}%):</span><span className="text-red-600">-{formatCurrency(Number(paymentModal.discount_amount) || 0)}</span></div>}
              {paymentModal.discount_enabled && <div className="flex justify-between"><span className="text-slate-500">Net Payable:</span><span className="font-medium text-blue-700">{formatCurrency(Number(paymentModal.final_payable_amount ?? paymentModal.grand_total))}</span></div>}
              <div className="flex justify-between"><span className="text-slate-500">{t('received')}:</span><span className="text-emerald-600">{formatCurrency(currentBalance > 0 ? Number(paymentModal.discount_enabled ? paymentModal.final_payable_amount ?? paymentModal.grand_total : paymentModal.grand_total) - currentBalance : Number(paymentModal.discount_enabled ? paymentModal.final_payable_amount ?? paymentModal.grand_total : paymentModal.grand_total))}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">{t('currentBalance')}:</span><span className="text-red-600 font-medium">{formatCurrency(currentBalance)}</span></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('paymentAmount')} required>
                <input type="number" step="0.01" className={inputClass()} value={paymentForm.amount ?? ''} onChange={e => setPaymentForm(f => ({ ...f, amount: e.target.value === '' ? null : Number(e.target.value) }))} />
              </Field>
              <Field label={t('paymentDate')} required>
                <DatePicker value={paymentForm.payment_date} onChange={v => setPaymentForm(f => ({ ...f, payment_date: v }))} />
              </Field>
              <Field label={t('paymentMode')}>
                <select className={inputClass()} value={paymentForm.payment_mode} onChange={e => setPaymentForm(f => ({ ...f, payment_mode: e.target.value as PaymentMode }))}>
                  <option value="Cash">Cash</option>
                  <option value="UPI">UPI</option>
                  <option value="Bank Transfer">Bank Transfer</option>
                  <option value="Cheque">Cheque</option>
                  <option value="Other">Other</option>
                </select>
              </Field>
              <Field label={t('referenceNumber')}>
                <input className={inputClass()} value={paymentForm.reference} onChange={e => setPaymentForm(f => ({ ...f, reference: e.target.value }))} placeholder="UPI Ref / Transaction ID / Cheque No" />
              </Field>
              <div className="col-span-2">
                <Field label={t('remarks')}>
                  <input className={inputClass()} value={paymentForm.remarks} onChange={e => setPaymentForm(f => ({ ...f, remarks: e.target.value }))} placeholder="Optional notes" />
                </Field>
              </div>
            </div>
            {paymentForm.amount != null && paymentForm.amount > 0 && (
              <div className="p-3 bg-blue-50 rounded-lg text-sm space-y-1 border border-blue-100">
                <div className="flex justify-between"><span className="text-slate-500">{t('currentBalance')}:</span><span className="font-medium">{formatCurrency(currentBalance)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">{t('newBalance')}:</span><span className={newBalanceAfterPayment <= 0 ? 'text-emerald-600 font-bold' : 'text-red-600 font-medium'}>{formatCurrency(newBalanceAfterPayment)}</span></div>
                {newBalanceAfterPayment <= 0 ? (
                  <div className="text-xs text-emerald-600 font-medium pt-1">{t('invoiceWillBePaid')}</div>
                ) : (
                  <div className="text-xs text-amber-600 font-medium pt-1">{t('invoicePartiallyPaid')}</div>
                )}
              </div>
            )}
            {paymentForm.amount != null && paymentForm.amount > currentBalance && (
              <div className="p-3 bg-red-50 rounded-lg text-sm text-red-600 border border-red-200">
                {t('paymentExceedsBalance')}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
