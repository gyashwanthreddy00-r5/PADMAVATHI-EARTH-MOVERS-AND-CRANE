import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useLang } from '@/context/LangContext';
import { useToast } from '@/components/ui/Toast';
import { useSettings } from '@/context/SettingsContext';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Modal, ConfirmDialog, StatusBadge, Button, Field, inputClass, LoadingSpinner } from '@/components/ui/common';
import { DatePicker } from '@/components/ui/DatePicker';
import { Plus, Pencil, Trash2, FileText } from 'lucide-react';
import { formatCurrency, formatDate, todayISO, amountInWords, vehicleTypeLabel } from '@/lib/utils';
import { calculateDiscount, validateDiscountPercentage } from '@/lib/discountCalc';
import type { MonthlyContract, ContractStatus, Vehicle, InvoiceSettings, InvoiceStatus } from '@/types';

function isContractActive(c: MonthlyContract, asOf?: string): boolean {
  if (c.status !== 'Active') return false;
  const ref = asOf ?? todayISO();
  if (c.start_date > ref) return false;
  if (c.end_date && c.end_date < ref) return false;
  return true;
}

function dateRangesOverlap(aStart: string, aEnd: string | null, bStart: string, bEnd: string | null): boolean {
  const aS = aStart;
  const aE = aEnd ?? '9999-12-31';
  const bS = bStart;
  const bE = bEnd ?? '9999-12-31';
  return aS <= bE && bS <= aE;
}

export default function Contracts() {
  const { t } = useLang();
  const { show } = useToast();
  const { settings } = useSettings();
  const [contracts, setContracts] = useState<MonthlyContract[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [invoiceSettings, setInvoiceSettings] = useState<InvoiceSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<MonthlyContract | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [invoiceModal, setInvoiceModal] = useState<MonthlyContract | null>(null);
  const [invoiceForm, setInvoiceForm] = useState({
    invoice_date: todayISO(),
    add_gst: true,
    gst_type: 'cgst_sgst' as 'cgst_sgst' | 'igst',
    cgst_percent: 9,
    sgst_percent: 9,
    igst_percent: 18,
    remarks: 'Being monthly crane/JCB rental charges.',
    discount_enabled: false,
    discount_percent: 0,
  });
  const [generating, setGenerating] = useState(false);

  const [form, setForm] = useState<Partial<MonthlyContract>>({
    company_name: '', address: '', billing_details: '', vehicle_id: '', start_date: new Date().toISOString().split('T')[0], end_date: '', budget: null as number | null, total_monthly_amount: null as number | null, status: 'Active',
  });

  const fetchAll = async () => {
    setLoading(true);
    const [cRes, vRes, isRes] = await Promise.all([
      supabase.from('monthly_contracts').select('*').order('created_at', { ascending: false }),
      supabase.from('vehicles').select('id, registration_number, model, type, capacity, tons, active, status').order('registration_number'),
      supabase.from('invoice_settings').select('*').limit(1).maybeSingle(),
    ]);
    setContracts((cRes.data ?? []) as MonthlyContract[]);
    setVehicles((vRes.data ?? []) as Vehicle[]);
    setInvoiceSettings(isRes.data as InvoiceSettings | null);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const today = todayISO();

  const bookedVehicleIds = useMemo(() => {
    const ids = new Set<string>();
    contracts.forEach(c => {
      if (isContractActive(c) && c.vehicle_id) ids.add(c.vehicle_id);
    });
    return ids;
  }, [contracts]);

  const vehicleLabel = (id: string | null) => vehicles.find(v => v.id === id)?.registration_number ?? '-';
  const vehicleById = (id: string | null) => vehicles.find(v => v.id === id) ?? null;

  const openAdd = () => {
    setEditing(null);
    setForm({ company_name: '', address: '', billing_details: '', vehicle_id: '', start_date: today, end_date: '', budget: null as number | null, total_monthly_amount: null as number | null, status: 'Active' });
    setModalOpen(true);
  };
  const openEdit = (c: MonthlyContract) => { setEditing(c); setForm(c); setModalOpen(true); };

  const save = async () => {
    if (!form.company_name) { show(t('required'), 'error'); return; }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { show('Your session has expired. Please log in again.', 'error'); return; }

    // Check for overlapping contract on the same vehicle
    if (form.vehicle_id) {
      const overlap = contracts.find(c => {
        if (c.vehicle_id !== form.vehicle_id) return false;
        if (editing && c.id === editing.id) return false;
        if (c.status !== 'Active') return false;
        const fStart = form.start_date ?? today;
        const fEnd = form.end_date ?? null;
        return dateRangesOverlap(c.start_date, c.end_date, fStart, fEnd);
      });
      if (overlap) {
        show(`Vehicle ${vehicleLabel(form.vehicle_id)} is already on an active contract (${overlap.company_name}, ${formatDate(overlap.start_date)} to ${overlap.end_date ? formatDate(overlap.end_date) : 'ongoing'}). Please choose a different vehicle or date range.`, 'error');
        return;
      }
    }

    setSaving(true);
    const cleanDate = (v: unknown): string | null => (v && String(v).trim() !== '' ? String(v) : null);
    const payload = {
      company_name: form.company_name?.trim() || '',
      address: form.address?.trim() || null,
      billing_details: form.billing_details?.trim() || null,
      vehicle_id: form.vehicle_id && form.vehicle_id !== '' ? form.vehicle_id : null,
      start_date: form.start_date ?? today,
      end_date: cleanDate(form.end_date),
      budget: form.budget != null ? Number(form.budget) : 0,
      total_monthly_amount: form.total_monthly_amount != null ? Number(form.total_monthly_amount) : 0,
      status: form.status ?? 'Active',
      created_by: editing ? undefined : user.id,
      updated_by: user.id,
    };
    if (editing) {
      const { error } = await supabase.from('monthly_contracts').update(payload).eq('id', editing.id);
      if (error) { console.error('Contract update failed:', error); show(t('saveError'), 'error'); }
      else { show(t('saveSuccess'), 'success'); setModalOpen(false); fetchAll(); }
    } else {
      const { error } = await supabase.from('monthly_contracts').insert(payload);
      if (error) { console.error('Contract insert failed:', error); show(t('saveError'), 'error'); }
      else { show(t('saveSuccess'), 'success'); setModalOpen(false); fetchAll(); }
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from('monthly_contracts').delete().eq('id', deleteId);
    if (error) show(t('deleteError'), 'error');
    else { show(t('deleteSuccess'), 'success'); fetchAll(); }
    setDeleteId(null);
  };

  // Auto-expire contracts past their end date
  useEffect(() => {
    contracts.forEach(c => {
      if (c.status === 'Active' && c.end_date && c.end_date < today) {
        supabase.from('monthly_contracts').update({ status: 'Expired' as ContractStatus }).eq('id', c.id);
      }
    });
  }, [contracts, today]);

  const generateContractInvoice = async () => {
    if (!invoiceModal) return;
    if (invoiceForm.discount_enabled) {
      const pctErr = validateDiscountPercentage(invoiceForm.discount_percent);
      if (pctErr) { show(pctErr, 'error'); return; }
      if (!invoiceForm.discount_percent || invoiceForm.discount_percent <= 0) {
        show('Discount is ON but percentage is empty. Please enter a discount percentage or turn discount OFF.', 'error'); return;
      }
    }
    setGenerating(true);
    try {
      const { data: invNum, error: numErr } = await supabase.rpc('next_pcs_invoice_number', {
        p_invoice_date: invoiceForm.invoice_date,
      });
      if (numErr || !invNum) throw new Error('Failed to generate invoice number');

      const now = new Date();
      const fy = now.getMonth() >= 3
        ? `${now.getFullYear()}-${String((now.getFullYear() + 1) % 100).padStart(2, '0')}`
        : `${now.getFullYear() - 1}-${String(now.getFullYear() % 100).padStart(2, '0')}`;

      const veh = vehicleById(invoiceModal.vehicle_id);
      const monthlyAmount = Number(invoiceModal.total_monthly_amount) || 0;
      const isInterState = invoiceForm.gst_type === 'igst';
      const cgstAmount = invoiceForm.add_gst && !isInterState ? Math.round(monthlyAmount * invoiceForm.cgst_percent / 100 * 100) / 100 : 0;
      const sgstAmount = invoiceForm.add_gst && !isInterState ? Math.round(monthlyAmount * invoiceForm.sgst_percent / 100 * 100) / 100 : 0;
      const igstAmount = invoiceForm.add_gst && isInterState ? Math.round(monthlyAmount * invoiceForm.igst_percent / 100 * 100) / 100 : 0;
      const totalTax = cgstAmount + sgstAmount + igstAmount;
      const grandTotal = Math.round((monthlyAmount + totalTax) * 100) / 100;
      const disc = calculateDiscount({ grandTotal, discountEnabled: invoiceForm.discount_enabled, discountPercentage: invoiceForm.discount_percent });
      const finalPayable = disc.finalPayableAmount;

      const declaration = invoiceSettings?.declaration ||
        'We declare that this invoice shows the actual price of the services described and that all particulars are true and correct.';

      const invoicePayload = {
        invoice_number: invNum,
        invoice_date: invoiceForm.invoice_date,
        invoice_type: 'MONTHLY_CONTRACT' as const,
        customer_id: null,
        customer_name: invoiceModal.company_name,
        customer_address: invoiceModal.address ?? null,
        customer_gstin: null,
        trip_id: null,
        trip_date: null,
        vehicle_id: invoiceModal.vehicle_id ?? null,
        vehicle_number: veh?.registration_number ?? null,
        driver_name: null,
        place_of_work: null,
        opening_hour_meter: null,
        closing_hour_meter: null,
        total_hours: null,
        rate_type: 'Monthly',
        description: `Monthly Full-Time Contract — ${invoiceModal.company_name} (${formatDate(invoiceModal.start_date)} to ${invoiceModal.end_date ? formatDate(invoiceModal.end_date) : 'Ongoing'})`,
        hours: null,
        rate: monthlyAmount,
        taxable_amount: monthlyAmount,
        cgst_percent: invoiceForm.add_gst && invoiceForm.gst_type === 'cgst_sgst' ? invoiceForm.cgst_percent : 0,
        sgst_percent: invoiceForm.add_gst && invoiceForm.gst_type === 'cgst_sgst' ? invoiceForm.sgst_percent : 0,
        igst_percent: invoiceForm.add_gst && invoiceForm.gst_type === 'igst' ? invoiceForm.igst_percent : 0,
        cgst_amount: cgstAmount,
        sgst_amount: sgstAmount,
        igst_amount: igstAmount,
        total_gst: totalTax,
        grand_total: grandTotal,
        discount_enabled: invoiceForm.discount_enabled,
        discount_percent: invoiceForm.discount_enabled ? invoiceForm.discount_percent : 0,
        discount_amount: disc.discountAmount,
        final_payable_amount: finalPayable,
        batha: 0,
        payment_status: 'Pending' as const,
        payment_mode: null,
        financial_year: fy,
        consignee_name: invoiceModal.company_name,
        consignee_address: invoiceModal.address ?? null,
        consignee_gstin: null,
        consignee_state: null,
        consignee_state_code: null,
        destination: null,
        motor_vehicle_numbers: veh?.registration_number ?? null,
        terms_of_payment: invoiceSettings?.default_payment_terms ?? '30 days',
        delivery_note: null,
        reference_no: null,
        buyer_order_no: null,
        dispatch_doc_no: null,
        delivery_note_date: null,
        amount_received: 0,
        balance_amount: finalPayable,
        invoice_status: 'Generated' as InvoiceStatus,
        amount_in_words: amountInWords(finalPayable),
        declaration,
        remarks: invoiceForm.remarks || null,
      };

      const { data: invData, error: invErr } = await supabase
        .from('invoices').insert(invoicePayload).select('id').single();
      if (invErr) throw new Error(invErr.message);
      const invoiceId = invData.id;

      const typeLabel = veh ? vehicleTypeLabel(veh.type, veh.tons ?? veh.capacity) : 'Vehicle';
      const itemRow = {
        invoice_id: invoiceId,
        trip_entry_id: null,
        sl_no: 1,
        description: `${typeLabel} Monthly Rental — ${invoiceModal.company_name} (${formatDate(invoiceModal.start_date)} to ${invoiceModal.end_date ? formatDate(invoiceModal.end_date) : 'Ongoing'})`,
        hsn_sac: invoiceSettings?.hsn_sac || '997319',
        quantity: 1,
        rate: monthlyAmount,
        unit: 'month',
        amount: monthlyAmount,
        batha: 0,
      };
      const { error: itemsErr } = await supabase.from('invoice_items').insert(itemRow);
      if (itemsErr) throw new Error(itemsErr.message);

      show(`Invoice ${invNum} generated successfully`, 'success');
      setInvoiceModal(null);
      fetchAll();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to generate invoice';
      show(msg, 'error');
    }
    setGenerating(false);
  };

  const columns: Column<MonthlyContract>[] = [
    { key: 'company_name', header: t('companyName'), sortable: true },
    { key: 'vehicle_id', header: t('allocatedVehicle'), render: c => {
      const veh = vehicleById(c.vehicle_id);
      const booked = isContractActive(c) && c.vehicle_id && bookedVehicleIds.has(c.vehicle_id);
      return (
        <span className="flex items-center gap-2">
          <span>{vehicleLabel(c.vehicle_id)}</span>
          {veh && booked && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700">Booked</span>}
          {veh && !booked && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700">Available</span>}
        </span>
      );
    }},
    { key: 'start_date', header: t('startDate'), sortable: true, render: c => formatDate(c.start_date) },
    { key: 'end_date', header: t('endDate'), render: c => formatDate(c.end_date) },
    { key: 'total_monthly_amount', header: t('totalMonthlyAmount'), align: 'right', render: c => formatCurrency(c.total_monthly_amount), sortable: true },
    { key: 'status', header: t('status'), render: c => <StatusBadge status={c.status} /> },
    {
      key: 'actions', header: t('actions'), align: 'center',
      render: c => (
        <div className="flex justify-center gap-1">
          {isContractActive(c) && (
            <button onClick={() => setInvoiceModal(c)} className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md" title="Create Invoice">
              <FileText className="w-4 h-4" />
            </button>
          )}
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
        <p className="text-sm text-slate-500">{contracts.length} {t('monthlyContracts')}</p>
        <Button onClick={openAdd}><Plus className="w-4 h-4" />{t('addNew')}</Button>
      </div>

      <DataTable columns={columns} data={contracts} searchKeys={['company_name']} searchPlaceholder={`${t('search')}...`} showSerialNumber />

      <Modal
        open={modalOpen} onClose={() => setModalOpen(false)}
        title={editing ? `${t('edit')} ${t('monthlyContracts')}` : `${t('addNew')} ${t('monthlyContracts')}`}
        size="lg"
        footer={<><Button variant="secondary" onClick={() => setModalOpen(false)}>{t('cancel')}</Button><Button onClick={save} disabled={saving}>{saving ? t('saving') : t('save')}</Button></>}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={t('companyName')} required>
            <input className={inputClass()} value={form.company_name ?? ''} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} />
          </Field>
          <Field label={t('allocatedVehicle')}>
            <select className={inputClass()} value={form.vehicle_id ?? ''} onChange={e => setForm(f => ({ ...f, vehicle_id: e.target.value || null }))}>
              <option value="">-</option>
              {vehicles.map(v => {
                const isBooked = bookedVehicleIds.has(v.id) && (!editing || v.id !== editing.vehicle_id);
                return (
                  <option key={v.id} value={v.id} disabled={isBooked}>
                    {v.registration_number} ({v.type}){isBooked ? ' — Booked (Under Monthly Contract)' : ''}
                  </option>
                );
              })}
            </select>
          </Field>
          <Field label={t('address')}>
            <textarea className={inputClass()} rows={2} value={form.address ?? ''} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
          </Field>
          <Field label={t('billingDetails')}>
            <textarea className={inputClass()} rows={2} value={form.billing_details ?? ''} onChange={e => setForm(f => ({ ...f, billing_details: e.target.value }))} />
          </Field>
          <Field label={t('startDate')} required>
            <DatePicker value={form.start_date ?? ''} onChange={v => setForm(f => ({ ...f, start_date: v }))} />
          </Field>
          <Field label={t('endDate')}>
            <DatePicker value={form.end_date ?? ''} onChange={v => setForm(f => ({ ...f, end_date: v }))} />
          </Field>
          <Field label={t('budget')}>
            <input type="number" className={inputClass()} value={form.budget ?? ''} onChange={e => setForm(f => ({ ...f, budget: e.target.value === '' ? null : Number(e.target.value) }))} />
          </Field>
          <Field label={t('totalMonthlyAmount')}>
            <input type="number" className={inputClass()} value={form.total_monthly_amount ?? ''} onChange={e => setForm(f => ({ ...f, total_monthly_amount: e.target.value === '' ? null : Number(e.target.value) }))} />
          </Field>
          <Field label={t('status')}>
            <select className={inputClass()} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as ContractStatus }))}>
              <option value="Active">{t('contractStatusActive')}</option>
              <option value="Completed">{t('contractStatusCompleted')}</option>
              <option value="Expired">{t('contractStatusExpired')}</option>
              <option value="Cancelled">{t('contractStatusCancelled')}</option>
            </select>
          </Field>
        </div>
      </Modal>

      {/* Invoice Modal for Monthly Contract */}
      <Modal
        open={!!invoiceModal} onClose={() => setInvoiceModal(null)}
        title="Create Invoice for Monthly Contract"
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setInvoiceModal(null)}>{t('cancel')}</Button>
            <Button onClick={generateContractInvoice} disabled={generating}>
              {generating ? 'Generating...' : <><FileText className="w-4 h-4" />{t('generateInvoice')}</>}
            </Button>
          </>
        }
      >
        {invoiceModal && (
          <div className="space-y-4">
            <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-slate-500">Company:</span><span className="font-medium">{invoiceModal.company_name}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Vehicle:</span><span className="font-medium">{vehicleLabel(invoiceModal.vehicle_id)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Period:</span><span className="font-medium">{formatDate(invoiceModal.start_date)} — {invoiceModal.end_date ? formatDate(invoiceModal.end_date) : 'Ongoing'}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Monthly Amount:</span><span className="font-bold text-slate-900">{formatCurrency(invoiceModal.total_monthly_amount)}</span></div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label={t('invoiceDate')} required>
                <DatePicker value={invoiceForm.invoice_date} onChange={v => setInvoiceForm(f => ({ ...f, invoice_date: v }))} />
              </Field>
              <Field label="Add GST">
                <label className="flex items-center gap-2 mt-2">
                  <input type="checkbox" checked={invoiceForm.add_gst} onChange={e => setInvoiceForm(f => ({ ...f, add_gst: e.target.checked }))} className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                  <span className="text-sm text-slate-600">Apply GST</span>
                </label>
              </Field>
              {invoiceForm.add_gst && (
                <div className="sm:col-span-2">
                  <div className="flex gap-4 mb-2">
                    <label className="flex items-center gap-2 text-sm text-slate-600">
                      <input type="radio" name="contract_gst_type" checked={invoiceForm.gst_type === 'cgst_sgst'} onChange={() => setInvoiceForm(f => ({ ...f, gst_type: 'cgst_sgst' }))} className="w-4 h-4 text-blue-600" />
                      Intra-State (CGST+SGST)
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-600">
                      <input type="radio" name="contract_gst_type" checked={invoiceForm.gst_type === 'igst'} onChange={() => setInvoiceForm(f => ({ ...f, gst_type: 'igst' }))} className="w-4 h-4 text-blue-600" />
                      Inter-State (IGST)
                    </label>
                  </div>
                </div>
              )}
              {invoiceForm.add_gst && invoiceForm.gst_type === 'cgst_sgst' && (
                <>
                  <Field label={t('cgstPercent')}>
                    <input type="number" step="0.01" className={inputClass()} value={invoiceForm.cgst_percent} onChange={e => setInvoiceForm(f => ({ ...f, cgst_percent: Number(e.target.value) }))} />
                  </Field>
                  <Field label={t('sgstPercent')}>
                    <input type="number" step="0.01" className={inputClass()} value={invoiceForm.sgst_percent} onChange={e => setInvoiceForm(f => ({ ...f, sgst_percent: Number(e.target.value) }))} />
                  </Field>
                </>
              )}
              {invoiceForm.add_gst && invoiceForm.gst_type === 'igst' && (
                <Field label="IGST %">
                  <input type="number" step="0.01" className={inputClass()} value={invoiceForm.igst_percent} onChange={e => setInvoiceForm(f => ({ ...f, igst_percent: Number(e.target.value) }))} />
                </Field>
              )}
              <Field label={t('remarks')}>
                <input className={inputClass()} value={invoiceForm.remarks} onChange={e => setInvoiceForm(f => ({ ...f, remarks: e.target.value }))} />
              </Field>
            </div>
            <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
              <input type="checkbox" id="discount-enabled-contract" checked={invoiceForm.discount_enabled} onChange={e => setInvoiceForm(f => ({ ...f, discount_enabled: e.target.checked }))} className="w-4 h-4 accent-blue-600" />
              <label htmlFor="discount-enabled-contract" className="text-sm font-semibold text-slate-700">Apply Discount</label>
              {invoiceForm.discount_enabled && (
                <div className="flex items-center gap-2 ml-auto">
                  <label className="text-sm text-slate-600">Discount (%):</label>
                  <input type="number" min={0} max={100} step="0.5" className={inputClass() + ' w-24'} value={invoiceForm.discount_percent} onChange={e => setInvoiceForm(f => ({ ...f, discount_percent: Number(e.target.value) }))} placeholder="e.g. 5" />
                </div>
              )}
            </div>
            {(() => {
              const amt = Number(invoiceModal.total_monthly_amount) || 0;
              const isIGST = invoiceForm.gst_type === 'igst';
              const tax = invoiceForm.add_gst ? (isIGST ? amt * invoiceForm.igst_percent / 100 : amt * (invoiceForm.cgst_percent + invoiceForm.sgst_percent) / 100) : 0;
              const grand = amt + tax;
              const disc = calculateDiscount({ grandTotal: grand, discountEnabled: invoiceForm.discount_enabled, discountPercentage: invoiceForm.discount_percent });
              return (
                <div className="p-4 bg-blue-50 rounded-lg border border-blue-100 text-sm">
                  <div className="flex justify-between"><span className="text-slate-500">Taxable Amount:</span><span className="font-medium">{formatCurrency(amt)}</span></div>
                  {invoiceForm.add_gst && <div className="flex justify-between"><span className="text-slate-500">GST:</span><span className="font-medium">{formatCurrency(tax)}</span></div>}
                  <div className="flex justify-between border-t border-blue-200 mt-1 pt-1"><span className="text-slate-500">Grand Total:</span><span className="font-bold text-slate-900">{formatCurrency(grand)}</span></div>
                  {invoiceForm.discount_enabled && <div className="flex justify-between text-red-600"><span className="text-slate-500">Discount ({invoiceForm.discount_percent}%):</span><span className="font-medium">-{formatCurrency(disc.discountAmount)}</span></div>}
                  {invoiceForm.discount_enabled && <div className="flex justify-between border-t border-blue-200 mt-1 pt-1 text-blue-700"><span className="font-semibold">Net Payable:</span><span className="font-bold">{formatCurrency(disc.finalPayableAmount)}</span></div>}
                </div>
              );
            })()}
          </div>
        )}
      </Modal>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={handleDelete} title={t('delete')} message={t('confirmDelete')} confirmText={t('delete')} danger />
    </div>
  );
}
