import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useLang } from '@/context/LangContext';
import { useToast } from '@/components/ui/Toast';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Modal, ConfirmDialog, StatusBadge, Button, Field, inputClass, LoadingSpinner } from '@/components/ui/common';
import { Plus, Pencil, Trash2, Download } from 'lucide-react';
import { exportToExcelWithCompany, sanitizePhone, phoneValidationError } from '@/lib/utils';
import { useSettings } from '@/context/SettingsContext';
import type { Customer } from '@/types';

export default function Customers() {
  const { t } = useLang();
  const { show } = useToast();
  const { settings } = useSettings();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [form, setForm] = useState<Partial<Customer>>({
    name: '', address: '', phone: '', email: '', gstin: '', billing_details: '',
    state: '', state_code: '', payment_terms: '', shipping_address: '', active: true,
  });

  const fetchCustomers = async () => {
    setLoading(true);
    const { data } = await supabase.from('customers').select('*').order('created_at', { ascending: false });
    setCustomers((data ?? []) as Customer[]);
    setLoading(false);
  };

  useEffect(() => { fetchCustomers(); }, []);

  const openAdd = () => { setEditing(null); setForm({ name: '', address: '', phone: '', email: '', gstin: '', billing_details: '', state: '', state_code: '', payment_terms: '', shipping_address: '', active: true }); setModalOpen(true); };
  const openEdit = (c: Customer) => { setEditing(c); setForm(c); setModalOpen(true); };

  const save = async () => {
    if (!form.name) { show(t('required'), 'error'); return; }
    const phoneErr = phoneValidationError(form.phone ?? '', false);
    if (phoneErr) { show(phoneErr, 'error'); return; }
    setSaving(true);
    if (editing) {
      const { error } = await supabase.from('customers').update(form).eq('id', editing.id);
      if (error) show(t('saveError'), 'error');
      else { show(t('saveSuccess'), 'success'); setModalOpen(false); fetchCustomers(); }
    } else {
      const { error } = await supabase.from('customers').insert(form);
      if (error) show(t('saveError'), 'error');
      else { show(t('saveSuccess'), 'success'); setModalOpen(false); fetchCustomers(); }
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from('customers').delete().eq('id', deleteId);
    if (error) show(t('deleteError'), 'error');
    else { show(t('deleteSuccess'), 'success'); fetchCustomers(); }
    setDeleteId(null);
  };

  const handleExport = () => {
    const headers = ['S.No', 'Name', 'Phone', 'Email', 'GSTIN', 'Address', 'State', 'State Code', 'Payment Terms', 'Status'];
    const dataRows = customers.map((c, i) => [
      i + 1, c.name, c.phone ?? '-', c.email ?? '-', c.gstin ?? '-',
      c.address ?? '-', c.state ?? '-', c.state_code ?? '-',
      c.payment_terms ?? '-', c.active ? 'Active' : 'Inactive',
    ]);
    exportToExcelWithCompany('customers-export.csv', 'Customer Master Report',
      settings ? { company_name: settings.company_name, address: settings.address, phone: settings.phone, email: settings.email, gstin: settings.gstin } : { company_name: 'Crane ERP' },
      'All Records', new Date().toLocaleString('en-IN'), '', headers, dataRows);
  };

  const columns: Column<Customer>[] = [
    { key: 'name', header: t('name'), sortable: true },
    { key: 'phone', header: t('phone') },
    { key: 'email', header: t('email2') },
    { key: 'gstin', header: t('gstin') },
    { key: 'address', header: t('address'), render: c => c.address ? <span className="truncate max-w-[200px] inline-block">{c.address}</span> : '-' },
    { key: 'active', header: t('status'), render: c => <StatusBadge status={c.active ? t('active') : t('inactive')} variant={c.active ? 'green' : 'gray'} /> },
    {
      key: 'actions', header: t('actions'), align: 'center',
      render: c => (
        <div className="flex justify-center gap-1">
          <button onClick={() => openEdit(c)} className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md"><Pencil className="w-4 h-4" /></button>
          <button onClick={() => setDeleteId(c.id)} className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-md"><Trash2 className="w-4 h-4" /></button>
        </div>
      ),
    },
  ];

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{customers.length} {t('customers')}</p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={handleExport}><Download className="w-4 h-4" />{t('export')}</Button>
          <Button onClick={openAdd}><Plus className="w-4 h-4" />{t('addNew')}</Button>
        </div>
      </div>

      <DataTable columns={columns} data={customers} searchKeys={['name', 'phone', 'gstin']} searchPlaceholder={`${t('search')}...`} showSerialNumber />

      <Modal
        open={modalOpen} onClose={() => setModalOpen(false)}
        title={editing ? `${t('edit')} ${t('customers')}` : `${t('addNew')} ${t('customers')}`}
        footer={<><Button variant="secondary" onClick={() => setModalOpen(false)}>{t('cancel')}</Button><Button onClick={save} disabled={saving}>{saving ? t('saving') : t('save')}</Button></>}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={t('name')} required>
            <input className={inputClass()} value={form.name ?? ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field label={t('phone')}>
            <input className={inputClass()} type="tel" maxLength={10} value={form.phone ?? ''} onChange={e => setForm(f => ({ ...f, phone: sanitizePhone(e.target.value) }))} placeholder="10-digit mobile number" />
          </Field>
          <Field label={t('email2')}>
            <input className={inputClass()} value={form.email ?? ''} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          </Field>
          <Field label={t('gstin')}>
            <input className={inputClass()} value={form.gstin ?? ''} onChange={e => setForm(f => ({ ...f, gstin: e.target.value.toUpperCase() }))} />
          </Field>
          <Field label={t('address')}>
            <textarea className={inputClass()} rows={2} value={form.address ?? ''} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
          </Field>
          <Field label={t('billingDetails')}>
            <textarea className={inputClass()} rows={2} value={form.billing_details ?? ''} onChange={e => setForm(f => ({ ...f, billing_details: e.target.value }))} />
          </Field>
          <Field label="State">
            <input className={inputClass()} value={form.state ?? ''} onChange={e => setForm(f => ({ ...f, state: e.target.value }))} placeholder="Telangana" />
          </Field>
          <Field label="State Code">
            <input className={inputClass()} value={form.state_code ?? ''} onChange={e => setForm(f => ({ ...f, state_code: e.target.value }))} placeholder="36" />
          </Field>
          <Field label="Payment Terms">
            <input className={inputClass()} value={form.payment_terms ?? ''} onChange={e => setForm(f => ({ ...f, payment_terms: e.target.value }))} placeholder="30 days" />
          </Field>
          <Field label="Shipping Address">
            <textarea className={inputClass()} rows={2} value={form.shipping_address ?? ''} onChange={e => setForm(f => ({ ...f, shipping_address: e.target.value }))} />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={handleDelete} title={t('delete')} message={t('confirmDelete')} confirmText={t('delete')} danger />
    </div>
  );
}
