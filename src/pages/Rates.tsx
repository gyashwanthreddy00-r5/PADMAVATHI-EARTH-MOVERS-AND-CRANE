import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useLang } from '@/context/LangContext';
import { useSettings } from '@/context/SettingsContext';
import { useToast } from '@/components/ui/Toast';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Modal, ConfirmDialog, StatusBadge, Button, Field, inputClass, LoadingSpinner } from '@/components/ui/common';
import { Plus, Pencil, History, Download, Filter } from 'lucide-react';
import { formatCurrency, formatDate, exportToExcelWithCompany, todayISO } from '@/lib/utils';
import { DatePicker } from '@/components/ui/DatePicker';
import type { RateMaster, RateMasterRateType } from '@/types';

const TODAY = todayISO();

/** Build the grouping key used for version numbering and history. */
function rateGroupKey(r: { vehicle_type: string; capacity_tons: string | null }): string {
  if (r.vehicle_type === 'Crane') return `Crane|${r.capacity_tons ?? ''}`;
  return 'JCB';
}

export default function Rates() {
  const { t } = useLang();
  const { show } = useToast();
  const { settings } = useSettings();
  const [rates, setRates] = useState<RateMaster[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<RateMaster | null>(null);
  const [saving, setSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLabel, setHistoryLabel] = useState<string>('');
  const [historyRates, setHistoryRates] = useState<RateMaster[]>([]);
  const [deactivateId, setDeactivateId] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const [form, setForm] = useState<Partial<RateMaster>>({
    vehicle_type: 'Crane', capacity_tons: '', rate_type: 'Both',
    first_hour_rate: null, second_hour_rate: null,
    weekly_rate: null, daily_rate: null as number | null, monthly_rate: null, batha: null as number | null,
    effective_from: TODAY, effective_to: null, status: 'Active',
  });

  const fetchRates = async () => {
    setLoading(true);
    const { data } = await supabase.from('rate_master').select('*').order('vehicle_type').order('capacity_tons').order('version_number', { ascending: false });
    setRates((data ?? []) as RateMaster[]);
    setLoading(false);
  };

  useEffect(() => { fetchRates(); }, []);

  const filteredRates = useMemo(() => {
    return rates.filter(r => {
      if (typeFilter && r.vehicle_type !== typeFilter) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      return true;
    });
  }, [rates, statusFilter, typeFilter]);

  const openAdd = () => {
    setEditing(null);
    setForm({
      vehicle_type: 'Crane', capacity_tons: '', rate_type: 'Both',
      first_hour_rate: null, second_hour_rate: null,
      weekly_rate: null, daily_rate: null as number | null, monthly_rate: null, batha: null as number | null,
      effective_from: TODAY, effective_to: null, status: 'Active',
    });
    setModalOpen(true);
  };

  const openEdit = (r: RateMaster) => {
    setEditing(r);
    setForm({
      vehicle_type: r.vehicle_type,
      capacity_tons: r.capacity_tons,
      rate_type: r.rate_type,
      first_hour_rate: r.first_hour_rate,
      second_hour_rate: r.second_hour_rate,
      weekly_rate: r.weekly_rate,
      daily_rate: r.daily_rate,
      monthly_rate: r.monthly_rate,
      batha: r.batha,
      effective_from: TODAY,
      effective_to: null,
      status: 'Active',
    });
    setModalOpen(true);
  };

  const openHistory = async (r: RateMaster) => {
    const groupKey = rateGroupKey(r);
    const label = r.vehicle_type === 'Crane' ? `Crane ${r.capacity_tons} Ton` : 'JCB';
    setHistoryLabel(label);
    const { data } = await supabase
      .from('rate_master')
      .select('*')
      .eq('vehicle_type', r.vehicle_type)
      .eq('capacity_tons', r.capacity_tons ?? '')
      .order('version_number', { ascending: true });
    setHistoryRates((data ?? []) as RateMaster[]);
    setHistoryOpen(true);
  };

  const save = async () => {
    if (!form.vehicle_type) { show(t('required'), 'error'); return; }
    if (form.vehicle_type === 'Crane' && !form.capacity_tons) { show('Capacity (Tons) is required for Crane rates', 'error'); return; }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { show('Your session has expired. Please log in again.', 'error'); return; }
    setSaving(true);

    const isDailyOnly = form.rate_type === 'Daily';
    const payload = {
      vehicle_category: form.vehicle_type ?? 'Crane',
      vehicle_type: form.vehicle_type ?? 'Crane',
      capacity_tons: form.vehicle_type === 'Crane' ? (form.capacity_tons?.trim() || null) : null,
      rate_type: form.rate_type ?? 'Both',
      first_hour_rate: isDailyOnly ? null : (form.first_hour_rate != null ? Number(form.first_hour_rate) : null),
      second_hour_rate: isDailyOnly ? null : (form.second_hour_rate != null ? Number(form.second_hour_rate) : null),
      third_hour_rate: null,
      fourth_hour_rate: null,
      fifth_hour_rate: null,
      weekly_rate: form.weekly_rate != null ? Number(form.weekly_rate) : null,
      daily_rate: form.daily_rate != null ? Number(form.daily_rate) : 0,
      monthly_rate: form.monthly_rate != null ? Number(form.monthly_rate) : null,
      batha: form.batha != null ? Number(form.batha) : 0,
      effective_from: form.effective_from ?? TODAY,
      effective_to: null,
      status: 'Active' as const,
    };

    try {
      if (editing) {
        const newEffFrom = form.effective_from ?? TODAY;
        const closeDate = new Date(newEffFrom);
        closeDate.setDate(closeDate.getDate() - 1);
        const prevDay = closeDate.toISOString().split('T')[0];

        const { data: maxVer } = await supabase
          .from('rate_master')
          .select('version_number')
          .eq('vehicle_type', editing.vehicle_type)
          .eq('capacity_tons', editing.capacity_tons ?? '')
          .order('version_number', { ascending: false })
          .limit(1)
          .maybeSingle();

        const nextVersion = (maxVer?.version_number ?? editing.version_number) + 1;

        const { error: closeErr } = await supabase
          .from('rate_master')
          .update({ effective_to: prevDay, status: 'Closed' as const })
          .eq('id', editing.id);

        if (closeErr) throw closeErr;

        const { error: insertErr } = await supabase
          .from('rate_master')
          .insert({ ...payload, version_number: nextVersion });

        if (insertErr) throw insertErr;
        show('New rate version created successfully.', 'success');
      } else {
        const formKey = rateGroupKey({ vehicle_type: form.vehicle_type ?? 'Crane', capacity_tons: form.capacity_tons ?? null });
        const existing = rates.find(r => r.status === 'Active' && rateGroupKey(r) === formKey);
        if (existing) {
          show(`An active rate for this ${form.vehicle_type === 'Crane' ? 'Crane capacity' : 'JCB'} already exists. Use Edit to create a new version.`, 'error');
          setSaving(false);
          return;
        }

        const { data: maxVer } = await supabase
          .from('rate_master')
          .select('version_number')
          .eq('vehicle_type', form.vehicle_type ?? 'Crane')
          .eq('capacity_tons', form.capacity_tons ?? '')
          .order('version_number', { ascending: false })
          .limit(1)
          .maybeSingle();

        const nextVersion = (maxVer?.version_number ?? 0) + 1;

        const { error } = await supabase
          .from('rate_master')
          .insert({ ...payload, version_number: nextVersion });

        if (error) throw error;
        show(t('saveSuccess'), 'success');
      }
      setModalOpen(false);
      fetchRates();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('saveError');
      show(msg, 'error');
    }
    setSaving(false);
  };

  const handleDeactivate = async () => {
    if (!deactivateId) return;
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('rate_master')
      .update({ status: 'Inactive', effective_to: TODAY, updated_by: user?.id })
      .eq('id', deactivateId);
    if (error) show(t('saveError'), 'error');
    else { show('Rate deactivated successfully.', 'success'); fetchRates(); }
    setDeactivateId(null);
  };

  const handleExport = () => {
    const headers = ['S.No', 'Vehicle Type', 'Capacity', '1 Hr', '2 Hr', 'Full Day', 'Monthly', 'Batha', 'Effective From', 'Effective To', 'Status', 'Version'];
    const dataRows = filteredRates.map((r, i) => [
      i + 1, r.vehicle_type ?? '-',
      r.vehicle_type === 'JCB' ? '-' : (r.capacity_tons ?? '-'),
      r.first_hour_rate ? Number(r.first_hour_rate) : '-',
      r.second_hour_rate ? Number(r.second_hour_rate) : '-',
      Number(r.daily_rate), r.monthly_rate ? Number(r.monthly_rate) : '-',
      Number(r.batha), formatDate(r.effective_from),
      r.effective_to ? formatDate(r.effective_to) : '-', r.status, `V${r.version_number}`,
    ]);
    exportToExcelWithCompany('rate-master-export.csv', 'Rate Master Report', settings ? { company_name: settings.company_name, address: settings.address, phone: settings.phone, email: settings.email, gstin: settings.gstin } : { company_name: 'Crane ERP' },
      'All Records', new Date().toLocaleString(),
      [typeFilter && `Type: ${typeFilter}`, statusFilter && `Status: ${statusFilter}`].filter(Boolean).join('; '),
      headers, dataRows);
  };

  const columns: Column<RateMaster>[] = [
    { key: 'vehicle_type', header: 'Vehicle Type', align: 'center', sortable: true, render: r => <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${r.vehicle_type === 'Crane' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>{r.vehicle_type ?? '-'}</span> },
    { key: 'capacity_tons', header: t('capacityTons'), align: 'center', sortable: true, render: r => r.vehicle_type === 'JCB' ? <span className="text-slate-400">-</span> : (r.capacity_tons ?? '-') },
    { key: 'first_hour_rate', header: '1 Hr', align: 'right', render: r => r.first_hour_rate ? formatCurrency(r.first_hour_rate) : '-' },
    { key: 'second_hour_rate', header: '2 Hr', align: 'right', render: r => r.second_hour_rate ? formatCurrency(r.second_hour_rate) : '-' },
    { key: 'daily_rate', header: t('dailyRate'), align: 'right', render: r => formatCurrency(r.daily_rate), sortable: true },
    { key: 'monthly_rate', header: 'Monthly', align: 'right', render: r => r.monthly_rate ? formatCurrency(r.monthly_rate) : '-' },
    { key: 'batha', header: t('batha2'), align: 'right', render: r => formatCurrency(r.batha) },
    { key: 'effective_from', header: t('effectiveFrom'), sortable: true, render: r => formatDate(r.effective_from) },
    { key: 'status', header: t('status'), render: r => <StatusBadge status={r.status} variant={r.status === 'Active' ? 'green' : 'gray'} /> },
    { key: 'version_number', header: t('version'), align: 'center', render: r => `V${r.version_number}` },
    {
      key: 'actions', header: t('actions'), align: 'center',
      render: r => (
        <div className="flex justify-center gap-1">
          <button onClick={() => openHistory(r)} className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-md" title={t('rateHistory')}><History className="w-4 h-4" /></button>
          {r.status === 'Active' && (
            <>
              <button onClick={() => openEdit(r)} className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md" title={t('edit')}><Pencil className="w-4 h-4" /></button>
              <button onClick={() => setDeactivateId(r.id)} className="p-1.5 text-slate-500 hover:text-amber-600 hover:bg-amber-50 rounded-md" title="Deactivate"><Filter className="w-4 h-4" /></button>
            </>
          )}
        </div>
      ),
    },
  ];

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm text-slate-500">{rates.filter(r => r.status === 'Active').length} active {t('rateMaster').toLowerCase()} configurations</p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={handleExport}><Download className="w-4 h-4" />{t('exportRates')}</Button>
          <Button onClick={openAdd}><Plus className="w-4 h-4" />{t('addNew')}</Button>
        </div>
      </div>

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
          <label className="text-xs font-medium text-slate-500">{t('filterByStatus')}</label>
          <select className={inputClass() + ' min-w-[140px]'} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">{t('all')}</option>
            <option value="Active">{t('active')}</option>
            <option value="Inactive">{t('inactive')}</option>
            <option value="Closed">{t('rateClosed')}</option>
          </select>
        </div>
        {(typeFilter || statusFilter) && (
          <Button variant="secondary" onClick={() => { setTypeFilter(''); setStatusFilter(''); }}>{t('clear')}</Button>
        )}
      </div>

      <DataTable columns={columns} data={filteredRates} searchKeys={['vehicle_type', 'capacity_tons']} searchPlaceholder={`${t('search')}...`} showSerialNumber />

      <Modal
        open={modalOpen} onClose={() => setModalOpen(false)}
        title={editing ? t('newRateVersion') : `${t('addNew')} ${t('rateMaster')}`}
        size="lg"
        footer={<><Button variant="secondary" onClick={() => setModalOpen(false)}>{t('cancel')}</Button><Button onClick={save} disabled={saving}>{saving ? t('saving') : t('save')}</Button></>}
      >
        {editing && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
            You are creating a new version for <strong>{editing.vehicle_type === 'Crane' ? `Crane ${editing.capacity_tons} Ton` : 'JCB'}</strong> (current: V{editing.version_number}).
            The old rate will be closed with an effective-to date and remain permanently unchanged.
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Vehicle Type" required>
            <select className={inputClass()} value={form.vehicle_type ?? 'Crane'} onChange={e => setForm(f => ({ ...f, vehicle_type: e.target.value as RateMaster['vehicle_type'], capacity_tons: e.target.value === 'JCB' ? '' : f.capacity_tons }))} disabled={!!editing}>
              <option value="Crane">Crane</option>
              <option value="JCB">JCB</option>
            </select>
          </Field>
          {form.vehicle_type === 'Crane' && (
            <Field label={t('capacityTons')} required>
              <select className={inputClass()} value={form.capacity_tons ?? ''} onChange={e => setForm(f => ({ ...f, capacity_tons: e.target.value }))} disabled={!!editing}>
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
          <Field label={t('rateType')} required>
            <select className={inputClass()} value={form.rate_type ?? 'Both'} onChange={e => setForm(f => ({ ...f, rate_type: e.target.value as RateMasterRateType }))}>
              <option value="Hourly">Hourly</option>
              <option value="Daily">Daily</option>
              <option value="Both">{t('rateBoth')}</option>
              <option value="Weekly">Weekly</option>
              <option value="Monthly">Monthly</option>
            </select>
          </Field>
          <Field label={t('effectiveFrom')} required>
            <DatePicker value={form.effective_from ?? ''} onChange={v => setForm(f => ({ ...f, effective_from: v }))} />
          </Field>
          {form.rate_type !== 'Daily' && (
            <>
              <Field label={t('firstHourRate')}>
                <input type="number" className={inputClass()} value={form.first_hour_rate ?? ''} onChange={e => setForm(f => ({ ...f, first_hour_rate: e.target.value ? Number(e.target.value) : null }))} placeholder="₹" />
              </Field>
              <Field label={t('secondHourRate')}>
                <input type="number" className={inputClass()} value={form.second_hour_rate ?? ''} onChange={e => setForm(f => ({ ...f, second_hour_rate: e.target.value ? Number(e.target.value) : null }))} placeholder="₹" />
              </Field>
              <Field label="Weekly Rate">
                <input type="number" className={inputClass()} value={form.weekly_rate ?? ''} onChange={e => setForm(f => ({ ...f, weekly_rate: e.target.value ? Number(e.target.value) : null }))} placeholder="₹" />
              </Field>
            </>
          )}
          <Field label={t('dailyRate')}>
            <input type="number" className={inputClass()} value={form.daily_rate ?? ''} onChange={e => setForm(f => ({ ...f, daily_rate: e.target.value === '' ? null : Number(e.target.value) }))} placeholder="₹" />
          </Field>
          <Field label="Monthly Rate">
            <input type="number" className={inputClass()} value={form.monthly_rate ?? ''} onChange={e => setForm(f => ({ ...f, monthly_rate: e.target.value ? Number(e.target.value) : null }))} placeholder="₹" />
          </Field>
          <Field label={t('batha2')}>
            <input type="number" className={inputClass()} value={form.batha ?? ''} onChange={e => setForm(f => ({ ...f, batha: e.target.value === '' ? null : Number(e.target.value) }))} placeholder="₹" />
          </Field>
        </div>
      </Modal>

      <Modal
        open={historyOpen} onClose={() => setHistoryOpen(false)}
        title={`${t('rateHistory')} — ${historyLabel}`}
        size="lg"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 px-3 text-left">{t('version')}</th>
                <th className="py-2 px-3 text-left">{t('effectiveFrom')}</th>
                <th className="py-2 px-3 text-left">{t('effectiveTo')}</th>
                <th className="py-2 px-3 text-right">1 Hr</th>
                <th className="py-2 px-3 text-right">2 Hr</th>
                <th className="py-2 px-3 text-right">Full Day</th>
                <th className="py-2 px-3 text-right">Batha</th>
                <th className="py-2 px-3 text-center">{t('status')}</th>
              </tr>
            </thead>
            <tbody>
              {historyRates.map(r => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="py-2 px-3 font-medium">V{r.version_number}</td>
                  <td className="py-2 px-3">{formatDate(r.effective_from)}</td>
                  <td className="py-2 px-3">{r.effective_to ? formatDate(r.effective_to) : '-'}</td>
                  <td className="py-2 px-3 text-right">{r.first_hour_rate ? formatCurrency(r.first_hour_rate) : '-'}</td>
                  <td className="py-2 px-3 text-right">{r.second_hour_rate ? formatCurrency(r.second_hour_rate) : '-'}</td>
                  <td className="py-2 px-3 text-right">{formatCurrency(r.daily_rate)}</td>
                  <td className="py-2 px-3 text-right">{formatCurrency(r.batha)}</td>
                  <td className="py-2 px-3 text-center"><StatusBadge status={r.status} variant={r.status === 'Active' ? 'green' : 'gray'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deactivateId}
        onClose={() => setDeactivateId(null)}
        onConfirm={handleDeactivate}
        title="Deactivate Rate"
        message="This rate will be marked Inactive and closed with today's date. Historical trips will not be affected."
        confirmText="Deactivate"
        danger
      />
    </div>
  );
}
