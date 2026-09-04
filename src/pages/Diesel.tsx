import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useLang } from '@/context/LangContext';
import { useToast } from '@/components/ui/Toast';
import { useSettings } from '@/context/SettingsContext';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Modal, ConfirmDialog, StatusBadge, Button, Field, inputClass, LoadingSpinner, EmptyState } from '@/components/ui/common';
import { DatePicker } from '@/components/ui/DatePicker';
import { Plus, Pencil, Trash2, Fuel, CheckSquare, Square, Search, Share2, Layers, List } from 'lucide-react';
import { formatCurrency, formatDate, todayISO, exportToExcelWithCompany } from '@/lib/utils';
import type { DieselEntry, DieselWithRelations, DieselDistribution, DieselDistributionWithRelations, Vehicle, BillStatus } from '@/types';

type DistTab = 'purchases' | 'distributions';

export default function Diesel() {
  const { t } = useLang();
  const { show } = useToast();
  const { settings } = useSettings();
  const [purchases, setPurchases] = useState<DieselWithRelations[]>([]);
  const [distributions, setDistributions] = useState<DieselDistributionWithRelations[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<DistTab>('purchases');

  // Purchase modal
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [editingPurchase, setEditingPurchase] = useState<DieselEntry | null>(null);
  const [savingPurchase, setSavingPurchase] = useState(false);
  const [deletePurchaseId, setDeletePurchaseId] = useState<string | null>(null);

  // Distribution modal
  const [distOpen, setDistOpen] = useState(false);
  const [savingDist, setSavingDist] = useState(false);
  const [deleteDistId, setDeleteDistId] = useState<string | null>(null);

  const [dateFilter, setDateFilter] = useState('');

  // Purchase form
  const [pForm, setPForm] = useState({
    diesel_date: todayISO(),
    pump_name: '',
    quantity_liters: null as number | null,
    rate_per_liter: null as number | null,
    paid_amount: null as number | null,
    additional_payment: null as number | null,
    remarks: '',
  });

  // Distribution form
  const [dForm, setDForm] = useState({
    distribution_date: todayISO(),
    selected_vehicles: [] as string[],
    quantities: {} as Record<string, number | null>,
    remarks: '',
  });
  const [vehicleSearch, setVehicleSearch] = useState('');
  const [distMode, setDistMode] = useState<'bulk' | 'individual'>('bulk');
  const [commonLiters, setCommonLiters] = useState<number | null>(null);

  const fetchAll = async () => {
    setLoading(true);
    const [pRes, dRes, vRes] = await Promise.all([
      supabase.from('diesel_entries').select('*, vehicle:vehicles(id,registration_number,type)').order('diesel_date', { ascending: false }).eq('is_cancelled', false),
      supabase.from('diesel_distributions').select('*, vehicle:vehicles(id,registration_number,type)').order('distribution_date', { ascending: false }).eq('is_cancelled', false),
      supabase.from('vehicles').select('*').order('registration_number'),
    ]);
    setPurchases((pRes.data ?? []) as DieselWithRelations[]);
    setDistributions((dRes.data ?? []) as DieselDistributionWithRelations[]);
    setVehicles((vRes.data ?? []) as Vehicle[]);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  // Stock calculations
  const totalPurchasedLiters = useMemo(
    () => purchases.reduce((s, p) => s + (Number(p.quantity_liters) || 0), 0),
    [purchases],
  );
  const totalDistributedLiters = useMemo(
    () => distributions.reduce((s, d) => s + (Number(d.quantity_liters) || 0), 0),
    [distributions],
  );
  const availableStock = useMemo(
    () => Math.max(0, Math.round((totalPurchasedLiters - totalDistributedLiters) * 100) / 100),
    [totalPurchasedLiters, totalDistributedLiters],
  );

  // Purchase calculations
  const purchaseTotal = useMemo(
    () => Math.round((Number(pForm.quantity_liters) || 0) * (Number(pForm.rate_per_liter) || 0) * 100) / 100,
    [pForm.quantity_liters, pForm.rate_per_liter],
  );
  const effectivePaid = useMemo(() => {
    const base = Number(pForm.paid_amount) || 0;
    const extra = Number(pForm.additional_payment) || 0;
    return Math.round((base + extra) * 100) / 100;
  }, [pForm.paid_amount, pForm.additional_payment]);
  const purchaseBalance = useMemo(
    () => Math.max(0, Math.round((purchaseTotal - effectivePaid) * 100) / 100),
    [purchaseTotal, effectivePaid],
  );
  const purchaseStatus: BillStatus = purchaseBalance <= 0 && effectivePaid > 0 ? 'Paid' : effectivePaid > 0 ? 'Partially Paid' : 'Pending';

  // Distribution calculations
  const effectiveQuantities = useMemo(() => {
    if (distMode === 'bulk') {
      const q: Record<string, number> = {};
      for (const vid of dForm.selected_vehicles) q[vid] = commonLiters ?? 0;
      return q;
    }
    return dForm.quantities;
  }, [distMode, dForm.selected_vehicles, commonLiters, dForm.quantities]);

  const totalDistributing = useMemo(
    () => Object.values(effectiveQuantities).reduce((s, q) => s + (Number(q) || 0), 0),
    [effectiveQuantities],
  );
  const remainingAfterDistribution = useMemo(
    () => Math.round((availableStock - totalDistributing) * 100) / 100,
    [availableStock, totalDistributing],
  );
  const insufficientStockError = useMemo(() => {
    if (totalDistributing <= 0 || remainingAfterDistribution >= 0) return null;
    return t('insufficientStock').replace('{available}', availableStock.toLocaleString()).replace('{required}', totalDistributing.toLocaleString());
  }, [totalDistributing, remainingAfterDistribution, availableStock, t]);

  // Latest purchase rate for distribution default
  const latestPurchaseRate = useMemo(() => {
    if (purchases.length === 0) return null;
    const sorted = [...purchases].sort((a, b) => b.diesel_date.localeCompare(a.diesel_date));
    return sorted[0]?.rate_per_liter ?? null;
  }, [purchases]);

  const openPurchaseAdd = () => {
    setEditingPurchase(null);
    setPForm({
      diesel_date: todayISO(),
      pump_name: '',
      quantity_liters: null,
      rate_per_liter: settings?.diesel_rate ?? null,
      paid_amount: null,
      additional_payment: null,
      remarks: '',
    });
    setPurchaseOpen(true);
  };

  const openPurchaseEdit = (p: DieselEntry) => {
    setEditingPurchase(p);
    setPForm({
      diesel_date: p.diesel_date,
      pump_name: p.pump_name ?? '',
      quantity_liters: p.quantity_liters,
      rate_per_liter: p.rate_per_liter,
      paid_amount: p.paid_amount,
      additional_payment: null,
      remarks: p.remarks ?? '',
    });
    setPurchaseOpen(true);
  };

  const savePurchase = async () => {
    if (savingPurchase) return;
    if (pForm.quantity_liters == null || Number(pForm.quantity_liters) <= 0) { show(t('quantityLiters') + ' - ' + t('required'), 'error'); return; }
    if (pForm.rate_per_liter == null || Number(pForm.rate_per_liter) <= 0) { show(t('ratePerLiter') + ' - ' + t('required'), 'error'); return; }
    const paid = effectivePaid;
    if (paid > purchaseTotal) { show(t('paidAmountExceedsTotal'), 'error'); return; }

    setSavingPurchase(true);
    const payload = {
      diesel_date: pForm.diesel_date,
      pump_name: pForm.pump_name || null,
      quantity_liters: Number(pForm.quantity_liters),
      rate_per_liter: Number(pForm.rate_per_liter),
      total_amount: purchaseTotal,
      paid_amount: paid,
      pending_amount: purchaseBalance,
      payment_status: purchaseStatus,
      remarks: pForm.remarks || null,
      vehicle_id: null,
    };

    try {
      if (editingPurchase) {
        const { error } = await supabase.from('diesel_entries').update(payload).eq('id', editingPurchase.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('diesel_entries').insert(payload);
        if (error) throw error;
      }
      show(t('saveSuccess'), 'success');
      setPurchaseOpen(false);
      fetchAll();
    } catch (err) {
      const msg = (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string')
        ? (err as { message: string }).message
        : err instanceof Error ? err.message : t('saveError');
      show(msg, 'error');
    }
    setSavingPurchase(false);
  };

  const handleDeletePurchase = async () => {
    if (!deletePurchaseId) return;
    const { error } = await supabase.from('diesel_entries').update({ is_cancelled: true }).eq('id', deletePurchaseId);
    if (error) show(t('deleteError'), 'error');
    else { show(t('deleteSuccess'), 'success'); fetchAll(); }
    setDeletePurchaseId(null);
  };

  // Distribution handlers
  const openDistribute = () => {
    setDForm({
      distribution_date: todayISO(),
      selected_vehicles: [],
      quantities: {},
      remarks: '',
    });
    setVehicleSearch('');
    setDistMode('bulk');
    setCommonLiters(null);
    setDistOpen(true);
  };

  const toggleVehicle = (id: string) => {
    setDForm(f => {
      const selected = f.selected_vehicles.includes(id)
        ? f.selected_vehicles.filter(v => v !== id)
        : [...f.selected_vehicles, id];
      const quantities = { ...f.quantities };
      if (!selected.includes(id)) delete quantities[id];
      return { ...f, selected_vehicles: selected, quantities };
    });
  };

  const selectAllVehicles = () => {
    setDForm(f => ({
      ...f,
      selected_vehicles: filteredVehicles.map(v => v.id),
    }));
  };

  const applyCommonLiters = (val: string) => {
    setCommonLiters(val === '' ? null : Number(val));
  };

  const clearSelection = () => {
    setDForm(f => ({ ...f, selected_vehicles: [], quantities: {} }));
  };

  const setVehicleQuantity = (id: string, val: string) => {
    setDForm(f => ({
      ...f,
      quantities: { ...f.quantities, [id]: val === '' ? null : Number(val) },
    }));
  };

  const filteredVehicles = useMemo(() => {
    if (!vehicleSearch) return vehicles;
    const q = vehicleSearch.toLowerCase();
    return vehicles.filter(v =>
      v.registration_number.toLowerCase().includes(q) ||
      (v.type ?? '').toLowerCase().includes(q),
    );
  }, [vehicles, vehicleSearch]);

  const saveDistribution = async () => {
    if (dForm.selected_vehicles.length === 0) { show(t('selectAtLeastOneVehicle'), 'error'); return; }

    if (distMode === 'bulk' && (commonLiters == null || commonLiters <= 0)) {
      show(t('litersPerVehicle') + ' - ' + t('required'), 'error');
      return;
    }

    const records: Omit<DieselDistribution, 'id' | 'created_at' | 'is_cancelled' | 'created_by' | 'updated_at' | 'updated_by'>[] = [];
    let totalQty = 0;
    for (const vid of dForm.selected_vehicles) {
      const qty = distMode === 'bulk' ? (commonLiters ?? 0) : dForm.quantities[vid];
      if (qty == null || Number(qty) <= 0) {
        show(t('enterQuantityForAll'), 'error');
        return;
      }
      totalQty += Number(qty);
    }

    if (totalQty > availableStock) {
      show(insufficientStockError ?? t('distributeExceedsStock'), 'error');
      return;
    }

    const rate = latestPurchaseRate ?? 0;
    for (const vid of dForm.selected_vehicles) {
      const qty = distMode === 'bulk' ? (commonLiters ?? 0) : Number(dForm.quantities[vid]);
      records.push({
        distribution_date: dForm.distribution_date,
        vehicle_id: vid,
        purchase_id: null,
        quantity_liters: qty,
        rate_per_liter: rate,
        amount: Math.round(qty * rate * 100) / 100,
        remarks: dForm.remarks || null,
      });
    }

    setSavingDist(true);
    try {
      const { error } = await supabase.from('diesel_distributions').insert(records);
      if (error) throw error;
      show(t('distributionSaved'), 'success');
      setDistOpen(false);
      fetchAll();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('saveError');
      show(msg, 'error');
    }
    setSavingDist(false);
  };

  const handleDeleteDist = async () => {
    if (!deleteDistId) return;
    const { error } = await supabase.from('diesel_distributions').update({ is_cancelled: true }).eq('id', deleteDistId);
    if (error) show(t('deleteError'), 'error');
    else { show(t('deleteSuccess'), 'success'); fetchAll(); }
    setDeleteDistId(null);
  };

  const filteredPurchases = useMemo(() => {
    if (!dateFilter) return purchases;
    return purchases.filter(e => e.diesel_date === dateFilter);
  }, [purchases, dateFilter]);

  const filteredDistributions = useMemo(() => {
    if (!dateFilter) return distributions;
    return distributions.filter(e => e.distribution_date === dateFilter);
  }, [distributions, dateFilter]);

  const exportPurchases = () => {
    const headers = ['Date', 'Pump', 'Quantity (L)', 'Rate/L', 'Total Amount', 'Paid', 'Balance', 'Status', 'Remarks'];
    const rows = filteredPurchases.map(d => [
      formatDate(d.diesel_date), d.pump_name ?? '',
      d.quantity_liters, d.rate_per_liter, d.total_amount, d.paid_amount, d.pending_amount,
      d.payment_status, d.remarks ?? '',
    ]);
    exportToExcelWithCompany(
      'Diesel_Purchases.csv', 'Diesel Purchase Report',
      settings ? { company_name: settings.company_name, address: settings.address, phone: settings.phone, email: settings.email, gstin: settings.gstin } : { company_name: 'Crane ERP' },
      dateFilter ? formatDate(dateFilter) : 'All Dates', todayISO(), dateFilter ? `Date: ${formatDate(dateFilter)}` : '',
      headers, rows,
    );
  };

  const exportDistributions = () => {
    const headers = ['Date', 'Vehicle', 'Quantity (L)', 'Rate/L', 'Amount', 'Remarks'];
    const rows = filteredDistributions.map(d => [
      formatDate(d.distribution_date), d.vehicle?.registration_number ?? '-',
      d.quantity_liters, d.rate_per_liter, d.amount, d.remarks ?? '',
    ]);
    exportToExcelWithCompany(
      'Diesel_Distributions.csv', 'Diesel Distribution Report',
      settings ? { company_name: settings.company_name, address: settings.address, phone: settings.phone, email: settings.email, gstin: settings.gstin } : { company_name: 'Crane ERP' },
      dateFilter ? formatDate(dateFilter) : 'All Dates', todayISO(), dateFilter ? `Date: ${formatDate(dateFilter)}` : '',
      headers, rows,
    );
  };

  const purchaseColumns: Column<DieselWithRelations>[] = [
    { key: 'diesel_date', header: t('date'), sortable: true, render: d => formatDate(d.diesel_date) },
    { key: 'pump_name', header: t('pumpName'), render: d => d.pump_name ?? '-' },
    { key: 'quantity_liters', header: t('liters'), align: 'right', sortable: true, render: d => `${d.quantity_liters} L` },
    { key: 'rate_per_liter', header: t('fuelRate'), align: 'right', render: d => formatCurrency(d.rate_per_liter) },
    { key: 'total_amount', header: t('totalDieselAmount'), align: 'right', sortable: true, render: d => formatCurrency(d.total_amount) },
    { key: 'paid_amount', header: t('paidAmount'), align: 'right', render: d => <span className="text-emerald-600">{formatCurrency(d.paid_amount)}</span> },
    { key: 'pending_amount', header: t('balanceAmount'), align: 'right', render: d => <span className="text-red-600">{formatCurrency(d.pending_amount)}</span> },
    { key: 'payment_status', header: t('paymentStatus'), render: d => <StatusBadge status={d.payment_status} /> },
    {
      key: 'actions', header: t('actions'), align: 'center',
      render: d => (
        <div className="flex justify-center gap-1">
          <button onClick={() => openPurchaseEdit(d)} className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md"><Pencil className="w-4 h-4" /></button>
          <button onClick={() => setDeletePurchaseId(d.id)} className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-md"><Trash2 className="w-4 h-4" /></button>
        </div>
      ),
    },
  ];

  const distColumns: Column<DieselDistributionWithRelations>[] = [
    { key: 'distribution_date', header: t('date'), sortable: true, render: d => formatDate(d.distribution_date) },
    { key: 'vehicle', header: t('vehicleNumber'), render: d => d.vehicle?.registration_number ?? '-' },
    { key: 'quantity_liters', header: t('liters'), align: 'right', sortable: true, render: d => `${d.quantity_liters} L` },
    { key: 'rate_per_liter', header: t('fuelRate'), align: 'right', render: d => formatCurrency(d.rate_per_liter) },
    { key: 'amount', header: t('totalDieselAmount'), align: 'right', render: d => formatCurrency(d.amount) },
    {
      key: 'actions', header: t('actions'), align: 'center',
      render: d => (
        <div className="flex justify-center gap-1">
          <button onClick={() => setDeleteDistId(d.id)} className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-md"><Trash2 className="w-4 h-4" /></button>
        </div>
      ),
    },
  ];

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      {/* Stock Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{t('totalPurchased')}</span>
            <div className="p-2 rounded-lg bg-blue-50 text-blue-600"><Fuel className="w-4 h-4" /></div>
          </div>
          <div className="mt-2 text-xl font-bold text-slate-800 tabular-nums">{totalPurchasedLiters.toLocaleString()} L</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{t('totalDistributed')}</span>
            <div className="p-2 rounded-lg bg-amber-50 text-amber-600"><Share2 className="w-4 h-4" /></div>
          </div>
          <div className="mt-2 text-xl font-bold text-slate-800 tabular-nums">{totalDistributedLiters.toLocaleString()} L</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{t('availableStock')}</span>
            <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600"><Fuel className="w-4 h-4" /></div>
          </div>
          <div className="mt-2 text-xl font-bold text-emerald-700 tabular-nums">{availableStock.toLocaleString()} L</div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <DatePicker
            value={dateFilter}
            onChange={v => setDateFilter(v)}
            placeholder="Filter by date"
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          />
          {dateFilter && <button onClick={() => setDateFilter('')} className="text-xs text-slate-400 hover:text-slate-600">Clear</button>}
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={openPurchaseAdd}><Plus className="w-4 h-4" />{t('addDieselPurchase')}</Button>
          <Button variant="outline" onClick={openDistribute}><Share2 className="w-4 h-4" />{t('distributeDiesel')}</Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        <button
          onClick={() => setTab('purchases')}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${tab === 'purchases' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
        >
          {t('purchaseRecords')}
        </button>
        <button
          onClick={() => setTab('distributions')}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${tab === 'distributions' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
        >
          {t('distributionHistory')}
        </button>
      </div>

      {/* Tables */}
      {tab === 'purchases' ? (
        <>
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={exportPurchases}><Fuel className="w-4 h-4" />{t('export')}</Button>
          </div>
          <DataTable columns={purchaseColumns} data={filteredPurchases} searchKeys={['pump_name']} searchPlaceholder={`${t('search')}...`} showSerialNumber />
        </>
      ) : (
        <>
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={exportDistributions}><Fuel className="w-4 h-4" />{t('export')}</Button>
          </div>
          <DataTable columns={distColumns} data={filteredDistributions} searchKeys={['vehicle']} searchPlaceholder={`${t('search')}...`} showSerialNumber />
        </>
      )}

      {/* Purchase Modal */}
      <Modal
        open={purchaseOpen} onClose={() => setPurchaseOpen(false)}
        title={editingPurchase ? `${t('edit')} ${t('addDieselPurchase')}` : t('addDieselPurchase')}
        size="lg"
        footer={<><Button variant="secondary" onClick={() => setPurchaseOpen(false)}>{t('cancel')}</Button><Button onClick={savePurchase} disabled={savingPurchase}>{savingPurchase ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />{t('saving')}</> : t('save')}</Button></>}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label={t('date')} required>
              <DatePicker value={pForm.diesel_date} onChange={v => setPForm(f => ({ ...f, diesel_date: v }))} />
            </Field>
            <Field label={t('pumpName')}>
              <input className={inputClass()} value={pForm.pump_name} onChange={e => setPForm(f => ({ ...f, pump_name: e.target.value }))} placeholder="Indian Oil, HP, Bharat..." />
            </Field>
            <Field label={t('quantityLiters')} required>
              <input type="number" step="0.01" className={inputClass()} value={pForm.quantity_liters ?? ''} onChange={e => setPForm(f => ({ ...f, quantity_liters: e.target.value === '' ? null : Number(e.target.value) }))} placeholder="0.00" />
            </Field>
            <Field label={t('ratePerLiter')} required>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₹</span>
                <input type="number" step="0.01" className={inputClass() + ' pl-7'} value={pForm.rate_per_liter ?? ''} onChange={e => setPForm(f => ({ ...f, rate_per_liter: e.target.value === '' ? null : Number(e.target.value) }))} placeholder="0.00" />
              </div>
              {settings?.diesel_rate && <p className="text-xs text-slate-400 mt-1">Default from Settings: ₹{settings.diesel_rate}/L</p>}
            </Field>
            <Field label={t('paidAmount')}>
              <input type="number" step="0.01" className={inputClass()} value={pForm.paid_amount ?? ''} onChange={e => setPForm(f => ({ ...f, paid_amount: e.target.value === '' ? null : Number(e.target.value) }))} placeholder="0.00" disabled={!!editingPurchase} />
            </Field>
            {editingPurchase && (
              <Field label="Additional Payment">
                <input type="number" step="0.01" className={inputClass()} value={pForm.additional_payment ?? ''} onChange={e => setPForm(f => ({ ...f, additional_payment: e.target.value === '' ? null : Number(e.target.value) }))} placeholder="Enter additional payment amount" />
              </Field>
            )}
            <Field label={t('remarks')}>
              <input className={inputClass()} value={pForm.remarks} onChange={e => setPForm(f => ({ ...f, remarks: e.target.value }))} placeholder="Optional notes" />
            </Field>
          </div>

          {/* Auto-calc summary */}
          <div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <span className="text-slate-500 block text-xs">{t('totalDieselAmount')}</span>
                <span className="font-semibold text-slate-800">{formatCurrency(purchaseTotal)}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-xs">{t('paidAmount')}</span>
                <span className="font-semibold text-emerald-600">{formatCurrency(effectivePaid)}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-xs">{t('balanceAmount')}</span>
                <span className="font-bold text-red-600">{formatCurrency(purchaseBalance)}</span>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-blue-100">
              <StatusBadge status={purchaseStatus} />
            </div>
          </div>
        </div>
      </Modal>

      {/* Distribution Modal */}
      <Modal
        open={distOpen} onClose={() => setDistOpen(false)}
        title={t('distributeDiesel')}
        size="2xl"
        footer={<><Button variant="secondary" onClick={() => setDistOpen(false)}>{t('cancel')}</Button><Button onClick={saveDistribution} disabled={savingDist || !!insufficientStockError}>{savingDist ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />{t('saving')}</> : t('save')}</Button></>}
      >
        <div className="space-y-4">
          {/* Available stock banner */}
          <div className="flex items-center justify-between p-4 rounded-lg border border-emerald-200 bg-emerald-50">
            <div>
              <span className="text-sm font-semibold text-emerald-800">{t('availableDieselStock')}</span>
              <div className="text-2xl font-bold text-emerald-700 tabular-nums">{availableStock.toLocaleString()} L</div>
            </div>
            {latestPurchaseRate != null && (
              <div className="text-right">
                <span className="text-xs text-slate-500 block">{t('fuelRate')}</span>
                <span className="font-semibold text-slate-700">{formatCurrency(latestPurchaseRate)}/L</span>
              </div>
            )}
          </div>

          <Field label={t('date')} required>
            <DatePicker value={dForm.distribution_date} onChange={v => setDForm(f => ({ ...f, distribution_date: v }))} />
          </Field>

          {/* Distribution mode toggle */}
          <div className="flex gap-2 p-1 bg-slate-100 rounded-lg">
            <button
              onClick={() => setDistMode('bulk')}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-md transition-all ${distMode === 'bulk' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Layers className="w-4 h-4" />{t('bulkDistribution')}
            </button>
            <button
              onClick={() => setDistMode('individual')}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-md transition-all ${distMode === 'individual' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <List className="w-4 h-4" />{t('individualDistribution')}
            </button>
          </div>

          {/* Common liters field (bulk mode) */}
          {distMode === 'bulk' && (
            <div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
              <Field label={t('litersPerVehicle')} required hint={t('litersPerVehicleHint')}>
                <div className="flex items-center gap-2 max-w-xs">
                  <input
                    type="number"
                    step="0.01"
                    className={inputClass()}
                    value={commonLiters ?? ''}
                    onChange={e => applyCommonLiters(e.target.value)}
                    placeholder=""
                  />
                  <span className="text-sm font-semibold text-slate-500 whitespace-nowrap">L</span>
                </div>
              </Field>
              {dForm.selected_vehicles.length > 0 && commonLiters != null && commonLiters > 0 && (
                <div className="mt-3 space-y-1">
                  {dForm.selected_vehicles.map(vid => {
                    const v = vehicles.find(vh => vh.id === vid);
                    return (
                      <div key={vid} className="flex items-center justify-between text-sm">
                        <span className="text-slate-600 font-medium">{v?.registration_number ?? '-'}</span>
                        <span className="text-slate-800 font-semibold">{commonLiters} L</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Vehicle selection panel */}
          <Field label={t('selectVehicles')} required>
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              {/* Search + actions bar */}
              <div className="flex flex-col sm:flex-row gap-2 p-3 bg-slate-50 border-b border-slate-200">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    className={inputClass() + ' pl-9'}
                    placeholder={t('searchVehicleNumber')}
                    value={vehicleSearch}
                    onChange={e => setVehicleSearch(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={selectAllVehicles} className="text-xs px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-600 flex items-center gap-1.5 font-medium whitespace-nowrap"><CheckSquare className="w-3.5 h-3.5" />{t('selectAll')}</button>
                  <button onClick={clearSelection} className="text-xs px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-600 flex items-center gap-1.5 font-medium whitespace-nowrap"><Square className="w-3.5 h-3.5" />{t('clearSelection')}</button>
                  <span className="text-xs text-slate-500 font-medium whitespace-nowrap self-center">{dForm.selected_vehicles.length} {t('vehiclesSelected')}</span>
                </div>
              </div>

              {/* Scrollable vehicle list */}
              <div className="max-h-[450px] overflow-y-auto p-2">
                {vehicles.length === 0 ? (
                  <EmptyState message="No vehicles available" icon={Fuel} />
                ) : filteredVehicles.length === 0 ? (
                  <div className="py-8 text-center text-sm text-slate-400">No vehicles match "{vehicleSearch}"</div>
                ) : (
                  <div className="space-y-1">
                    {filteredVehicles.map(v => {
                      const isSelected = dForm.selected_vehicles.includes(v.id);
                      return (
                        <div
                          key={v.id}
                          onClick={() => toggleVehicle(v.id)}
                          className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all border ${isSelected ? 'bg-blue-50 border-blue-300' : 'bg-white border-transparent hover:bg-slate-50'}`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleVehicle(v.id)}
                            onClick={e => e.stopPropagation()}
                            className="w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                          />
                          <span className="text-sm font-bold text-slate-800">{v.registration_number}</span>
                          <span className="text-xs text-slate-400 font-medium">({v.type})</span>
                          {isSelected && distMode === 'individual' && (
                            <div className="ml-auto flex items-center gap-2" onClick={e => e.stopPropagation()}>
                              <input
                                type="number"
                                step="0.01"
                                className="w-24 px-2 py-1 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                placeholder="L"
                                value={dForm.quantities[v.id] ?? ''}
                                onChange={e => setVehicleQuantity(v.id, e.target.value)}
                              />
                              <span className="text-xs text-slate-400">L</span>
                            </div>
                          )}
                          {isSelected && distMode === 'bulk' && (
                            <span className="ml-auto text-sm font-semibold text-blue-600">
                              {commonLiters != null ? `${commonLiters} L` : ''}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </Field>

          {/* Distribution summary */}
          {dForm.selected_vehicles.length > 0 && (
            <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
                <div>
                  <span className="text-amber-700 block text-xs">{t('availableStock')}</span>
                  <span className="font-bold text-slate-800">{availableStock.toLocaleString()} L</span>
                </div>
                <div>
                  <span className="text-amber-700 block text-xs">{t('selectedVehiclesCount')}</span>
                  <span className="font-bold text-slate-800">{dForm.selected_vehicles.length}</span>
                </div>
                <div>
                  <span className="text-amber-700 block text-xs">{t('litersPerVehicle')}</span>
                  <span className="font-bold text-slate-800">{distMode === 'bulk' ? (commonLiters != null ? `${commonLiters} L` : '-') : '-'}</span>
                </div>
                <div>
                  <span className="text-amber-700 block text-xs">{t('totalDistributedLiters')}</span>
                  <span className="font-bold text-blue-700">{totalDistributing.toLocaleString()} L</span>
                </div>
                <div>
                  <span className="text-amber-700 block text-xs">{t('remainingStock')}</span>
                  <span className={`font-bold ${remainingAfterDistribution < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{remainingAfterDistribution.toLocaleString()} L</span>
                </div>
              </div>
              {insufficientStockError && (
                <p className="mt-2 text-xs font-medium text-red-600">{insufficientStockError}</p>
              )}
            </div>
          )}

          <Field label={t('remarks')}>
            <input className={inputClass()} value={dForm.remarks} onChange={e => setDForm(f => ({ ...f, remarks: e.target.value }))} placeholder="Optional notes" />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog open={!!deletePurchaseId} onClose={() => setDeletePurchaseId(null)} onConfirm={handleDeletePurchase} title={t('delete')} message={t('confirmDelete')} confirmText={t('delete')} danger />
      <ConfirmDialog open={!!deleteDistId} onClose={() => setDeleteDistId(null)} onConfirm={handleDeleteDist} title={t('delete')} message={t('confirmDelete')} confirmText={t('delete')} danger />
    </div>
  );
}
