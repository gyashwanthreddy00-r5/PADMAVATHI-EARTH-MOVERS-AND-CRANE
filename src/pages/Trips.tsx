import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useLang } from '@/context/LangContext';
import { useToast } from '@/components/ui/Toast';
import { useSettings } from '@/context/SettingsContext';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Modal, ConfirmDialog, Button, Field, inputClass, LoadingSpinner } from '@/components/ui/common';
import { Plus, Pencil, Trash2, Eye, Download, Settings2 } from 'lucide-react';
import { formatCurrency, formatDate, formatTime, formatDuration, getBillingBreakdown, calcHoursFromMeter, calcHoursFromTime, calcRentalForTrip, calcRentalFromRateMaster, todayISO, vehicleTypeLabel } from '@/lib/utils';
import { exportToExcelProfessional } from '@/lib/excelExport';
import { TRIP_FIELDS, getSelectedFields, setSelectedFields as persistSelectedFields, getSelectedFieldDefs } from '@/lib/tripFields';
import { DatePicker, DateTimePicker } from '@/components/ui/DatePicker';
import { findRateMasterForVehicle } from '@/lib/rateLookup';
import type { Trip, TripWithRelations, Vehicle, Employee, Customer, Rate, RateMaster, PaymentMode, RateType, MonthlyContract } from '@/types';

const TODAY = todayISO();

export default function Trips() {
  const { t } = useLang();
  const { show } = useToast();
  const { settings } = useSettings();
  const [trips, setTrips] = useState<TripWithRelations[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [rates, setRates] = useState<Rate[]>([]);
  const [rateMasterRates, setRateMasterRates] = useState<RateMaster[]>([]);
  const [monthlyContracts, setMonthlyContracts] = useState<MonthlyContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Trip | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [viewTrip, setViewTrip] = useState<TripWithRelations | null>(null);
  const [fieldModalOpen, setFieldModalOpen] = useState(false);
  const [selectedFields, setSelectedFieldsState] = useState<string[]>(getSelectedFields());
  const [selTons, setSelTons] = useState<string>('');
  const [selVehicleType, setSelVehicleType] = useState<'Crane' | 'JCB'>('Crane');
  const [selectedTripIds, setSelectedTripIds] = useState<Set<string>>(new Set());

  const [form, setForm] = useState<Partial<Trip>>({
    trip_date: todayISO(), vehicle_id: '', driver_id: '', customer_id: '', place_of_work: '',
    rate_type: 'Hourly', in_time: '', out_time: '', opening_hour_meter: null, closing_hour_meter: null,
    total_hours: 0, rental_amount: 0, batha: 0, total_amount: 0,
    bill_status: 'Pending', payment_mode: null, payment_date: null, remarks: '',
  });

  const fetchAll = async () => {
    setLoading(true);
    const [tRes, vRes, eRes, cRes, rRes, rmRes, mcRes] = await Promise.all([
      supabase.from('trips').select('*, vehicle:vehicles(id,registration_number,model,type,capacity,hourly_rate,daily_rate), driver:employees(id,name,role,phone,license_number,license_expiry,salary), customer:customers(id,name,address,gstin)').order('trip_date', { ascending: false }).eq('is_cancelled', false),
      supabase.from('vehicles').select('*').order('registration_number'),
      supabase.from('employees').select('*').order('name'),
      supabase.from('customers').select('*').order('name'),
      supabase.from('rates').select('*').eq('active', true).order('effective_from', { ascending: false }),
      supabase.from('rate_master').select('*').in('status', ['Active', 'Closed']).order('vehicle_type'),
      supabase.from('monthly_contracts').select('*'),
    ]);
    setTrips((tRes.data ?? []) as TripWithRelations[]);
    setVehicles((vRes.data ?? []) as Vehicle[]);
    setEmployees((eRes.data ?? []) as Employee[]);
    setCustomers((cRes.data ?? []) as Customer[]);
    setRates((rRes.data ?? []) as Rate[]);
    setRateMasterRates((rmRes.data ?? []) as RateMaster[]);
    setMonthlyContracts((mcRes.data ?? []) as MonthlyContract[]);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const drivers = employees.filter(e => e.role === 'Driver' || e.role === 'Operator');

  const activeVehicles = useMemo(() => vehicles.filter(v => v.active && v.status !== 'Inactive'), [vehicles]);

  const bookedVehicleIds = useMemo(() => {
    const ids = new Set<string>();
    const todayStr = todayISO();
    monthlyContracts.forEach(c => {
      if (c.status === 'Active' && c.vehicle_id && c.start_date <= todayStr && (!c.end_date || c.end_date >= todayStr)) {
        ids.add(c.vehicle_id);
      }
    });
    return ids;
  }, [monthlyContracts]);

  const availableTons = useMemo(() => {
    const tonsSet = new Set<string>();
    activeVehicles
      .filter(v => v.tons != null)
      .forEach(v => tonsSet.add(String(v.tons)));
    return Array.from(tonsSet).sort((a, b) => Number(a) - Number(b));
  }, [activeVehicles]);

  const filteredVehicles = useMemo(() => {
    let result = activeVehicles.filter(v => !bookedVehicleIds.has(v.id) && v.type === selVehicleType);
    if (selVehicleType === 'Crane' && selTons) result = result.filter(v => v.tons != null && String(v.tons) === selTons);
    // If editing an existing trip whose vehicle is booked, still show it
    if (editing && editing.vehicle_id) {
      const editVeh = vehicles.find(v => v.id === editing.vehicle_id);
      if (editVeh && editVeh.type === selVehicleType && !result.includes(editVeh)) result = [editVeh, ...result];
    }
    return result;
  }, [activeVehicles, selTons, selVehicleType, bookedVehicleIds, vehicles, editing]);

  const selectedVehicle = vehicles.find(v => v.id === form.vehicle_id);

  const applicableRateMaster = useMemo(() => {
    return findRateMasterForVehicle(selectedVehicle, rateMasterRates, form.trip_date ?? TODAY);
  }, [rateMasterRates, selectedVehicle, form.trip_date]);

  const applicableRate = useMemo(() => {
    if (!selectedVehicle) return null;
    return rates.find(r => (r.vehicle_type === selectedVehicle.type || r.vehicle_type === 'Both') && r.rate_type === form.rate_type) ?? null;
  }, [rates, selectedVehicle, form.rate_type]);

  const lastClosingMeter = useMemo(() => {
    if (!form.vehicle_id) return null;
    const vehicleTrips = trips.filter(tr => tr.vehicle_id === form.vehicle_id);
    if (vehicleTrips.length === 0) return null;
    return Math.max(...vehicleTrips.map(tr => Number(tr.closing_hour_meter) || 0));
  }, [trips, form.vehicle_id]);

  const totalHours = useMemo(() => {
    const fromMeter = calcHoursFromMeter(form.opening_hour_meter as number | null, form.closing_hour_meter as number | null);
    const fromTime = calcHoursFromTime(form.in_time ?? null, form.out_time ?? null);
    return fromMeter || fromTime;
  }, [form.opening_hour_meter, form.closing_hour_meter, form.in_time, form.out_time]);

  const rentalAmount = useMemo(() => {
    if (applicableRateMaster) {
      const rt = form.rate_type ?? 'Hourly';
      return calcRentalFromRateMaster(totalHours, rt, applicableRateMaster);
    }
    return calcRentalForTrip(totalHours, form.rate_type ?? 'Hourly', applicableRate, selectedVehicle ?? null);
  }, [totalHours, form.rate_type, applicableRate, applicableRateMaster, selectedVehicle]);

  const batha = Number(form.batha) || 0;
  const totalAmount = rentalAmount + batha;

  const r1 = applicableRateMaster ? Number(applicableRateMaster.first_hour_rate) || 0 : Number(selectedVehicle?.hourly_rate) || 0;
  const r2 = applicableRateMaster ? Number(applicableRateMaster.second_hour_rate) || 0 : r1;
  const dailyRate = applicableRateMaster ? Number(applicableRateMaster.daily_rate) || 0 : Number(selectedVehicle?.daily_rate) || 0;

  const billingBreakdown = getBillingBreakdown(totalHours, r1, r2, dailyRate, form.rate_type ?? 'Hourly');

  const onVehicleTypeChange = (newType: 'Crane' | 'JCB') => {
    setSelVehicleType(newType);
    setSelTons('');
    setForm(f => ({ ...f, vehicle_id: '' }));
  };

  const onTonsChange = (newTons: string) => {
    setSelTons(newTons);
    setForm(f => ({ ...f, vehicle_id: '' }));
  };

  const onVehicleChange = (id: string) => {
    const v = vehicles.find(x => x.id === id);
    const tripDate = form.trip_date ?? TODAY;
    const rm = findRateMasterForVehicle(v, rateMasterRates, tripDate);
    const bathaVal = rm ? Number(rm.batha) || 0 : 0;
    setForm(f => ({
      ...f, vehicle_id: id,
      opening_hour_meter: lastClosingMeter,
      batha: bathaVal,
    }));
  };

  const openAdd = () => {
    setEditing(null);
    setForm({
      trip_date: todayISO(), vehicle_id: '', driver_id: '', customer_id: '', place_of_work: '',
      rate_type: 'Hourly', in_time: '', out_time: '', opening_hour_meter: null, closing_hour_meter: null,
      total_hours: 0, rental_amount: 0, batha: 0, total_amount: 0,
      bill_status: 'Pending', payment_mode: null, payment_date: null, remarks: '',
    });
    setSelTons('');
    setSelVehicleType('Crane');
    setModalOpen(true);
  };

  const openEdit = (tr: TripWithRelations) => {
    const { vehicle, driver, customer, ...tripFields } = tr;
    void vehicle; void driver; void customer;
    setEditing(tripFields);
    setForm({
      ...tripFields,
      in_time: tripFields.in_time ? new Date(tripFields.in_time).toISOString().slice(0, 16) : '',
      out_time: tripFields.out_time ? new Date(tripFields.out_time).toISOString().slice(0, 16) : '',
      payment_date: tripFields.payment_date ?? '',
      payment_mode: tripFields.payment_mode ?? null,
    });
    const v = vehicles.find(x => x.id === tr.vehicle_id);
    setSelVehicleType(v?.type === 'JCB' ? 'JCB' : 'Crane');
    setSelTons(v?.tons != null ? String(v.tons) : '');
    setModalOpen(true);
  };

  const togglePayment = async (tr: TripWithRelations) => {
    const newStatus = tr.bill_status === 'Paid' ? 'Pending' : 'Paid';
    const payload: Partial<Trip> = {
      bill_status: newStatus,
      payment_date: newStatus === 'Paid' ? todayISO() : null,
      payment_mode: newStatus === 'Paid' ? tr.payment_mode ?? null : null,
    };
    const { error } = await supabase.from('trips').update(payload).eq('id', tr.id);
    if (error) { console.error('Failed to toggle payment:', error); show(t('saveError'), 'error'); }
    else { show(newStatus === 'Paid' ? 'Marked as Paid' : 'Marked as Pending', 'success'); fetchAll(); }
  };

  const save = async () => {
    if (!form.vehicle_id || !form.driver_id || !form.place_of_work) { show(t('required'), 'error'); return; }
    if (selectedVehicle && !selectedVehicle.active) { show('Selected vehicle is inactive. Please choose an active vehicle.', 'error'); return; }
    if (selectedVehicle && selTons && (selectedVehicle.tons == null || String(selectedVehicle.tons) !== selTons)) { show('Selected vehicle does not match the chosen tons.', 'error'); return; }
    if (selectedVehicle && bookedVehicleIds.has(selectedVehicle.id) && (!editing || editing.vehicle_id !== selectedVehicle.id)) {
      show(`${selectedVehicle.registration_number} is booked under an active Monthly Contract and cannot be assigned to a trip.`, 'error'); return;
    }
    if (form.closing_hour_meter != null && form.opening_hour_meter != null && Number(form.closing_hour_meter) < Number(form.opening_hour_meter)) {
      show(t('invalidMeter'), 'error'); return;
    }
    if (form.out_time && form.in_time && new Date(form.out_time).getTime() < new Date(form.in_time).getTime()) {
      show(t('invalidTime'), 'error'); return;
    }
    setSaving(true);

    const rateSnapshot = applicableRateMaster ? {
      rate_master_id: applicableRateMaster.id,
      rate_version: applicableRateMaster.version_number,
      capacity_tons: applicableRateMaster.capacity_tons,
      first_hour_rate: applicableRateMaster.first_hour_rate,
      second_hour_rate: applicableRateMaster.second_hour_rate,
      third_hour_rate_snapshot: applicableRateMaster.third_hour_rate,
      fourth_hour_rate_snapshot: applicableRateMaster.fourth_hour_rate,
      fifth_hour_rate_snapshot: applicableRateMaster.fifth_hour_rate,
      weekly_rate_snapshot: applicableRateMaster.weekly_rate,
      daily_rate_snapshot: Number(applicableRateMaster.daily_rate) || null,
      monthly_rate_snapshot: applicableRateMaster.monthly_rate,
      batha_snapshot: Number(applicableRateMaster.batha) || null,
    } : {};

    const payload = {
      trip_date: form.trip_date,
      vehicle_id: form.vehicle_id || null,
      driver_id: form.driver_id || null,
      customer_id: form.customer_id || null,
      place_of_work: form.place_of_work,
      rate_type: form.rate_type,
      in_time: form.in_time ? new Date(form.in_time).toISOString() : null,
      out_time: form.out_time ? new Date(form.out_time).toISOString() : null,
      opening_hour_meter: form.opening_hour_meter != null && form.opening_hour_meter !== '' ? Number(form.opening_hour_meter) : null,
      closing_hour_meter: form.closing_hour_meter != null && form.closing_hour_meter !== '' ? Number(form.closing_hour_meter) : null,
      total_hours: totalHours,
      rental_amount: rentalAmount,
      batha: batha,
      total_amount: totalAmount,
      bill_status: form.bill_status,
      payment_mode: form.bill_status === 'Paid' ? (form.payment_mode ?? null) : null,
      payment_date: form.bill_status === 'Paid' ? (form.payment_date || todayISO()) : null,
      remarks: form.remarks ?? null,
      ...rateSnapshot,
    };

    if (editing) {
      const { error } = await supabase.from('trips').update(payload).eq('id', editing.id);
      if (error) { console.error('Failed to update trip:', error); show(t('saveError'), 'error'); }
      else {
        if (selectedVehicle) {
          await supabase.from('vehicles').update({ status: form.out_time ? 'Available' : 'Working' }).eq('id', selectedVehicle.id);
        }
        show(t('saveSuccess'), 'success'); setModalOpen(false); fetchAll();
      }
    } else {
      const { data: tripNum } = await supabase.rpc('next_trip_number');
      const payloadWithNum = { ...payload, trip_number: tripNum };
      const { error } = await supabase.from('trips').insert(payloadWithNum);
      if (error) { console.error('Failed to create trip:', error); show(t('saveError'), 'error'); }
      else {
        if (selectedVehicle) {
          await supabase.from('vehicles').update({ status: form.out_time ? 'Available' : 'Working' }).eq('id', selectedVehicle.id);
        }
        show(t('saveSuccess'), 'success'); setModalOpen(false); fetchAll();
      }
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from('trips').update({ is_cancelled: true }).eq('id', deleteId);
    if (error) show(t('deleteError'), 'error');
    else { show(t('deleteSuccess'), 'success'); fetchAll(); }
    setDeleteId(null);
  };

  const paymentTotals = useMemo(() => {
    const totalAmount = trips.reduce((s, tr) => s + (Number(tr.total_amount) || 0), 0);
    const totalPaid = trips.filter(tr => tr.bill_status === 'Paid').reduce((s, tr) => s + (Number(tr.total_amount) || 0), 0);
    const totalPending = totalAmount - totalPaid;
    const paidCount = trips.filter(tr => tr.bill_status === 'Paid').length;
    const pendingCount = trips.filter(tr => tr.bill_status !== 'Paid').length;
    return { totalAmount, totalPaid, totalPending, paidCount, pendingCount, totalCount: trips.length };
  }, [trips]);

  const toggleField = (key: string) => {
    setSelectedFieldsState(prev => {
      const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key];
      persistSelectedFields(next);
      return next;
    });
  };

  const handleExport = () => {
    if (selectedTripIds.size === 0) { show('Please select at least one record to export.', 'error'); return; }
    const selectedTrips = trips.filter(tr => selectedTripIds.has(tr.id));
    const defs = getSelectedFieldDefs();
    const headers = ['S.No', ...defs.map(d => d.label)];
    const dataRows = selectedTrips.map((tr, i) => [
      i + 1, ...defs.map(d => {
        const v = d.getValue(tr as unknown as Record<string, unknown>);
        if (d.key === 'trip_date') return formatDate(v as string);
        if (d.key === 'in_time' || d.key === 'out_time') return v && v !== '-' ? formatTime(v as string) : '-';
        if (d.key === 'total_hours') return v && v !== '-' ? formatDuration(v as number) : '-';
        if (d.key === 'rental_amount' || d.key === 'batha' || d.key === 'total_amount') return Number(v) || 0;
        return v ?? '-';
      }),
    ]);
    const totalRow = ['', ...defs.map(d => {
      if (d.key === 'rental_amount') return selectedTrips.reduce((s, tr) => s + Number(tr.rental_amount), 0);
      if (d.key === 'batha') return selectedTrips.reduce((s, tr) => s + Number(tr.batha), 0);
      if (d.key === 'total_amount') return selectedTrips.reduce((s, tr) => s + Number(tr.total_amount), 0);
      return '';
    })];
    const currencyCols = defs.map((d, i) => ['rental_amount', 'batha', 'total_amount'].includes(d.key) ? i + 1 : -1).filter(i => i >= 0);
    exportToExcelProfessional('trip-entries-export.xls', 'Trip Entries Report',
      settings ? { company_name: settings.company_name, address: settings.address, phone: settings.phone, email: settings.email, gstin: settings.gstin, pan: settings.pan } : { company_name: 'PADMAVATHI EARTH MOVERS AND CRANE SERVICES' },
      `${selectedTrips.length} Selected Records`, headers, dataRows, totalRow, currencyCols);
  };

  const columns: Column<TripWithRelations>[] = [
    { key: 'trip_date', header: t('date'), sortable: true, render: tr => formatDate(tr.trip_date) },
    { key: 'vehicle', header: t('vehicleNumber'), render: tr => tr.vehicle?.registration_number ?? '-' },
    { key: 'vehicle_type', header: 'Type', render: tr => vehicleTypeLabel(tr.vehicle?.type, tr.capacity_tons || tr.vehicle?.capacity) },
    { key: 'customer', header: t('customer'), render: tr => tr.customer?.name ?? '-' },
    { key: 'driver', header: t('driver'), render: tr => tr.driver?.name ?? '-' },
    { key: 'total_hours', header: 'Duration', align: 'right', sortable: true, render: tr => formatDuration(tr.total_hours) },
    { key: 'rental_amount', header: t('rentalAmount'), align: 'right', render: tr => formatCurrency(tr.rental_amount), sortable: true },
    { key: 'total_amount', header: t('totalAmount'), align: 'right', render: tr => formatCurrency(tr.total_amount), sortable: true },
    { key: 'bill_status', header: 'Payment', align: 'center', render: tr => (
      <button
        onClick={() => togglePayment(tr)}
        className={`px-3 py-1 rounded-md text-xs font-bold border transition-colors ${
          tr.bill_status === 'Paid'
            ? 'bg-emerald-500 text-white border-emerald-600 hover:bg-emerald-600'
            : 'bg-red-500 text-white border-red-600 hover:bg-red-600'
        }`}
      >
        {tr.bill_status === 'Paid' ? 'PAID' : 'UNPAID'}
      </button>
    ) },
    {
      key: 'actions', header: t('actions'), align: 'center',
      render: tr => (
        <div className="flex justify-center gap-1">
          <button onClick={() => setViewTrip(tr)} className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md"><Eye className="w-4 h-4" /></button>
          <button onClick={() => openEdit(tr)} className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md"><Pencil className="w-4 h-4" /></button>
          <button onClick={() => setDeleteId(tr.id)} className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-md"><Trash2 className="w-4 h-4" /></button>
        </div>
      ),
    },
  ];

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{trips.length} {t('tripEntries')}</p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setFieldModalOpen(true)}><Settings2 className="w-4 h-4" />Fields</Button>
          <Button variant="secondary" onClick={handleExport}><Download className="w-4 h-4" />{t('export')}</Button>
          <Button onClick={openAdd}><Plus className="w-4 h-4" />{t('addNew')}</Button>
        </div>
      </div>

      {/* Payment Totals */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white rounded-lg border border-slate-200 p-3 shadow-sm">
          <p className="text-xs text-slate-500">Total Trips</p>
          <p className="text-lg font-bold text-slate-800">{paymentTotals.totalCount}</p>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-3 shadow-sm">
          <p className="text-xs text-slate-500">Total Amount</p>
          <p className="text-lg font-bold text-slate-800">{formatCurrency(paymentTotals.totalAmount)}</p>
        </div>
        <div className="bg-white rounded-lg border border-emerald-200 p-3 shadow-sm">
          <p className="text-xs text-emerald-600">Total Paid</p>
          <p className="text-lg font-bold text-emerald-700">{formatCurrency(paymentTotals.totalPaid)}</p>
        </div>
        <div className="bg-white rounded-lg border border-red-200 p-3 shadow-sm">
          <p className="text-xs text-red-600">Total Pending</p>
          <p className="text-lg font-bold text-red-700">{formatCurrency(paymentTotals.totalPending)}</p>
        </div>
        <div className="bg-white rounded-lg border border-emerald-200 p-3 shadow-sm">
          <p className="text-xs text-emerald-600">Paid Trips</p>
          <p className="text-lg font-bold text-emerald-700">{paymentTotals.paidCount}</p>
        </div>
        <div className="bg-white rounded-lg border border-red-200 p-3 shadow-sm">
          <p className="text-xs text-red-600">Pending Trips</p>
          <p className="text-lg font-bold text-red-700">{paymentTotals.pendingCount}</p>
        </div>
      </div>

      <DataTable columns={columns} data={trips} searchKeys={['trip_number', 'place_of_work']} searchPlaceholder={`${t('search')}...`} selectable selectedIds={selectedTripIds} onSelectionChange={setSelectedTripIds} getRowId={tr => tr.id} showSerialNumber />

      <Modal
        open={modalOpen} onClose={() => setModalOpen(false)}
        title={editing ? `${t('edit')} ${t('tripEntries')}` : `${t('addNew')} ${t('tripEntries')}`}
        size="xl"
        footer={<><Button variant="secondary" onClick={() => setModalOpen(false)}>{t('cancel')}</Button><Button onClick={save} disabled={saving}>{saving ? t('saving') : t('save')}</Button></>}
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label={t('date')} required>
            <DatePicker value={form.trip_date ?? ''} onChange={v => setForm(f => ({ ...f, trip_date: v }))} />
          </Field>
          <Field label="Vehicle Type" required>
            <select className={inputClass()} value={selVehicleType} onChange={e => onVehicleTypeChange(e.target.value as 'Crane' | 'JCB')}>
              <option value="Crane">Crane</option>
              <option value="JCB">JCB</option>
            </select>
          </Field>
          {selVehicleType === 'Crane' && (
            <Field label="Tons / Capacity" required>
              <select className={inputClass()} value={selTons} onChange={e => onTonsChange(e.target.value)}>
                <option value="">Select Tons</option>
                {availableTons.map(tn => <option key={tn} value={tn}>{tn} Ton</option>)}
              </select>
            </Field>
          )}
          <Field label={t('vehicleNumber')} required>
            {filteredVehicles.length === 0 ? (
              <div className="text-sm text-red-500 py-2">No active {selVehicleType} vehicles available{selVehicleType === 'Crane' && selTons ? ' for the selected tons' : ''}. Vehicles on active Monthly Contracts are excluded.</div>
            ) : (
              <select className={inputClass()} value={form.vehicle_id ?? ''} onChange={e => onVehicleChange(e.target.value)}>
                <option value="">Select Vehicle</option>
                {filteredVehicles.map(v => {
                  const isBooked = bookedVehicleIds.has(v.id) && (!editing || editing.vehicle_id !== v.id);
                  return <option key={v.id} value={v.id} disabled={isBooked}>{v.registration_number}{isBooked ? ' — Booked (Monthly Contract)' : ''}</option>;
                })}
              </select>
            )}
          </Field>
          <Field label={t('driver')} required>
            <select className={inputClass()} value={form.driver_id ?? ''} onChange={e => setForm(f => ({ ...f, driver_id: e.target.value }))}>
              <option value="">-</option>
              {drivers.map(d => <option key={d.id} value={d.id}>{d.name} ({d.role})</option>)}
            </select>
          </Field>
          <Field label={t('customer')}>
            <select className={inputClass()} value={form.customer_id ?? ''} onChange={e => setForm(f => ({ ...f, customer_id: e.target.value || null }))}>
              <option value="">-</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label={t('placeOfWork')} required>
            <input className={inputClass()} value={form.place_of_work ?? ''} onChange={e => setForm(f => ({ ...f, place_of_work: e.target.value }))} placeholder="e.g. Hyderabad" />
          </Field>
          <Field label={t('rateType')}>
            <select className={inputClass()} value={form.rate_type} onChange={e => setForm(f => ({ ...f, rate_type: e.target.value as RateType }))}>
              <option value="Hourly">Hourly</option>
              <option value="Daily">Full Day</option>
              <option value="Weekly">Weekly</option>
              <option value="Monthly">Monthly</option>
            </select>
          </Field>
          <Field label={t('inTime')}>
            <DateTimePicker value={form.in_time ?? ''} onChange={v => setForm(f => ({ ...f, in_time: v }))} />
          </Field>
          <Field label={t('outTime')}>
            <DateTimePicker value={form.out_time ?? ''} onChange={v => setForm(f => ({ ...f, out_time: v }))} />
          </Field>
          <Field label={t('openingHourMeter')}>
            <input type="number" step="0.01" className={inputClass()}
              value={form.opening_hour_meter ?? ''}
              onChange={e => setForm(f => ({ ...f, opening_hour_meter: e.target.value === '' ? null : Number(e.target.value) }))}
              placeholder={lastClosingMeter ? `Last: ${lastClosingMeter}` : 'Enter opening hour meter'} />
          </Field>
          <Field label={t('closingHourMeter')}>
            <input type="number" step="0.01" className={inputClass()}
              value={form.closing_hour_meter ?? ''}
              onChange={e => setForm(f => ({ ...f, closing_hour_meter: e.target.value === '' ? null : Number(e.target.value) }))}
              placeholder="Enter closing hour meter" />
          </Field>
          <Field label={t('batha')}>
            <input type="number" step="0.01" className={inputClass() + ' bg-slate-100 cursor-not-allowed'}
              value={form.batha ?? ''}
              readOnly
              placeholder="Auto from Rate Master" />
          </Field>
          <Field label={t('remarks')}>
            <input className={inputClass()} value={form.remarks ?? ''} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} />
          </Field>
        </div>

        {/* Billing Summary */}
        <div className="mt-5 p-4 bg-blue-50 rounded-lg border border-blue-100">
          <h4 className="text-sm font-semibold text-blue-800 mb-3">Billing Summary</h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mb-3">
            <div><span className="text-slate-500">Total Duration: </span><span className="font-semibold text-slate-800">{formatDuration(totalHours)}</span></div>
            <div><span className="text-slate-500">Rate Type: </span><span className="font-semibold text-slate-800">{form.rate_type === 'Daily' ? 'Full Day' : form.rate_type}</span></div>
            <div><span className="text-slate-500">1 Hr Rate: </span><span className="font-semibold text-slate-800">{formatCurrency(r1)}</span></div>
            <div><span className="text-slate-500">2 Hr Rate: </span><span className="font-semibold text-slate-800">{formatCurrency(r2)}</span></div>
            <div><span className="text-slate-500">Full Day Rate: </span><span className="font-semibold text-slate-800">{formatCurrency(dailyRate)}</span></div>
            <div><span className="text-slate-500">Batha: </span><span className="font-semibold text-slate-800">{formatCurrency(batha)}</span></div>
          </div>
          <div className="text-sm text-slate-600 mb-2">
            <span className="text-slate-500">Calculation: </span><span className="font-medium">{billingBreakdown}</span>
          </div>
          <div className="border-t border-blue-200 pt-2 grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <div><span className="text-slate-500">Rental Amount: </span><span className="font-semibold text-slate-800">{formatCurrency(rentalAmount)}</span></div>
            <div><span className="text-slate-500">Total Amount: </span><span className="font-bold text-blue-700">{formatCurrency(totalAmount)}</span></div>
          </div>
          {selectedVehicle && (
            <div className="mt-2 text-xs text-slate-500">
              {selectedVehicle.model ?? '-'} • {vehicleTypeLabel(selectedVehicle.type, selectedVehicle.tons ?? selectedVehicle.capacity)} • {applicableRateMaster ? `Rate Master V${applicableRateMaster.version_number}` : 'Vehicle rate'}
            </div>
          )}
          {selectedVehicle && !applicableRateMaster && !applicableRate && (
            <div className="mt-2 text-xs text-amber-600">
              Rate not configured for {selectedVehicle.registration_number}. Please configure the rate in Rate Master.
            </div>
          )}
        </div>

        {/* Payment Status in Modal */}
        <div className="mt-4 flex items-center gap-3">
          <span className="text-sm font-medium text-slate-600">Payment Status:</span>
          <button
            type="button"
            onClick={() => setForm(f => ({ ...f, bill_status: f.bill_status === 'Paid' ? 'Pending' : 'Paid' }))}
            className={`px-4 py-1.5 rounded-md text-sm font-bold border transition-colors ${
              form.bill_status === 'Paid'
                ? 'bg-emerald-500 text-white border-emerald-600 hover:bg-emerald-600'
                : 'bg-red-500 text-white border-red-600 hover:bg-red-600'
            }`}
          >
            {form.bill_status === 'Paid' ? 'PAID' : 'UNPAID'}
          </button>
          {form.bill_status === 'Paid' && (
            <>
              <Field label="">
                <select className={inputClass()} value={form.payment_mode ?? ''} onChange={e => setForm(f => ({ ...f, payment_mode: e.target.value as PaymentMode }))}>
                  <option value="">Payment Mode</option>
                  <option value="Cash">{t('cash')}</option>
                  <option value="UPI">UPI</option>
                  <option value="Bank Transfer">Bank Transfer</option>
                  <option value="Cheque">Cheque</option>
                </select>
              </Field>
              <Field label="">
                <DatePicker value={form.payment_date ?? ''} onChange={v => setForm(f => ({ ...f, payment_date: v }))} />
              </Field>
            </>
          )}
        </div>
      </Modal>

      <Modal open={!!viewTrip} onClose={() => setViewTrip(null)} title={`${t('view')} ${t('tripEntries')}`} size="lg">
        {viewTrip && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div><span className="text-slate-500">{t('tripNumber')}: </span><span className="font-medium">{viewTrip.trip_number}</span></div>
              <div><span className="text-slate-500">{t('date')}: </span><span className="font-medium">{formatDate(viewTrip.trip_date)}</span></div>
              <div><span className="text-slate-500">{t('vehicleNumber')}: </span><span className="font-medium">{viewTrip.vehicle?.registration_number ?? '-'}</span></div>
              <div><span className="text-slate-500">Type: </span><span className="font-medium">{vehicleTypeLabel(viewTrip.vehicle?.type, viewTrip.capacity_tons || viewTrip.vehicle?.capacity)}</span></div>

              <div><span className="text-slate-500">{t('driver')}: </span><span className="font-medium">{viewTrip.driver?.name ?? '-'}</span></div>
              <div><span className="text-slate-500">{t('customer')}: </span><span className="font-medium">{viewTrip.customer?.name ?? '-'}</span></div>
              <div><span className="text-slate-500">{t('placeOfWork')}: </span><span className="font-medium">{viewTrip.place_of_work}</span></div>
              <div><span className="text-slate-500">{t('inTime')}: </span><span className="font-medium">{formatTime(viewTrip.in_time)}</span></div>
              <div><span className="text-slate-500">{t('outTime')}: </span><span className="font-medium">{formatTime(viewTrip.out_time)}</span></div>
              <div><span className="text-slate-500">{t('openingHourMeter')}: </span><span className="font-medium">{viewTrip.opening_hour_meter ?? '-'}</span></div>
              <div><span className="text-slate-500">{t('closingHourMeter')}: </span><span className="font-medium">{viewTrip.closing_hour_meter ?? '-'}</span></div>
              <div><span className="text-slate-500">Duration: </span><span className="font-medium">{formatDuration(viewTrip.total_hours)}</span></div>
              <div><span className="text-slate-500">{t('rentalAmount')}: </span><span className="font-medium">{formatCurrency(viewTrip.rental_amount)}</span></div>
              <div><span className="text-slate-500">{t('batha')}: </span><span className="font-medium">{formatCurrency(viewTrip.batha)}</span></div>
              <div><span className="text-slate-500">{t('totalAmount')}: </span><span className="font-bold">{formatCurrency(viewTrip.total_amount)}</span></div>
              <div><span className="text-slate-500">Payment: </span>
                <span className={`px-2 py-0.5 rounded text-xs font-bold ${viewTrip.bill_status === 'Paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                  {viewTrip.bill_status === 'Paid' ? 'PAID' : 'UNPAID'}
                </span>
              </div>
              {viewTrip.payment_mode && <div><span className="text-slate-500">{t('paymentMode')}: </span><span className="font-medium">{viewTrip.payment_mode}</span></div>}
              {viewTrip.remarks && <div className="col-span-2"><span className="text-slate-500">{t('remarks')}: </span><span className="font-medium">{viewTrip.remarks}</span></div>}
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={handleDelete} title={t('delete')} message={t('confirmDelete')} confirmText={t('delete')} danger />

      <Modal
        open={fieldModalOpen} onClose={() => setFieldModalOpen(false)}
        title="Select Trip Fields to Show & Export"
        size="md"
        footer={<><Button variant="secondary" onClick={() => setFieldModalOpen(false)}>Done</Button></>}
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-500">Select which trip fields are visible on the Dashboard and included in the Excel Export. Your selection is remembered automatically.</p>
          <div className="flex gap-2">
            <button onClick={() => { const all = TRIP_FIELDS.map(f => f.key); setSelectedFieldsState(all); persistSelectedFields(all); }} className="text-xs px-3 py-1 bg-blue-50 text-blue-700 rounded-md hover:bg-blue-100">Select All</button>
            <button onClick={() => { setSelectedFieldsState([]); persistSelectedFields([]); }} className="text-xs px-3 py-1 bg-slate-100 text-slate-600 rounded-md hover:bg-slate-200">Clear All</button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {TRIP_FIELDS.map(field => (
              <label key={field.key} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${selectedFields.includes(field.key) ? 'border-blue-300 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                <input
                  type="checkbox"
                  checked={selectedFields.includes(field.key)}
                  onChange={() => toggleField(field.key)}
                  className="w-4 h-4 accent-blue-600"
                />
                <span className={`text-sm ${selectedFields.includes(field.key) ? 'text-blue-700 font-medium' : 'text-slate-600'}`}>{field.label}</span>
              </label>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  );
}
