import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/Toast';
import { useSettings } from '@/context/SettingsContext';
import { Button, inputClass, LoadingSpinner, StatusBadge } from '@/components/ui/common';
import { DatePicker } from '@/components/ui/DatePicker';
import { formatCurrency, formatDate, todayISO } from '@/lib/utils';
import { exportToXlsxWithCompany } from '@/lib/exportXlsx';
import { printReportWithCompany } from '@/lib/printReport';
import { round2 } from '@/lib/gstBillingCalc';
import {
  ShoppingCart, Search, X, Printer, FileText, FileSpreadsheet, RefreshCw,
  IndianRupee, Receipt, CalendarDays, ChevronLeft, ChevronRight,
} from 'lucide-react';
import type { Purchase, Vendor } from '@/types';

type PaymentStatusFilter = 'All' | 'Paid' | 'Partial' | 'Pending';
type DateFilter = 'All' | 'Today' | 'Yesterday' | 'This Week' | 'This Month' | 'Last Month' | 'Custom';

const PAGE_SIZES = [10, 25, 50, 100];

// Same quick-range pattern as Purchase.tsx's own dateRangeFor.
function dateRangeFor(filter: DateFilter, customFrom: string, customTo: string): { from: string | null; to: string | null } {
  const today = todayISO();
  const now = new Date(today + 'T00:00:00');
  switch (filter) {
    case 'Today': return { from: today, to: today };
    case 'Yesterday': {
      const d = new Date(now); d.setDate(d.getDate() - 1);
      const s = d.toISOString().split('T')[0];
      return { from: s, to: s };
    }
    case 'This Week': {
      const d = new Date(now);
      const day = d.getDay();
      const diffToMonday = day === 0 ? 6 : day - 1;
      d.setDate(d.getDate() - diffToMonday);
      return { from: d.toISOString().split('T')[0], to: today };
    }
    case 'This Month': {
      const d = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: d.toISOString().split('T')[0], to: today };
    }
    case 'Last Month': {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const to = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: from.toISOString().split('T')[0], to: to.toISOString().split('T')[0] };
    }
    case 'Custom': return { from: customFrom || null, to: customTo || null };
    default: return { from: null, to: null };
  }
}

interface PurchaseRow extends Purchase {
  vendor: { name: string } | null;
}

// purchases has no stored payment-status column - derived the same way Purchase.tsx's
// own dashboard totals already reason about paid_amount vs total_amount.
function paymentStatusOf(r: Pick<Purchase, 'paid_amount' | 'total_amount'>): 'Paid' | 'Partial' | 'Pending' {
  const paid = Number(r.paid_amount) || 0;
  const total = Number(r.total_amount) || 0;
  if (paid <= 0) return 'Pending';
  if (paid >= total) return 'Paid';
  return 'Partial';
}
const STATUS_VARIANT: Record<'Paid' | 'Partial' | 'Pending', 'green' | 'amber' | 'red'> = {
  Paid: 'green', Partial: 'amber', Pending: 'red',
};

export default function PurchaseReport() {
  const { show } = useToast();
  const { settings } = useSettings();

  const [rows, setRows] = useState<PurchaseRow[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);

  const [vendorId, setVendorId] = useState('');
  const [statusFilter, setStatusFilter] = useState<PaymentStatusFilter>('All');
  const [billSearch, setBillSearch] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('This Month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [purRes, vendRes] = await Promise.all([
      supabase.from('purchases').select('*, vendor:vendors(name)').order('purchase_date', { ascending: false }),
      supabase.from('vendors').select('*').order('name'),
    ]);
    if (purRes.error) { show('Unable to load purchases: ' + purRes.error.message, 'error'); setLoading(false); return; }
    setRows((purRes.data ?? []) as PurchaseRow[]);
    setVendors((vendRes.data ?? []) as Vendor[]);
    setLoading(false);
  }, [show]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const { from, to } = useMemo(() => dateRangeFor(dateFilter, customFrom, customTo), [dateFilter, customFrom, customTo]);

  const filteredRows = useMemo(() => {
    let result = rows;
    if (vendorId) result = result.filter(r => r.vendor_id === vendorId);
    if (statusFilter !== 'All') result = result.filter(r => paymentStatusOf(r) === statusFilter);
    if (billSearch.trim()) {
      const q = billSearch.toLowerCase().trim();
      result = result.filter(r => (r.bill_no ?? '').toLowerCase().includes(q));
    }
    if (from) result = result.filter(r => r.purchase_date >= from);
    if (to) result = result.filter(r => r.purchase_date <= to);
    return result;
  }, [rows, vendorId, statusFilter, billSearch, from, to]);

  const thisMonthRange = useMemo(() => dateRangeFor('This Month', '', ''), []);

  const summary = useMemo(() => {
    const totalAmount = round2(filteredRows.reduce((s, r) => s + Number(r.total_amount), 0));
    const totalPaid = round2(filteredRows.reduce((s, r) => s + Number(r.paid_amount), 0));
    const thisMonth = round2(rows.filter(r => (!thisMonthRange.from || r.purchase_date >= thisMonthRange.from) && (!thisMonthRange.to || r.purchase_date <= thisMonthRange.to)).reduce((s, r) => s + Number(r.total_amount), 0));
    return {
      totalAmount, totalPaid,
      totalPending: round2(totalAmount - totalPaid),
      totalEntries: filteredRows.length,
      thisMonth,
    };
  }, [filteredRows, rows, thisMonthRange]);

  useEffect(() => { setPage(1); }, [vendorId, statusFilter, billSearch, dateFilter, customFrom, customTo, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginatedRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const clearFilters = () => {
    setVendorId(''); setStatusFilter('All'); setBillSearch(''); setDateFilter('All'); setCustomFrom(''); setCustomTo('');
  };

  const filterStr = [
    vendorId ? `Supplier: ${vendors.find(v => v.id === vendorId)?.name ?? ''}` : '',
    statusFilter !== 'All' ? `Payment Status: ${statusFilter}` : '',
    billSearch.trim() ? `Invoice No: ${billSearch.trim()}` : '',
  ].filter(Boolean).join(' | ');
  const dateRangeText = `${from || 'All'} - ${to || 'All'}`;

  function buildExportData() {
    const headers = ['SL', 'Date', 'Invoice No', 'Supplier', 'Category', 'Amount', 'Paid', 'Pending', 'Payment Status'];
    const dataRows: (string | number)[][] = filteredRows.map((r, i) => [
      i + 1, formatDate(r.purchase_date), r.bill_no ?? '-', r.vendor?.name ?? '-', '—',
      Number(r.total_amount), Number(r.paid_amount), Number(r.balance_amount), paymentStatusOf(r),
    ]);
    const totalRow = ['', '', '', '', 'Total', summary.totalAmount, summary.totalPaid, summary.totalPending, ''];
    return { headers, dataRows, totalRow };
  }

  function companyInfo() {
    return settings
      ? { company_name: settings.company_name, address: settings.address, phone: settings.phone, email: settings.email, gstin: settings.gstin, pan: settings.pan }
      : { company_name: 'Crane ERP' };
  }

  function handlePrint(orientation: 'portrait' | 'landscape' = 'landscape') {
    const { headers, dataRows, totalRow } = buildExportData();
    printReportWithCompany('Purchase Report', companyInfo(), dateRangeText, new Date().toLocaleString('en-IN'), filterStr, headers, dataRows, totalRow, orientation);
  }

  async function handleExportExcel() {
    const { headers, dataRows, totalRow } = buildExportData();
    await exportToXlsxWithCompany('Purchase_Report.xlsx', 'Purchase Report', companyInfo(), dateRangeText, new Date().toLocaleString('en-IN'), filterStr, headers, dataRows, totalRow);
  }

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><ShoppingCart className="w-5 h-5 text-blue-600" />Purchase Report</h2>
          <p className="text-sm text-slate-500">Track vendor purchase bills, payments and outstanding balances.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => fetchAll()}><RefreshCw className="w-4 h-4" />Refresh</Button>
          <Button variant="outline" onClick={() => handlePrint('portrait')}><Printer className="w-4 h-4" />Print</Button>
          <Button variant="outline" onClick={() => handlePrint('landscape')}><FileText className="w-4 h-4" />Export PDF</Button>
          <Button variant="outline" onClick={handleExportExcel} disabled={filteredRows.length === 0}><FileSpreadsheet className="w-4 h-4" />Export Excel</Button>
        </div>
      </div>

      {/* purchases has no category column anywhere in this schema, and the spec asks
          not to change existing Purchase-module functionality - so the Category
          filter is intentionally omitted here; the table shows "—" for that column. */}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1"><IndianRupee className="w-4 h-4 text-blue-500" /><span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Purchase</span></div>
          <p className="text-xl font-bold text-slate-800">{formatCurrency(summary.totalAmount)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1"><IndianRupee className="w-4 h-4 text-emerald-500" /><span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Paid</span></div>
          <p className="text-xl font-bold text-emerald-600">{formatCurrency(summary.totalPaid)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1"><IndianRupee className="w-4 h-4 text-red-500" /><span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Pending</span></div>
          <p className="text-xl font-bold text-red-600">{formatCurrency(summary.totalPending)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1"><Receipt className="w-4 h-4 text-slate-400" /><span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Entries</span></div>
          <p className="text-xl font-bold text-slate-800">{summary.totalEntries}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1"><CalendarDays className="w-4 h-4 text-blue-500" /><span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">This Month</span></div>
          <p className="text-xl font-bold text-blue-600">{formatCurrency(summary.thisMonth)}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <select className={inputClass()} value={vendorId} onChange={e => setVendorId(e.target.value)}>
            <option value="">All Suppliers</option>
            {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <select className={inputClass()} value={statusFilter} onChange={e => setStatusFilter(e.target.value as PaymentStatusFilter)}>
            <option value="All">All Payment Status</option>
            <option value="Paid">Paid</option>
            <option value="Partial">Partial</option>
            <option value="Pending">Pending</option>
          </select>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input type="text" className={`${inputClass()} pl-9`} placeholder="Search Invoice Number" value={billSearch} onChange={e => setBillSearch(e.target.value)} />
          </div>
          <select className={inputClass()} value={dateFilter} onChange={e => setDateFilter(e.target.value as DateFilter)}>
            {(['All', 'Today', 'Yesterday', 'This Week', 'This Month', 'Last Month', 'Custom'] as DateFilter[]).map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        {dateFilter === 'Custom' && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <DatePicker value={customFrom} onChange={setCustomFrom} placeholder="From Date" />
            <DatePicker value={customTo} onChange={setCustomTo} placeholder="To Date" />
          </div>
        )}
        <div className="flex justify-end">
          <Button variant="secondary" onClick={clearFilters}><X className="w-4 h-4" />Clear Filters</Button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {paginatedRows.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-400">No records found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-slate-100 bg-slate-50/90 backdrop-blur">
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">SL</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Date</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Invoice No</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Supplier</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Category</th>
                  <th className="text-right px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Amount</th>
                  <th className="text-right px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Paid</th>
                  <th className="text-right px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Pending</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Payment Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedRows.map((r, idx) => (
                  <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 text-sm text-slate-500 tabular-nums">{(currentPage - 1) * pageSize + idx + 1}</td>
                    <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">{formatDate(r.purchase_date)}</td>
                    <td className="px-4 py-3 text-sm font-medium text-blue-700 whitespace-nowrap">{r.bill_no ?? '-'}</td>
                    <td className="px-4 py-3 text-sm text-slate-700 whitespace-nowrap">{r.vendor?.name ?? '-'}</td>
                    <td className="px-4 py-3 text-sm text-slate-400 whitespace-nowrap">—</td>
                    <td className="px-4 py-3 text-sm text-slate-800 text-right tabular-nums whitespace-nowrap">{formatCurrency(r.total_amount)}</td>
                    <td className="px-4 py-3 text-sm text-emerald-700 text-right tabular-nums whitespace-nowrap">{formatCurrency(r.paid_amount)}</td>
                    <td className="px-4 py-3 text-sm text-red-600 text-right tabular-nums whitespace-nowrap">{formatCurrency(r.balance_amount)}</td>
                    <td className="px-4 py-3 whitespace-nowrap"><StatusBadge status={paymentStatusOf(r)} variant={STATUS_VARIANT[paymentStatusOf(r)]} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 font-semibold border-t-2 border-slate-200">
                  <td className="px-4 py-3 text-sm text-slate-700" colSpan={5}>Total</td>
                  <td className="px-4 py-3 text-sm text-slate-800 text-right tabular-nums">{formatCurrency(summary.totalAmount)}</td>
                  <td className="px-4 py-3 text-sm text-emerald-700 text-right tabular-nums">{formatCurrency(summary.totalPaid)}</td>
                  <td className="px-4 py-3 text-sm text-red-600 text-right tabular-nums">{formatCurrency(summary.totalPending)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {filteredRows.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 flex-wrap gap-2">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <span>Rows per page:</span>
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
