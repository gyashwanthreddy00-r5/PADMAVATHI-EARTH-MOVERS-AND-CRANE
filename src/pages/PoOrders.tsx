import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/Toast';
import { useSettings } from '@/context/SettingsContext';
import { Field, Button, inputClass, LoadingSpinner, ConfirmDialog, StatusBadge } from '@/components/ui/common';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { DatePicker } from '@/components/ui/DatePicker';
import { formatCurrency, formatDate, todayISO, classNames, vehicleTypeLabel } from '@/lib/utils';
import { findRateMasterForVehicle, normalizeCapacity } from '@/lib/rateLookup';
import { computePoLineAmounts, round2 } from '@/lib/poOrdersCalc';
import { printPoWorkingData, exportPoWorkingDataToExcel } from '@/lib/poOrdersExport';
import { Plus, Trash2, AlertTriangle, FileSpreadsheet, ArrowLeft, Printer, Download, Save } from 'lucide-react';
import type { Customer, RateMaster, PoOrder, PoWorkingRecord, PoRateType, Vehicle } from '@/types';

type VehicleLite = Pick<Vehicle, 'id' | 'registration_number' | 'tons' | 'type' | 'capacity' | 'model'>;

const RATE_TYPE_LABEL: Record<PoRateType, string> = { Daily: 'Full Day', Hourly: 'Hourly' };

export default function PoOrders() {
  const { show } = useToast();
  const { settings } = useSettings();

  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'select' | 'billing'>('select');

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [vehicles, setVehicles] = useState<VehicleLite[]>([]);
  const [rateMasterRows, setRateMasterRows] = useState<RateMaster[]>([]);

  const [poOrders, setPoOrders] = useState<PoOrder[]>([]);
  const [workingCounts, setWorkingCounts] = useState<Map<string, number>>(new Map());

  const [activePoOrder, setActivePoOrder] = useState<PoOrder | null>(null);
  const [draftPoNumber, setDraftPoNumber] = useState('');
  const [draftPoDate, setDraftPoDate] = useState(todayISO());
  const [savingPO, setSavingPO] = useState(false);

  const [records, setRecords] = useState<PoWorkingRecord[]>([]);

  // PO-level Invoice Number / Bill Date - applied to every working record. Manually
  // entered by the user (no auto-generation) before the PO can be marked Completed.
  const [invoiceNumberDraft, setInvoiceNumberDraft] = useState('');
  const [billDateDraft, setBillDateDraft] = useState('');
  const [savingInvoiceDetails, setSavingInvoiceDetails] = useState(false);

  // Working Day Entry form (single step)
  const [entDate, setEntDate] = useState('');
  const [entVehicleId, setEntVehicleId] = useState('');
  const [entVlNo, setEntVlNo] = useState('');
  const [entRateType, setEntRateType] = useState<PoRateType>('Hourly');
  const [entHours, setEntHours] = useState('');
  const [entMinutes, setEntMinutes] = useState('');
  const [savingRecord, setSavingRecord] = useState(false);

  const [deleteRecordId, setDeleteRecordId] = useState<string | null>(null);
  const [deletePoOrder, setDeletePoOrder] = useState<PoOrder | null>(null);

  useEffect(() => { fetchCustomers(); fetchVehicles(); fetchRateMaster(); }, []);
  useEffect(() => {
    if (!customerId) return;
    setView('select');
    setActivePoOrder(null);
    fetchPoOrders();
    fetchWorkingCounts();
  }, [customerId]);

  async function fetchCustomers() {
    const { data, error } = await supabase.from('customers').select('id,name').eq('active', true).order('name');
    if (error) { show(error.message, 'error'); setLoading(false); return; }
    const list = (data ?? []) as Customer[];
    setCustomers(list);
    setCustomerId(prev => prev || (list[0]?.id ?? ''));
    setLoading(false);
  }

  async function fetchVehicles() {
    // Every active vehicle, regardless of whether Ton is set on the Vehicle Master
    // record - findRateMasterForVehicle (rateLookup.ts) matches by vehicle type
    // (JCB) or the `capacity` text field (Crane), never by `tons`, so requiring
    // `tons` to be non-null here was hiding vehicles - JCBs especially, which
    // typically have no Ton value at all - that would otherwise get a valid rate.
    const { data, error } = await supabase.from('vehicles').select('id,registration_number,tons,type,capacity,model').eq('active', true).order('registration_number');
    if (error) { show(error.message, 'error'); return; }
    setVehicles((data ?? []) as VehicleLite[]);
  }

  async function fetchRateMaster() {
    const { data, error } = await supabase.from('rate_master').select('*');
    if (error) { show(error.message, 'error'); return; }
    setRateMasterRows((data ?? []) as RateMaster[]);
  }

  async function fetchPoOrders() {
    const { data, error } = await supabase.from('po_orders').select('*').eq('customer_id', customerId).order('created_at', { ascending: false });
    if (error) { show(error.message, 'error'); return; }
    setPoOrders((data ?? []) as PoOrder[]);
  }

  async function fetchWorkingCounts() {
    const { data, error } = await supabase.from('po_working_records').select('po_order_id').eq('customer_id', customerId);
    if (error) { show(error.message, 'error'); return; }
    const map = new Map<string, number>();
    (data ?? []).forEach((r: { po_order_id: string }) => map.set(r.po_order_id, (map.get(r.po_order_id) ?? 0) + 1));
    setWorkingCounts(map);
  }

  async function fetchRecords(poOrderId: string) {
    const { data, error } = await supabase.from('po_working_records').select('*').eq('po_order_id', poOrderId).order('working_date');
    if (error) { show(error.message, 'error'); return; }
    setRecords((data ?? []) as PoWorkingRecord[]);
  }

  const customerName = customers.find(c => c.id === customerId)?.name ?? '';
  const vehiclesById = useMemo(() => new Map(vehicles.map(v => [v.id, v])), [vehicles]);

  function rateFor(vehicleId: string, workingDate: string): RateMaster | null {
    const v = vehiclesById.get(vehicleId);
    if (!v) return null;
    return findRateMasterForVehicle({ type: v.type, capacity: v.capacity }, rateMasterRows, workingDate);
  }

  // ---------------- Page 1 ----------------

  function openExistingPO(po: PoOrder) {
    setActivePoOrder(po);
    resetEntryForm();
    setInvoiceNumberDraft(po.invoice_number ?? '');
    setBillDateDraft(po.bill_date ?? '');
    fetchRecords(po.id);
    setView('billing');
  }

  function startNewPO() {
    setActivePoOrder(null);
    setDraftPoNumber(''); setDraftPoDate(todayISO());
    setRecords([]);
    setInvoiceNumberDraft(''); setBillDateDraft('');
    resetEntryForm();
    setView('billing');
  }

  function goBackToList() {
    setView('select');
    setActivePoOrder(null);
    fetchPoOrders();
    fetchWorkingCounts();
  }

  async function createPO() {
    if (!draftPoNumber.trim() || !draftPoDate) { show('PO Number and PO Date are required.', 'error'); return; }
    setSavingPO(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.from('po_orders').insert({
      customer_id: customerId,
      po_number: draftPoNumber.trim(),
      po_date: draftPoDate,
      created_by: user?.id ?? null,
    }).select().single();
    if (error) {
      show(error.code === '23505' ? 'A PO with this number already exists for this customer.' : error.message, 'error');
    } else {
      const po = data as PoOrder;
      setActivePoOrder(po);
      fetchRecords(po.id);
      show('PO Order created.', 'success');
      fetchPoOrders();
    }
    setSavingPO(false);
  }

  async function togglePoStatus() {
    if (!activePoOrder) return;
    if (activePoOrder.status === 'Active') {
      // Completing a PO requires at least one Working Day, an Invoice Number and a
      // Bill Date - all validated up front (friendly messages) before any status
      // change or database write, and saved atomically with it so the PO is never
      // marked Completed without them.
      if (records.length === 0) {
        show('Please add at least one Working Day.', 'error');
        return;
      }
      if (!invoiceNumberDraft.trim()) {
        show('Please enter the Invoice Number before completing this PO.', 'error');
        return;
      }
      if (!billDateDraft) {
        show('Please select the Bill Date.', 'error');
        return;
      }
      setSavingInvoiceDetails(true);
      const payload = { invoice_number: invoiceNumberDraft.trim(), bill_date: billDateDraft || null, status: 'Completed' as const };
      const { error } = await supabase.from('po_orders').update(payload).eq('id', activePoOrder.id);
      setSavingInvoiceDetails(false);
      if (error) { show(error.message, 'error'); return; }
      setActivePoOrder({ ...activePoOrder, ...payload });
      show('PO marked Completed.', 'success');
      fetchPoOrders();
      return;
    }
    const { error } = await supabase.from('po_orders').update({ status: 'Active' }).eq('id', activePoOrder.id);
    if (error) { show(error.message, 'error'); return; }
    setActivePoOrder({ ...activePoOrder, status: 'Active' });
    show('PO marked Active.', 'success');
    fetchPoOrders();
  }

  async function handleDeletePoOrder() {
    if (!deletePoOrder) return;
    const { error } = await supabase.from('po_orders').delete().eq('id', deletePoOrder.id);
    if (error) show(error.message, 'error');
    else {
      show(`PO ${deletePoOrder.po_number} deleted.`, 'success');
      fetchPoOrders();
      fetchWorkingCounts();
    }
    setDeletePoOrder(null);
  }

  // ---------------- Working Day Entry (single step) ----------------

  function resetEntryForm() {
    setEntDate(''); setEntVehicleId(''); setEntVlNo(''); setEntRateType('Hourly'); setEntHours(''); setEntMinutes('');
  }

  const selectedEntVehicle = entVehicleId ? vehiclesById.get(entVehicleId) ?? null : null;
  const entRate = (entDate && entVehicleId) ? rateFor(entVehicleId, entDate) : null;
  const entCalc = (entDate && entVehicleId)
    ? computePoLineAmounts(entRateType, entRateType === 'Daily' ? 0 : Number(entHours) || 0, entRateType === 'Daily' ? 0 : Number(entMinutes) || 0, entRate)
    : null;
  const canAddRecord = !!(activePoOrder && entDate && entVehicleId && entVlNo.trim() && (entRateType === 'Daily' || entHours !== '' || entMinutes !== '') && entCalc?.rateFound);

  async function addWorkingRecord() {
    if (!selectedEntVehicle || !activePoOrder || !entCalc || !entCalc.rateFound) return;
    setSavingRecord(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('po_working_records').insert({
      po_order_id: activePoOrder.id,
      customer_id: customerId,
      working_date: entDate,
      vehicle_id: selectedEntVehicle.id,
      vehicle_number: selectedEntVehicle.registration_number,
      // po_working_records.ton is NOT NULL - vehicles without a numeric Ton set (e.g.
      // most JCBs, which don't need one for rate lookup at all) fall back to whatever
      // number is in their capacity text, then to 0, rather than failing to save.
      ton: selectedEntVehicle.tons ?? (Number(normalizeCapacity(selectedEntVehicle.capacity)) || 0),
      vl_no: entVlNo.trim(),
      rate_type: entRateType,
      hours: entRateType === 'Daily' ? 0 : Number(entHours) || 0,
      minutes: entRateType === 'Daily' ? 0 : Number(entMinutes) || 0,
      first_hour_rate: entCalc.firstRate,
      second_hour_rate: entCalc.secondRate,
      first_hour_amount: entCalc.firstAmt,
      second_hour_amount: entCalc.secondAmt,
      subtotal: entCalc.subtotal,
      gst_amount: entCalc.gstAmount,
      total_amount: entCalc.totalAmount,
      created_by: user?.id ?? null,
    });
    if (error) show(error.message, 'error');
    else {
      show('Working day added.', 'success');
      resetEntryForm();
      fetchRecords(activePoOrder.id);
    }
    setSavingRecord(false);
  }

  async function handleDeleteRecord() {
    if (!deleteRecordId || !activePoOrder) return;
    const { error } = await supabase.from('po_working_records').delete().eq('id', deleteRecordId);
    if (error) show(error.message, 'error');
    else {
      show('Working record removed.', 'success');
      fetchRecords(activePoOrder.id);
    }
    setDeleteRecordId(null);
  }

  // ---------------- PO-level Invoice Number / Bill Date ----------------
  // Entered once at the end and applied to every working record under this PO -
  // not stored per row, so editing it here updates it everywhere at once
  // (in the table, Print, and Excel export) without touching individual records.

  async function saveInvoiceDetails() {
    if (!activePoOrder) return;
    setSavingInvoiceDetails(true);
    const payload = {
      invoice_number: invoiceNumberDraft.trim() || null,
      bill_date: billDateDraft || null,
    };
    const { error } = await supabase.from('po_orders').update(payload).eq('id', activePoOrder.id);
    if (error) show(error.message, 'error');
    else {
      setActivePoOrder({ ...activePoOrder, ...payload });
      show('Invoice details saved.', 'success');
    }
    setSavingInvoiceDetails(false);
  }

  // ---------------- Totals ----------------

  const totals = useMemo(() => ({
    subtotal: round2(records.reduce((s, r) => s + (r.subtotal ?? 0), 0)),
    gst: round2(records.reduce((s, r) => s + (r.gst_amount ?? 0), 0)),
    grand: round2(records.reduce((s, r) => s + (r.total_amount ?? 0), 0)),
  }), [records]);

  const needsRecompute = useMemo(() => records.filter(r => r.total_amount == null), [records]);

  function handlePrint() {
    if (!activePoOrder) return;
    printPoWorkingData({ companyName: settings?.company_name ?? 'Company', companyAddress: settings?.address, companyGstin: settings?.gstin, customerName, poNumber: activePoOrder.po_number, invoiceNumber: activePoOrder.invoice_number, billDate: activePoOrder.bill_date }, records);
  }
  function handleExport() {
    if (!activePoOrder) return;
    exportPoWorkingDataToExcel({ companyName: settings?.company_name ?? 'Company', companyAddress: settings?.address, companyGstin: settings?.gstin, customerName, poNumber: activePoOrder.po_number, invoiceNumber: activePoOrder.invoice_number, billDate: activePoOrder.bill_date }, records);
  }

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2"><FileSpreadsheet className="w-5 h-5 text-blue-600" /> PO Orders</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {view === 'select' ? 'Select a customer to see their PO Orders, or start a new one.' : 'Maintain working-day billing data, then print or export it - this does not create a Customer Invoice.'}
          </p>
        </div>
      </div>

      {view === 'select' ? (
        <>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex flex-col gap-1 max-w-md">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Customer Name</label>
              <SearchableSelect value={customerId} onChange={setCustomerId} options={customers.map(c => ({ value: c.id, label: c.name }))} placeholder="Select customer" />
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <p className="text-sm font-bold text-slate-700">Recent PO Orders {customerName && `- ${customerName}`}</p>
              <Button onClick={startNewPO} disabled={!customerId}><Plus className="w-4 h-4" />New PO Order</Button>
            </div>
            {poOrders.length === 0 ? (
              <p className="text-sm text-slate-400 italic px-4 py-8 text-center">No PO Orders yet for {customerName || 'this customer'}. Click "New PO Order" to create one.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-200">
                      <th className="py-2 px-4">PO / Order No.</th>
                      <th className="py-2 px-4">PO Date</th>
                      <th className="py-2 px-4 text-center">Working Records</th>
                      <th className="py-2 px-4">Status</th>
                      <th className="py-2 px-4"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {poOrders.map(po => (
                      <tr key={po.id} className="border-b border-slate-100">
                        <td className="py-2 px-4 font-semibold text-slate-800">{po.po_number}</td>
                        <td className="py-2 px-4">{formatDate(po.po_date)}</td>
                        <td className="py-2 px-4 text-center tabular-nums">{workingCounts.get(po.id) ?? 0}</td>
                        <td className="py-2 px-4"><StatusBadge status={po.status} variant={po.status === 'Active' ? 'green' : 'blue'} /></td>
                        <td className="py-2 px-4 text-right">
                          <div className="flex justify-end items-center gap-1.5">
                            <Button size="sm" variant="outline" onClick={() => openExistingPO(po)}>Open PO</Button>
                            <button onClick={() => setDeletePoOrder(po)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md" title="Delete PO">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <button onClick={goBackToList} className="flex items-center gap-1.5 text-sm font-semibold text-blue-700 hover:text-blue-800">
            <ArrowLeft className="w-4 h-4" />Back to PO Orders
          </button>

          <div className="bg-white border border-slate-200 rounded-xl p-4">
            {activePoOrder ? (
              <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
                <div><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Customer</p><p className="text-sm font-semibold text-slate-800">{customerName}</p></div>
                <div><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">PO Order</p><p className="text-sm font-semibold text-slate-800">{activePoOrder.po_number}</p></div>
                <div><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">PO Date</p><p className="text-sm text-slate-700">{formatDate(activePoOrder.po_date)}</p></div>
                <div className="ml-auto flex items-center gap-3">
                  <StatusBadge status={activePoOrder.status} variant={activePoOrder.status === 'Active' ? 'green' : 'blue'} />
                  <Button size="sm" variant="secondary" onClick={togglePoStatus} disabled={savingInvoiceDetails}>{activePoOrder.status === 'Active' ? 'Complete PO' : 'Reopen PO'}</Button>
                </div>
              </div>
            ) : (
              <>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-3">New PO Order - {customerName}</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
                  <Field label="PO / Order No." required>
                    <input type="text" className={inputClass()} value={draftPoNumber} onChange={e => setDraftPoNumber(e.target.value)} placeholder="e.g. PO-003" />
                  </Field>
                  <Field label="PO Date" required>
                    <DatePicker value={draftPoDate} onChange={setDraftPoDate} />
                  </Field>
                </div>
                <div className="flex justify-end mt-3">
                  <Button onClick={createPO} disabled={savingPO}>{savingPO ? 'Creating...' : 'Create PO Order'}</Button>
                </div>
              </>
            )}
          </div>

          {activePoOrder && (
            <>
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-3">Add Working Day</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 items-end">
                  <Field label="Working Date" required>
                    <DatePicker value={entDate} onChange={setEntDate} />
                  </Field>
                  <Field label="Vehicle" required>
                    {/* Options panel widened beyond the (narrow, 1-of-6-column) field
                        itself so "REG.NO - N Ton"/"REG.NO - JCB" never gets truncated —
                        the field/trigger's own width, styling and search behavior are
                        unchanged. searchText lets the search box match on type/model/
                        capacity too (e.g. "JCB", "Hydra", "14"), not just what's shown
                        in the label. */}
                    <SearchableSelect
                      value={entVehicleId}
                      onChange={setEntVehicleId}
                      options={vehicles.map(v => ({
                        value: v.id,
                        label: `${v.registration_number} - ${vehicleTypeLabel(v.type, v.tons ?? v.capacity)}`,
                        searchText: [v.registration_number, v.type, v.model, v.capacity, v.tons].filter(Boolean).join(' '),
                      }))}
                      placeholder="Select vehicle"
                      emptyText="No active vehicles found"
                      dropdownClassName="min-w-full w-max max-w-xs"
                    />
                  </Field>
                  <Field label="Ton">
                    <div className={classNames(inputClass(), 'bg-slate-100 text-slate-500 tabular-nums')}>{selectedEntVehicle ? (selectedEntVehicle.tons != null ? `${selectedEntVehicle.tons} Ton` : (selectedEntVehicle.capacity || '-')) : '-'}</div>
                  </Field>
                  <Field label="VL No" required>
                    <input type="text" className={inputClass()} value={entVlNo} onChange={e => setEntVlNo(e.target.value)} placeholder="Type VL No" />
                  </Field>
                  <Field label="Rate Type" required>
                    <select className={inputClass()} value={entRateType} onChange={e => setEntRateType(e.target.value as PoRateType)}>
                      <option value="Hourly">Hourly</option>
                      <option value="Daily">Full Day</option>
                    </select>
                  </Field>
                  {entRateType === 'Hourly' ? (
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Hours"><input type="number" min="0" className={inputClass()} value={entHours} onChange={e => setEntHours(e.target.value)} placeholder="3" /></Field>
                      <Field label="Minutes"><input type="number" min="0" max="59" className={inputClass()} value={entMinutes} onChange={e => setEntMinutes(e.target.value)} placeholder="20" /></Field>
                    </div>
                  ) : (
                    <div className="flex items-center text-sm text-slate-400 italic">Full day - billed at the Rate Master's Daily Rate.</div>
                  )}
                </div>

                {entVehicleId && entDate && (
                  <div className="flex flex-wrap gap-4 mt-3 text-sm">
                    {entCalc?.rateFound ? (
                      entRateType === 'Daily' ? (
                        <span className="text-emerald-700 font-semibold">Full Day Amount: {formatCurrency(entCalc.subtotal)}</span>
                      ) : (
                        <>
                          <span className="text-slate-500">First Hour Amount: <b className="text-slate-800">{formatCurrency(entCalc.firstAmt)}</b></span>
                          <span className="text-slate-500">Additional Amount: <b className="text-slate-800">{formatCurrency(entCalc.secondAmt)}</b></span>
                          <span className="text-emerald-700 font-semibold">Subtotal: {formatCurrency(entCalc.subtotal)}</span>
                        </>
                      )
                    ) : (
                      <span className="text-red-600 font-semibold flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" />Rate not found in Rate Master for this customer and vehicle{entRateType === 'Daily' ? ' (Daily Rate)' : ''}. Add it to Rate Master before adding this working day.</span>
                    )}
                  </div>
                )}

                <div className="flex justify-end mt-3">
                  <Button onClick={addWorkingRecord} disabled={!canAddRecord || savingRecord}><Plus className="w-4 h-4" />{savingRecord ? 'Adding...' : 'Add Working Day'}</Button>
                </div>
              </div>

              {needsRecompute.length > 0 && (
                <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{needsRecompute.length} row{needsRecompute.length > 1 ? 's were' : ' was'} entered before rate snapshots were stored and show blank amounts. Delete and re-add {needsRecompute.length > 1 ? 'them' : 'it'} to recompute.</span>
                </div>
              )}

              <div className="overflow-x-auto border border-slate-200 rounded-xl bg-white">
                <table className="w-full text-sm border-collapse min-w-[1600px]">
                  <thead>
                    <tr className="bg-amber-50">
                      {['Sl.No', 'Working Date', 'Ton', 'Vehicle No', 'VL No', 'Rate Type', 'HR', 'MIN', 'First Hour Rate', 'Second Hour Rate', 'First Hour Amt', 'Second Hr Amt', 'Total Amt', 'Invoice Number', 'Bill Date', 'GST 18 %', 'TOTAL AMT', ''].map((h, i) => (
                        <th key={i} className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-wide text-slate-700 border border-amber-100 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {records.length === 0 ? (
                      <tr><td colSpan={18} className="py-10 text-center text-slate-400">No working days added to this PO yet.</td></tr>
                    ) : records.map((r, idx) => {
                      const isFullDay = r.rate_type === 'Daily';
                      const na = <span className="text-slate-300">-</span>;
                      return (
                        <tr key={r.id} className={idx % 2 ? 'bg-slate-50' : 'bg-white'}>
                          <td className="border border-slate-100 px-2 py-1.5 text-center tabular-nums">{idx + 1}</td>
                          <td className="border border-slate-100 px-2 py-1.5 text-center whitespace-nowrap">{formatDate(r.working_date)}</td>
                          <td className="border border-slate-100 px-2 py-1.5 text-center tabular-nums">{r.ton}</td>
                          <td className="border border-slate-100 px-2 py-1.5 text-center whitespace-nowrap">{r.vehicle_number}</td>
                          <td className="border border-slate-100 px-2 py-1.5 text-center">{r.vl_no}</td>
                          <td className="border border-slate-100 px-2 py-1.5 text-center">{RATE_TYPE_LABEL[r.rate_type]}</td>
                          <td className="border border-slate-100 px-2 py-1.5 text-center tabular-nums">{isFullDay ? na : r.hours}</td>
                          <td className="border border-slate-100 px-2 py-1.5 text-center tabular-nums">{isFullDay ? na : r.minutes}</td>
                          <td className="border border-slate-100 px-2 py-1.5 text-right tabular-nums">{isFullDay ? na : (r.first_hour_rate != null ? formatCurrency(r.first_hour_rate) : na)}</td>
                          <td className="border border-slate-100 px-2 py-1.5 text-right tabular-nums">{isFullDay ? na : (r.second_hour_rate != null ? formatCurrency(r.second_hour_rate) : na)}</td>
                          <td className="border border-slate-100 px-2 py-1.5 text-right tabular-nums">{isFullDay ? na : (r.first_hour_amount != null ? formatCurrency(r.first_hour_amount) : na)}</td>
                          <td className="border border-slate-100 px-2 py-1.5 text-right tabular-nums">{isFullDay ? na : (r.second_hour_amount != null ? formatCurrency(r.second_hour_amount) : na)}</td>
                          <td className="border border-slate-100 px-2 py-1.5 text-right tabular-nums font-semibold">{r.subtotal != null ? formatCurrency(r.subtotal) : na}</td>
                          <td className="border border-slate-100 px-2 py-1.5 text-center whitespace-nowrap text-slate-600">{activePoOrder?.invoice_number || <span className="text-slate-300">-</span>}</td>
                          <td className="border border-slate-100 px-2 py-1.5 text-center whitespace-nowrap text-slate-600">{activePoOrder?.bill_date ? formatDate(activePoOrder.bill_date) : <span className="text-slate-300">-</span>}</td>
                          <td className="border border-slate-100 px-2 py-1.5 text-right tabular-nums">{r.gst_amount != null ? formatCurrency(r.gst_amount) : na}</td>
                          <td className="border border-slate-100 px-2 py-1.5 text-right tabular-nums font-bold">{r.total_amount != null ? formatCurrency(r.total_amount) : na}</td>
                          <td className="border border-slate-100 px-2 py-1.5 text-center">
                            <button onClick={() => setDeleteRecordId(r.id)} className="p-1 text-slate-400 hover:text-red-600 rounded" title="Remove"><Trash2 className="w-3.5 h-3.5" /></button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-1">Invoice Details</p>
                  <p className="text-xs text-slate-400 mb-3">Enter the invoice number once you're ready to bill. Applies to every working-day row above. Required before this PO can be marked Completed.</p>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Invoice Number" required>
                      <input
                        type="text"
                        className={inputClass()}
                        value={invoiceNumberDraft}
                        onChange={e => setInvoiceNumberDraft(e.target.value)}
                        placeholder="Enter Invoice Number"
                      />
                    </Field>
                    <Field label="Bill Date">
                      <DatePicker value={billDateDraft} onChange={setBillDateDraft} />
                    </Field>
                  </div>
                  <div className="flex justify-end mt-3">
                    <Button variant="secondary" onClick={saveInvoiceDetails} disabled={savingInvoiceDetails}><Save className="w-4 h-4" />{savingInvoiceDetails ? 'Saving...' : 'Save Invoice Details'}</Button>
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between text-slate-500"><span>Working days</span><span className="font-semibold text-slate-800 tabular-nums">{records.length}</span></div>
                    <div className="flex justify-between text-slate-500"><span>Subtotal</span><span className="font-semibold text-slate-800 tabular-nums">{formatCurrency(totals.subtotal)}</span></div>
                    <div className="flex justify-between text-slate-500"><span>GST @ 18%</span><span className="font-semibold text-slate-800 tabular-nums">{formatCurrency(totals.gst)}</span></div>
                    <div className="flex justify-between pt-1.5 border-t border-dashed border-slate-200">
                      <span className="font-bold text-slate-700">Grand Total</span>
                      <span className="font-bold text-blue-700 tabular-nums">{formatCurrency(totals.grand)}</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <Button variant="outline" onClick={handlePrint} disabled={records.length === 0}><Printer className="w-4 h-4" />Print</Button>
                    <Button variant="outline" onClick={handleExport} disabled={records.length === 0}><Download className="w-4 h-4" />Excel</Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}

      <ConfirmDialog
        open={!!deleteRecordId}
        onClose={() => setDeleteRecordId(null)}
        onConfirm={handleDeleteRecord}
        title="Remove Working Record"
        message="This working-day record will be deleted permanently."
        confirmText="Remove"
        danger
      />

      <ConfirmDialog
        open={!!deletePoOrder}
        onClose={() => setDeletePoOrder(null)}
        onConfirm={handleDeletePoOrder}
        title="Delete PO Order"
        message={deletePoOrder ? `PO ${deletePoOrder.po_number} and all ${workingCounts.get(deletePoOrder.id) ?? 0} of its working-day record${(workingCounts.get(deletePoOrder.id) ?? 0) === 1 ? '' : 's'} will be deleted permanently. This cannot be undone.` : ''}
        confirmText="Delete PO"
        danger
      />
    </div>
  );
}
