import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useLang } from '@/context/LangContext';
import { useSettings } from '@/context/SettingsContext';
import { useToast } from '@/components/ui/Toast';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Modal, ConfirmDialog, StatusBadge, Button, Field, inputClass, LoadingSpinner } from '@/components/ui/common';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { Plus, Pencil, Trash2, Download, Filter, Columns3, X } from 'lucide-react';
import { formatCurrency, formatDate, exportToExcelWithCompany, todayISO, monthName } from '@/lib/utils';
import { DatePicker } from '@/components/ui/DatePicker';
import type { MaintenanceRecord, MaintenanceWithRelations, Vehicle, MaintenanceTypeConfig } from '@/types';

const COLUMN_KEYS = ['sl_no', 'date', 'vehicle', 'maintenance_type', 'remark', 'total_amount', 'paid_amount', 'balance'] as const;
type ColumnKey = typeof COLUMN_KEYS[number];

const STORAGE_KEY = 'maintenance-visible-columns';

function loadVisibleColumns(): Set<ColumnKey> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const arr = JSON.parse(stored) as ColumnKey[];
      return new Set(arr);
    }
  } catch { /* ignore */ }
  return new Set(COLUMN_KEYS);
}

function paymentStatusOf(m: MaintenanceWithRelations): 'Fully Paid' | 'Unpaid' | 'Partially Paid' {
  const total = Number(m.amount) || 0;
  const paid = Number(m.paid_amount) || 0;
  if (paid >= total && total > 0) return 'Fully Paid';
  if (paid <= 0) return 'Unpaid';
  return 'Partially Paid';
}

export default function Maintenance() {
  const { t } = useLang();
  const { show } = useToast();
  const { settings } = useSettings();
  const [records, setRecords] = useState<MaintenanceWithRelations[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [maintTypes, setMaintTypes] = useState<MaintenanceTypeConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<MaintenanceRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [showColumnPicker, setShowColumnPicker] = useState(false);

  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(() => loadVisibleColumns());

  const [form, setForm] = useState<Partial<MaintenanceRecord>>({
    maintenance_date: todayISO(), vehicle_id: '', maintenance_type: '', amount: null as number | null, paid_amount: null as number | null, remark: '',
  });

  const [filters, setFilters] = useState({
    from: '',
    to: '',
    month: 0,
    year: 0,
    vehicle_id: '',
    maintenance_type: '',
    payment_status: '',
  });

  const activeTypes = useMemo(() => maintTypes.filter(mt => mt.is_active), [maintTypes]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [mRes, vRes, mtRes] = await Promise.all([
      supabase.from('maintenance').select('*, vehicle:vehicles(id,registration_number,type)').order('maintenance_date', { ascending: false }).eq('is_cancelled', false),
      supabase.from('vehicles').select('*').order('registration_number'),
      supabase.from('maintenance_types').select('*').order('sort_order', { ascending: true }),
    ]);
    setRecords((mRes.data ?? []) as MaintenanceWithRelations[]);
    setVehicles((vRes.data ?? []) as Vehicle[]);
    setMaintTypes((mtRes.data ?? []) as MaintenanceTypeConfig[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const persistColumns = (next: Set<ColumnKey>) => {
    setVisibleColumns(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
  };

  const toggleColumn = (key: ColumnKey) => {
    const next = new Set(visibleColumns);
    if (next.has(key)) {
      if (next.size > 1) next.delete(key);
    } else {
      next.add(key);
    }
    persistColumns(next);
  };

  const filteredRecords = useMemo(() => {
    return records.filter(m => {
      if (filters.from && m.maintenance_date < filters.from) return false;
      if (filters.to && m.maintenance_date > filters.to) return false;
      if (filters.month > 0) {
        const d = new Date(m.maintenance_date + 'T00:00:00');
        if (d.getMonth() + 1 !== filters.month) return false;
      }
      if (filters.year > 0) {
        const d = new Date(m.maintenance_date + 'T00:00:00');
        if (d.getFullYear() !== filters.year) return false;
      }
      if (filters.vehicle_id && m.vehicle_id !== filters.vehicle_id) return false;
      if (filters.maintenance_type && m.maintenance_type !== filters.maintenance_type) return false;
      if (filters.payment_status) {
        const status = paymentStatusOf(m);
        if (status !== filters.payment_status) return false;
      }
      return true;
    });
  }, [records, filters]);

  const openAdd = () => {
    setEditing(null);
    setForm({
      maintenance_date: todayISO(), vehicle_id: '', maintenance_type: activeTypes[0]?.name ?? '',
      amount: null as number | null, paid_amount: null as number | null, remark: '',
    });
    setModalOpen(true);
  };
  const openEdit = (m: MaintenanceRecord) => {
    setEditing(m);
    setForm({ ...m });
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.vehicle_id) { show(t('required'), 'error'); return; }
    if (!form.maintenance_type) { show(`${t('maintenanceType')} - ${t('required')}`, 'error'); return; }
    const totalAmount = form.amount === null ? 0 : Number(form.amount);
    const paidAmount = form.paid_amount === null ? 0 : Number(form.paid_amount);
    if (paidAmount > totalAmount) { show(t('paidAmountExceedsTotal'), 'error'); return; }
    setSaving(true);
    const payload = {
      maintenance_date: form.maintenance_date,
      vehicle_id: form.vehicle_id,
      maintenance_type: form.maintenance_type,
      amount: totalAmount,
      paid_amount: paidAmount,
      balance: totalAmount - paidAmount,
      remark: form.remark ?? null,
    };
    if (editing) {
      const { error } = await supabase.from('maintenance').update(payload).eq('id', editing.id);
      if (error) show(t('saveError'), 'error');
      else { show(t('saveSuccess'), 'success'); setModalOpen(false); fetchAll(); }
    } else {
      const { error } = await supabase.from('maintenance').insert(payload);
      if (error) show(t('saveError'), 'error');
      else { show(t('saveSuccess'), 'success'); setModalOpen(false); fetchAll(); }
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from('maintenance').update({ is_cancelled: true }).eq('id', deleteId);
    if (error) show(t('deleteError'), 'error');
    else { show(t('deleteSuccess'), 'success'); fetchAll(); }
    setDeleteId(null);
  };

  const clearFilters = () => setFilters({ from: '', to: '', month: 0, year: 0, vehicle_id: '', maintenance_type: '', payment_status: '' });

  const hasActiveFilters = filters.from || filters.to || filters.month > 0 || filters.year > 0 || filters.vehicle_id || filters.maintenance_type || filters.payment_status;

  const handleExport = () => {
    const data = filteredRecords;
    if (data.length === 0) { show('No data to export', 'error'); return; }
    const companyInfo = settings ? { company_name: settings.company_name, address: settings.address, phone: settings.phone, email: settings.email, gstin: settings.gstin } : { company_name: 'Crane ERP' };
    let filterStr = '';
    if (filters.from || filters.to) filterStr += `Date: ${filters.from || '...'} to ${filters.to || '...'} `;
    if (filters.month > 0) filterStr += `Month: ${monthName(filters.month - 1)}${filters.year > 0 ? ' ' + filters.year : ''} `;
    if (filters.vehicle_id) filterStr += `Vehicle: ${vehicles.find(v => v.id === filters.vehicle_id)?.registration_number ?? ''} `;
    if (filters.maintenance_type) filterStr += `Type: ${filters.maintenance_type} `;
    if (filters.payment_status) filterStr += `Status: ${filters.payment_status} `;

    const headers: string[] = [];
    const rows: (string | number)[][] = [];

    for (const r of data) {
      const row: (string | number)[] = [];
      for (const col of COLUMN_KEYS) {
        if (!visibleColumns.has(col)) continue;
        switch (col) {
          case 'sl_no': row.push(data.indexOf(r) + 1); break;
          case 'date': row.push(formatDate(r.maintenance_date)); break;
          case 'vehicle': row.push(r.vehicle?.registration_number ?? '-'); break;
          case 'maintenance_type': row.push(r.maintenance_type); break;
          case 'remark': row.push(r.remark ?? r.description ?? '-'); break;
          case 'total_amount': row.push(Number(r.amount)); break;
          case 'paid_amount': row.push(Number(r.paid_amount)); break;
          case 'balance': row.push(Number(r.balance)); break;
        }
      }
      rows.push(row);
    }

    for (const col of COLUMN_KEYS) {
      if (!visibleColumns.has(col)) continue;
      switch (col) {
        case 'sl_no': headers.push(t('slNo')); break;
        case 'date': headers.push(t('date')); break;
        case 'vehicle': headers.push(t('vehicleNumber')); break;
        case 'maintenance_type': headers.push(t('maintenanceType')); break;
        case 'remark': headers.push(t('remark')); break;
        case 'total_amount': headers.push(t('totalAmount')); break;
        case 'paid_amount': headers.push(t('paidAmount')); break;
        case 'balance': headers.push(t('balance')); break;
      }
    }

    const totalRow: (string | number)[] = headers.map(() => '');
    if (visibleColumns.has('total_amount')) {
      const idx = [...COLUMN_KEYS].filter(c => visibleColumns.has(c)).indexOf('total_amount');
      totalRow[idx] = data.reduce((s, m) => s + Number(m.amount), 0);
    }
    if (visibleColumns.has('paid_amount')) {
      const idx = [...COLUMN_KEYS].filter(c => visibleColumns.has(c)).indexOf('paid_amount');
      totalRow[idx] = data.reduce((s, m) => s + Number(m.paid_amount), 0);
    }
    if (visibleColumns.has('balance')) {
      const idx = [...COLUMN_KEYS].filter(c => visibleColumns.has(c)).indexOf('balance');
      totalRow[idx] = data.reduce((s, m) => s + Number(m.balance), 0);
    }

    exportToExcelWithCompany('Maintenance_Report.csv', t('maintenanceReport'), companyInfo, filterStr || 'All Records', new Date().toLocaleString('en-IN'), filterStr, headers, rows, totalRow);
  };

  // Build columns dynamically based on visibleColumns
  const columns: Column<MaintenanceWithRelations>[] = useMemo(() => {
    const cols: Column<MaintenanceWithRelations>[] = [];
        if (visibleColumns.has('date')) cols.push({ key: 'maintenance_date', header: t('date'), sortable: true, render: m => formatDate(m.maintenance_date) });
    if (visibleColumns.has('vehicle')) cols.push({ key: 'vehicle', header: t('vehicleNumber'), render: m => m.vehicle?.registration_number ?? '-' });
    if (visibleColumns.has('maintenance_type')) cols.push({ key: 'maintenance_type', header: t('maintenanceType'), render: m => <StatusBadge status={m.maintenance_type} variant="blue" /> });
    if (visibleColumns.has('remark')) cols.push({ key: 'remark', header: t('remark'), render: m => <span className="truncate max-w-[200px] inline-block">{m.remark ?? m.description ?? '-'}</span> });
    if (visibleColumns.has('total_amount')) cols.push({ key: 'amount', header: t('totalAmount'), align: 'right', sortable: true, render: m => <span className="font-medium text-slate-800">{formatCurrency(m.amount)}</span> });
    if (visibleColumns.has('paid_amount')) cols.push({ key: 'paid_amount', header: t('paidAmount'), align: 'right', render: m => <span className="font-medium text-emerald-600">{formatCurrency(m.paid_amount)}</span> });
    if (visibleColumns.has('balance')) cols.push({ key: 'balance', header: t('balance'), align: 'right', render: m => <span className={Number(m.balance) > 0 ? 'font-medium text-red-600' : 'font-medium text-emerald-600'}>{formatCurrency(m.balance)}</span> });
    cols.push({
      key: 'actions', header: t('actions'), align: 'center',
      render: m => (
        <div className="flex justify-center gap-1">
          <button onClick={() => openEdit(m)} className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md"><Pencil className="w-4 h-4" /></button>
          <button onClick={() => setDeleteId(m.id)} className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-md"><Trash2 className="w-4 h-4" /></button>
        </div>
      ),
    });
    return cols;
  }, [visibleColumns, filteredRecords, t]);

  const totals = useMemo(() => ({
    total: filteredRecords.reduce((s, m) => s + Number(m.amount), 0),
    paid: filteredRecords.reduce((s, m) => s + Number(m.paid_amount), 0),
    balance: filteredRecords.reduce((s, m) => s + Number(m.balance), 0),
  }), [filteredRecords]);

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      {/* Summary KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-lg border border-slate-200 p-3 shadow-sm">
          <p className="text-xs text-slate-500">{t('maintenance')} — {filteredRecords.length}</p>
          <p className="text-lg font-bold text-slate-800">{filteredRecords.length}</p>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-3 shadow-sm">
          <p className="text-xs text-slate-500">{t('totalAmount')}</p>
          <p className="text-lg font-bold text-slate-800">{formatCurrency(totals.total)}</p>
        </div>
        <div className="bg-white rounded-lg border border-emerald-200 p-3 shadow-sm">
          <p className="text-xs text-emerald-600">{t('paidAmount')}</p>
          <p className="text-lg font-bold text-emerald-700">{formatCurrency(totals.paid)}</p>
        </div>
        <div className="bg-white rounded-lg border border-red-200 p-3 shadow-sm">
          <p className="text-xs text-red-600">{t('balance')}</p>
          <p className="text-lg font-bold text-red-700">{formatCurrency(totals.balance)}</p>
        </div>
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowFilters(s => !s)}><Filter className="w-4 h-4" />{t('filter')}</Button>
          <Button variant="outline" size="sm" onClick={() => setShowColumnPicker(s => !s)}><Columns3 className="w-4 h-4" />{t('selectColumns')}</Button>
          {hasActiveFilters && <Button variant="outline" size="sm" onClick={clearFilters}><X className="w-4 h-4" />{t('clear')}</Button>}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={handleExport} disabled={filteredRecords.length === 0}><Download className="w-4 h-4" />{t('export')}</Button>
          <Button onClick={openAdd}><Plus className="w-4 h-4" />{t('addMaintenance')}</Button>
        </div>
      </div>

      {/* Filters panel */}
      {showFilters && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Field label={t('from')}>
              <DatePicker value={filters.from} onChange={v => setFilters(f => ({ ...f, from: v }))} />
            </Field>
            <Field label={t('to')}>
              <DatePicker value={filters.to} onChange={v => setFilters(f => ({ ...f, to: v }))} />
            </Field>
            <Field label={t('month')}>
              <select className={inputClass()} value={filters.month} onChange={e => setFilters(f => ({ ...f, month: Number(e.target.value) }))}>
                <option value={0}>{t('all')}</option>
                {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{monthName(i)}</option>)}
              </select>
            </Field>
            <Field label={t('year')}>
              <input type="number" className={inputClass()} value={filters.year || ''} onChange={e => setFilters(f => ({ ...f, year: Number(e.target.value) }))} placeholder={t('all')} />
            </Field>
            <Field label={t('vehicleNumber')}>
              <select className={inputClass()} value={filters.vehicle_id} onChange={e => setFilters(f => ({ ...f, vehicle_id: e.target.value }))}>
                <option value="">{t('all')}</option>
                {vehicles.map(v => <option key={v.id} value={v.id}>{v.registration_number}</option>)}
              </select>
            </Field>
            <Field label={t('maintenanceType')}>
              <select className={inputClass()} value={filters.maintenance_type} onChange={e => setFilters(f => ({ ...f, maintenance_type: e.target.value }))}>
                <option value="">{t('all')}</option>
                {maintTypes.map(mt => <option key={mt.id} value={mt.name}>{mt.name}</option>)}
              </select>
            </Field>
            <Field label={t('paymentStatusFilter')}>
              <select className={inputClass()} value={filters.payment_status} onChange={e => setFilters(f => ({ ...f, payment_status: e.target.value }))}>
                <option value="">{t('all')}</option>
                <option value="Fully Paid">{t('fullyPaid')}</option>
                <option value="Partially Paid">{t('partiallyPaid')}</option>
                <option value="Unpaid">{t('unpaid')}</option>
              </select>
            </Field>
          </div>
        </div>
      )}

      {/* Column picker panel */}
      {showColumnPicker && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <p className="text-sm font-medium text-slate-700 mb-3">{t('selectColumns')}</p>
          <div className="flex flex-wrap gap-2">
            {COLUMN_KEYS.map(key => {
              const labelMap: Record<ColumnKey, string> = {
                sl_no: t('slNo'), date: t('date'), vehicle: t('vehicleNumber'),
                maintenance_type: t('maintenanceType'), remark: t('remark'),
                total_amount: t('totalAmount'), paid_amount: t('paidAmount'), balance: t('balance'),
              };
              const active = visibleColumns.has(key);
              return (
                <button
                  key={key}
                  onClick={() => toggleColumn(key)}
                  className={`px-3 py-1.5 text-sm font-medium rounded-lg border transition-all ${active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                >
                  {labelMap[key]}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Data table */}
      <DataTable columns={columns} data={filteredRecords} searchKeys={['maintenance_type', 'remark', 'description']} searchPlaceholder={`${t('search')}...`} showSerialNumber />

      {/* Add/Edit Modal */}
      <Modal
        open={modalOpen} onClose={() => setModalOpen(false)}
        title={editing ? `${t('edit')} ${t('maintenance')}` : `${t('addMaintenance')}`}
        footer={<><Button variant="secondary" onClick={() => setModalOpen(false)}>{t('cancel')}</Button><Button onClick={save} disabled={saving}>{saving ? t('saving') : t('save')}</Button></>}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={t('date')} required>
            <DatePicker value={form.maintenance_date ?? ''} onChange={v => setForm(f => ({ ...f, maintenance_date: v }))} />
          </Field>
          <Field label={t('vehicleNumber')} required>
            <SearchableSelect
              value={form.vehicle_id ?? ''}
              onChange={val => setForm(f => ({ ...f, vehicle_id: val }))}
              placeholder="-"
              searchPlaceholder="Search vehicle number..."
              options={vehicles.map(v => ({
                value: v.id,
                label: `${v.registration_number} (${v.type})`,
                searchText: v.registration_number,
              }))}
            />
          </Field>
          <Field label={t('maintenanceType')} required>
            <select className={inputClass()} value={form.maintenance_type ?? ''} onChange={e => setForm(f => ({ ...f, maintenance_type: e.target.value }))}>
              <option value="">-</option>
              {activeTypes.map(mt => <option key={mt.id} value={mt.name}>{mt.name}</option>)}
              {editing && !activeTypes.some(mt => mt.name === editing.maintenance_type) && (
                <option value={editing.maintenance_type}>{editing.maintenance_type} (inactive)</option>
              )}
            </select>
          </Field>
          <Field label={t('remark')}>
            <input className={inputClass()} value={form.remark ?? ''} onChange={e => setForm(f => ({ ...f, remark: e.target.value }))} placeholder="Enter remark..." />
          </Field>
          <Field label={t('totalAmount')} required>
            <input type="number" step="0.01" min="0" className={inputClass()} value={form.amount ?? ''} onChange={e => setForm(f => ({ ...f, amount: e.target.value === '' ? null : Number(e.target.value) }))} />
          </Field>
          <Field label={t('paidAmount')}>
            <input type="number" step="0.01" min="0" className={inputClass()} value={form.paid_amount ?? ''} onChange={e => setForm(f => ({ ...f, paid_amount: e.target.value === '' ? null : Number(e.target.value) }))} />
          </Field>
          <div className="sm:col-span-2">
            <div className="flex justify-between items-center bg-slate-50 rounded-lg px-4 py-2.5 border border-slate-200">
              <span className="text-sm font-medium text-slate-600">{t('balance')}</span>
              <span className={`text-lg font-bold ${(form.amount ?? 0) - (form.paid_amount ?? 0) > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                {formatCurrency((form.amount ?? 0) - (form.paid_amount ?? 0))}
              </span>
            </div>
          </div>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={handleDelete} title={t('delete')} message={t('confirmDelete')} confirmText={t('delete')} danger />
    </div>
  );
}
