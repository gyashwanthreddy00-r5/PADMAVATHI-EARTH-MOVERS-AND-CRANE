import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/Toast';
import { useSettings } from '@/context/SettingsContext';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Modal, ConfirmDialog, StatusBadge, Button, Field, inputClass, LoadingSpinner, KpiCard } from '@/components/ui/common';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { DatePicker } from '@/components/ui/DatePicker';
import { formatCurrency, formatDate, todayISO } from '@/lib/utils';
import { computePoItemAmounts, getEffectivePoStatus, isPoLowBalance, round2, PO_CGST_PERCENT, PO_SGST_PERCENT } from '@/lib/poOrderManagement';
import { printPurchaseOrder, exportPurchaseOrderToExcel } from '@/lib/poExport';
import { PoRequestModal } from '@/components/PoRequestModal';
import { Plus, Trash2, Pencil, Eye, Printer, Download, X, AlertTriangle, ClipboardList, CheckCircle2, Mail } from 'lucide-react';
import type { Customer, Vehicle, PurchaseOrder, PurchaseOrderItem, PurchaseOrderUtilization, PurchaseOrderStatus } from '@/types';

type PoCustomerInfo = { name: string; address: string | null; phone: string | null; email: string | null; gstin: string | null } | null;
type PoWithCustomer = PurchaseOrder & { customer?: PoCustomerInfo };

interface ItemDraft { vehicleType: string; remarks: string; quantity: string; unitRate: string; }

const emptyItemDraft = (): ItemDraft => ({ vehicleType: '', remarks: '', quantity: '1', unitRate: '' });

// Ton / Vehicle Type options for PO items - derived from the Vehicle (Crane) Master,
// never hardcoded, mirroring the "Crane {tons} Ton" / "JCB" label style Rate Master
// already uses elsewhere in this app.
function poVehicleTypeLabel(v: Pick<Vehicle, 'type' | 'tons' | 'capacity'>): string {
  if (v.type === 'JCB') return 'JCB';
  const tonsNum = v.tons ?? (v.capacity ? Number(String(v.capacity).replace(/[^0-9.]/g, '')) || null : null);
  if (v.type === 'Crane' && tonsNum) {
    const tonsStr = Number.isInteger(tonsNum) ? String(tonsNum) : String(tonsNum);
    return `${tonsStr} TON`;
  }
  return v.type ? v.type.toUpperCase() : '';
}

export default function PurchaseOrders() {
  const { show } = useToast();
  const { settings } = useSettings();

  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [pos, setPos] = useState<PoWithCustomer[]>([]);

  const [filterCustomerId, setFilterCustomerId] = useState('');
  const [filterPoNumber, setFilterPoNumber] = useState('');
  const [filterDate, setFilterDate] = useState('');
  // 'LowBalance' is a synthetic filter value (not a real PurchaseOrderStatus) so the
  // "Low Balance POs" dashboard card can filter the table too - low balance is a
  // computed flag on Active POs, not a status of its own.
  const [filterStatus, setFilterStatus] = useState<'All' | PurchaseOrderStatus | 'LowBalance'>('All');

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formCustomerId, setFormCustomerId] = useState('');
  const [formPoNumber, setFormPoNumber] = useState('');
  const [formPoDate, setFormPoDate] = useState(todayISO());
  const [formValidFrom, setFormValidFrom] = useState('');
  const [formValidTo, setFormValidTo] = useState('');
  const [formItems, setFormItems] = useState<ItemDraft[]>([emptyItemDraft()]);
  const [savingForm, setSavingForm] = useState(false);

  const [detailPo, setDetailPo] = useState<PoWithCustomer | null>(null);
  const [detailItems, setDetailItems] = useState<PurchaseOrderItem[]>([]);
  const [detailUtilization, setDetailUtilization] = useState<PurchaseOrderUtilization[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const [deletePo, setDeletePo] = useState<PoWithCustomer | null>(null);
  const [requestPoOpen, setRequestPoOpen] = useState(false);

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    setLoading(true);
    const [custRes, vehRes, poRes] = await Promise.all([
      supabase.from('customers').select('*').eq('active', true).order('name'),
      supabase.from('vehicles').select('*').eq('active', true),
      supabase.from('purchase_orders').select('*, customer:customers(name,address,phone,email,gstin)').order('created_at', { ascending: false }),
    ]);
    setCustomers((custRes.data ?? []) as Customer[]);
    setVehicles((vehRes.data ?? []) as Vehicle[]);
    setPos((poRes.data ?? []) as PoWithCustomer[]);
    setLoading(false);
  }

  const vehicleTypeOptions = useMemo(() => {
    const seen = new Map<string, number>();
    vehicles.forEach(v => {
      const label = poVehicleTypeLabel(v);
      if (!label) return;
      const tonsNum = Number(label.replace(/[^0-9.]/g, ''));
      seen.set(label, isNaN(tonsNum) ? Infinity : tonsNum);
    });
    return Array.from(seen.entries()).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([label]) => label);
  }, [vehicles]);

  const posWithStatus = useMemo(() => pos.map(p => ({ ...p, effectiveStatus: getEffectivePoStatus(p) })), [pos]);

  const alertCounts = useMemo(() => ({
    lowBalance: posWithStatus.filter(isPoLowBalance).length,
    expired: posWithStatus.filter(p => p.effectiveStatus === 'Expired').length,
    completed: posWithStatus.filter(p => p.effectiveStatus === 'Completed').length,
    active: posWithStatus.filter(p => p.effectiveStatus === 'Active').length,
  }), [posWithStatus]);

  const filteredPos = useMemo(() => posWithStatus.filter(p => {
    if (filterCustomerId && p.customer_id !== filterCustomerId) return false;
    if (filterPoNumber.trim() && !p.po_number.toLowerCase().includes(filterPoNumber.trim().toLowerCase())) return false;
    if (filterDate && p.po_date !== filterDate) return false;
    if (filterStatus === 'LowBalance') { if (!isPoLowBalance(p)) return false; }
    else if (filterStatus !== 'All' && p.effectiveStatus !== filterStatus) return false;
    return true;
  }), [posWithStatus, filterCustomerId, filterPoNumber, filterDate, filterStatus]);

  // ---------------- Create / Edit form ----------------

  function openCreate() {
    setEditingId(null);
    setFormCustomerId(filterCustomerId || '');
    setFormPoNumber('');
    setFormPoDate(todayISO());
    setFormValidFrom('');
    setFormValidTo('');
    setFormItems([emptyItemDraft()]);
    setFormOpen(true);
  }

  async function openEdit(po: PoWithCustomer) {
    const { data, error } = await supabase.from('purchase_order_items').select('*').eq('purchase_order_id', po.id).order('sl_no');
    if (error) { show(error.message, 'error'); return; }
    setEditingId(po.id);
    setFormCustomerId(po.customer_id);
    setFormPoNumber(po.po_number);
    setFormPoDate(po.po_date);
    setFormValidFrom(po.valid_from ?? '');
    setFormValidTo(po.valid_to ?? '');
    const items = (data ?? []) as PurchaseOrderItem[];
    setFormItems(items.length > 0
      ? items.map(it => ({ vehicleType: it.vehicle_type, remarks: it.remarks ?? '', quantity: String(it.quantity), unitRate: String(it.unit_rate) }))
      : [emptyItemDraft()]);
    setFormOpen(true);
  }

  const formItemsComputed = useMemo(() => formItems.map(it => computePoItemAmounts(Number(it.quantity) || 0, Number(it.unitRate) || 0)), [formItems]);
  const formTotals = useMemo(() => ({
    taxable: round2(formItemsComputed.reduce((s, c) => s + c.taxableAmount, 0)),
    cgst: round2(formItemsComputed.reduce((s, c) => s + c.cgstAmount, 0)),
    sgst: round2(formItemsComputed.reduce((s, c) => s + c.sgstAmount, 0)),
    grand: round2(formItemsComputed.reduce((s, c) => s + c.totalAmount, 0)),
  }), [formItemsComputed]);

  function updateFormItem(idx: number, patch: Partial<ItemDraft>) {
    setFormItems(items => items.map((it, i) => i === idx ? { ...it, ...patch } : it));
  }
  function addFormItem() {
    setFormItems(items => [...items, emptyItemDraft()]);
  }
  function removeFormItem(idx: number) {
    setFormItems(items => items.length > 1 ? items.filter((_, i) => i !== idx) : items);
  }

  async function savePo() {
    if (!formCustomerId) { show('Please select a customer.', 'error'); return; }
    if (!formPoNumber.trim()) { show('PO Number is required.', 'error'); return; }
    const validIdx: number[] = [];
    formItems.forEach((it, i) => { if (it.vehicleType && Number(it.quantity) > 0 && Number(it.unitRate) > 0) validIdx.push(i); });
    if (validIdx.length === 0) { show('Please add at least one PO item with Ton/Vehicle Type, Quantity and Rate.', 'error'); return; }

    setSavingForm(true);
    try {
      const taxableTotal = formTotals.taxable, cgstTotal = formTotals.cgst, sgstTotal = formTotals.sgst, grandTotal = formTotals.grand;
      let poId = editingId;
      if (editingId) {
        const existing = pos.find(p => p.id === editingId);
        const utilizedAmount = existing?.utilized_amount ?? 0;
        const remainingAmount = round2(grandTotal - utilizedAmount);
        const status = getEffectivePoStatus({ remaining_amount: remainingAmount, valid_to: formValidTo || null });
        const { error: updErr } = await supabase.from('purchase_orders').update({
          customer_id: formCustomerId, po_number: formPoNumber.trim(), po_date: formPoDate,
          valid_from: formValidFrom || null, valid_to: formValidTo || null,
          taxable_total: taxableTotal, cgst_total: cgstTotal, sgst_total: sgstTotal, grand_total: grandTotal,
          remaining_amount: remainingAmount, status, updated_at: new Date().toISOString(),
        }).eq('id', editingId);
        if (updErr) throw updErr;
        await supabase.from('purchase_order_items').delete().eq('purchase_order_id', editingId);
      } else {
        const { data: poRow, error: insErr } = await supabase.from('purchase_orders').insert({
          customer_id: formCustomerId, po_number: formPoNumber.trim(), po_date: formPoDate,
          valid_from: formValidFrom || null, valid_to: formValidTo || null,
          taxable_total: taxableTotal, cgst_total: cgstTotal, sgst_total: sgstTotal, grand_total: grandTotal,
          utilized_amount: 0, remaining_amount: grandTotal,
          status: getEffectivePoStatus({ remaining_amount: grandTotal, valid_to: formValidTo || null }),
        }).select('id').single();
        if (insErr) throw insErr;
        poId = poRow.id;
      }

      const rows = validIdx.map((i, order) => ({
        purchase_order_id: poId, sl_no: order + 1, vehicle_type: formItems[i].vehicleType,
        remarks: formItems[i].remarks.trim() || null,
        quantity: Number(formItems[i].quantity), unit_rate: Number(formItems[i].unitRate),
        taxable_amount: formItemsComputed[i].taxableAmount, cgst_amount: formItemsComputed[i].cgstAmount,
        sgst_amount: formItemsComputed[i].sgstAmount, total_amount: formItemsComputed[i].totalAmount,
      }));
      const { error: itemsErr } = await supabase.from('purchase_order_items').insert(rows);
      if (itemsErr) throw itemsErr;

      show(editingId ? 'Purchase Order updated successfully.' : 'Purchase Order created successfully.', 'success');
      setFormOpen(false);
      await fetchAll();
    } catch (e) {
      show(e instanceof Error ? e.message : 'Failed to save Purchase Order.', 'error');
    } finally {
      setSavingForm(false);
    }
  }

  // ---------------- Detail / Print / Export / Delete ----------------

  async function openDetail(po: PoWithCustomer) {
    setDetailPo(po);
    setDetailLoading(true);
    const [itemsRes, utilRes] = await Promise.all([
      supabase.from('purchase_order_items').select('*').eq('purchase_order_id', po.id).order('sl_no'),
      supabase.from('purchase_order_utilization').select('*').eq('purchase_order_id', po.id).order('created_at'),
    ]);
    setDetailItems((itemsRes.data ?? []) as PurchaseOrderItem[]);
    setDetailUtilization((utilRes.data ?? []) as PurchaseOrderUtilization[]);
    setDetailLoading(false);
  }

  async function fetchItemsFor(po: PoWithCustomer): Promise<PurchaseOrderItem[]> {
    const { data, error } = await supabase.from('purchase_order_items').select('*').eq('purchase_order_id', po.id).order('sl_no');
    if (error) { show(error.message, 'error'); return []; }
    return (data ?? []) as PurchaseOrderItem[];
  }

  async function handlePrint(po: PoWithCustomer) {
    const items = po.id === detailPo?.id && detailItems.length > 0 ? detailItems : await fetchItemsFor(po);
    const company = settings
      ? { company_name: settings.company_name, address: settings.address, phone: settings.phone, email: settings.email, gstin: settings.gstin, pan: settings.pan, signature_path: settings.signature_path, authorized_signatory: settings.authorized_signatory }
      : { company_name: 'Crane ERP' };
    printPurchaseOrder(company, po, po.customer?.name ?? '-', po.customer?.address, items);
  }

  async function handleExport(po: PoWithCustomer) {
    const items = po.id === detailPo?.id && detailItems.length > 0 ? detailItems : await fetchItemsFor(po);
    const company = settings
      ? { company_name: settings.company_name, address: settings.address, phone: settings.phone, email: settings.email, gstin: settings.gstin, pan: settings.pan }
      : { company_name: 'Crane ERP' };
    exportPurchaseOrderToExcel(company, po, po.customer?.name ?? '-', items);
  }

  async function handleDeleteConfirmed() {
    if (!deletePo) return;
    const { error } = await supabase.from('purchase_orders').delete().eq('id', deletePo.id);
    if (error) { show(error.message, 'error'); setDeletePo(null); return; }
    show('Purchase Order deleted.', 'success');
    setDeletePo(null);
    await fetchAll();
  }

  const statusVariant = (s: PurchaseOrderStatus) => s === 'Active' ? 'green' : s === 'Completed' ? 'gray' : 'red';

  const columns: Column<PoWithCustomer & { effectiveStatus: PurchaseOrderStatus }>[] = [
    { key: 'po_number', header: 'PO Number', sortable: true, render: r => <span className="font-semibold text-blue-700">{r.po_number}</span> },
    { key: 'customer', header: 'Customer', render: r => r.customer?.name ?? '-' },
    { key: 'po_date', header: 'PO Date', sortable: true, render: r => formatDate(r.po_date) },
    { key: 'grand_total', header: 'Grand Total', align: 'right', render: r => formatCurrency(r.grand_total) },
    { key: 'utilized_amount', header: 'Utilized', align: 'right', render: r => formatCurrency(r.utilized_amount) },
    { key: 'remaining_amount', header: 'Remaining', align: 'right', render: r => <span className={r.remaining_amount <= 0 ? 'text-slate-400' : isPoLowBalance(r) ? 'text-amber-600 font-bold' : 'text-emerald-700 font-semibold'}>{formatCurrency(r.remaining_amount)}</span> },
    { key: 'status', header: 'Status', align: 'center', render: r => <StatusBadge status={r.effectiveStatus} variant={statusVariant(r.effectiveStatus)} /> },
    {
      key: 'actions', header: 'Actions', align: 'center', render: r => (
        <div className="flex items-center justify-center gap-1">
          <button onClick={e => { e.stopPropagation(); openDetail(r); }} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md" title="View"><Eye className="w-4 h-4" /></button>
          <button onClick={e => { e.stopPropagation(); openEdit(r); }} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md" title="Edit"><Pencil className="w-4 h-4" /></button>
          <button onClick={e => { e.stopPropagation(); handlePrint(r); }} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md" title="Print"><Printer className="w-4 h-4" /></button>
          <button onClick={e => { e.stopPropagation(); handleExport(r); }} className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-md" title="Export Excel"><Download className="w-4 h-4" /></button>
          <button onClick={e => { e.stopPropagation(); setDeletePo(r); }} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md" title="Delete"><Trash2 className="w-4 h-4" /></button>
        </div>
      ),
    },
  ];

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2"><ClipboardList className="w-5 h-5 text-blue-600" />PO Orders</h1>
          <p className="text-sm text-slate-500 mt-0.5">Manage customer Purchase Orders and track their balance against GST invoices.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setRequestPoOpen(true)}><Mail className="w-4 h-4" />Request New PO</Button>
          <Button onClick={openCreate}><Plus className="w-4 h-4" />New PO Order</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Active POs" value={alertCounts.active} icon={CheckCircle2} color="emerald" onClick={() => setFilterStatus('Active')} />
        <KpiCard label="Low Balance POs" value={alertCounts.lowBalance} icon={AlertTriangle} color="amber" onClick={() => setFilterStatus('LowBalance')} />
        <KpiCard label="Expired POs" value={alertCounts.expired} icon={AlertTriangle} color="red" onClick={() => setFilterStatus('Expired')} />
        <KpiCard label="Completed POs" value={alertCounts.completed} icon={CheckCircle2} color="slate" onClick={() => setFilterStatus('Completed')} />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <Field label="Customer">
            <SearchableSelect value={filterCustomerId} onChange={setFilterCustomerId} options={[{ value: '', label: 'All Customers' }, ...customers.map(c => ({ value: c.id, label: c.name }))]} placeholder="All Customers" />
          </Field>
          <Field label="PO Number">
            <input type="text" className={inputClass()} value={filterPoNumber} onChange={e => setFilterPoNumber(e.target.value)} placeholder="Search PO Number" />
          </Field>
          <Field label="PO Date">
            <DatePicker value={filterDate} onChange={setFilterDate} />
          </Field>
          <Field label="Status">
            <select className={inputClass()} value={filterStatus} onChange={e => setFilterStatus(e.target.value as 'All' | PurchaseOrderStatus | 'LowBalance')}>
              <option value="All">All</option>
              <option value="Active">Active</option>
              <option value="LowBalance">Low Balance</option>
              <option value="Completed">Completed</option>
              <option value="Expired">Expired</option>
            </select>
          </Field>
          <div className="flex items-end">
            <Button variant="secondary" onClick={() => { setFilterCustomerId(''); setFilterPoNumber(''); setFilterDate(''); setFilterStatus('All'); }}>
              <X className="w-4 h-4" />Clear Filters
            </Button>
          </div>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={filteredPos}
        emptyMessage="No Purchase Orders found."
        onRowClick={openDetail}
      />

      {/* Create / Edit PO Modal */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingId ? 'Edit PO Order' : 'New PO Order'}
        size="2xl"
        footer={<>
          <Button variant="secondary" onClick={() => setFormOpen(false)}>Cancel</Button>
          <Button onClick={savePo} disabled={savingForm}>{savingForm ? 'Saving...' : 'Save PO'}</Button>
        </>}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Customer" required>
              <SearchableSelect value={formCustomerId} onChange={setFormCustomerId} options={customers.map(c => ({ value: c.id, label: c.name }))} placeholder="Select customer" />
            </Field>
            <Field label="PO Number" required>
              <input type="text" className={inputClass()} value={formPoNumber} onChange={e => setFormPoNumber(e.target.value)} placeholder="e.g. PO-1234" />
            </Field>
            <Field label="PO Date" required>
              <DatePicker value={formPoDate} onChange={setFormPoDate} />
            </Field>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">PO Items</p>
              <Button variant="outline" size="sm" onClick={addFormItem}><Plus className="w-3.5 h-3.5" />Add Item</Button>
            </div>
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-xs uppercase text-slate-600">
                    <th className="px-2 py-2 text-center">Sl.No</th>
                    <th className="px-2 py-2 text-left">Ton / Vehicle Type</th>
                    <th className="px-2 py-2 text-left">Remarks</th>
                    <th className="px-2 py-2 text-center">Quantity</th>
                    <th className="px-2 py-2 text-right">Rate</th>
                    <th className="px-2 py-2 text-right">Taxable</th>
                    <th className="px-2 py-2 text-right">CGST {PO_CGST_PERCENT}%</th>
                    <th className="px-2 py-2 text-right">SGST {PO_SGST_PERCENT}%</th>
                    <th className="px-2 py-2 text-right">Total</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {formItems.map((it, idx) => (
                    <tr key={idx} className="border-t border-slate-100">
                      <td className="px-2 py-1.5 text-center text-slate-500">{idx + 1}</td>
                      <td className="px-2 py-1.5">
                        <select className={inputClass()} value={it.vehicleType} onChange={e => updateFormItem(idx, { vehicleType: e.target.value })}>
                          <option value="">Select...</option>
                          {vehicleTypeOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1.5 w-36">
                        <input type="text" className={inputClass()} value={it.remarks} onChange={e => updateFormItem(idx, { remarks: e.target.value })} placeholder="Optional" />
                      </td>
                      <td className="px-2 py-1.5 w-24">
                        <input type="number" min="0" step="1" className={inputClass()} value={it.quantity} onChange={e => updateFormItem(idx, { quantity: e.target.value })} />
                      </td>
                      <td className="px-2 py-1.5 w-32">
                        <input type="number" min="0" step="0.01" className={inputClass()} value={it.unitRate} onChange={e => updateFormItem(idx, { unitRate: e.target.value })} />
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(formItemsComputed[idx]?.taxableAmount ?? 0)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(formItemsComputed[idx]?.cgstAmount ?? 0)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(formItemsComputed[idx]?.sgstAmount ?? 0)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{formatCurrency(formItemsComputed[idx]?.totalAmount ?? 0)}</td>
                      <td className="px-2 py-1.5 text-center">
                        <button onClick={() => removeFormItem(idx)} className="p-1 text-slate-400 hover:text-red-600" title="Remove"><Trash2 className="w-4 h-4" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-end">
            <div className="w-64 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Total Taxable</span><b className="tabular-nums">{formatCurrency(formTotals.taxable)}</b></div>
              <div className="flex justify-between"><span className="text-slate-500">Total CGST</span><b className="tabular-nums">{formatCurrency(formTotals.cgst)}</b></div>
              <div className="flex justify-between"><span className="text-slate-500">Total SGST</span><b className="tabular-nums">{formatCurrency(formTotals.sgst)}</b></div>
              <div className="flex justify-between pt-1.5 border-t border-slate-200 text-base"><span className="font-bold text-slate-800">Grand Total</span><b className="tabular-nums text-blue-700">{formatCurrency(formTotals.grand)}</b></div>
            </div>
          </div>
        </div>
      </Modal>

      {/* Detail Modal */}
      <Modal open={!!detailPo} onClose={() => setDetailPo(null)} title={`PO Order - ${detailPo?.po_number ?? ''}`} size="2xl"
        footer={detailPo ? <>
          <Button variant="outline" onClick={() => handlePrint(detailPo)}><Printer className="w-4 h-4" />Print</Button>
          <Button variant="outline" onClick={() => handleExport(detailPo)}><Download className="w-4 h-4" />Export Excel</Button>
        </> : undefined}
      >
        {detailPo && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200 text-sm">
              <div><span className="text-slate-500">Customer: </span><b>{detailPo.customer?.name ?? '-'}</b></div>
              <div><span className="text-slate-500">PO Number: </span><b>{detailPo.po_number}</b></div>
              <div><span className="text-slate-500">PO Date: </span><b>{formatDate(detailPo.po_date)}</b></div>
              <div><span className="text-slate-500">Status: </span><StatusBadge status={getEffectivePoStatus(detailPo)} variant={statusVariant(getEffectivePoStatus(detailPo))} /></div>
              <div><span className="text-slate-500">PO Amount: </span><b>{formatCurrency(detailPo.grand_total)}</b></div>
              <div><span className="text-slate-500">Utilized: </span><b>{formatCurrency(detailPo.utilized_amount)}</b></div>
              <div><span className="text-slate-500">Remaining: </span><b className={detailPo.remaining_amount <= 0 ? 'text-slate-500' : 'text-emerald-700'}>{formatCurrency(detailPo.remaining_amount)}</b></div>
              <div><span className="text-slate-500">Validity: </span><b>{detailPo.valid_from ? formatDate(detailPo.valid_from) : '-'} to {detailPo.valid_to ? formatDate(detailPo.valid_to) : '-'}</b></div>
            </div>

            {detailLoading ? <LoadingSpinner size="sm" /> : (
              <>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">PO Items</p>
                  <div className="overflow-x-auto border border-slate-200 rounded-lg">
                    <table className="w-full text-sm">
                      <thead><tr className="bg-slate-50 text-xs uppercase text-slate-600">
                        <th className="px-2 py-2 text-center">Sl.No</th><th className="px-2 py-2 text-left">Ton / Vehicle Type</th>
                        <th className="px-2 py-2 text-left">Remarks</th>
                        <th className="px-2 py-2 text-center">Qty</th><th className="px-2 py-2 text-right">Rate</th>
                        <th className="px-2 py-2 text-right">Taxable</th><th className="px-2 py-2 text-right">CGST</th>
                        <th className="px-2 py-2 text-right">SGST</th><th className="px-2 py-2 text-right">Total</th>
                      </tr></thead>
                      <tbody>
                        {detailItems.map(it => (
                          <tr key={it.id} className="border-t border-slate-100">
                            <td className="px-2 py-1.5 text-center">{it.sl_no}</td>
                            <td className="px-2 py-1.5">{it.vehicle_type}</td>
                            <td className="px-2 py-1.5 text-slate-500">{it.remarks ?? '-'}</td>
                            <td className="px-2 py-1.5 text-center">{it.quantity}</td>
                            <td className="px-2 py-1.5 text-right">{formatCurrency(it.unit_rate)}</td>
                            <td className="px-2 py-1.5 text-right">{formatCurrency(it.taxable_amount)}</td>
                            <td className="px-2 py-1.5 text-right">{formatCurrency(it.cgst_amount)}</td>
                            <td className="px-2 py-1.5 text-right">{formatCurrency(it.sgst_amount)}</td>
                            <td className="px-2 py-1.5 text-right font-semibold">{formatCurrency(it.total_amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot><tr className="bg-slate-50 font-bold border-t-2 border-slate-200">
                        <td colSpan={5} className="px-2 py-2">TOTAL</td>
                        <td className="px-2 py-2 text-right">{formatCurrency(detailPo.taxable_total)}</td>
                        <td className="px-2 py-2 text-right">{formatCurrency(detailPo.cgst_total)}</td>
                        <td className="px-2 py-2 text-right">{formatCurrency(detailPo.sgst_total)}</td>
                        <td className="px-2 py-2 text-right">{formatCurrency(detailPo.grand_total)}</td>
                      </tr></tfoot>
                    </table>
                  </div>
                </div>

                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">PO Utilization History</p>
                  {detailUtilization.length === 0 ? (
                    <p className="text-sm text-slate-400 italic px-2 py-4 text-center border border-slate-200 rounded-lg">No GST invoices have drawn against this PO yet.</p>
                  ) : (
                    <div className="overflow-x-auto border border-slate-200 rounded-lg">
                      <table className="w-full text-sm">
                        <thead><tr className="bg-slate-50 text-xs uppercase text-slate-600">
                          <th className="px-2 py-2 text-left">Invoice Number</th><th className="px-2 py-2 text-left">Invoice Date</th>
                          <th className="px-2 py-2 text-right">Invoice Amount</th><th className="px-2 py-2 text-right">Balance After Invoice</th>
                        </tr></thead>
                        <tbody>
                          {detailUtilization.map(u => (
                            <tr key={u.id} className="border-t border-slate-100">
                              <td className="px-2 py-1.5 font-medium text-blue-700">{u.invoice_number ?? '-'}</td>
                              <td className="px-2 py-1.5">{u.invoice_date ? formatDate(u.invoice_date) : '-'}</td>
                              <td className="px-2 py-1.5 text-right">{formatCurrency(u.utilized_amount)}</td>
                              <td className="px-2 py-1.5 text-right font-semibold">{formatCurrency(u.balance_after)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deletePo}
        onClose={() => setDeletePo(null)}
        onConfirm={handleDeleteConfirmed}
        title="Delete Purchase Order?"
        message={`This will permanently delete PO "${deletePo?.po_number}" and its full item/utilization history. This cannot be undone.`}
        confirmText="Delete"
        danger
      />

      <PoRequestModal
        open={requestPoOpen}
        onClose={() => setRequestPoOpen(false)}
        customers={customers}
      />
    </div>
  );
}
