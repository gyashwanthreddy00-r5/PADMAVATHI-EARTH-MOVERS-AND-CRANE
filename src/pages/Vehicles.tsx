import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useLang } from '@/context/LangContext';
import { useToast } from '@/components/ui/Toast';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Modal, ConfirmDialog, StatusBadge, Button, Field, inputClass, LoadingSpinner, ErrorState } from '@/components/ui/common';
import { Plus, Pencil, Trash2, Eye, Download, RefreshCw, Truck } from 'lucide-react';
import { formatCurrency, formatDate, exportToExcelWithCompany } from '@/lib/utils';
import { useSettings } from '@/context/SettingsContext';
import { DatePicker } from '@/components/ui/DatePicker';
import type { Vehicle, VehicleStatus, EmiStatus } from '@/types';

const vehicleStatuses: VehicleStatus[] = ['Available', 'Working', 'Maintenance', 'Inactive'];
const emiStatuses: EmiStatus[] = ['No EMI', 'EMI Applicable'];

function normalizeVehicle(row: Record<string, unknown>): Vehicle | null {
  if (!row.id) return null;

  const status = String(row.status ?? 'Available') as VehicleStatus;
  const emiStatus = String(row.emi_status ?? 'No EMI') as EmiStatus;

  return {
    ...row,
    id: String(row.id),
    serial_number: String(row.serial_number ?? ''),
    registration_number: String(row.registration_number ?? ''),
    model: row.model == null ? null : String(row.model),
    type: String(row.type ?? 'JCB') as Vehicle['type'],
    capacity: row.capacity == null ? null : String(row.capacity),
    tons: row.tons == null || row.tons === '' ? null : Number(row.tons),
    emi_status: emiStatuses.includes(emiStatus) ? emiStatus : 'No EMI',
    emi_amount: row.emi_amount == null || row.emi_amount === '' ? null : Number(row.emi_amount),
    emi_due_date: row.emi_due_date == null ? null : String(row.emi_due_date),
    emi_end_date: row.emi_end_date == null ? null : String(row.emi_end_date),
    hourly_rate: row.hourly_rate == null || row.hourly_rate === '' ? null : Number(row.hourly_rate),
    daily_rate: row.daily_rate == null || row.daily_rate === '' ? null : Number(row.daily_rate),
    fitness_expiry_date: row.fitness_expiry_date == null ? null : String(row.fitness_expiry_date),
    status: vehicleStatuses.includes(status) ? status : 'Available',
    active: Boolean(row.active),
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  };
}

export default function Vehicles() {
  const { t } = useLang();
  const { show } = useToast();
  const { settings } = useSettings();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [viewVehicle, setViewVehicle] = useState<Vehicle | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const [form, setForm] = useState<Partial<Vehicle>>({
    serial_number: '', registration_number: '', model: '', type: 'Crane', capacity: '', tons: null,
    emi_status: 'No EMI', emi_amount: null as number | null, emi_due_date: '', emi_end_date: '',
    hourly_rate: null as number | null, daily_rate: null as number | null, fitness_expiry_date: '',
    status: 'Available', active: true,
  });

  const fetchVehicles = async () => {
    setLoading(true);
    setError(null);
    const { data, error: fetchError } = await supabase
      .from('vehicles')
      .select('*')
      .order('serial_number', { ascending: true });
    if (fetchError) {
      setError(fetchError.message);
      setVehicles([]);
    } else {
      const rows = (data ?? [])
        .filter((row): row is Record<string, unknown> => Boolean(row && typeof row === 'object'))
        .map(normalizeVehicle)
        .filter((row): row is Vehicle => row !== null);
      setVehicles(rows);
    }
    setLoading(false);
  };

  useEffect(() => { fetchVehicles(); }, []);

  const filteredVehicles = useMemo(() => {
    return vehicles.filter(v => {
      if (typeFilter && v.type !== typeFilter) return false;
      if (statusFilter && v.status !== statusFilter) return false;
      return true;
    });
  }, [vehicles, statusFilter, typeFilter]);

  const openAdd = () => {
    setEditing(null);
    setForm({ serial_number: String(vehicles.length + 1), registration_number: '', model: '', type: 'Crane', capacity: '', tons: null, emi_status: 'No EMI', emi_amount: null as number | null, emi_due_date: '', emi_end_date: '', hourly_rate: null as number | null, daily_rate: null as number | null, fitness_expiry_date: '', status: 'Available', active: true });
    setModalOpen(true);
  };

  const openEdit = (v: Vehicle) => { setEditing(v); setForm(v); setModalOpen(true); };

  const save = async () => {
    if (!form.serial_number || !form.registration_number) { show(t('required'), 'error'); return; }
    if (form.type === 'Crane' && !form.capacity?.trim() && (form.tons == null || form.tons <= 0)) { show('Tons/Capacity is required for Crane vehicles', 'error'); return; }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { show('Your session has expired. Please log in again.', 'error'); return; }

    const isEmi = form.emi_status === 'EMI Applicable';
    if (isEmi) {
      if (!form.emi_amount || Number(form.emi_amount) <= 0) { show('EMI Amount is required and must be a positive number', 'error'); return; }
      if (!form.emi_due_date) { show('EMI Due Date is required', 'error'); return; }
      if (!form.emi_end_date) { show('EMI End Date is required', 'error'); return; }
      if (new Date(form.emi_end_date) < new Date(form.emi_due_date)) { show('EMI End Date cannot be before EMI Due Date', 'error'); return; }
    }

    setSaving(true);

    const cleanDate = (v: unknown): string | null => (v && String(v).trim() !== '' ? String(v) : null);

    const payload = {
      serial_number: String(form.serial_number).trim(),
      registration_number: String(form.registration_number).trim().toUpperCase(),
      model: form.model?.trim() || null,
      type: form.type ?? 'Crane',
      capacity: form.type === 'Crane' ? (form.tons != null ? `${form.tons} Ton` : (form.capacity ?? null)) : null,
      tons: form.type === 'Crane' ? (form.tons != null ? Number(form.tons) : null) : null,
      status: form.status ?? 'Available',
      hourly_rate: Number(form.hourly_rate) || 0,
      daily_rate: Number(form.daily_rate) || 0,
      emi_status: form.emi_status ?? 'No EMI',
      emi_amount: isEmi ? Math.max(0, Number(form.emi_amount) || 0) : 0,
      emi_due_date: isEmi ? cleanDate(form.emi_due_date) : null,
      emi_end_date: isEmi ? cleanDate(form.emi_end_date) : null,
      fitness_expiry_date: cleanDate(form.fitness_expiry_date),
      active: form.active ?? true,
      created_by: editing ? undefined : user.id,
      updated_by: user.id,
    };

    if (editing) {
      const { error } = await supabase.from('vehicles').update(payload).eq('id', editing.id);
      if (error) {
        if (error.code === '23505') show(`Vehicle ${form.registration_number} already exists.`, 'error');
        else if (error.code === '42501') show('You do not have permission to save this vehicle.', 'error');
        else show(t('saveError'), 'error');
      } else {
        if (isEmi) {
          const { data: existing } = await supabase.from('emi_records').select('id').eq('vehicle_id', editing.id).maybeSingle();
          const emiPayload = {
            vehicle_id: editing.id,
            emi_amount: Math.max(0, Number(form.emi_amount) || 0),
            due_date: cleanDate(form.emi_due_date),
            end_date: cleanDate(form.emi_end_date),
            status: 'Upcoming' as const,
          };
          if (existing) await supabase.from('emi_records').update(emiPayload).eq('id', existing.id);
          else await supabase.from('emi_records').insert(emiPayload);
        }
        show(t('saveSuccess'), 'success');
        setModalOpen(false);
        fetchVehicles();
      }
    } else {
      const { data: inserted, error } = await supabase.from('vehicles').insert(payload).select().single();
      if (error) {
        if (error.code === '23505') show(`Vehicle ${form.registration_number} already exists.`, 'error');
        else if (error.code === '42501') show('You do not have permission to save this vehicle.', 'error');
        else show(t('saveError'), 'error');
      } else {
        if (isEmi && inserted) {
          await supabase.from('emi_records').insert({
            vehicle_id: inserted.id,
            emi_amount: Math.max(0, Number(form.emi_amount) || 0),
            due_date: cleanDate(form.emi_due_date),
            end_date: cleanDate(form.emi_end_date),
            status: 'Upcoming',
          });
        }
        show(t('saveSuccess'), 'success');
        setModalOpen(false);
        fetchVehicles();
      }
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const { count } = await supabase.from('trips').select('id', { count: 'exact', head: true }).eq('vehicle_id', deleteId);
    if (count && count > 0) {
      const { error } = await supabase.from('vehicles').update({ status: 'Inactive', active: false }).eq('id', deleteId);
      if (error) show(t('deleteError'), 'error');
      else show('Vehicle has historical trips. Set to Inactive to preserve data.', 'success');
    } else {
      const { error } = await supabase.from('vehicles').delete().eq('id', deleteId);
      if (error) show(t('deleteError'), 'error');
      else show(t('deleteSuccess'), 'success');
    }
    fetchVehicles();
    setDeleteId(null);
  };

  const handleExport = () => {
    const exportData = filteredVehicles;

    if (exportData.length === 0) {
      show('No records to export', 'error');
      return;
    }

    const headers = ['S.No', 'Serial No', 'Registration Number', 'Vehicle Type', 'Model', 'Tons / Capacity', 'Status', 'EMI Status', 'EMI Amount', 'Hourly Rate', 'Daily Rate'];
    const dataRows = exportData.map((v, i) => [
      i + 1, v.serial_number, v.registration_number, v.type,
      v.model ?? '-',
      v.tons != null ? `${v.tons} Ton` : (v.capacity ?? '-'),
      v.status, v.emi_status, v.emi_status === 'EMI Applicable' ? Number(v.emi_amount) : 0,
      Number(v.hourly_rate), Number(v.daily_rate),
    ]);

    const selectionInfo = [statusFilter && `Status: ${statusFilter}`].filter(Boolean).join('; ') || 'All Records';

    exportToExcelWithCompany('crane-master-export.csv', 'Crane Master Report',
      settings ? { company_name: settings.company_name, address: settings.address, phone: settings.phone, email: settings.email, gstin: settings.gstin } : { company_name: 'Crane ERP' },
      selectionInfo, new Date().toLocaleString(),
      selectionInfo,
      headers, dataRows);

    show(`Exported ${exportData.length} record${exportData.length !== 1 ? 's' : ''}`, 'success');
  };

  const capacityDisplay = (v: Vehicle): string => {
    if (v.tons != null && Number.isFinite(Number(v.tons))) return `${v.tons} Ton`;
    return v.capacity ? String(v.capacity) : '-';
  };

  const columns: Column<Vehicle>[] = [
    { key: 'registration_number', header: t('registrationNumber'), sortable: true },
    { key: 'type', header: 'Vehicle Type', align: 'center', sortable: true, render: v => <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${v.type === 'Crane' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>{v.type}</span> },
    { key: 'model', header: t('model'), sortable: true, render: v => v.model || '-' },
    { key: 'capacity', header: t('capacity'), align: 'center', sortable: true, render: v => v.type === 'JCB' ? <span className="text-slate-400">-</span> : capacityDisplay(v) },
    { key: 'status', header: t('status'), align: 'center', sortable: true, render: v => <StatusBadge status={v.status} /> },
    { key: 'emi_status', header: 'EMI', align: 'center', render: v => v.emi_status === 'EMI Applicable' ? <StatusBadge status="EMI" variant="amber" /> : <span className="text-slate-400 text-sm">No EMI</span> },
    { key: 'emi_amount', header: 'EMI Amount', align: 'right', render: v => v.emi_status === 'EMI Applicable' ? formatCurrency(v.emi_amount) : <span className="text-slate-400">-</span> },
    {
      key: 'actions', header: t('actions'), align: 'center',
      render: v => (
        <div className="flex justify-center gap-1">
          <button onClick={() => setViewVehicle(v)} className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors" title="View"><Eye className="w-4 h-4" /></button>
          <button onClick={() => openEdit(v)} className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors" title={t('edit')}><Pencil className="w-4 h-4" /></button>
          <button onClick={() => setDeleteId(v.id)} className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors" title="Delete/Deactivate"><Trash2 className="w-4 h-4" /></button>
        </div>
      ),
    },
  ];

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorState message={`Failed to load vehicles: ${error}`} />;

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Truck className="w-6 h-6 text-blue-600" />
            {t('craneMaster')}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5 font-medium">Manage and maintain crane details</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={fetchVehicles} title="Refresh"><RefreshCw className="w-4 h-4" /></Button>
          <Button variant="outline" onClick={handleExport} title="Export to Excel">
            <Download className="w-4 h-4" />{t('export')}
          </Button>
          <Button onClick={openAdd}>
            <Plus className="w-4 h-4" />{t('addNew')}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-500">Vehicle Type</label>
          <select className={inputClass() + ' min-w-[120px]'} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
            <option value="">{t('all')}</option>
            <option value="Crane">Crane</option>
            <option value="JCB">JCB</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-500">Filter by Status</label>
          <select className={inputClass() + ' min-w-[140px]'} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">{t('all')}</option>
            <option value="Available">{t('vehicleStatusAvailable')}</option>
            <option value="Working">{t('vehicleStatusWorking')}</option>
            <option value="Maintenance">{t('vehicleStatusMaintenance')}</option>
            <option value="Inactive">{t('vehicleStatusInactive')}</option>
          </select>
        </div>
        {(typeFilter || statusFilter) && (
          <Button variant="secondary" size="sm" onClick={() => { setTypeFilter(''); setStatusFilter(''); }}>{t('clear')}</Button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={filteredVehicles}
        searchKeys={['serial_number', 'registration_number', 'model', 'capacity']}
        searchPlaceholder={`${t('search')} ${t('craneMaster')}...`}
        stickyHeader
        emptyMessage="No cranes found. Try adjusting filters or add a new crane."
        showSerialNumber
      />

      <Modal
        open={modalOpen} onClose={() => setModalOpen(false)}
        title={editing ? `${t('edit')} ${t('craneMaster')}` : `${t('addNew')} ${t('craneMaster')}`}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>{t('cancel')}</Button>
            <Button onClick={save} disabled={saving}>{saving ? t('saving') : t('save')}</Button>
          </>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Vehicle Type" required>
            <select className={inputClass()} value={form.type ?? 'Crane'} onChange={e => setForm(f => ({ ...f, type: e.target.value as Vehicle['type'], tons: e.target.value === 'JCB' ? null : f.tons, capacity: e.target.value === 'JCB' ? null : f.capacity }))}>
              <option value="Crane">Crane</option>
              <option value="JCB">JCB</option>
            </select>
          </Field>
          {form.type === 'Crane' && (
            <Field label="Tons / Capacity" required>
              <select className={inputClass()} value={form.tons ?? ''} onChange={e => {
                const tonsVal = e.target.value === '' ? null : Number(e.target.value);
                setForm(f => ({ ...f, tons: tonsVal, capacity: tonsVal != null ? `${tonsVal} Ton` : '' }));
              }}>
                <option value="">Select Tons</option>
                <option value="11">11 Ton</option>
                <option value="12">12 Ton</option>
                <option value="14">14 Ton</option>
                <option value="15">15 Ton</option>
                <option value="16">16 Ton</option>
                <option value="17">17 Ton</option>
                <option value="30">30 Ton</option>
                <option value="55">55 Ton</option>
                <option value="80">80 Ton</option>
              </select>
            </Field>
          )}
          <Field label={t('serialNumber')} required>
            <input className={inputClass()} value={form.serial_number ?? ''} onChange={e => setForm(f => ({ ...f, serial_number: e.target.value }))} />
          </Field>
          <Field label={t('registrationNumber')} required>
            <input className={inputClass()} value={form.registration_number ?? ''} onChange={e => setForm(f => ({ ...f, registration_number: e.target.value.toUpperCase() }))} placeholder="e.g. TS08WF7819" />
          </Field>
          <Field label={t('model')}>
            <input className={inputClass()} value={form.model ?? ''} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} placeholder="e.g. HYDRA, FARANA" />
          </Field>
          <Field label={t('status')}>
            <select className={inputClass()} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as VehicleStatus }))}>
              <option value="Available">{t('vehicleStatusAvailable')}</option>
              <option value="Working">{t('vehicleStatusWorking')}</option>
              <option value="Maintenance">{t('vehicleStatusMaintenance')}</option>
              <option value="Inactive">{t('vehicleStatusInactive')}</option>
            </select>
          </Field>
          <Field label={t('hourlyRate')}>
            <input type="number" className={inputClass()} value={form.hourly_rate ?? ''} onChange={e => setForm(f => ({ ...f, hourly_rate: e.target.value === '' ? null : Number(e.target.value) }))} />
          </Field>
          <Field label={t('dailyRate')}>
            <input type="number" className={inputClass()} value={form.daily_rate ?? ''} onChange={e => setForm(f => ({ ...f, daily_rate: e.target.value === '' ? null : Number(e.target.value) }))} />
          </Field>
          <Field label={t('fitnessExpiryDate')}>
            <DatePicker value={form.fitness_expiry_date ?? ''} onChange={v => setForm(f => ({ ...f, fitness_expiry_date: v }))} />
          </Field>
          <Field label={t('emiStatus')}>
            <select className={inputClass()} value={form.emi_status} onChange={e => setForm(f => ({ ...f, emi_status: e.target.value as EmiStatus }))}>
              <option value="No EMI">{t('noEmi')}</option>
              <option value="EMI Applicable">{t('emiApplicable')}</option>
            </select>
          </Field>
          {form.emi_status === 'EMI Applicable' && (
            <>
              <Field label={t('emiAmount')} required>
                <input type="number" className={inputClass()} value={form.emi_amount ?? ''} onChange={e => setForm(f => ({ ...f, emi_amount: e.target.value === '' ? null : Number(e.target.value) }))} />
              </Field>
              <Field label={t('emiDueDate')} required>
                <DatePicker value={form.emi_due_date ?? ''} onChange={v => setForm(f => ({ ...f, emi_due_date: v }))} />
              </Field>
              <Field label={t('emiEndDate')} required>
                <DatePicker value={form.emi_end_date ?? ''} onChange={v => setForm(f => ({ ...f, emi_end_date: v }))} />
              </Field>
            </>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete / Deactivate Vehicle"
        message="If this vehicle has historical trips or invoices, it will be set to Inactive to preserve data. Otherwise it will be permanently deleted."
        confirmText="Confirm"
        danger
      />

      <Modal
        open={!!viewVehicle} onClose={() => setViewVehicle(null)}
        title="Vehicle Details" size="md"
      >
        {viewVehicle && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div><span className="text-slate-500">Sl No:</span> <span className="font-medium">{viewVehicle.serial_number}</span></div>
              <div><span className="text-slate-500">Registration:</span> <span className="font-medium">{viewVehicle.registration_number}</span></div>
              <div><span className="text-slate-500">Vehicle Type:</span> <span className="font-medium">{viewVehicle.type}</span></div>
              <div><span className="text-slate-500">Model:</span> <span className="font-medium">{viewVehicle.model || '-'}</span></div>
              <div><span className="text-slate-500">Capacity:</span> <span className="font-medium">{viewVehicle.type === 'JCB' ? '-' : (viewVehicle.tons != null ? `${viewVehicle.tons} Ton` : (viewVehicle.capacity ?? '-'))}</span></div>
              <div><span className="text-slate-500">Status:</span> <StatusBadge status={viewVehicle.status} /></div>
              <div><span className="text-slate-500">Hourly Rate:</span> <span className="font-medium">{formatCurrency(viewVehicle.hourly_rate)}</span></div>
              <div><span className="text-slate-500">Daily Rate:</span> <span className="font-medium">{formatCurrency(viewVehicle.daily_rate)}</span></div>
              <div><span className="text-slate-500">Fitness Expiry:</span> <span className="font-medium">{viewVehicle.fitness_expiry_date ? formatDate(viewVehicle.fitness_expiry_date) : '-'}</span></div>
              <div><span className="text-slate-500">EMI Status:</span> <span className="font-medium">{viewVehicle.emi_status}</span></div>
              <div><span className="text-slate-500">EMI Amount:</span> <span className="font-medium">{viewVehicle.emi_status === 'EMI Applicable' ? formatCurrency(viewVehicle.emi_amount) : '-'}</span></div>
              {viewVehicle.emi_status === 'EMI Applicable' && (
                <>
                  <div><span className="text-slate-500">EMI Due Date:</span> <span className="font-medium">{viewVehicle.emi_due_date ? formatDate(viewVehicle.emi_due_date) : '-'}</span></div>
                  <div><span className="text-slate-500">EMI End Date:</span> <span className="font-medium">{viewVehicle.emi_end_date ? formatDate(viewVehicle.emi_end_date) : '-'}</span></div>
                </>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
