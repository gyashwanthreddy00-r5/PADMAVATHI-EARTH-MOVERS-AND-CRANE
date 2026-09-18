import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useLang } from '@/context/LangContext';
import { useSettings } from '@/context/SettingsContext';
import { useToast } from '@/components/ui/Toast';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Modal, ConfirmDialog, Button, Field, inputClass, LoadingSpinner } from '@/components/ui/common';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { Plus, Pencil, Trash2, Download, Filter, X } from 'lucide-react';
import { formatCurrency, formatDate, todayISO, monthName } from '@/lib/utils';
import { exportToXlsxWithCompany } from '@/lib/exportXlsx';
import { DatePicker } from '@/components/ui/DatePicker';
import type { SalaryPayment, Employee, PaymentMode, BankAccount } from '@/types';

interface SalaryPaymentRow extends SalaryPayment {
  employee?: Pick<Employee, 'id' | 'name'> | null;
}

interface BatchEmployee {
  employee_id: string;
  name: string;
  amount: number;
}

const emptyBatchMeta = {
  payment_date: todayISO(),
  payment_mode: 'Cash' as PaymentMode,
  bank_account_id: '',
  reference_number: '',
  remarks: '',
};

// Single-row edit form (editing an existing salary payment record affects
// only that one employee's entry, not a whole batch).
const emptyEditForm = {
  employee_id: '',
  amount: null as number | null,
  payment_date: todayISO(),
  payment_mode: 'Cash' as PaymentMode,
  bank_account_id: '',
  reference_number: '',
  remarks: '',
};

function salaryMonthFor(dateISO: string): string {
  const d = new Date(dateISO + 'T00:00:00');
  return `${monthName(d.getMonth())} ${d.getFullYear()}`;
}

export default function SalaryPayments() {
  const { t } = useLang();
  const { show } = useToast();
  const { settings } = useSettings();
  const [records, setRecords] = useState<SalaryPaymentRow[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SalaryPayment | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  // Add flow: pick a payment date/mode/bank once, then add any number of
  // employees - each gets its own salary_payments row (and so its own
  // individual Bank Ledger debit entry) sharing this same batch metadata.
  const [batchMeta, setBatchMeta] = useState(emptyBatchMeta);
  const [batchEmployees, setBatchEmployees] = useState<BatchEmployee[]>([]);

  // Edit flow: a single existing record.
  const [editForm, setEditForm] = useState(emptyEditForm);

  const [filters, setFilters] = useState({ from: '', to: '', employee_id: '' });

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [pRes, eRes, bRes] = await Promise.all([
      supabase.from('salary_payments').select('*, employee:employees(id,name)').eq('is_cancelled', false).order('payment_date', { ascending: false }),
      supabase.from('employees').select('*').order('name'),
      supabase.from('bank_accounts').select('*').eq('is_active', true).order('is_default', { ascending: false }).order('bank_name'),
    ]);
    setRecords((pRes.data ?? []) as SalaryPaymentRow[]);
    setEmployees((eRes.data ?? []) as Employee[]);
    setBankAccounts((bRes.data ?? []) as BankAccount[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const filteredRecords = useMemo(() => {
    return records.filter(r => {
      if (filters.from && r.payment_date < filters.from) return false;
      if (filters.to && r.payment_date > filters.to) return false;
      if (filters.employee_id && r.employee_id !== filters.employee_id) return false;
      return true;
    });
  }, [records, filters]);

  // ---------------- Add (multi-employee batch) ----------------

  const openAdd = () => {
    setEditing(null);
    setBatchMeta({ ...emptyBatchMeta, bank_account_id: bankAccounts.find(a => a.is_default)?.id ?? bankAccounts[0]?.id ?? '' });
    setBatchEmployees([]);
    setModalOpen(true);
  };

  const addEmployeeToBatch = (employeeId: string) => {
    const emp = employees.find(e => e.id === employeeId);
    if (!emp) return;
    const salary = emp.salary;
    if (!salary || salary <= 0) {
      show(`${emp.name} has no salary configured in Employee Master. Please set it there first.`, 'error');
      return;
    }
    setBatchEmployees(prev => prev.some(e => e.employee_id === employeeId) ? prev : [...prev, { employee_id: emp.id, name: emp.name, amount: salary }]);
  };

  const removeFromBatch = (employeeId: string) => {
    setBatchEmployees(prev => prev.filter(e => e.employee_id !== employeeId));
  };

  const batchTotal = useMemo(() => batchEmployees.reduce((s, e) => s + Number(e.amount), 0), [batchEmployees]);
  const employeeOptions = useMemo(
    () => employees.filter(e => !batchEmployees.some(b => b.employee_id === e.id)).map(e => ({ value: e.id, label: `${e.name} (${e.role})` })),
    [employees, batchEmployees],
  );

  const saveBatch = async () => {
    if (batchEmployees.length === 0) { show('Select at least one employee.', 'error'); return; }
    if (!batchMeta.payment_date) { show(`${t('date')} - ${t('required')}`, 'error'); return; }
    if (!batchMeta.payment_mode) { show(`${t('paymentMode')} - ${t('required')}`, 'error'); return; }
    if (batchMeta.payment_mode === 'Bank Transfer' && !batchMeta.bank_account_id) { show(`${t('bankAccount')} - ${t('required')}`, 'error'); return; }
    setSaving(true);
    const isCheque = batchMeta.payment_mode === 'Cheque';
    const salaryMonth = salaryMonthFor(batchMeta.payment_date);
    const rows = batchEmployees.map(e => ({
      employee_id: e.employee_id,
      salary_month: salaryMonth,
      amount: e.amount,
      payment_date: batchMeta.payment_date,
      payment_mode: batchMeta.payment_mode,
      reference_number: batchMeta.reference_number || null,
      cheque_number: isCheque ? (batchMeta.reference_number || null) : null,
      bank_account_id: batchMeta.payment_mode === 'Bank Transfer' ? batchMeta.bank_account_id : null,
      remarks: batchMeta.remarks || null,
    }));
    // Each row triggers the DB's sync_salary_payment_to_bank trigger
    // individually, so a batch of N employees creates N separate Bank
    // Ledger debit entries automatically - never one combined entry.
    const { error } = await supabase.from('salary_payments').insert(rows);
    if (error) show(error.message || t('saveError'), 'error');
    else { show(t('saveSuccess'), 'success'); setModalOpen(false); fetchAll(); }
    setSaving(false);
  };

  // ---------------- Edit (single existing record) ----------------

  const openEdit = (r: SalaryPayment) => {
    setEditing(r);
    setEditForm({
      employee_id: r.employee_id ?? '',
      amount: r.amount,
      payment_date: r.payment_date,
      payment_mode: r.payment_mode,
      bank_account_id: r.bank_account_id ?? '',
      reference_number: r.reference_number ?? '',
      remarks: r.remarks ?? '',
    });
    setModalOpen(true);
  };

  const saveEdit = async () => {
    if (!editing) return;
    if (!editForm.employee_id) { show(`${t('employee')} - ${t('required')}`, 'error'); return; }
    if (!editForm.amount || editForm.amount <= 0) { show(`${t('amount')} - ${t('required')}`, 'error'); return; }
    if (editForm.payment_mode === 'Bank Transfer' && !editForm.bank_account_id) { show(`${t('bankAccount')} - ${t('required')}`, 'error'); return; }
    setSaving(true);
    const isCheque = editForm.payment_mode === 'Cheque';
    const payload = {
      employee_id: editForm.employee_id,
      salary_month: salaryMonthFor(editForm.payment_date),
      amount: editForm.amount,
      payment_date: editForm.payment_date,
      payment_mode: editForm.payment_mode,
      reference_number: editForm.reference_number || null,
      cheque_number: isCheque ? (editForm.reference_number || null) : null,
      bank_account_id: editForm.payment_mode === 'Bank Transfer' ? editForm.bank_account_id : null,
      remarks: editForm.remarks || null,
    };
    const { error } = await supabase.from('salary_payments').update(payload).eq('id', editing.id);
    if (error) show(error.message || t('saveError'), 'error');
    else { show(t('saveSuccess'), 'success'); setModalOpen(false); fetchAll(); }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from('salary_payments').update({ is_cancelled: true }).eq('id', deleteId);
    if (error) show(t('deleteError'), 'error');
    else { show(t('deleteSuccess'), 'success'); fetchAll(); }
    setDeleteId(null);
  };

  const clearFilters = () => setFilters({ from: '', to: '', employee_id: '' });
  const hasActiveFilters = filters.from || filters.to || filters.employee_id;

  const handleExport = () => {
    if (filteredRecords.length === 0) { show('No data to export', 'error'); return; }
    const companyInfo = settings ? { company_name: settings.company_name, address: settings.address, phone: settings.phone, email: settings.email, gstin: settings.gstin } : { company_name: 'Crane ERP' };
    const headers = [t('date'), t('employee'), t('month'), t('amount'), t('paymentMode'), t('referenceNumber')];
    const rows = filteredRecords.map(r => [formatDate(r.payment_date), r.employee?.name ?? '-', r.salary_month, Number(r.amount), r.payment_mode, r.reference_number ?? '-']);
    const totalRow: (string | number)[] = ['', '', '', filteredRecords.reduce((s, r) => s + Number(r.amount), 0), '', ''];
    exportToXlsxWithCompany('Salary_Payments.xlsx', t('salaryPayments'), companyInfo, 'All Records', new Date().toLocaleString('en-IN'), '', headers, rows, totalRow);
  };

  const columns: Column<SalaryPaymentRow>[] = [
    { key: 'payment_date', header: t('date'), sortable: true, render: r => formatDate(r.payment_date) },
    { key: 'employee', header: t('employee'), render: r => r.employee?.name ?? '-' },
    { key: 'salary_month', header: t('month'), render: r => r.salary_month },
    { key: 'amount', header: t('amount'), align: 'right', sortable: true, render: r => <span className="font-medium text-slate-800">{formatCurrency(r.amount)}</span> },
    { key: 'payment_mode', header: t('paymentMode'), render: r => r.payment_mode === 'Bank Transfer' ? 'Bank' : r.payment_mode },
    { key: 'reference_number', header: t('referenceNumber'), render: r => r.reference_number ?? '-' },
    {
      key: 'actions', header: t('actions'), align: 'center',
      render: r => (
        <div className="flex justify-center gap-1">
          <button onClick={() => openEdit(r)} className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md"><Pencil className="w-4 h-4" /></button>
          <button onClick={() => setDeleteId(r.id)} className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-md"><Trash2 className="w-4 h-4" /></button>
        </div>
      ),
    },
  ];

  const totalAmount = useMemo(() => filteredRecords.reduce((s, r) => s + Number(r.amount), 0), [filteredRecords]);

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="bg-white rounded-lg border border-slate-200 p-3 shadow-sm">
          <p className="text-xs text-slate-500">{t('salaryPayments')}</p>
          <p className="text-lg font-bold text-slate-800">{filteredRecords.length}</p>
        </div>
        <div className="bg-white rounded-lg border border-emerald-200 p-3 shadow-sm">
          <p className="text-xs text-emerald-600">{t('totalAmount')}</p>
          <p className="text-lg font-bold text-emerald-700">{formatCurrency(totalAmount)}</p>
        </div>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowFilters(s => !s)}><Filter className="w-4 h-4" />{t('filter')}</Button>
          {hasActiveFilters && <Button variant="outline" size="sm" onClick={clearFilters}><X className="w-4 h-4" />{t('clear')}</Button>}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={handleExport} disabled={filteredRecords.length === 0}><Download className="w-4 h-4" />{t('export')}</Button>
          <Button onClick={openAdd}><Plus className="w-4 h-4" />{t('addSalaryPayment')}</Button>
        </div>
      </div>

      {showFilters && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label={t('from')}>
              <DatePicker value={filters.from} onChange={v => setFilters(f => ({ ...f, from: v }))} />
            </Field>
            <Field label={t('to')}>
              <DatePicker value={filters.to} onChange={v => setFilters(f => ({ ...f, to: v }))} />
            </Field>
            <Field label={t('employee')}>
              <select className={inputClass()} value={filters.employee_id} onChange={e => setFilters(f => ({ ...f, employee_id: e.target.value }))}>
                <option value="">{t('all')}</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </Field>
          </div>
        </div>
      )}

      <DataTable columns={columns} data={filteredRecords} searchKeys={['salary_month']} searchPlaceholder={`${t('search')}...`} showSerialNumber />

      {/* Add: multi-employee batch */}
      <Modal
        open={modalOpen && !editing} onClose={() => setModalOpen(false)}
        title={t('addSalaryPayment')}
        closeOnBackdropClick={false}
        size="lg"
        footer={<><Button variant="secondary" onClick={() => setModalOpen(false)}>{t('cancel')}</Button><Button onClick={saveBatch} disabled={saving || batchEmployees.length === 0}>{saving ? t('saving') : t('save')}</Button></>}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label={t('date')} required>
              <DatePicker value={batchMeta.payment_date} onChange={v => setBatchMeta(f => ({ ...f, payment_date: v }))} />
            </Field>
            <Field label={t('employee')}>
              <SearchableSelect
                value=""
                onChange={addEmployeeToBatch}
                placeholder="Search and select employees..."
                searchPlaceholder="Search employee..."
                options={employeeOptions}
              />
            </Field>
          </div>

          <div>
            <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-slate-600">{t('employee')}</th>
                  <th className="text-right px-3 py-2 font-medium text-slate-600">{t('salaryAmount')}</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {batchEmployees.length === 0 ? (
                  <tr><td colSpan={3} className="px-3 py-4 text-center text-slate-400">No employees selected yet</td></tr>
                ) : batchEmployees.map(e => (
                  <tr key={e.employee_id} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-slate-800">{e.name}</td>
                    <td className="px-3 py-2 text-right font-medium text-slate-800">{formatCurrency(e.amount)}</td>
                    <td className="px-3 py-2 text-center">
                      <button onClick={() => removeFromBatch(e.employee_id)} className="p-1 text-slate-400 hover:text-red-600"><X className="w-4 h-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-between items-center bg-slate-50 rounded-lg px-4 py-2.5 border border-slate-200">
            <span className="text-sm font-medium text-slate-600">{t('salaryPayments')}: {batchEmployees.length}</span>
            <span className="text-lg font-bold text-slate-800">{t('totalAmount')}: {formatCurrency(batchTotal)}</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label={t('paymentMode')}>
              <select className={inputClass()} value={batchMeta.payment_mode} onChange={e => setBatchMeta(f => ({ ...f, payment_mode: e.target.value as PaymentMode }))}>
                <option value="Cash">Cash</option>
                <option value="Bank Transfer">Bank</option>
                <option value="UPI">UPI</option>
                <option value="Cheque">Cheque</option>
              </select>
            </Field>
            {batchMeta.payment_mode === 'Bank Transfer' && (
              <Field label={t('bankAccount')} required>
                <select className={inputClass()} value={batchMeta.bank_account_id} onChange={e => setBatchMeta(f => ({ ...f, bank_account_id: e.target.value }))}>
                  <option value="">{t('selectBankAccount')}</option>
                  {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.bank_name}</option>)}
                </select>
              </Field>
            )}
            <Field label={t('referenceNumber')}>
              <input className={inputClass()} value={batchMeta.reference_number} onChange={e => setBatchMeta(f => ({ ...f, reference_number: e.target.value }))} placeholder="UPI Ref / Cheque No" />
            </Field>
            <Field label={t('notes')}>
              <input className={inputClass()} value={batchMeta.remarks} onChange={e => setBatchMeta(f => ({ ...f, remarks: e.target.value }))} placeholder="Optional notes" />
            </Field>
          </div>
        </div>
      </Modal>

      {/* Edit: single existing record */}
      <Modal
        open={modalOpen && !!editing} onClose={() => setModalOpen(false)}
        title={`${t('edit')} ${t('salaryPayment')}`}
        closeOnBackdropClick={false}
        footer={<><Button variant="secondary" onClick={() => setModalOpen(false)}>{t('cancel')}</Button><Button onClick={saveEdit} disabled={saving}>{saving ? t('saving') : t('save')}</Button></>}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={t('employee')} required>
            <SearchableSelect
              value={editForm.employee_id}
              onChange={val => setEditForm(f => ({ ...f, employee_id: val }))}
              placeholder="Select employee"
              searchPlaceholder="Search employee..."
              options={employees.map(e => ({ value: e.id, label: `${e.name} (${e.role})` }))}
            />
          </Field>
          <Field label={t('date')} required>
            <DatePicker value={editForm.payment_date} onChange={v => setEditForm(f => ({ ...f, payment_date: v }))} />
          </Field>
          <Field label={t('amount')} required>
            <input type="number" step="0.01" min="0" className={inputClass()} value={editForm.amount ?? ''} onChange={e => setEditForm(f => ({ ...f, amount: e.target.value === '' ? null : Number(e.target.value) }))} />
          </Field>
          <Field label={t('paymentMode')}>
            <select className={inputClass()} value={editForm.payment_mode} onChange={e => setEditForm(f => ({ ...f, payment_mode: e.target.value as PaymentMode }))}>
              <option value="Cash">Cash</option>
              <option value="Bank Transfer">Bank</option>
              <option value="UPI">UPI</option>
              <option value="Cheque">Cheque</option>
            </select>
          </Field>
          {editForm.payment_mode === 'Bank Transfer' && (
            <Field label={t('bankAccount')} required>
              <select className={inputClass()} value={editForm.bank_account_id} onChange={e => setEditForm(f => ({ ...f, bank_account_id: e.target.value }))}>
                <option value="">{t('selectBankAccount')}</option>
                {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.bank_name}</option>)}
              </select>
            </Field>
          )}
          <Field label={t('referenceNumber')}>
            <input className={inputClass()} value={editForm.reference_number} onChange={e => setEditForm(f => ({ ...f, reference_number: e.target.value }))} placeholder="UPI Ref / Cheque No" />
          </Field>
          <div className="sm:col-span-2">
            <Field label={t('notes')}>
              <input className={inputClass()} value={editForm.remarks} onChange={e => setEditForm(f => ({ ...f, remarks: e.target.value }))} placeholder="Optional notes" />
            </Field>
          </div>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={handleDelete} title={t('delete')} message={t('confirmDelete')} confirmText={t('delete')} danger />
    </div>
  );
}
