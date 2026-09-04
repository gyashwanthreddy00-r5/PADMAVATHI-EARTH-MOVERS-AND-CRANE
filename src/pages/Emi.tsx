import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useLang } from '@/context/LangContext';
import { useToast } from '@/components/ui/Toast';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Modal, ConfirmDialog, StatusBadge, Button, Field, inputClass, LoadingSpinner } from '@/components/ui/common';
import { Plus, Pencil, Trash2, Download, CheckCircle } from 'lucide-react';
import { formatCurrency, formatDate, exportToExcelWithCompany, todayISO } from '@/lib/utils';
import { useSettings } from '@/context/SettingsContext';
import { DatePicker } from '@/components/ui/DatePicker';
import type { EmiRecord, EmiWithRelations, Vehicle, EmiStatus2, PaymentMode } from '@/types';

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00');
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export default function Emi() {
  const { t } = useLang();
  const { show } = useToast();
  const { settings } = useSettings();
  const [records, setRecords] = useState<EmiWithRelations[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<EmiRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [payTarget, setPayTarget] = useState<EmiWithRelations | null>(null);
  const [payMode, setPayMode] = useState<PaymentMode>('Cash');
  const [paySaving, setPaySaving] = useState(false);

  const [form, setForm] = useState<Partial<EmiRecord>>({
    vehicle_id: '', emi_amount: null as number | null, due_date: todayISO(), end_date: '', status: 'Upcoming', paid_date: '', payment_mode: null, remarks: '',
  });

  const fetchAll = async () => {
    setLoading(true);
    const [eRes, vRes] = await Promise.all([
      supabase.from('emi_records').select('*, vehicle:vehicles(id,registration_number,model,type)').order('due_date', { ascending: true }),
      supabase.from('vehicles').select('*').order('registration_number'),
    ]);
    setRecords((eRes.data ?? []) as EmiWithRelations[]);
    setVehicles((vRes.data ?? []) as Vehicle[]);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const openAdd = () => {
    setEditing(null);
    setForm({ vehicle_id: '', emi_amount: null as number | null, due_date: todayISO(), end_date: '', status: 'Upcoming', paid_date: '', payment_mode: null, remarks: '' });
    setModalOpen(true);
  };
  const openEdit = (e: EmiRecord) => { setEditing(e); setForm(e); setModalOpen(true); };

  const save = async () => {
    if (!form.vehicle_id) { show(t('required'), 'error'); return; }
    if (!form.emi_amount || Number(form.emi_amount) <= 0) { show('EMI amount must be a positive number', 'error'); return; }
    if (!form.due_date) { show('EMI Due Date is required', 'error'); return; }
    if (!form.end_date) { show('EMI End Date is required', 'error'); return; }
    if (new Date(form.end_date) < new Date(form.due_date)) { show('EMI End Date cannot be before Due Date', 'error'); return; }

    setSaving(true);
    const payload = { ...form, emi_amount: Number(form.emi_amount) || 0 };
    if (editing) {
      const { error } = await supabase.from('emi_records').update(payload).eq('id', editing.id);
      if (error) show(t('saveError'), 'error');
      else { show(t('saveSuccess'), 'success'); setModalOpen(false); fetchAll(); }
    } else {
      const { error } = await supabase.from('emi_records').insert(payload);
      if (error) show(t('saveError'), 'error');
      else { show(t('saveSuccess'), 'success'); setModalOpen(false); fetchAll(); }
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from('emi_records').delete().eq('id', deleteId);
    if (error) show(t('deleteError'), 'error');
    else { show(t('deleteSuccess'), 'success'); fetchAll(); }
    setDeleteId(null);
  };

  const confirmMarkPaid = async () => {
    if (!payTarget) return;
    setPaySaving(true);
    const { error } = await supabase.from('emi_records').update({
      status: 'Paid' as EmiStatus2,
      paid_date: todayISO(),
      payment_mode: payMode,
    }).eq('id', payTarget.id);
    if (error) show(t('saveError'), 'error');
    else { show('EMI marked as paid', 'success'); setPayTarget(null); fetchAll(); }
    setPaySaving(false);
  };

  const handleExport = () => {
    const headers = ['S.No', 'Vehicle', 'Vehicle Type', 'EMI Amount', 'Due Date', 'End Date', 'Days Remaining/Overdue', 'Status', 'Paid Date', 'Payment Mode', 'Remarks'];
    const dataRows = records.map((e, i) => {
      const d = daysUntil(e.due_date);
      const dayLabel = e.status === 'Paid' ? '-' : d < 0 ? `${Math.abs(d)} days overdue` : d === 0 ? 'Due today' : `${d} days remaining`;
      return [
        i + 1, e.vehicle?.registration_number ?? '-', e.vehicle?.type ?? '-',
        e.emi_amount, formatDate(e.due_date), formatDate(e.end_date),
        dayLabel, e.status, formatDate(e.paid_date), e.payment_mode ?? '-', e.remarks ?? '-',
      ];
    });
    const totalRow = ['', 'Total', '', records.reduce((s, e) => s + e.emi_amount, 0), '', '', '', '', '', '', ''];
    exportToExcelWithCompany('emi-export.csv', 'EMI Report',
      settings ? { company_name: settings.company_name, address: settings.address, phone: settings.phone, email: settings.email, gstin: settings.gstin } : { company_name: 'Crane ERP' },
      'All Records', new Date().toLocaleString('en-IN'), '', headers, dataRows, totalRow);
  };

  const columns: Column<EmiWithRelations>[] = [
    { key: 'vehicle', header: t('vehicleNumber'), render: e => e.vehicle?.registration_number ?? '-' },
    { key: 'vehicle_type', header: t('type'), render: e => e.vehicle?.type ?? '-' },
    { key: 'emi_amount', header: t('emiAmount'), align: 'right', sortable: true, render: e => formatCurrency(e.emi_amount) },
    { key: 'due_date', header: t('dueDate'), sortable: true, render: e => formatDate(e.due_date) },
    { key: 'end_date', header: t('endDate'), render: e => formatDate(e.end_date) },
    {
      key: 'days', header: 'Days Remaining/Overdue', align: 'center',
      render: e => {
        if (e.status === 'Paid') return <span className="text-slate-400 text-sm">-</span>;
        const d = daysUntil(e.due_date);
        if (d < 0) return <span className="text-red-600 font-semibold text-sm">{Math.abs(d)} days overdue</span>;
        if (d === 0) return <span className="text-orange-600 font-bold text-sm">Due today</span>;
        return <span className="text-amber-600 font-medium text-sm">{d} days remaining</span>;
      },
    },
    { key: 'status', header: t('status'), render: e => <StatusBadge status={e.status} /> },
    { key: 'paid_date', header: t('paidDate'), render: e => formatDate(e.paid_date) },
    { key: 'payment_mode', header: t('paymentMode'), render: e => e.payment_mode ?? '-' },
    {
      key: 'pay_action', header: 'Payment', align: 'center',
      render: e => e.status === 'Paid' ? (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-100 text-emerald-700 text-xs font-bold">
          <CheckCircle className="w-3.5 h-3.5" /> Paid
        </span>
      ) : (
        <button
          onClick={() => { setPayTarget(e); setPayMode('Cash'); }}
          className="px-2.5 py-1 rounded-md bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-colors"
        >
          Mark Paid
        </button>
      ),
    },
    {
      key: 'actions', header: t('actions'), align: 'center',
      render: e => (
        <div className="flex justify-center gap-1">
          <button onClick={() => openEdit(e)} className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md"><Pencil className="w-4 h-4" /></button>
          <button onClick={() => setDeleteId(e.id)} className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-md"><Trash2 className="w-4 h-4" /></button>
        </div>
      ),
    },
  ];

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{records.length} {t('emiVehicles')}</p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={handleExport}><Download className="w-4 h-4" />{t('export')}</Button>
          <Button onClick={openAdd}><Plus className="w-4 h-4" />{t('addNew')}</Button>
        </div>
      </div>

      <DataTable columns={columns} data={records} searchKeys={[]} searchPlaceholder={`${t('search')}...`} showSerialNumber />

      <Modal
        open={modalOpen} onClose={() => setModalOpen(false)}
        title={editing ? `${t('edit')} ${t('emiVehicles')}` : `${t('addNew')} ${t('emiVehicles')}`}
        footer={<><Button variant="secondary" onClick={() => setModalOpen(false)}>{t('cancel')}</Button><Button onClick={save} disabled={saving}>{saving ? t('saving') : t('save')}</Button></>}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={t('vehicleNumber')} required>
            <select className={inputClass()} value={form.vehicle_id ?? ''} onChange={e => setForm(f => ({ ...f, vehicle_id: e.target.value }))}>
              <option value="">-</option>
              {vehicles.map(v => <option key={v.id} value={v.id}>{v.registration_number}</option>)}
            </select>
          </Field>
          <Field label={t('emiAmount')} required>
            <input type="number" step="0.01" className={inputClass()} value={form.emi_amount ?? ''} onChange={e => setForm(f => ({ ...f, emi_amount: e.target.value === '' ? null : Number(e.target.value) }))} />
          </Field>
          <Field label={t('dueDate')} required>
            <DatePicker value={form.due_date ?? ''} onChange={v => setForm(f => ({ ...f, due_date: v }))} />
          </Field>
          <Field label={t('endDate')} required>
            <DatePicker value={form.end_date ?? ''} onChange={v => setForm(f => ({ ...f, end_date: v }))} />
          </Field>
          <Field label={t('status')}>
            <select className={inputClass()} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as EmiStatus2 }))}>
              <option value="Upcoming">{t('upcoming')}</option>
              <option value="Due">{t('due')}</option>
              <option value="Paid">{t('paid')}</option>
              <option value="Overdue">{t('overdue')}</option>
            </select>
          </Field>
          {form.status === 'Paid' && (
            <>
              <Field label={t('paidDate')}>
                <DatePicker value={form.paid_date ?? ''} onChange={v => setForm(f => ({ ...f, paid_date: v }))} />
              </Field>
              <Field label={t('paymentMode')}>
                <select className={inputClass()} value={form.payment_mode ?? ''} onChange={e => setForm(f => ({ ...f, payment_mode: (e.target.value || null) as PaymentMode }))}>
                  <option value="">-</option>
                  <option value="Cash">{t('cash')}</option>
                  <option value="Bank Transfer">Bank Transfer</option>
                  <option value="UPI">UPI</option>
                  <option value="Cheque">Cheque</option>
                  <option value="Other">Other</option>
                </select>
              </Field>
            </>
          )}
          <Field label={t('remarks')}>
            <input className={inputClass()} value={form.remarks ?? ''} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={handleDelete} title={t('delete')} message={t('confirmDelete')} confirmText={t('delete')} danger />

      {payTarget && (
        <Modal
          open={!!payTarget}
          onClose={() => setPayTarget(null)}
          title="Mark EMI as Paid"
          footer={
            <>
              <Button variant="secondary" onClick={() => setPayTarget(null)}>Cancel</Button>
              <Button onClick={confirmMarkPaid} disabled={paySaving} className="bg-emerald-600 hover:bg-emerald-700">
                {paySaving ? t('saving') : 'Confirm Payment'}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <div className="bg-slate-50 rounded-lg p-3 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Vehicle:</span><span className="font-medium">{payTarget.vehicle?.registration_number ?? '-'}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">EMI Amount:</span><span className="font-medium">{formatCurrency(payTarget.emi_amount)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Due Date:</span><span className="font-medium">{formatDate(payTarget.due_date)}</span></div>
            </div>
            <p className="text-sm text-slate-600 font-medium">Are you sure you want to mark this EMI as paid?</p>
            <Field label={t('paymentMode')} required>
              <select className={inputClass()} value={payMode} onChange={e => setPayMode(e.target.value as PaymentMode)}>
                <option value="Cash">Cash</option>
                <option value="Bank Transfer">Bank Transfer</option>
                <option value="UPI">UPI</option>
                <option value="Cheque">Cheque</option>
                <option value="Other">Other</option>
              </select>
            </Field>
            <p className="text-xs text-slate-400">Today's date will be saved as the paid date.</p>
          </div>
        </Modal>
      )}
    </div>
  );
}
