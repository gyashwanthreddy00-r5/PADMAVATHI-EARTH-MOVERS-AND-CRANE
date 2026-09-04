import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useLang } from '@/context/LangContext';
import { useToast } from '@/components/ui/Toast';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Modal, ConfirmDialog, StatusBadge, Button, Field, inputClass, LoadingSpinner } from '@/components/ui/common';
import { Plus, Pencil, Trash2, Eye, Download, AlertTriangle } from 'lucide-react';
import { formatCurrency, formatDate, exportToExcelWithCompany, sanitizePhone, phoneValidationError } from '@/lib/utils';
import { useSettings } from '@/context/SettingsContext';
import { DatePicker } from '@/components/ui/DatePicker';
import type { Employee, EmployeeRole } from '@/types';

export default function Employees() {
  const { t } = useLang();
  const { show } = useToast();
  const { settings } = useSettings();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [viewEmp, setViewEmp] = useState<Employee | null>(null);
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [form, setForm] = useState<Partial<Employee>>({
    name: '', role: 'Driver', phone: '', salary: null as number | null, license_number: '', license_expiry: '', advance_salary: null as number | null,
    eye_test_amount: null as number | null, eye_test_date: '', eye_test_expiry_date: '',
    active: true,
  });

  const fetchEmployees = async () => {
    setLoading(true);
    const { data } = await supabase.from('employees').select('*').order('created_at', { ascending: true });
    setEmployees((data ?? []) as Employee[]);
    setLoading(false);
  };

  useEffect(() => { fetchEmployees(); }, []);

  const filteredEmployees = useMemo(() => {
    return employees.filter(e => {
      if (roleFilter && e.role !== roleFilter) return false;
      if (statusFilter === 'active' && !e.active) return false;
      if (statusFilter === 'inactive' && e.active) return false;
      return true;
    });
  }, [employees, roleFilter, statusFilter]);

  const openAdd = () => {
    setEditing(null);
    setForm({ name: '', role: 'Driver', phone: '', salary: null as number | null, license_number: '', license_expiry: '', advance_salary: null as number | null,
      eye_test_amount: null as number | null, eye_test_date: '', eye_test_expiry_date: '',
      active: true });
    setModalOpen(true);
  };

  const openEdit = (e: Employee) => { setEditing(e); setForm(e); setModalOpen(true); };

  const save = async () => {
    if (!form.name?.trim()) { show(t('required'), 'error'); return; }
    const phoneErr = phoneValidationError(form.phone ?? '', true);
    if (phoneErr) { show(phoneErr, 'error'); return; }
    if (form.salary != null && form.salary < 0) { show('Salary cannot be negative', 'error'); return; }
    if (form.advance_salary != null && form.advance_salary < 0) { show('Advance salary cannot be negative', 'error'); return; }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { show('Your session has expired. Please log in again.', 'error'); return; }
    setSaving(true);
    const cleanDate = (v: unknown): string | null => (v && String(v).trim() !== '' ? String(v) : null);
    const payload = {
      name: form.name?.trim() || '',
      role: form.role ?? 'Driver',
      phone: form.phone?.trim() || null,
      salary: Math.max(0, Number(form.salary) || 0),
      license_number: form.license_number?.trim() || null,
      license_expiry: cleanDate(form.license_expiry),
      advance_salary: Math.max(0, Number(form.advance_salary) || 0),
      eye_test_amount: form.role === 'Driver' ? (form.eye_test_amount != null ? Math.max(0, Number(form.eye_test_amount)) : null) : null,
      eye_test_date: form.role === 'Driver' ? cleanDate(form.eye_test_date) : null,
      eye_test_expiry_date: form.role === 'Driver' ? cleanDate(form.eye_test_expiry_date) : null,
      active: form.active ?? true,
      created_by: editing ? undefined : user.id,
      updated_by: user.id,
    };
    try {
      if (editing) {
        const { error } = await supabase.from('employees').update(payload).eq('id', editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('employees').insert(payload);
        if (error) throw error;
      }
      show(t('saveSuccess'), 'success');
      setModalOpen(false);
      fetchEmployees();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('saveError');
      show(msg, 'error');
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    // Check if employee has attendance or trips — deactivate instead of deleting
    const { count: attCount } = await supabase.from('attendance').select('id', { count: 'exact', head: true }).eq('employee_id', deleteId);
    const { count: tripCount } = await supabase.from('trips').select('id', { count: 'exact', head: true }).eq('driver_id', deleteId);
    if ((attCount && attCount > 0) || (tripCount && tripCount > 0)) {
      const { error } = await supabase.from('employees').update({ active: false }).eq('id', deleteId);
      if (error) show(t('deleteError'), 'error');
      else show('Employee has historical records. Deactivated to preserve data.', 'success');
    } else {
      const { error } = await supabase.from('employees').delete().eq('id', deleteId);
      if (error) show(t('deleteError'), 'error');
      else show(t('deleteSuccess'), 'success');
    }
    fetchEmployees();
    setDeleteId(null);
  };

  const handleExport = () => {
    const headers = ['S.No', 'Name', 'Role', 'Phone', 'Salary', 'License Number', 'License Expiry', 'Advance Salary', 'Status'];
    const dataRows = filteredEmployees.map((e, i) => [
      i + 1, e.name, e.role, e.phone ?? '-', Number(e.salary), e.license_number ?? '-',
      e.license_expiry ? formatDate(e.license_expiry) : '-', Number(e.advance_salary),
      e.active ? 'Active' : 'Inactive',
    ]);
    exportToExcelWithCompany('employee-master-export.csv', 'Employee Master Report',
      settings ? { company_name: settings.company_name, address: settings.address, phone: settings.phone, email: settings.email, gstin: settings.gstin } : { company_name: 'Crane ERP' },
      'All Records', new Date().toLocaleString(),
      [roleFilter && `Role: ${roleFilter}`, statusFilter && `Status: ${statusFilter}`].filter(Boolean).join('; '),
      headers, dataRows);
  };

  const isExpired = (d: string | null) => d && new Date(d) < new Date();
  const isExpiringSoon = (d: string | null) => {
    if (!d) return false;
    const diff = (new Date(d).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    return diff > 0 && diff < 30;
  };

  const columns: Column<Employee>[] = [
    { key: 'name', header: t('name'), sortable: true, render: e => <span className="font-medium">{e.name}</span> },
    { key: 'role', header: t('role'), align: 'center', render: e => <StatusBadge status={e.role} variant={e.role === 'Driver' ? 'blue' : e.role === 'Helper' ? 'amber' : 'gray'} /> },
    { key: 'phone', header: t('phone') },
    { key: 'salary', header: t('salary'), align: 'right', render: e => formatCurrency(e.salary), sortable: true },
    { key: 'license_number', header: t('licenseNumber'), render: e => e.license_number || '-' },
    {
      key: 'license_expiry', header: t('licenseExpiry'), sortable: true,
      render: e => e.license_expiry ? (
        <span className="inline-flex items-center gap-1">
          {formatDate(e.license_expiry)}
          {isExpired(e.license_expiry) && <span className="text-red-600 text-xs font-medium">({t('licenseExpired')})</span>}
          {isExpiringSoon(e.license_expiry) && <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />}
        </span>
      ) : '-',
    },
    { key: 'advance_salary', header: t('advanceSalary'), align: 'right', render: e => formatCurrency(e.advance_salary) },
    { key: 'active', header: t('status'), align: 'center', render: e => <StatusBadge status={e.active ? t('active') : t('inactive')} variant={e.active ? 'green' : 'gray'} /> },
    {
      key: 'actions', header: t('actions'), align: 'center',
      render: e => (
        <div className="flex justify-center gap-1">
          <button onClick={() => setViewEmp(e)} className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-md" title="View"><Eye className="w-4 h-4" /></button>
          <button onClick={() => openEdit(e)} className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md" title={t('edit')}><Pencil className="w-4 h-4" /></button>
          <button onClick={() => setDeleteId(e.id)} className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-md" title="Delete/Deactivate"><Trash2 className="w-4 h-4" /></button>
        </div>
      ),
    },
  ];

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm text-slate-500">{employees.length} {t('employeeMaster')}</p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={handleExport}><Download className="w-4 h-4" />Export</Button>
          <Button onClick={openAdd}><Plus className="w-4 h-4" />{t('addNew')}</Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-500">Filter by Role</label>
          <select className={inputClass() + ' min-w-[120px]'} value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
            <option value="">All Roles</option>
            <option value="Driver">Driver</option>
            <option value="Operator">Operator</option>
            <option value="Helper">Helper</option>
            <option value="Other">Other</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-500">Filter by Status</label>
          <select className={inputClass() + ' min-w-[120px]'} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        {(roleFilter || statusFilter) && (
          <Button variant="secondary" onClick={() => { setRoleFilter(''); setStatusFilter(''); }}>{t('clear')}</Button>
        )}
      </div>

      <DataTable columns={columns} data={filteredEmployees} searchKeys={['name', 'phone', 'license_number']} searchPlaceholder={`${t('search')}...`} showSerialNumber />

      <Modal
        open={modalOpen} onClose={() => setModalOpen(false)}
        title={editing ? `${t('edit')} ${t('employeeMaster')}` : `${t('addNew')} ${t('employeeMaster')}`}
        footer={<><Button variant="secondary" onClick={() => setModalOpen(false)}>{t('cancel')}</Button><Button onClick={save} disabled={saving}>{saving ? t('saving') : t('save')}</Button></>}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={t('name')} required>
            <input className={inputClass()} value={form.name ?? ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field label={t('role')} required>
            <select className={inputClass()} value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value as EmployeeRole }))}>
              <option value="Driver">{t('roleDriver')}</option>
              <option value="Operator">{t('roleOperator')}</option>
              <option value="Helper">{t('roleHelper')}</option>
              <option value="Other">{t('roleOther')}</option>
            </select>
          </Field>
          <Field label={t('phone')} required>
            <input className={inputClass()} type="tel" maxLength={10} value={form.phone ?? ''} onChange={e => setForm(f => ({ ...f, phone: sanitizePhone(e.target.value) }))} placeholder="10-digit mobile number" />
          </Field>
          <Field label={t('salary')}>
            <input type="number" min="0" className={inputClass()} value={form.salary ?? ''} onChange={e => setForm(f => ({ ...f, salary: e.target.value === '' ? null : Number(e.target.value) }))} />
          </Field>
          {(form.role === 'Driver' || form.role === 'Operator') && (
            <>
              <Field label={t('licenseNumber')}>
                <input className={inputClass()} value={form.license_number ?? ''} onChange={e => setForm(f => ({ ...f, license_number: e.target.value }))} />
              </Field>
              <Field label={t('licenseExpiry')}>
                <DatePicker value={form.license_expiry ?? ''} onChange={v => setForm(f => ({ ...f, license_expiry: v }))} />
              </Field>
            </>
          )}
          {form.role === 'Driver' && (
            <>
              <Field label={t('eyeTestAmount')}>
                <input type="number" min="0" step="0.01" className={inputClass()} value={form.eye_test_amount ?? ''} onChange={e => setForm(f => ({ ...f, eye_test_amount: e.target.value === '' ? null : Number(e.target.value) }))} placeholder="" />
              </Field>
              <Field label={t('eyeTestDate')}>
                <DatePicker value={form.eye_test_date ?? ''} onChange={v => setForm(f => ({ ...f, eye_test_date: v }))} />
              </Field>
              <Field label={t('eyeTestExpiryDate')}>
                <DatePicker value={form.eye_test_expiry_date ?? ''} onChange={v => setForm(f => ({ ...f, eye_test_expiry_date: v }))} />
              </Field>
            </>
          )}
          <Field label={t('advanceSalary')}>
            <input type="number" min="0" className={inputClass()} value={form.advance_salary ?? ''} onChange={e => setForm(f => ({ ...f, advance_salary: e.target.value === '' ? null : Number(e.target.value) }))} />
          </Field>
          <Field label={t('status')}>
            <select className={inputClass()} value={form.active ? 'active' : 'inactive'} onChange={e => setForm(f => ({ ...f, active: e.target.value === 'active' }))}>
              <option value="active">{t('active')}</option>
              <option value="inactive">{t('inactive')}</option>
            </select>
          </Field>
        </div>
      </Modal>

      <Modal open={!!viewEmp} onClose={() => setViewEmp(null)} title="Employee Details" size="md">
        {viewEmp && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div><span className="text-slate-500">Name:</span> <span className="font-medium">{viewEmp.name}</span></div>
              <div><span className="text-slate-500">Role:</span> <StatusBadge status={viewEmp.role} variant="blue" /></div>
              <div><span className="text-slate-500">Phone:</span> <span className="font-medium">{viewEmp.phone ?? '-'}</span></div>
              <div><span className="text-slate-500">Salary:</span> <span className="font-medium">{formatCurrency(viewEmp.salary)}</span></div>
              <div><span className="text-slate-500">License No:</span> <span className="font-medium">{viewEmp.license_number ?? '-'}</span></div>
              <div><span className="text-slate-500">License Expiry:</span> <span className="font-medium">{viewEmp.license_expiry ? formatDate(viewEmp.license_expiry) : '-'}</span></div>
              <div><span className="text-slate-500">Advance Salary:</span> <span className="font-medium">{formatCurrency(viewEmp.advance_salary)}</span></div>
              {viewEmp.role === 'Driver' && (
                <>
                  <div><span className="text-slate-500">Eye Test Amount:</span> <span className="font-medium">{viewEmp.eye_test_amount != null ? formatCurrency(viewEmp.eye_test_amount) : '-'}</span></div>
                  <div><span className="text-slate-500">Eye Test Date:</span> <span className="font-medium">{viewEmp.eye_test_date ? formatDate(viewEmp.eye_test_date) : '-'}</span></div>
                  <div><span className="text-slate-500">Eye Test Expiry:</span> <span className="font-medium">{viewEmp.eye_test_expiry_date ? formatDate(viewEmp.eye_test_expiry_date) : '-'}</span></div>
                </>
              )}
              <div><span className="text-slate-500">Status:</span> <StatusBadge status={viewEmp.active ? 'Active' : 'Inactive'} variant={viewEmp.active ? 'green' : 'gray'} /></div>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={handleDelete}
        title="Delete / Deactivate Employee"
        message="If this employee has attendance or trip records, they will be deactivated to preserve data. Otherwise they will be permanently deleted."
        confirmText="Confirm"
        danger
      />
    </div>
  );
}
