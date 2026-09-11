import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/Toast';
import { useSettings } from '@/context/SettingsContext';
import { Modal, ConfirmDialog, Button, Field, inputClass, LoadingSpinner } from '@/components/ui/common';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { DatePicker } from '@/components/ui/DatePicker';
import { formatCurrency, formatDate, todayISO, exportToExcelWithCompany, classNames } from '@/lib/utils';
import { round2 } from '@/lib/gstBillingCalc';
import { Plus, Pencil, Trash2, ArrowLeft, ShoppingCart, Search, Printer, FileSpreadsheet } from 'lucide-react';
import type { Vendor, Purchase as PurchaseRow } from '@/types';

const GST_RATE = 18;

type DateFilter = 'All' | 'Today' | 'Yesterday' | 'This Week' | 'This Month' | 'Last Month' | 'Custom';

function isValidPhone(v: string): boolean {
  const digits = v.replace(/[\s-]/g, '');
  return /^\d{10,15}$/.test(digits);
}
function isValidGst(v: string): boolean {
  return /^[0-9A-Z]{15}$/.test(v.trim().toUpperCase());
}

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
      const day = d.getDay(); // 0 = Sunday
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

interface PurchaseForm {
  bill_no: string;
  remark: string;
  purchase_date: string;
  amount: string;
  paid_amount: string;
  gst_enabled: boolean;
}

// GST OFF by default — GST is optional per purchase, not assumed.
const emptyPurchaseForm: PurchaseForm = { bill_no: '', remark: '', purchase_date: todayISO(), amount: '', paid_amount: '', gst_enabled: false };

export default function Purchase() {
  const { show } = useToast();
  const { settings } = useSettings();

  const [loading, setLoading] = useState(true);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorSearch, setVendorSearch] = useState('');

  const [vendorModalOpen, setVendorModalOpen] = useState(false);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);
  const [vendorForm, setVendorForm] = useState({ name: '', phone: '', address: '', gst_number: '' });
  const [vendorErrors, setVendorErrors] = useState<{ name?: string; phone?: string; gst_number?: string }>({});
  const [savingVendor, setSavingVendor] = useState(false);
  const [deleteVendorId, setDeleteVendorId] = useState<string | null>(null);

  // Every purchase across every vendor — used only for the first-page Purchase
  // Summary dashboard (totals must reflect the complete dataset, not just the
  // currently-selected vendor's filtered/paginated rows).
  const [allPurchases, setAllPurchases] = useState<PurchaseRow[]>([]);

  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(null);
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [purchasesLoading, setPurchasesLoading] = useState(false);
  const [purchaseSearch, setPurchaseSearch] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('All');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const [purchaseModalOpen, setPurchaseModalOpen] = useState(false);
  const [editingPurchase, setEditingPurchase] = useState<PurchaseRow | null>(null);
  const [purchaseForm, setPurchaseForm] = useState<PurchaseForm>(emptyPurchaseForm);
  const [purchaseErrors, setPurchaseErrors] = useState<{ amount?: string; paid_amount?: string }>({});
  const [savingPurchase, setSavingPurchase] = useState(false);
  const [deletePurchaseId, setDeletePurchaseId] = useState<string | null>(null);

  const fetchVendors = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('vendors').select('*').order('name');
    if (error) { show('Unable to load vendors: ' + error.message, 'error'); setLoading(false); return; }
    setVendors((data ?? []) as Vendor[]);
    setLoading(false);
  }, [show]);

  // Shared data source (same `purchases` table/RLS every vendor's own entries use) —
  // fetched unfiltered so the dashboard totals always reflect every purchase from every
  // vendor, created by any authorized user, not just what's currently on screen.
  const fetchAllPurchases = useCallback(async () => {
    const { data, error } = await supabase.from('purchases').select('*');
    if (error) { show('Unable to load purchase summary: ' + error.message, 'error'); return; }
    setAllPurchases((data ?? []) as PurchaseRow[]);
  }, [show]);

  useEffect(() => { fetchVendors(); fetchAllPurchases(); }, [fetchVendors, fetchAllPurchases]);

  const fetchPurchases = useCallback(async (vendorId: string) => {
    setPurchasesLoading(true);
    const { data, error } = await supabase.from('purchases').select('*').eq('vendor_id', vendorId).order('purchase_date', { ascending: false }).order('created_at', { ascending: false });
    if (error) { show('Unable to load purchases: ' + error.message, 'error'); setPurchasesLoading(false); return; }
    setPurchases((data ?? []) as PurchaseRow[]);
    setPurchasesLoading(false);
  }, [show]);

  useEffect(() => {
    if (selectedVendorId) fetchPurchases(selectedVendorId);
  }, [selectedVendorId, fetchPurchases]);

  const selectedVendor = useMemo(() => vendors.find(v => v.id === selectedVendorId) ?? null, [vendors, selectedVendorId]);

  // ---------------- Vendor CRUD ----------------

  function openAddVendor() {
    setEditingVendor(null);
    setVendorForm({ name: '', phone: '', address: '', gst_number: '' });
    setVendorErrors({});
    setVendorModalOpen(true);
  }
  function openEditVendor(v: Vendor) {
    setEditingVendor(v);
    setVendorForm({ name: v.name, phone: v.phone ?? '', address: v.address ?? '', gst_number: v.gst_number ?? '' });
    setVendorErrors({});
    setVendorModalOpen(true);
  }

  function validateVendorForm(): boolean {
    const errors: typeof vendorErrors = {};
    if (!vendorForm.name.trim()) errors.name = 'Vendor Name is required.';
    if (vendorForm.phone.trim() && !isValidPhone(vendorForm.phone)) errors.phone = 'Enter a valid phone number.';
    if (vendorForm.gst_number.trim() && !isValidGst(vendorForm.gst_number)) errors.gst_number = 'GST Number should be 15 alphanumeric characters.';
    setVendorErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function saveVendor() {
    if (!validateVendorForm()) return;
    setSavingVendor(true);
    const payload = {
      name: vendorForm.name.trim(),
      phone: vendorForm.phone.trim() || null,
      address: vendorForm.address.trim() || null,
      gst_number: vendorForm.gst_number.trim() ? vendorForm.gst_number.trim().toUpperCase() : null,
    };
    const result = editingVendor
      ? await supabase.from('vendors').update(payload).eq('id', editingVendor.id).select().single()
      : await supabase.from('vendors').insert(payload).select().single();
    if (result.error) { show(result.error.message, 'error'); setSavingVendor(false); return; }
    const saved = result.data as Vendor;
    setVendors(prev => {
      const exists = prev.some(v => v.id === saved.id);
      const next = exists ? prev.map(v => v.id === saved.id ? saved : v) : [...prev, saved];
      return [...next].sort((a, b) => a.name.localeCompare(b.name));
    });
    show(editingVendor ? 'Vendor updated.' : 'Vendor added.', 'success');
    setVendorModalOpen(false);
    setSavingVendor(false);
  }

  async function handleDeleteVendor() {
    if (!deleteVendorId) return;
    const { error } = await supabase.from('vendors').delete().eq('id', deleteVendorId);
    if (error) {
      show(error.message.includes('foreign key') || error.code === '23503'
        ? 'This vendor has purchase history and cannot be deleted.'
        : error.message, 'error');
      setDeleteVendorId(null);
      return;
    }
    setVendors(prev => prev.filter(v => v.id !== deleteVendorId));
    if (selectedVendorId === deleteVendorId) setSelectedVendorId(null);
    show('Vendor deleted.', 'success');
    setDeleteVendorId(null);
  }

  const filteredVendors = useMemo(() => {
    if (!vendorSearch.trim()) return vendors;
    const q = vendorSearch.toLowerCase().trim();
    return vendors.filter(v =>
      v.name.toLowerCase().includes(q) ||
      (v.phone ?? '').toLowerCase().includes(q) ||
      (v.gst_number ?? '').toLowerCase().includes(q),
    );
  }, [vendors, vendorSearch]);

  // ---------------- Purchase CRUD ----------------

  function openAddPurchase() {
    setEditingPurchase(null);
    setPurchaseForm({ ...emptyPurchaseForm, purchase_date: todayISO() });
    setPurchaseErrors({});
    setPurchaseModalOpen(true);
  }
  function openEditPurchase(p: PurchaseRow) {
    setEditingPurchase(p);
    setPurchaseForm({
      bill_no: p.bill_no ?? '',
      remark: p.remark ?? '',
      purchase_date: p.purchase_date,
      amount: String(p.amount),
      paid_amount: String(p.paid_amount),
      gst_enabled: p.gst_enabled,
    });
    setPurchaseErrors({});
    setPurchaseModalOpen(true);
  }

  const purchaseFormCalc = useMemo(() => {
    const amount = Number(purchaseForm.amount) || 0;
    const gstEnabled = purchaseForm.gst_enabled;
    const gstRate = gstEnabled ? GST_RATE : 0;
    const gstAmount = gstEnabled ? round2(amount * GST_RATE / 100) : 0;
    const totalAmount = round2(amount + gstAmount);
    const paidAmount = Number(purchaseForm.paid_amount) || 0;
    const balanceAmount = round2(totalAmount - paidAmount);
    return { amount, gstEnabled, gstRate, gstAmount, totalAmount, paidAmount, balanceAmount };
  }, [purchaseForm.amount, purchaseForm.paid_amount, purchaseForm.gst_enabled]);

  function validatePurchaseForm(): boolean {
    if (!purchaseForm.purchase_date) { show('Purchase Date is required.', 'error'); return false; }
    const errors: typeof purchaseErrors = {};
    if (!purchaseForm.amount.trim() || Number(purchaseForm.amount) <= 0) errors.amount = 'Enter a valid amount greater than 0.';
    if (purchaseForm.paid_amount.trim() && Number(purchaseForm.paid_amount) < 0) errors.paid_amount = 'Paid amount cannot be negative.';
    if (purchaseFormCalc.paidAmount > purchaseFormCalc.totalAmount) errors.paid_amount = `Paid amount cannot exceed the total bill amount (${formatCurrency(purchaseFormCalc.totalAmount)}).`;
    setPurchaseErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function savePurchase() {
    if (!selectedVendorId) return;
    if (!validatePurchaseForm()) return;
    setSavingPurchase(true);
    const { data: { user } } = await supabase.auth.getUser();
    const payload = {
      vendor_id: selectedVendorId,
      bill_no: purchaseForm.bill_no.trim() || null,
      remark: purchaseForm.remark.trim() || null,
      purchase_date: purchaseForm.purchase_date || todayISO(),
      amount: purchaseFormCalc.amount,
      gst_enabled: purchaseFormCalc.gstEnabled,
      gst_rate: purchaseFormCalc.gstRate,
      gst_amount: purchaseFormCalc.gstAmount,
      total_amount: purchaseFormCalc.totalAmount,
      paid_amount: purchaseFormCalc.paidAmount,
      balance_amount: purchaseFormCalc.balanceAmount,
    };
    const result = editingPurchase
      ? await supabase.from('purchases').update(payload).eq('id', editingPurchase.id).select().single()
      : await supabase.from('purchases').insert({ ...payload, created_by: user?.id ?? null }).select().single();
    if (result.error) { show(result.error.message, 'error'); setSavingPurchase(false); return; }
    const saved = result.data as PurchaseRow;
    setPurchases(prev => {
      const exists = prev.some(p => p.id === saved.id);
      const next = exists ? prev.map(p => p.id === saved.id ? saved : p) : [saved, ...prev];
      return [...next].sort((a, b) => b.purchase_date.localeCompare(a.purchase_date) || b.created_at.localeCompare(a.created_at));
    });
    setAllPurchases(prev => {
      const exists = prev.some(p => p.id === saved.id);
      return exists ? prev.map(p => p.id === saved.id ? saved : p) : [saved, ...prev];
    });
    show(editingPurchase ? 'Purchase updated.' : 'Purchase added.', 'success');
    setPurchaseModalOpen(false);
    setSavingPurchase(false);
  }

  async function handleDeletePurchase() {
    if (!deletePurchaseId) return;
    const { error } = await supabase.from('purchases').delete().eq('id', deletePurchaseId);
    if (error) { show(error.message, 'error'); setDeletePurchaseId(null); return; }
    setPurchases(prev => prev.filter(p => p.id !== deletePurchaseId));
    setAllPurchases(prev => prev.filter(p => p.id !== deletePurchaseId));
    show('Purchase entry removed.', 'success');
    setDeletePurchaseId(null);
  }

  const filteredPurchases = useMemo(() => {
    const { from, to } = dateRangeFor(dateFilter, customFrom, customTo);
    let result = purchases;
    if (from) result = result.filter(p => p.purchase_date >= from);
    if (to) result = result.filter(p => p.purchase_date <= to);
    if (purchaseSearch.trim()) {
      const q = purchaseSearch.toLowerCase().trim();
      result = result.filter(p => (p.bill_no ?? '').toLowerCase().includes(q) || (p.remark ?? '').toLowerCase().includes(q));
    }
    return result;
  }, [purchases, dateFilter, customFrom, customTo, purchaseSearch]);

  const summary = useMemo(() => ({
    totalAmount: round2(filteredPurchases.reduce((s, p) => s + Number(p.amount), 0)),
    totalGst: round2(filteredPurchases.reduce((s, p) => s + Number(p.gst_amount), 0)),
    totalBill: round2(filteredPurchases.reduce((s, p) => s + Number(p.total_amount), 0)),
    totalPaid: round2(filteredPurchases.reduce((s, p) => s + Number(p.paid_amount), 0)),
    totalBalance: round2(filteredPurchases.reduce((s, p) => s + Number(p.balance_amount), 0)),
  }), [filteredPurchases]);

  // First-page Purchase Summary dashboard — the complete dataset (every vendor, every
  // purchase, shared across all users via the same purchases/vendors tables), never just
  // the rows currently visible/paginated on some other view.
  const purchaseDashboard = useMemo(() => ({
    totalVendors: vendors.length,
    totalPurchaseAmount: round2(allPurchases.reduce((s, p) => s + Number(p.amount), 0)),
    totalGst: round2(allPurchases.reduce((s, p) => s + Number(p.gst_amount), 0)),
    totalBillAmount: round2(allPurchases.reduce((s, p) => s + Number(p.total_amount), 0)),
    totalPaidAmount: round2(allPurchases.reduce((s, p) => s + Number(p.paid_amount), 0)),
    totalBalanceAmount: round2(allPurchases.reduce((s, p) => s + Number(p.balance_amount), 0)),
  }), [vendors, allPurchases]);

  const companyInfo = settings
    ? { company_name: settings.company_name, address: settings.address, phone: settings.phone, email: settings.email, gstin: settings.gstin }
    : { company_name: 'PADMAVATHI EARTH MOVERS AND CRANE SERVICES' };

  const filterLabel = () => {
    if (dateFilter === 'Custom') return `${customFrom ? formatDate(customFrom) : 'Start'} – ${customTo ? formatDate(customTo) : 'Today'}`;
    return dateFilter === 'All' ? 'All Dates' : dateFilter;
  };

  function exportPurchasesExcel() {
    if (!selectedVendor) return;
    const headers = ['SL.NO', 'BILL NO', 'REMARK', 'DATE', 'AMOUNT', 'GST', 'TOTAL BILL AMOUNT', 'PAID AMOUNT', 'BALANCE AMOUNT'];
    const rows: (string | number)[][] = filteredPurchases.map((p, idx) => [
      idx + 1, p.bill_no ?? '-', p.remark ?? '-', formatDate(p.purchase_date),
      Number(p.amount), Number(p.gst_amount), Number(p.total_amount), Number(p.paid_amount), Number(p.balance_amount),
    ]);
    const totalRow = ['', '', '', 'TOTAL', summary.totalAmount, summary.totalGst, summary.totalBill, summary.totalPaid, summary.totalBalance];
    exportToExcelWithCompany(
      `Purchase_Statement_${selectedVendor.name.replace(/\s+/g, '_')}.csv`,
      'Purchase Statement',
      companyInfo,
      filterLabel(),
      new Date().toLocaleString('en-IN'),
      `Vendor: ${selectedVendor.name}${purchaseSearch.trim() ? `; Search: ${purchaseSearch.trim()}` : ''}`,
      headers, rows, totalRow,
    );
  }

  function printPurchaseStatement() {
    if (!selectedVendor) return;
    const win = window.open('', '_blank');
    if (!win) { show('Please allow popups to print', 'error'); return; }
    const rows = filteredPurchases.map((p, idx) => `<tr>
      <td style="text-align:center">${idx + 1}</td>
      <td>${p.bill_no ?? '-'}</td>
      <td>${formatDate(p.purchase_date)}</td>
      <td>${p.remark ?? '-'}</td>
      <td style="text-align:right">${formatCurrency(p.amount)}</td>
      <td style="text-align:right">${formatCurrency(p.gst_amount)}</td>
      <td style="text-align:right">${formatCurrency(p.total_amount)}</td>
      <td style="text-align:right">${formatCurrency(p.paid_amount)}</td>
      <td style="text-align:right">${formatCurrency(p.balance_amount)}</td>
    </tr>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Purchase Statement - ${selectedVendor.name}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; padding: 14mm 12mm; color: #1a1a1a; font-size: 11px; }
  .co { text-align: center; font-weight: 800; font-size: 17px; text-transform: uppercase; }
  .addr { text-align: center; font-size: 10px; color: #444; margin-top: 2px; line-height: 1.5; }
  h2 { text-align: center; font-size: 13px; letter-spacing: 1.5px; margin: 12px 0 10px; padding: 5px 0; border-top: 1.5px solid #000; border-bottom: 1.5px solid #000; text-transform: uppercase; }
  .vendor { font-size: 11px; line-height: 1.6; margin-bottom: 10px; }
  .vendor .nm { font-weight: 700; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 10.5px; margin-top: 6px; }
  th, td { border: 1px solid #999; padding: 4px 6px; }
  th { background: #f0f0f0; text-transform: uppercase; font-size: 9px; text-align: center; }
  td:first-child, th:first-child { text-align: center; }
  tfoot td { font-weight: 700; background: #f7f7f7; border-top: 1.5px solid #000; }
  @media print { body { padding: 0; } @page { size: A4; margin: 14mm 12mm; } }
</style></head><body>
  <div class="co">${settings?.company_name ?? ''}</div>
  ${settings?.address ? `<div class="addr">${settings.address.replace(/\n/g, ', ')}</div>` : ''}
  <div class="addr">${[settings?.phone ? 'Ph: ' + settings.phone : '', settings?.email ?? '', settings?.gstin ? 'GSTIN: ' + settings.gstin : ''].filter(Boolean).join(' &middot; ')}</div>
  <h2>Purchase Statement</h2>
  <div class="vendor">
    <div class="nm">${selectedVendor.name}</div>
    ${selectedVendor.phone ? `<div>Phone: ${selectedVendor.phone}</div>` : ''}
    ${selectedVendor.address ? `<div>Address: ${selectedVendor.address}</div>` : ''}
    ${selectedVendor.gst_number ? `<div>GST Number: ${selectedVendor.gst_number}</div>` : ''}
    <div>Period: ${filterLabel()}</div>
  </div>
  <table>
    <thead><tr><th>Sl.No</th><th>Bill No</th><th>Date</th><th>Remark</th><th>Amount</th><th>GST</th><th>Total</th><th>Paid</th><th>Balance</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="9" style="text-align:center;padding:16px">No purchase entries found for this filter.</td></tr>'}</tbody>
    ${filteredPurchases.length > 0 ? `<tfoot><tr><td colspan="4">TOTAL PURCHASE AMOUNT / GST / BILL / PAID / BALANCE</td><td style="text-align:right">${formatCurrency(summary.totalAmount)}</td><td style="text-align:right">${formatCurrency(summary.totalGst)}</td><td style="text-align:right">${formatCurrency(summary.totalBill)}</td><td style="text-align:right">${formatCurrency(summary.totalPaid)}</td><td style="text-align:right">${formatCurrency(summary.totalBalance)}</td></tr></tfoot>` : ''}
  </table>
</body></html>`;
    win.document.write(html.replace('</body></html>', '<script>window.onload = () => { window.print(); }</script></body></html>'));
    win.document.close();
  }

  const vendorColumns: Column<Vendor>[] = [
    { key: 'name', header: 'Vendor Name', sortable: true },
    { key: 'phone', header: 'Phone Number', render: v => v.phone ?? <span className="text-slate-400">-</span> },
    { key: 'address', header: 'Address', render: v => v.address ?? <span className="text-slate-400">-</span> },
    { key: 'gst_number', header: 'GST Number', render: v => v.gst_number ?? <span className="text-slate-400">-</span> },
    {
      key: 'actions', header: 'Actions', align: 'center',
      render: v => (
        <div className="flex justify-center gap-1">
          <button onClick={() => setSelectedVendorId(v.id)} className="px-2.5 py-1 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md">Select</button>
          <button onClick={() => openEditVendor(v)} className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md" title="Edit"><Pencil className="w-4 h-4" /></button>
          <button onClick={() => setDeleteVendorId(v.id)} className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-md" title="Delete"><Trash2 className="w-4 h-4" /></button>
        </div>
      ),
    },
  ];

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      {!selectedVendorId ? (
        <>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><ShoppingCart className="w-5 h-5 text-blue-600" />Purchase</h2>
              <p className="text-sm text-slate-500">Manage vendors and their purchase bills.</p>
            </div>
            <Button onClick={openAddVendor}><Plus className="w-4 h-4" />Add Vendor</Button>
          </div>

          {/* Purchase Summary — the complete dataset across every vendor (allPurchases),
              not just whatever vendor happens to be selected elsewhere on this page. */}
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-3">Purchase Summary</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="bg-slate-50 rounded-lg border border-slate-200 p-3">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Total Vendors</div>
                <div className="text-lg font-bold text-slate-800">{purchaseDashboard.totalVendors}</div>
              </div>
              <div className="bg-slate-50 rounded-lg border border-slate-200 p-3">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Total Purchase Amount</div>
                <div className="text-lg font-bold text-slate-800">{formatCurrency(purchaseDashboard.totalPurchaseAmount)}</div>
              </div>
              <div className="bg-slate-50 rounded-lg border border-slate-200 p-3">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Total GST</div>
                <div className="text-lg font-bold text-slate-800">{formatCurrency(purchaseDashboard.totalGst)}</div>
              </div>
              <div className="bg-slate-50 rounded-lg border border-slate-200 p-3">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Total Bill Amount</div>
                <div className="text-lg font-bold text-slate-800">{formatCurrency(purchaseDashboard.totalBillAmount)}</div>
              </div>
              <div className="bg-emerald-50 rounded-lg border border-emerald-200 p-3">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Total Paid Amount</div>
                <div className="text-lg font-bold text-emerald-600">{formatCurrency(purchaseDashboard.totalPaidAmount)}</div>
              </div>
              <div className="bg-red-50 rounded-lg border border-red-200 p-3">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Total Balance Amount</div>
                <div className="text-lg font-bold text-red-600">{formatCurrency(purchaseDashboard.totalBalanceAmount)}</div>
              </div>
            </div>
          </div>

          <DataTable
            columns={vendorColumns}
            data={filteredVendors}
            searchKeys={['name', 'phone', 'gst_number']}
            searchPlaceholder="Search vendor by name, phone, or GST number..."
            showSerialNumber
            emptyMessage="No vendors yet - click Add Vendor to create one."
          />
        </>
      ) : (
        <>
          <button onClick={() => setSelectedVendorId(null)} className="flex items-center gap-1.5 text-sm font-semibold text-blue-700 hover:text-blue-800">
            <ArrowLeft className="w-4 h-4" />Back to Vendors
          </button>

          {selectedVendor && (
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Selected Vendor</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                <div><span className="text-slate-500">Vendor Name: </span><span className="font-semibold text-slate-800">{selectedVendor.name}</span></div>
                <div><span className="text-slate-500">Phone: </span><span className="font-medium">{selectedVendor.phone ?? '-'}</span></div>
                <div><span className="text-slate-500">Address: </span><span className="font-medium">{selectedVendor.address ?? '-'}</span></div>
                <div><span className="text-slate-500">GST Number: </span><span className="font-medium">{selectedVendor.gst_number ?? '-'}</span></div>
              </div>
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Purchase Entries</p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={printPurchaseStatement} disabled={filteredPurchases.length === 0}><Printer className="w-4 h-4" />Print</Button>
                <Button variant="outline" onClick={exportPurchasesExcel} disabled={filteredPurchases.length === 0}><FileSpreadsheet className="w-4 h-4" />Export Excel</Button>
                <Button onClick={openAddPurchase}><Plus className="w-4 h-4" />Add Purchase</Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-3 items-end mb-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                <input type="text" className={`${inputClass()} pl-9 min-w-[220px]`} placeholder="Search Bill No / Remark..." value={purchaseSearch} onChange={e => setPurchaseSearch(e.target.value)} />
              </div>
              <Field label="Date Filter">
                <select className={inputClass()} value={dateFilter} onChange={e => setDateFilter(e.target.value as DateFilter)}>
                  {(['All', 'Today', 'Yesterday', 'This Week', 'This Month', 'Last Month', 'Custom'] as DateFilter[]).map(f => (
                    <option key={f} value={f}>{f === 'All' ? 'All Dates' : f}</option>
                  ))}
                </select>
              </Field>
              {dateFilter === 'Custom' && (
                <>
                  <Field label="From Date"><DatePicker value={customFrom} onChange={setCustomFrom} /></Field>
                  <Field label="To Date"><DatePicker value={customTo} onChange={setCustomTo} /></Field>
                </>
              )}
            </div>

            {purchasesLoading ? (
              <LoadingSpinner />
            ) : (
              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-xs uppercase text-slate-600">
                      <th className="text-center px-3 py-2 border-b border-slate-200">Sl.No</th>
                      <th className="text-left px-3 py-2 border-b border-slate-200">Bill No</th>
                      <th className="text-left px-3 py-2 border-b border-slate-200">Remark</th>
                      <th className="text-left px-3 py-2 border-b border-slate-200">Date</th>
                      <th className="text-right px-3 py-2 border-b border-slate-200">Amount</th>
                      <th className="text-right px-3 py-2 border-b border-slate-200">GST</th>
                      <th className="text-right px-3 py-2 border-b border-slate-200">Total Bill Amount</th>
                      <th className="text-right px-3 py-2 border-b border-slate-200">Paid Amount</th>
                      <th className="text-right px-3 py-2 border-b border-slate-200">Balance Amount</th>
                      <th className="text-center px-3 py-2 border-b border-slate-200">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPurchases.length === 0 ? (
                      <tr><td colSpan={10} className="text-center py-8 text-slate-400">No purchase entries found for this filter.</td></tr>
                    ) : filteredPurchases.map((p, idx) => (
                      <tr key={p.id} className={idx % 2 ? 'bg-slate-50' : 'bg-white'}>
                        <td className="text-center px-3 py-1.5 border-b border-slate-100">{idx + 1}</td>
                        <td className="px-3 py-1.5 border-b border-slate-100 font-medium">{p.bill_no ?? '-'}</td>
                        <td className="px-3 py-1.5 border-b border-slate-100">{p.remark ?? '-'}</td>
                        <td className="px-3 py-1.5 border-b border-slate-100 whitespace-nowrap">{formatDate(p.purchase_date)}</td>
                        <td className="text-right px-3 py-1.5 border-b border-slate-100">{formatCurrency(p.amount)}</td>
                        <td className="text-right px-3 py-1.5 border-b border-slate-100 whitespace-nowrap">
                          {p.gst_enabled
                            ? <>{formatCurrency(p.gst_amount)} <span className="text-slate-400 text-xs">({p.gst_rate}%)</span></>
                            : <span className="text-slate-400 text-xs font-semibold">GST OFF</span>}
                        </td>
                        <td className="text-right px-3 py-1.5 border-b border-slate-100 font-medium">{formatCurrency(p.total_amount)}</td>
                        <td className="text-right px-3 py-1.5 border-b border-slate-100 text-emerald-600">{formatCurrency(p.paid_amount)}</td>
                        <td className={`text-right px-3 py-1.5 border-b border-slate-100 font-semibold ${p.balance_amount > 0 ? 'text-red-600' : 'text-slate-400'}`}>{formatCurrency(p.balance_amount)}</td>
                        <td className="text-center px-3 py-1.5 border-b border-slate-100">
                          <button onClick={() => openEditPurchase(p)} className="p-1 text-slate-400 hover:text-blue-600" title="Edit"><Pencil className="w-4 h-4" /></button>
                          <button onClick={() => setDeletePurchaseId(p.id)} className="p-1 text-slate-400 hover:text-red-600" title="Delete"><Trash2 className="w-4 h-4" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-3">Summary</p>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <div className="bg-slate-50 rounded-lg border border-slate-200 p-3">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Total Purchase Amount</div>
                <div className="text-lg font-bold text-slate-800">{formatCurrency(summary.totalAmount)}</div>
              </div>
              <div className="bg-slate-50 rounded-lg border border-slate-200 p-3">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Total GST</div>
                <div className="text-lg font-bold text-slate-800">{formatCurrency(summary.totalGst)}</div>
              </div>
              <div className="bg-slate-50 rounded-lg border border-slate-200 p-3">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Total Bill Amount</div>
                <div className="text-lg font-bold text-slate-800">{formatCurrency(summary.totalBill)}</div>
              </div>
              <div className="bg-emerald-50 rounded-lg border border-emerald-200 p-3">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Total Paid Amount</div>
                <div className="text-lg font-bold text-emerald-600">{formatCurrency(summary.totalPaid)}</div>
              </div>
              <div className="bg-red-50 rounded-lg border border-red-200 p-3">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Total Balance Amount</div>
                <div className="text-lg font-bold text-red-600">{formatCurrency(summary.totalBalance)}</div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Add / Edit Vendor Modal */}
      <Modal
        open={vendorModalOpen}
        onClose={() => setVendorModalOpen(false)}
        title={editingVendor ? 'Edit Vendor' : 'Add Vendor'}
        size="sm"
        closeOnBackdropClick={false}
        footer={
          <>
            <Button variant="secondary" onClick={() => setVendorModalOpen(false)}>Cancel</Button>
            <Button onClick={saveVendor} disabled={savingVendor}>{savingVendor ? 'Saving...' : 'Save Vendor'}</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Vendor Name" required error={vendorErrors.name}>
            <input type="text" className={inputClass(vendorErrors.name)} value={vendorForm.name} onChange={e => setVendorForm(f => ({ ...f, name: e.target.value }))} placeholder="Vendor name" />
          </Field>
          <Field label="Phone Number" error={vendorErrors.phone}>
            <input type="text" className={inputClass(vendorErrors.phone)} value={vendorForm.phone} onChange={e => setVendorForm(f => ({ ...f, phone: e.target.value }))} placeholder="Optional" />
          </Field>
          <Field label="Address">
            <input type="text" className={inputClass()} value={vendorForm.address} onChange={e => setVendorForm(f => ({ ...f, address: e.target.value }))} placeholder="Optional" />
          </Field>
          <Field label="GST Number" error={vendorErrors.gst_number}>
            <input type="text" className={inputClass(vendorErrors.gst_number)} value={vendorForm.gst_number} onChange={e => setVendorForm(f => ({ ...f, gst_number: e.target.value.toUpperCase() }))} placeholder="Optional" />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteVendorId}
        onClose={() => setDeleteVendorId(null)}
        onConfirm={handleDeleteVendor}
        title="Delete Vendor"
        message="This vendor will be permanently deleted. This is only possible if the vendor has no purchase history."
        confirmText="Delete"
        danger
      />

      {/* Add / Edit Purchase Modal */}
      <Modal
        open={purchaseModalOpen}
        onClose={() => setPurchaseModalOpen(false)}
        title={editingPurchase ? 'Edit Purchase' : 'Add Purchase'}
        size="md"
        closeOnBackdropClick={false}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPurchaseModalOpen(false)}>Cancel</Button>
            <Button onClick={savePurchase} disabled={savingPurchase}>{savingPurchase ? 'Saving...' : 'Save Purchase'}</Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bill No">
              <input type="text" className={inputClass()} value={purchaseForm.bill_no} onChange={e => setPurchaseForm(f => ({ ...f, bill_no: e.target.value }))} placeholder="Optional" />
            </Field>
            <Field label="Purchase Date" required>
              <DatePicker value={purchaseForm.purchase_date} onChange={v => setPurchaseForm(f => ({ ...f, purchase_date: v }))} />
            </Field>
          </div>
          <Field label="Remark">
            <input type="text" className={inputClass()} value={purchaseForm.remark} onChange={e => setPurchaseForm(f => ({ ...f, remark: e.target.value }))} placeholder="Optional" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount" required error={purchaseErrors.amount}>
              <input type="number" min="0" className={inputClass(purchaseErrors.amount)} value={purchaseForm.amount} onChange={e => setPurchaseForm(f => ({ ...f, amount: e.target.value }))} placeholder="0" />
            </Field>
            <Field label="Paid Amount" error={purchaseErrors.paid_amount}>
              <input type="number" min="0" className={inputClass(purchaseErrors.paid_amount)} value={purchaseForm.paid_amount} onChange={e => setPurchaseForm(f => ({ ...f, paid_amount: e.target.value }))} placeholder="0" />
            </Field>
          </div>
          <Field label="GST">
            <div className="grid grid-cols-2 gap-2 max-w-xs">
              {([false, true] as const).map(on => (
                <button
                  key={String(on)}
                  type="button"
                  onClick={() => setPurchaseForm(f => ({ ...f, gst_enabled: on }))}
                  className={classNames(
                    'p-2.5 border rounded-lg text-sm font-semibold transition-colors',
                    purchaseForm.gst_enabled === on ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  )}
                >
                  {on ? 'ON' : 'OFF'}
                </button>
              ))}
            </div>
          </Field>
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-sm space-y-1">
            <div className="flex justify-between"><span className="text-slate-500">GST</span><b className="text-slate-800">{formatCurrency(purchaseFormCalc.gstAmount)}</b></div>
            <div className="flex justify-between"><span className="text-slate-500">GST Rate</span><b className="text-slate-800">{purchaseFormCalc.gstEnabled ? `${purchaseFormCalc.gstRate}%` : '-'}</b></div>
            <div className="flex justify-between"><span className="text-slate-500">Total Bill Amount</span><b className="text-slate-800">{formatCurrency(purchaseFormCalc.totalAmount)}</b></div>
            <div className="flex justify-between pt-1 border-t border-dashed border-slate-200"><span className="font-semibold text-slate-700">Balance Amount</span><b className={purchaseFormCalc.balanceAmount > 0 ? 'text-red-600' : 'text-emerald-600'}>{formatCurrency(purchaseFormCalc.balanceAmount)}</b></div>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deletePurchaseId}
        onClose={() => setDeletePurchaseId(null)}
        onConfirm={handleDeletePurchase}
        title="Delete Purchase Entry"
        message="This purchase entry will be permanently deleted."
        confirmText="Delete"
        danger
      />
    </div>
  );
}
