import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/Toast';
import { useSettings } from '@/context/SettingsContext';
import { Button, inputClass, LoadingSpinner, StatusBadge } from '@/components/ui/common';
import { DatePicker } from '@/components/ui/DatePicker';
import { formatCurrency, formatDate, todayISO } from '@/lib/utils';
import { exportToXlsxWithCompany } from '@/lib/exportXlsx';
import { printReportWithCompany } from '@/lib/printReport';
import { getEffectivePoStatus, isPoLowBalance, round2 } from '@/lib/poOrderManagement';
import {
  ClipboardList, Search, X, Printer, FileText, FileSpreadsheet, RefreshCw,
  IndianRupee, CheckCircle2, AlertTriangle, XCircle, ChevronLeft, ChevronRight,
} from 'lucide-react';
import type { PurchaseOrder, PurchaseOrderStatus } from '@/types';

type StatusFilter = 'All' | PurchaseOrderStatus | 'LowBalance';
type DateFilter = 'All' | 'Today' | 'Yesterday' | 'This Week' | 'This Month' | 'Last Month' | 'Custom';

const PAGE_SIZES = [10, 25, 50, 100];

// Same quick-range pattern as Purchase.tsx's dateRangeFor - kept local per that file's
// own precedent (no shared date-quick-filter helper exists yet in this codebase).
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

interface PoRow extends PurchaseOrder {
  customer: { name: string } | null;
}
interface PoRowWithStatus extends PoRow {
  effectiveStatus: PurchaseOrderStatus;
}

const STATUS_VARIANT: Record<PurchaseOrderStatus, 'green' | 'gray' | 'red'> = {
  Active: 'green', Completed: 'gray', Expired: 'red',
};

export default function PoOrdersReport() {
  const { show } = useToast();
  const { settings } = useSettings();

  const [rows, setRows] = useState<PoRow[]>([]);
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const [customerId, setCustomerId] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  const [poSearch, setPoSearch] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('This Month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [poRes, custRes] = await Promise.all([
      supabase.from('purchase_orders').select('*, customer:customers(name)').order('po_date', { ascending: false }),
      supabase.from('customers').select('id,name').eq('active', true).order('name'),
    ]);
    if (poRes.error) { show('Unable to load PO Orders: ' + poRes.error.message, 'error'); setLoading(false); return; }
    setRows((poRes.data ?? []) as PoRow[]);
    setCustomers((custRes.data ?? []) as { id: string; name: string }[]);
    setLoading(false);
  }, [show]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const { from, to } = useMemo(() => dateRangeFor(dateFilter, customFrom, customTo), [dateFilter, customFrom, customTo]);

  const filteredRows = useMemo(() => {
    let result: PoRowWithStatus[] = rows.map(r => ({ ...r, effectiveStatus: getEffectivePoStatus(r) }));
    if (customerId) result = result.filter(r => r.customer_id === customerId);
    if (statusFilter === 'LowBalance') result = result.filter(r => isPoLowBalance(r));
    else if (statusFilter !== 'All') result = result.filter(r => r.effectiveStatus === statusFilter);
    if (poSearch.trim()) {
      const q = poSearch.toLowerCase().trim();
      result = result.filter(r => r.po_number.toLowerCase().includes(q));
    }
    if (from) result = result.filter(r => r.po_date >= from);
    if (to) result = result.filter(r => r.po_date <= to);
    return result;
  }, [rows, customerId, statusFilter, poSearch, from, to]);

  const summary = useMemo(() => ({
    totalPoAmount: round2(filteredRows.reduce((s, r) => s + Number(r.grand_total), 0)),
    totalUtilized: round2(filteredRows.reduce((s, r) => s + Number(r.utilized_amount), 0)),
    totalRemaining: round2(filteredRows.reduce((s, r) => s + Number(r.remaining_amount), 0)),
    activeCount: filteredRows.filter(r => r.effectiveStatus === 'Active').length,
    completedCount: filteredRows.filter(r => r.effectiveStatus === 'Completed').length,
    lowBalanceCount: filteredRows.filter(r => isPoLowBalance(r)).length,
  }), [filteredRows]);

  useEffect(() => { setPage(1); }, [customerId, statusFilter, poSearch, dateFilter, customFrom, customTo, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginatedRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const clearFilters = () => {
    setCustomerId(''); setStatusFilter('All'); setPoSearch(''); setDateFilter('All'); setCustomFrom(''); setCustomTo('');
  };

  // Remaining-cell color: spec's own rule (distinct from isPoLowBalance's fixed
  // ₹20,000 threshold) - gray at ₹0, orange under 10% of the PO's own grand_total,
  // green otherwise.
  function remainingColorClass(r: PoRow): string {
    if (Number(r.remaining_amount) <= 0) return 'text-slate-400';
    if (Number(r.grand_total) > 0 && Number(r.remaining_amount) < Number(r.grand_total) * 0.1) return 'text-amber-600 font-bold';
    return 'text-emerald-700 font-semibold';
  }

  function statusVariant(r: PoRowWithStatus): 'green' | 'gray' | 'red' | 'amber' {
    if (isPoLowBalance(r)) return 'amber';
    return STATUS_VARIANT[r.effectiveStatus];
  }
  function statusLabel(r: PoRowWithStatus): string {
    if (isPoLowBalance(r)) return 'Low Balance';
    return r.effectiveStatus;
  }

  const filterStr = [
    customerId ? `Customer: ${customers.find(c => c.id === customerId)?.name ?? ''}` : '',
    statusFilter !== 'All' ? `Status: ${statusFilter === 'LowBalance' ? 'Low Balance' : statusFilter}` : '',
    poSearch.trim() ? `PO Number: ${poSearch.trim()}` : '',
  ].filter(Boolean).join(' | ');
  const dateRangeText = `${from || 'All'} - ${to || 'All'}`;

  function buildExportData() {
    const headers = ['SL', 'PO Number', 'Customer', 'PO Date', 'PO Amount', 'Utilized', 'Remaining', 'Status'];
    const dataRows: (string | number)[][] = filteredRows.map((r, i) => [
      i + 1, r.po_number, r.customer?.name ?? '-', formatDate(r.po_date),
      Number(r.grand_total), Number(r.utilized_amount), Number(r.remaining_amount), statusLabel(r),
    ]);
    const totalRow = ['', '', '', 'Total', summary.totalPoAmount, summary.totalUtilized, summary.totalRemaining, ''];
    return { headers, dataRows, totalRow };
  }

  function companyInfo() {
    return settings
      ? { company_name: settings.company_name, address: settings.address, phone: settings.phone, email: settings.email, gstin: settings.gstin, pan: settings.pan }
      : { company_name: 'Crane ERP' };
  }

  function handlePrint(orientation: 'portrait' | 'landscape' = 'portrait') {
    const { headers, dataRows, totalRow } = buildExportData();
    printReportWithCompany('PO Orders Report', companyInfo(), dateRangeText, new Date().toLocaleString('en-IN'), filterStr, headers, dataRows, totalRow, orientation);
  }

  async function handleExportExcel() {
    const { headers, dataRows, totalRow } = buildExportData();
    await exportToXlsxWithCompany('PO_Orders_Report.xlsx', 'PO Orders Report', companyInfo(), dateRangeText, new Date().toLocaleString('en-IN'), filterStr, headers, dataRows, totalRow);
  }

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><ClipboardList className="w-5 h-5 text-blue-600" />PO Orders Report</h2>
          <p className="text-sm text-slate-500">Track Purchase Order balances, utilization and completion across every customer.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => fetchAll()}><RefreshCw className="w-4 h-4" />Refresh</Button>
          <Button variant="outline" onClick={() => handlePrint('portrait')}><Printer className="w-4 h-4" />Print</Button>
          <Button variant="outline" onClick={() => handlePrint('landscape')}><FileText className="w-4 h-4" />Export PDF</Button>
          <Button variant="outline" onClick={handleExportExcel} disabled={filteredRows.length === 0}><FileSpreadsheet className="w-4 h-4" />Export Excel</Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1"><IndianRupee className="w-4 h-4 text-blue-500" /><span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total PO Amount</span></div>
          <p className="text-xl font-bold text-slate-800">{formatCurrency(summary.totalPoAmount)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1"><IndianRupee className="w-4 h-4 text-amber-500" /><span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Utilized</span></div>
          <p className="text-xl font-bold text-amber-600">{formatCurrency(summary.totalUtilized)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1"><IndianRupee className="w-4 h-4 text-emerald-500" /><span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Remaining</span></div>
          <p className="text-xl font-bold text-emerald-600">{formatCurrency(summary.totalRemaining)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1"><CheckCircle2 className="w-4 h-4 text-emerald-500" /><span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Active POs</span></div>
          <p className="text-xl font-bold text-emerald-600">{summary.activeCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1"><XCircle className="w-4 h-4 text-slate-400" /><span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Completed POs</span></div>
          <p className="text-xl font-bold text-slate-700">{summary.completedCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-1"><AlertTriangle className="w-4 h-4 text-amber-500" /><span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Low Balance POs</span></div>
          <p className="text-xl font-bold text-amber-600">{summary.lowBalanceCount}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <select className={inputClass()} value={customerId} onChange={e => setCustomerId(e.target.value)}>
            <option value="">All Customers</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className={inputClass()} value={statusFilter} onChange={e => setStatusFilter(e.target.value as StatusFilter)}>
            <option value="All">All Statuses</option>
            <option value="Active">Active</option>
            <option value="Completed">Completed</option>
            <option value="LowBalance">Low Balance</option>
            <option value="Expired">Expired</option>
          </select>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input type="text" className={`${inputClass()} pl-9`} placeholder="Search PO Number" value={poSearch} onChange={e => setPoSearch(e.target.value)} />
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
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">PO Number</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Customer</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">PO Date</th>
                  <th className="text-right px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">PO Amount</th>
                  <th className="text-right px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Utilized</th>
                  <th className="text-right px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Remaining</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedRows.map((r, idx) => (
                  <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 text-sm text-slate-500 tabular-nums">{(currentPage - 1) * pageSize + idx + 1}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-blue-700 whitespace-nowrap">{r.po_number}</td>
                    <td className="px-4 py-3 text-sm text-slate-700 whitespace-nowrap">{r.customer?.name ?? '-'}</td>
                    <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">{formatDate(r.po_date)}</td>
                    <td className="px-4 py-3 text-sm text-slate-800 text-right tabular-nums whitespace-nowrap">{formatCurrency(r.grand_total)}</td>
                    <td className="px-4 py-3 text-sm text-slate-600 text-right tabular-nums whitespace-nowrap">{formatCurrency(r.utilized_amount)}</td>
                    <td className={`px-4 py-3 text-sm text-right tabular-nums whitespace-nowrap ${remainingColorClass(r)}`}>{formatCurrency(r.remaining_amount)}</td>
                    <td className="px-4 py-3 whitespace-nowrap"><StatusBadge status={statusLabel(r)} variant={statusVariant(r)} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 font-semibold border-t-2 border-slate-200">
                  <td className="px-4 py-3 text-sm text-slate-700" colSpan={4}>Total</td>
                  <td className="px-4 py-3 text-sm text-slate-800 text-right tabular-nums">{formatCurrency(summary.totalPoAmount)}</td>
                  <td className="px-4 py-3 text-sm text-amber-700 text-right tabular-nums">{formatCurrency(summary.totalUtilized)}</td>
                  <td className="px-4 py-3 text-sm text-emerald-700 text-right tabular-nums">{formatCurrency(summary.totalRemaining)}</td>
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
