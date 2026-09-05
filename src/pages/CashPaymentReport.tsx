import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useLang } from '@/context/LangContext';
import { useToast } from '@/components/ui/Toast';
import { useSettings } from '@/context/SettingsContext';
import { Button, inputClass, LoadingSpinner } from '@/components/ui/common';
import {
  FileSpreadsheet, X, Search, IndianRupee, Wallet, Banknote,
  CreditCard, Smartphone, ChevronLeft, ChevronRight, FileText,
} from 'lucide-react';
import { formatCurrency, formatDate, exportToExcelWithCompany } from '@/lib/utils';
import { DatePicker } from '@/components/ui/DatePicker';
import type { PaymentMode } from '@/types';

type ModeFilter = 'All' | PaymentMode;

interface PaymentRow {
  id: string;
  invoice_number: string;
  invoice_date: string;
  customer_name: string | null;
  vehicle_numbers: string | null;
  payment_date: string;
  amount: number;
  payment_mode: PaymentMode | null;
  reference: string | null;
  remarks: string | null;
  recorded_by: string | null;
  invoice_grand_total: number;
  invoice_balance: number;
}

const PAGE_SIZES = [10, 25, 50, 100];

const MODE_ICONS: Record<PaymentMode, typeof IndianRupee> = {
  Cash: Banknote,
  UPI: Smartphone,
  'Bank Transfer': IndianRupee,
  Cheque: CreditCard,
  Other: FileText,
};

export default function CashPaymentReport() {
  const { t } = useLang();
  const { show } = useToast();
  const { settings } = useSettings();

  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [searchInvoice, setSearchInvoice] = useState('');
  const [searchCustomer, setSearchCustomer] = useState('');
  const [modeFilter, setModeFilter] = useState<ModeFilter>('All');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    // First get Cash invoice IDs so we only show Cash/UPI payments
    const { data: cashInvs, error: cashErr } = await supabase
      .from('invoices')
      .select('id')
      .eq('invoice_type', 'Cash')
      .eq('is_cancelled', false);
    if (cashErr) {
      show('Unable to load payment data: ' + cashErr.message, 'error');
      setLoading(false);
      return;
    }
    const cashIds = (cashInvs ?? []).map(i => i.id);
    if (cashIds.length === 0) {
      setPayments([]);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from('invoice_payments')
      .select(`
        id, amount, payment_date, payment_mode, reference, remarks, recorded_by,
        invoice:invoices!invoice_payments_invoice_id_fkey(
          id, invoice_number, invoice_date, invoice_type, grand_total, discount_enabled, discount_percent, discount_amount, final_payable_amount, customer_name,
          customer:customers!invoices_customer_id_fkey(id, name),
          items:invoice_items(trip:trips!invoice_items_trip_entry_id_fkey(vehicle:vehicles!trips_vehicle_id_fkey(registration_number)))
        )
      `)
      .in('invoice_id', cashIds)
      .order('payment_date', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      show('Unable to load payment data: ' + error.message, 'error');
      setLoading(false);
      return;
    }

    const rows: PaymentRow[] = (data ?? []).map((p: Record<string, unknown>) => {
      const inv = p.invoice as Record<string, unknown> | null;
      const items = (inv?.items as Record<string, unknown>[] | null) ?? [];
      const vehicleNumbers = Array.from(new Set(
        items.map(it => {
          const trip = it.trip as Record<string, unknown> | null;
          return trip?.vehicle as Record<string, unknown> | null;
        }).filter(Boolean).map(v => v?.registration_number).filter(Boolean)
      )).join(', ') || null;

      const grandTotal = Number(inv?.grand_total ?? 0);
      const customer = inv?.customer as Record<string, unknown> | null;
      const customerName = (inv?.customer_name as string) ?? (customer?.name as string) ?? null;

      return {
        id: p.id as string,
        invoice_number: (inv?.invoice_number as string) ?? '-',
        invoice_date: (inv?.invoice_date as string) ?? '',
        customer_name: customerName,
        vehicle_numbers: vehicleNumbers,
        payment_date: p.payment_date as string,
        amount: Number(p.amount),
        payment_mode: p.payment_mode as PaymentMode | null,
        reference: p.reference as string | null,
        remarks: p.remarks as string | null,
        recorded_by: p.recorded_by as string | null,
        invoice_grand_total: grandTotal,
        invoice_balance: 0,
      };
    });

    setPayments(rows);
    setLoading(false);
  }, [show]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const filteredRows = useMemo(() => {
    let result = payments;
    if (searchInvoice.trim()) {
      const q = searchInvoice.toLowerCase().trim();
      result = result.filter(r => r.invoice_number?.toLowerCase().includes(q));
    }
    if (searchCustomer.trim()) {
      const q = searchCustomer.toLowerCase().trim();
      result = result.filter(r => r.customer_name?.toLowerCase().includes(q));
    }
    if (modeFilter !== 'All') {
      result = result.filter(r => r.payment_mode === modeFilter);
    }
    if (dateFrom) result = result.filter(r => r.payment_date >= dateFrom);
    if (dateTo) result = result.filter(r => r.payment_date <= dateTo);
    return result;
  }, [payments, searchInvoice, searchCustomer, modeFilter, dateFrom, dateTo]);

  const summary = useMemo(() => {
    const totalAmount = Math.round(filteredRows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
    const count = filteredRows.length;
    const byMode: Record<string, number> = {};
    for (const r of filteredRows) {
      const mode = r.payment_mode ?? 'Other';
      byMode[mode] = (byMode[mode] ?? 0) + r.amount;
    }
    return { totalAmount, count, byMode };
  }, [filteredRows]);

  useEffect(() => { setPage(1); }, [searchInvoice, searchCustomer, modeFilter, dateFrom, dateTo, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginatedRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const clearFilters = () => {
    setSearchInvoice('');
    setSearchCustomer('');
    setModeFilter('All');
    setDateFrom('');
    setDateTo('');
  };

  const exportExcel = () => {
    const companyInfo = settings
      ? { company_name: settings.company_name, address: settings.address, phone: settings.phone, email: settings.email, gstin: settings.gstin }
      : { company_name: 'Crane ERP' };
    const headers = [t('invoiceNumber'), t('invoiceDate'), t('customer'), t('vehicleNumber'), t('paymentDate'), t('amount'), t('mode'), t('reference'), t('remarks'), t('recordedBy')];
    const rows: (string | number)[][] = filteredRows.map(r => [
      r.invoice_number,
      formatDate(r.invoice_date),
      r.customer_name ?? '',
      r.vehicle_numbers ?? '',
      formatDate(r.payment_date),
      r.amount,
      r.payment_mode ?? '',
      r.reference ?? '',
      r.remarks ?? '',
      r.recorded_by ?? '',
    ]);
    exportToExcelWithCompany(
      'Cash_Payment_Report.csv', 'Cash & Payment Report',
      companyInfo, `${dateFrom || 'All'} - ${dateTo || 'All'}`, new Date().toLocaleString('en-IN'),
      modeFilter !== 'All' ? `Mode: ${modeFilter}` : '',
      headers, rows,
      ['Total', '', '', '', '', summary.totalAmount, '', '', '', ''],
    );
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-800">{t('cashPaymentReport')}</h2>
          <p className="text-sm text-slate-500">{t('trackPaymentsByMode')}</p>
        </div>
        <Button variant="outline" onClick={exportExcel} disabled={filteredRows.length === 0}>
          <FileSpreadsheet className="w-4 h-4" />{t('exportReport')}
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1">
            <FileText className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('totalPayments')}</span>
          </div>
          <p className="text-2xl font-bold text-slate-800">{summary.count}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1">
            <Wallet className="w-4 h-4 text-emerald-500" />
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('totalCollected')}</span>
          </div>
          <p className="text-2xl font-bold text-emerald-600">{formatCurrency(summary.totalAmount)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1">
            <Banknote className="w-4 h-4 text-amber-500" />
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Cash</span>
          </div>
          <p className="text-2xl font-bold text-amber-600">{formatCurrency(summary.byMode.Cash ?? 0)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1">
            <Smartphone className="w-4 h-4 text-blue-500" />
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">UPI</span>
          </div>
          <p className="text-2xl font-bold text-blue-600">{formatCurrency(summary.byMode.UPI ?? 0)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1">
            <CreditCard className="w-4 h-4 text-purple-500" />
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Cheque/Bank</span>
          </div>
          <p className="text-2xl font-bold text-slate-700">
            {formatCurrency((summary.byMode.Cheque ?? 0) + (summary.byMode['Bank Transfer'] ?? 0))}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input type="text" className={`${inputClass()} pl-9`} placeholder={t('searchInvoiceNumber')} value={searchInvoice} onChange={e => setSearchInvoice(e.target.value)} />
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input type="text" className={`${inputClass()} pl-9`} placeholder={t('searchCompanyCustomer')} value={searchCustomer} onChange={e => setSearchCustomer(e.target.value)} />
          </div>
          <select className={inputClass()} value={modeFilter} onChange={e => setModeFilter(e.target.value as ModeFilter)}>
            <option value="All">{t('allModes')}</option>
            <option value="Cash">Cash</option>
            <option value="UPI">UPI</option>
            <option value="Bank Transfer">{t('bankTransfer')}</option>
            <option value="Cheque">Cheque</option>
            <option value="Other">{t('other')}</option>
          </select>
          <DatePicker value={dateFrom} onChange={v => setDateFrom(v)} />
          <DatePicker value={dateTo} onChange={v => setDateTo(v)} />
          <Button variant="secondary" onClick={clearFilters}><X className="w-4 h-4" />{t('clearFilters')}</Button>
        </div>
      </div>

      {/* Payment Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {paginatedRows.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-400">{t('noPaymentsFound')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">{t('invoiceNumber')}</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">{t('invoiceDate')}</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">{t('customer')}</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">{t('vehicleNumber')}</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">{t('paymentDate')}</th>
                  <th className="text-right px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">{t('amount')}</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">{t('mode')}</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">{t('reference')}</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">{t('recordedBy')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedRows.map(row => {
                  const ModeIcon = row.payment_mode ? MODE_ICONS[row.payment_mode] : FileText;
                  return (
                    <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 text-sm font-medium text-blue-700 whitespace-nowrap">{row.invoice_number}</td>
                      <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">{formatDate(row.invoice_date)}</td>
                      <td className="px-4 py-3 text-sm text-slate-700 whitespace-nowrap">{row.customer_name ?? '-'}</td>
                      <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">{row.vehicle_numbers ?? '-'}</td>
                      <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">{formatDate(row.payment_date)}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-emerald-600 text-right whitespace-nowrap">{formatCurrency(row.amount)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <ModeIcon className="w-3.5 h-3.5 text-slate-400" />
                          <span className="text-sm text-slate-600">{row.payment_mode ?? '-'}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-500 whitespace-nowrap">{row.reference ?? '-'}</td>
                      <td className="px-4 py-3 text-sm text-slate-500 whitespace-nowrap">{row.recorded_by ?? '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 font-semibold border-t-2 border-slate-200">
                  <td className="px-4 py-3 text-sm text-slate-700" colSpan={5}>{t('total')}</td>
                  <td className="px-4 py-3 text-sm text-emerald-700 text-right">{formatCurrency(summary.totalAmount)}</td>
                  <td colSpan={3}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {filteredRows.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 flex-wrap gap-2">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <span>{t('rowsPerPage')}:</span>
              <select className="border border-slate-200 rounded-md px-2 py-1 text-sm text-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500" value={pageSize} onChange={e => setPageSize(Number(e.target.value))}>
                {PAGE_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <span className="ml-2">{((currentPage - 1) * pageSize) + 1}–{Math.min(currentPage * pageSize, filteredRows.length)} of {filteredRows.length}</span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={currentPage <= 1} className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm text-slate-500 px-2">{currentPage} / {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages} className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
