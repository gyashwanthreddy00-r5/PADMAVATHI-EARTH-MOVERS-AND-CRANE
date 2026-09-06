import { useState, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { useLang } from '@/context/LangContext';
import { useToast } from '@/components/ui/Toast';
import { Button, Field, inputClass, LoadingSpinner } from '@/components/ui/common';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { DatePicker, DateTimePicker } from '@/components/ui/DatePicker';
import {
  formatCurrency, formatDuration, todayISO,
} from '@/lib/utils';
import {
  calcRental, validateSessions, type SessionInput, type TransportationCharges,
} from '@/lib/rentalCalc';
import { findRateMasterForVehicle } from '@/lib/rateLookup';
import type {
  Vehicle, Employee, Customer, Rate, RateMaster, RateType,
  MonthlyContract,
} from '@/types';

function emptySession(rateType: RateType = 'Hourly'): SessionInput {
  return { in_time: null, out_time: null, opening_hour_meter: null, closing_hour_meter: null, remarks: '', rate_type: rateType };
}

export type VehicleTypeFilter = 'Crane' | 'JCB';

export interface VehicleEntryData {
  vehicle_id: string;
  vehicle_number: string | null;
  vehicle_type: string | null;
  vehicle_type_filter: VehicleTypeFilter;
  vehicle_capacity: string | null;
  driver_id: string;
  driver_name: string | null;
  place_of_work: string;
  rate_type: RateType;
  tons: string;
  sessions: SessionInput[];
  batha: number;
  total_hours: number;
  rental_amount: number;
  total_amount: number;
  rate_master_id: string | null;
  rate_version: number | null;
  capacity_tons: string | null;
  first_hour_rate: number | null;
  second_hour_rate: number | null;
  third_hour_rate_snapshot: number | null;
  fourth_hour_rate_snapshot: number | null;
  fifth_hour_rate_snapshot: number | null;
  weekly_rate_snapshot: number | null;
  daily_rate_snapshot: number | null;
  monthly_rate_snapshot: number | null;
  batha_snapshot: number | null;
}

export interface MultiVehicleTripFormData {
  trip_date: string;
  place_of_work: string;
  customer_id: string | null;
  vehicles: VehicleEntryData[];
  up_transportation_enabled: boolean;
  up_transportation_amount: number;
  down_transportation_enabled: boolean;
  down_transportation_amount: number;
  remarks: string | null;
  total_hours: number;
  total_amount: number;
  total_batha: number;
  total_rental: number;
}

interface TripEntryFormProps {
  onSubmit: (data: MultiVehicleTripFormData) => void;
  onCancel?: () => void;
  submitLabel?: string;
  submitting?: boolean;
  lockedCustomerId?: string;
  hideCustomerSelect?: boolean;
  extraTop?: ReactNode;
  extraBottom?: ReactNode;
  onTotalAmountChange?: (amount: number) => void;
  initialCustomerId?: string | null;
  initialTripDate?: string;
  perVehiclePlaceOfWork?: boolean;
  initialData?: MultiVehicleTripFormData | null;
}

function createEmptyVehicle(): VehicleEntryData {
  return {
    vehicle_id: '',
    vehicle_number: null,
    vehicle_type: null,
    vehicle_capacity: null,
    driver_id: '',
    driver_name: null,
    place_of_work: '',
    rate_type: 'Hourly',
    tons: '',
    vehicle_type_filter: 'Crane',
    sessions: [emptySession('Hourly')],
    batha: 0,
    total_hours: 0,
    rental_amount: 0,
    total_amount: 0,
    rate_master_id: null,
    rate_version: null,
    capacity_tons: null,
    first_hour_rate: null,
    second_hour_rate: null,
    third_hour_rate_snapshot: null,
    fourth_hour_rate_snapshot: null,
    fifth_hour_rate_snapshot: null,
    weekly_rate_snapshot: null,
    daily_rate_snapshot: null,
    monthly_rate_snapshot: null,
    batha_snapshot: null,
  };
}

export function TripEntryForm({
  onSubmit,
  onCancel,
  submitLabel = 'Save',
  submitting = false,
  lockedCustomerId,
  hideCustomerSelect = false,
  extraTop,
  extraBottom,
  onTotalAmountChange,
  initialCustomerId,
  initialTripDate,
  perVehiclePlaceOfWork = false,
  initialData = null,
}: TripEntryFormProps) {
  const { t } = useLang();
  const { show } = useToast();

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [rates, setRates] = useState<Rate[]>([]);
  const [rateMasterRates, setRateMasterRates] = useState<RateMaster[]>([]);
  const [monthlyContracts, setMonthlyContracts] = useState<MonthlyContract[]>([]);
  const [loading, setLoading] = useState(true);

  const [tripDate, setTripDate] = useState(initialData?.trip_date ?? initialTripDate ?? todayISO());
  const [customerId, setCustomerId] = useState(initialData?.customer_id ?? initialCustomerId ?? lockedCustomerId ?? '');
  const [billPlaceOfWork, setBillPlaceOfWork] = useState(initialData?.place_of_work ?? '');
  const [remarks, setRemarks] = useState(initialData?.remarks ?? '');
  const [vehicleEntries, setVehicleEntries] = useState<VehicleEntryData[]>(
    initialData?.vehicles?.length ? initialData.vehicles.map(v => ({
      ...v,
      vehicle_type_filter: v.vehicle_type_filter ?? (v.vehicle_type === 'JCB' ? 'JCB' : 'Crane' as VehicleTypeFilter),
      sessions: v.sessions?.length ? v.sessions.map(s => ({ ...s, rate_type: s.rate_type ?? v.rate_type ?? 'Hourly' })) : [emptySession(v.rate_type ?? 'Hourly')],
    })) : [createEmptyVehicle()]
  );
  const [collapsedVehicles, setCollapsedVehicles] = useState<Set<number>>(new Set());
  const [upTransportEnabled, setUpTransportEnabled] = useState(initialData?.up_transportation_enabled ?? false);
  const [upTransportAmount, setUpTransportAmount] = useState(initialData?.up_transportation_amount ?? 0);
  const [downTransportEnabled, setDownTransportEnabled] = useState(initialData?.down_transportation_enabled ?? false);
  const [downTransportAmount, setDownTransportAmount] = useState(initialData?.down_transportation_amount ?? 0);

  useEffect(() => {
    (async () => {
      const [vRes, eRes, cRes, rRes, rmRes, mcRes] = await Promise.all([
        supabase.from('vehicles').select('*').order('registration_number'),
        supabase.from('employees').select('*').order('name'),
        supabase.from('customers').select('*').order('name'),
        supabase.from('rates').select('*').eq('active', true).order('effective_from', { ascending: false }),
        supabase.from('rate_master').select('*').in('status', ['Active', 'Closed']).order('vehicle_type'),
        supabase.from('monthly_contracts').select('*'),
      ]);
      setVehicles((vRes.data ?? []) as Vehicle[]);
      setEmployees((eRes.data ?? []) as Employee[]);
      setCustomers((cRes.data ?? []) as Customer[]);
      setRates((rRes.data ?? []) as Rate[]);
      setRateMasterRates((rmRes.data ?? []) as RateMaster[]);
      setMonthlyContracts((mcRes.data ?? []) as MonthlyContract[]);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (lockedCustomerId) setCustomerId(lockedCustomerId);
  }, [lockedCustomerId]);

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

  const getFilteredVehicles = (vehicleTypeFilter: VehicleTypeFilter, tons: string) => {
    let result = activeVehicles.filter(v => !bookedVehicleIds.has(v.id));
    result = result.filter(v => v.type === vehicleTypeFilter);
    if (vehicleTypeFilter === 'Crane' && tons) {
      result = result.filter(v => v.tons != null && String(v.tons) === tons);
    }
    return result;
  };

  const getUsedVehicleIds = useMemo(() => {
    const ids = new Set<string>();
    vehicleEntries.forEach(ve => { if (ve.vehicle_id) ids.add(ve.vehicle_id); });
    return ids;
  }, [vehicleEntries]);

  // Calculate each vehicle's rental
  const vehicleCalcs = useMemo(() => {
    return vehicleEntries.map((ve) => {
      const selectedVehicle = vehicles.find(v => v.id === ve.vehicle_id);
      const applicableRateMaster = findRateMasterForVehicle(selectedVehicle, rateMasterRates, tripDate);
      const applicableRate = selectedVehicle
        ? rates.find(r => (r.vehicle_type === selectedVehicle.type || r.vehicle_type === 'Both') && r.rate_type === ve.rate_type) ?? null
        : null;
      const transportation: TransportationCharges = {
        up_enabled: false, up_amount: 0, down_enabled: false, down_amount: 0,
      };
      const calcResult = calcRental(ve.sessions, ve.rate_type, applicableRateMaster, Number(ve.batha) || 0, transportation);
      return { calcResult, applicableRateMaster, applicableRate, selectedVehicle };
    });
  }, [vehicleEntries, vehicles, rateMasterRates, rates, tripDate]);

  const billTotals = useMemo(() => {
    let totalRental = 0;
    let totalBatha = 0;
    let totalHours = 0;
    vehicleCalcs.forEach(({ calcResult }) => {
      totalRental += calcResult.rental_amount;
      totalBatha += calcResult.batha;
      totalHours += calcResult.total_hours;
    });
    const upTransport = upTransportEnabled ? Number(upTransportAmount) || 0 : 0;
    const downTransport = downTransportEnabled ? Number(downTransportAmount) || 0 : 0;
    const grandTotal = Math.round((totalRental + totalBatha + upTransport + downTransport) * 100) / 100;
    return {
      totalRental: Math.round(totalRental * 100) / 100,
      totalBatha: Math.round(totalBatha * 100) / 100,
      totalHours: Math.round(totalHours * 100) / 100,
      upTransport,
      downTransport,
      grandTotal,
    };
  }, [vehicleCalcs, upTransportEnabled, upTransportAmount, downTransportEnabled, downTransportAmount]);

  useEffect(() => {
    if (onTotalAmountChange) onTotalAmountChange(billTotals.grandTotal);
  }, [billTotals.grandTotal, onTotalAmountChange]);

  const updateVehicleEntry = (idx: number, patch: Partial<VehicleEntryData>) => {
    setVehicleEntries(prev => prev.map((ve, i) => i === idx ? { ...ve, ...patch } : ve));
  };

  const onVehicleTypeFilterChange = (idx: number, filter: VehicleTypeFilter) => {
    updateVehicleEntry(idx, { vehicle_type_filter: filter, tons: '', vehicle_id: '' });
  };

  const onVehicleTonsChange = (idx: number, newTons: string) => {
    updateVehicleEntry(idx, { tons: newTons, vehicle_id: '' });
  };

  const onVehicleSelect = (idx: number, id: string) => {
    const v = vehicles.find(x => x.id === id);
    const rm = findRateMasterForVehicle(v, rateMasterRates, tripDate);
    const bathaVal = rm ? Number(rm.batha) || 0 : 0;
    updateVehicleEntry(idx, {
      vehicle_id: id,
      vehicle_number: v?.registration_number ?? null,
      vehicle_type: v?.type ?? null,
      vehicle_capacity: v?.capacity ?? null,
      batha: bathaVal,
    });
  };

  const onVehicleRateTypeChange = (idx: number, rateType: RateType) => {
    setVehicleEntries(prev => prev.map((ve, i) => {
      if (i !== idx) return ve;
      const lastSession = ve.sessions[ve.sessions.length - 1];
      if (ve.sessions.length === 1 && lastSession && (!lastSession.in_time && !lastSession.out_time && !lastSession.opening_hour_meter && !lastSession.closing_hour_meter && !lastSession.remarks)) {
        return { ...ve, rate_type: rateType, sessions: [{ ...lastSession, rate_type: rateType }] };
      }
      return { ...ve, rate_type: rateType };
    }));
  };

  const updateVehicleSession = (vIdx: number, sIdx: number, patch: Partial<SessionInput>) => {
    setVehicleEntries(prev => prev.map((ve, i) => {
      if (i !== vIdx) return ve;
      const newSessions = ve.sessions.map((s, si) => si === sIdx ? { ...s, ...patch } : s);
      return { ...ve, sessions: newSessions };
    }));
  };

  const addVehicleSession = (vIdx: number) => {
    setVehicleEntries(prev => prev.map((ve, i) => {
      if (i !== vIdx) return ve;
      const lastSession = ve.sessions[ve.sessions.length - 1];
      const defaultRateType = lastSession?.rate_type ?? ve.rate_type;
      return { ...ve, sessions: [...ve.sessions, emptySession(defaultRateType)] };
    }));
  };

  const removeVehicleSession = (vIdx: number, sIdx: number) => {
    setVehicleEntries(prev => prev.map((ve, i) => {
      if (i !== vIdx) return ve;
      if (ve.sessions.length <= 1) return ve;
      return { ...ve, sessions: ve.sessions.filter((_, si) => si !== sIdx) };
    }));
  };

  const addVehicle = () => {
    setVehicleEntries(prev => [...prev, createEmptyVehicle()]);
  };

  const removeVehicle = (idx: number) => {
    setVehicleEntries(prev => prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx));
    setCollapsedVehicles(prev => {
      const next = new Set<number>();
      prev.forEach(vi => { if (vi < idx) next.add(vi); else if (vi > idx) next.add(vi - 1); });
      return next;
    });
  };

  const toggleCollapse = (idx: number) => {
    setCollapsedVehicles(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const handleSubmit = () => {
    if (vehicleEntries.length === 0) {
      show('At least one vehicle is required.', 'error');
      return;
    }
    if (!perVehiclePlaceOfWork && !billPlaceOfWork.trim()) {
      show(t('required'), 'error');
      return;
    }

    for (let i = 0; i < vehicleEntries.length; i++) {
      const ve = vehicleEntries[i];
      if (!ve.vehicle_id) {
        show(`Vehicle ${i + 1}: ${t('vehicleNumber')} is required.`, 'error');
        return;
      }
      if (!ve.driver_id) {
        show(`Vehicle ${i + 1}: ${t('driver')} is required.`, 'error');
        return;
      }
      if (perVehiclePlaceOfWork && !ve.place_of_work.trim()) {
        show(`Vehicle ${i + 1}: ${t('placeOfWork')} is required.`, 'error');
        return;
      }
      const errors = validateSessions(ve.sessions, ve.rate_type);
      if (errors.length > 0) {
        show(`Vehicle ${i + 1}: ${errors[0]}`, 'error');
        return;
      }
    }

    const builtVehicles: VehicleEntryData[] = vehicleEntries.map((ve, idx) => {
      const { calcResult, applicableRateMaster } = vehicleCalcs[idx];
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
      } : {
        rate_master_id: null as string | null,
        rate_version: null as number | null,
        capacity_tons: null as string | null,
        first_hour_rate: null as number | null,
        second_hour_rate: null as number | null,
        third_hour_rate_snapshot: null as number | null,
        fourth_hour_rate_snapshot: null as number | null,
        fifth_hour_rate_snapshot: null as number | null,
        weekly_rate_snapshot: null as number | null,
        daily_rate_snapshot: null as number | null,
        monthly_rate_snapshot: null as number | null,
        batha_snapshot: null as number | null,
      };
      return {
        ...ve,
        place_of_work: perVehiclePlaceOfWork ? ve.place_of_work : billPlaceOfWork,
        total_hours: calcResult.total_hours,
        rental_amount: calcResult.rental_amount,
        total_amount: Math.round((calcResult.rental_amount + calcResult.batha) * 100) / 100,
        ...rateSnapshot,
      };
    });

    const data: MultiVehicleTripFormData = {
      trip_date: tripDate,
      place_of_work: billPlaceOfWork,
      customer_id: customerId || null,
      vehicles: builtVehicles,
      up_transportation_enabled: upTransportEnabled,
      up_transportation_amount: upTransportEnabled ? Number(upTransportAmount) || 0 : 0,
      down_transportation_enabled: downTransportEnabled,
      down_transportation_amount: downTransportEnabled ? Number(downTransportAmount) || 0 : 0,
      remarks: remarks || null,
      total_hours: billTotals.totalHours,
      total_amount: billTotals.grandTotal,
      total_batha: billTotals.totalBatha,
      total_rental: billTotals.totalRental,
    };

    onSubmit(data);
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      {extraTop}

      {/* Bill-level Info */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Field label={t('date')} required>
          <DatePicker value={tripDate} onChange={v => setTripDate(v)} />
        </Field>
        {!hideCustomerSelect && (
          <Field label={t('customer')}>
            <select className={inputClass()} value={customerId} onChange={e => setCustomerId(e.target.value || '')} disabled={!!lockedCustomerId}>
              <option value="">-</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        )}
        {!perVehiclePlaceOfWork && (
          <Field label={t('placeOfWork')} required>
            <input className={inputClass()} value={billPlaceOfWork} onChange={e => setBillPlaceOfWork(e.target.value)} placeholder="e.g. Hyderabad" />
          </Field>
        )}
      </div>

      {/* Vehicle / Equipment Entries */}
      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-slate-700">Vehicle / Equipment Entries</h4>
        {vehicleEntries.map((ve, vIdx) => {
          const { calcResult, applicableRateMaster, selectedVehicle } = vehicleCalcs[vIdx];
          const isCollapsed = collapsedVehicles.has(vIdx);
          const usedIds = new Set(getUsedVehicleIds);
          usedIds.delete(ve.vehicle_id);
          const filteredVs = getFilteredVehicles(ve.vehicle_type_filter, ve.tons);

          return (
            <div key={vIdx} className="rounded-lg border border-slate-200 shadow-sm overflow-hidden">
              {/* Vehicle header bar */}
              <div className="flex items-center justify-between px-4 py-3 bg-slate-50 cursor-pointer" onClick={() => toggleCollapse(vIdx)}>
                <div className="flex items-center gap-3 text-sm">
                  <span className="font-semibold text-slate-700">Vehicle {vIdx + 1}</span>
                  {ve.vehicle_id && (
                    <span className="text-slate-500">
                      {ve.vehicle_number ?? '-'}
                      {ve.driver_id && ` • ${employees.find(e => e.id === ve.driver_id)?.name ?? ''}`}
                      {calcResult.total_hours > 0 && ` • ${formatDuration(calcResult.total_hours)}`}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {calcResult.rental_amount > 0 && (
                    <span className="text-sm font-semibold text-slate-900">{formatCurrency(calcResult.rental_amount + calcResult.batha)}</span>
                  )}
                  {vehicleEntries.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); removeVehicle(vIdx); }}
                      className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded"
                      title="Remove vehicle"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                  <button type="button" onClick={() => toggleCollapse(vIdx)} className="p-1 text-slate-400 hover:text-slate-600">
                    {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Vehicle body */}
              {!isCollapsed && (
                <div className="p-4 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <Field label="Vehicle Type" required>
                      <select className={inputClass()} value={ve.vehicle_type_filter} onChange={e => onVehicleTypeFilterChange(vIdx, e.target.value as VehicleTypeFilter)}>
                        <option value="Crane">Crane</option>
                        <option value="JCB">JCB</option>
                      </select>
                    </Field>
                    {ve.vehicle_type_filter === 'Crane' && (
                      <Field label="Tons / Capacity" required>
                        <select className={inputClass()} value={ve.tons} onChange={e => onVehicleTonsChange(vIdx, e.target.value)}>
                          <option value="">Select Tons</option>
                          {availableTons.map(tn => <option key={tn} value={tn}>{tn} Ton</option>)}
                        </select>
                      </Field>
                    )}
                    <Field label={t('vehicleNumber')} required>
                      {filteredVs.length === 0 ? (
                        <div className="text-sm text-red-500 py-2">No active {ve.vehicle_type_filter} vehicles{ve.vehicle_type_filter === 'Crane' && ve.tons ? ' for selected tons' : ''}.</div>
                      ) : (
                        <SearchableSelect
                          value={ve.vehicle_id}
                          onChange={val => onVehicleSelect(vIdx, val)}
                          placeholder="Select Vehicle"
                          searchPlaceholder="Search vehicle number..."
                          options={filteredVs.map(v => {
                            const isBooked = bookedVehicleIds.has(v.id);
                            const isUsed = usedIds.has(v.id);
                            return {
                              value: v.id,
                              label: `${v.registration_number}${isBooked ? ' — Booked' : ''}${isUsed ? ' — Selected' : ''}`,
                              disabled: isBooked || isUsed,
                              searchText: v.registration_number,
                            };
                          })}
                        />
                      )}
                    </Field>
                    <Field label={t('driver')} required>
                      <SearchableSelect
                        value={ve.driver_id}
                        onChange={val => updateVehicleEntry(vIdx, { driver_id: val, driver_name: employees.find(emp => emp.id === val)?.name ?? null })}
                        placeholder="-"
                        searchPlaceholder="Search driver name..."
                        options={drivers.map(d => ({
                          value: d.id,
                          label: `${d.name} (${d.role})`,
                          searchText: d.name,
                        }))}
                      />
                    </Field>
                    <Field label={t('rateType')}>
                      <select className={inputClass()} value={ve.rate_type} onChange={e => onVehicleRateTypeChange(vIdx, e.target.value as RateType)}>
                        <option value="Hourly">Hourly</option>
                        <option value="Daily">Full Day</option>
                        <option value="Weekly">Weekly</option>
                        <option value="Monthly">Monthly</option>
                      </select>
                    </Field>
                    {perVehiclePlaceOfWork && (
                      <Field label={t('placeOfWork')} required>
                        <input className={inputClass()} value={ve.place_of_work} onChange={e => updateVehicleEntry(vIdx, { place_of_work: e.target.value })} placeholder="e.g. Hyderabad" />
                      </Field>
                    )}
                    <Field label={t('batha')}>
                      <input type="number" step="0.01" className={inputClass()} value={ve.batha} onChange={e => updateVehicleEntry(vIdx, { batha: e.target.value === '' ? 0 : Number(e.target.value) })} placeholder="Auto from Rate Master" />
                    </Field>
                  </div>

                  {/* Sessions for this vehicle */}
                  <div className="space-y-2">
                    {calcResult.sessions.map((session, sIdx) => (
                      <div key={sIdx} className="p-3 bg-white rounded-lg border border-slate-200">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-slate-600">{t('session')} {sIdx + 1}</span>
                          {ve.sessions.length > 1 && (
                            <button type="button" onClick={() => removeVehicleSession(vIdx, sIdx)} className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700">
                              <Trash2 className="w-3 h-3" /> {t('removeSession')}
                            </button>
                          )}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                          <Field label={t('rateType')}>
                            <select className={inputClass()} value={ve.sessions[sIdx].rate_type ?? ve.rate_type} onChange={e => updateVehicleSession(vIdx, sIdx, { rate_type: e.target.value as RateType })}>
                              <option value="Hourly">Hourly</option>
                              <option value="Daily">Full Day</option>
                              <option value="Weekly">Weekly</option>
                              <option value="Monthly">Monthly</option>
                            </select>
                          </Field>
                          {((ve.sessions[sIdx].rate_type ?? ve.rate_type) === 'Hourly') && (
                            <>
                              <Field label={t('inTime')} required>
                                <DateTimePicker value={ve.sessions[sIdx].in_time ?? ''} onChange={v => updateVehicleSession(vIdx, sIdx, { in_time: v || null })} />
                              </Field>
                              <Field label={t('outTime')} required>
                                <DateTimePicker value={ve.sessions[sIdx].out_time ?? ''} onChange={v => updateVehicleSession(vIdx, sIdx, { out_time: v || null })} />
                              </Field>
                              <Field label={t('openingHourMeter')}>
                                <input type="number" step="0.01" className={inputClass()} value={ve.sessions[sIdx].opening_hour_meter ?? ''} onChange={e => updateVehicleSession(vIdx, sIdx, { opening_hour_meter: e.target.value === '' ? null : Number(e.target.value) })} placeholder="Opening meter" />
                              </Field>
                              <Field label={t('closingHourMeter')}>
                                <input type="number" step="0.01" className={inputClass()} value={ve.sessions[sIdx].closing_hour_meter ?? ''} onChange={e => updateVehicleSession(vIdx, sIdx, { closing_hour_meter: e.target.value === '' ? null : Number(e.target.value) })} placeholder="Closing meter" />
                              </Field>
                            </>
                          )}
                        </div>
                        <div className="grid grid-cols-1 gap-2 mt-1">
                          <Field label={t('remarks')}>
                            <input className={inputClass()} value={ve.sessions[sIdx].remarks ?? ''} onChange={e => updateVehicleSession(vIdx, sIdx, { remarks: e.target.value })} placeholder="Session remarks" />
                          </Field>
                        </div>
                        {session.session_amount > 0 && (
                          <div className="mt-2 space-y-1">
                            {session.session_breakdown && (
                              <div className="text-xs text-slate-500">Rate: {session.session_breakdown}</div>
                            )}
                            <div className="flex items-center justify-between px-3 py-1.5 bg-blue-50 rounded-lg text-sm">
                              <span className="text-slate-500">{t('sessionDuration')}: <span className="font-semibold text-slate-800">{session.duration_minutes > 0 ? formatDuration(session.duration_hours) : (ve.sessions[sIdx].rate_type ?? ve.rate_type) === 'Daily' ? 'Full Day' : (ve.sessions[sIdx].rate_type ?? ve.rate_type)}</span></span>
                              <span className="font-bold text-slate-900">{formatCurrency(session.session_amount)}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                    <button type="button" onClick={() => addVehicleSession(vIdx)} className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-blue-600 border border-dashed border-blue-300 rounded-lg hover:bg-blue-50 transition-colors">
                      <Plus className="w-4 h-4" /> {t('addSession')}
                    </button>
                  </div>

                  {/* Vehicle summary */}
                  <div className="flex items-center justify-between px-3 py-2 bg-blue-50 rounded-lg text-sm">
                    <div className="flex gap-4">
                      <span className="text-slate-500">Duration: <span className="font-semibold text-slate-800">{formatDuration(calcResult.total_hours)}</span></span>
                      <span className="text-slate-500">Rental: <span className="font-semibold text-slate-800">{formatCurrency(calcResult.rental_amount)}</span></span>
                      <span className="text-slate-500">Batha: <span className="font-semibold text-slate-800">{formatCurrency(calcResult.batha)}</span></span>
                    </div>
                    <span className="font-bold text-slate-900">{formatCurrency(calcResult.rental_amount + calcResult.batha)}</span>
                  </div>
                  {selectedVehicle && !applicableRateMaster && (
                    <div className="text-xs text-amber-600 px-1">
                      Rate not configured for {selectedVehicle.registration_number}. Please configure the rate in Rate Master.
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        <button type="button" onClick={addVehicle} className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-blue-600 border border-dashed border-blue-300 rounded-lg hover:bg-blue-50 transition-colors w-full justify-center">
          <Plus className="w-4 h-4" /> Add Vehicle
        </button>
      </div>

      {/* Transportation Charges */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="p-4 border border-slate-200 rounded-lg">
          <label className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-slate-700">UP Transportation Charges</span>
            <button type="button" onClick={() => setUpTransportEnabled(v => !v)} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${upTransportEnabled ? 'bg-blue-600' : 'bg-slate-300'}`}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${upTransportEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </label>
          {upTransportEnabled && (
            <input type="number" step="0.01" className={inputClass()} value={upTransportAmount || ''} onChange={e => setUpTransportAmount(e.target.value === '' ? 0 : Number(e.target.value))} placeholder="Enter UP transportation amount" />
          )}
        </div>
        <div className="p-4 border border-slate-200 rounded-lg">
          <label className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-slate-700">DOWN Transportation Charges</span>
            <button type="button" onClick={() => setDownTransportEnabled(v => !v)} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${downTransportEnabled ? 'bg-blue-600' : 'bg-slate-300'}`}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${downTransportEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </label>
          {downTransportEnabled && (
            <input type="number" step="0.01" className={inputClass()} value={downTransportAmount || ''} onChange={e => setDownTransportAmount(e.target.value === '' ? 0 : Number(e.target.value))} placeholder="Enter DOWN transportation amount" />
          )}
        </div>
      </div>

      {/* Bill Summary */}
      <div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-semibold text-blue-800">Bill Summary</h4>
          <span className="text-xs text-slate-500">{vehicleEntries.length} Vehicle{vehicleEntries.length !== 1 ? 's' : ''} • Total Hours: <span className="font-semibold text-slate-700">{formatDuration(billTotals.totalHours)}</span></span>
        </div>

        {/* Vehicle-wise breakdown */}
        <div className="space-y-2 mb-3">
          {vehicleEntries.map((ve, idx) => {
            const { calcResult } = vehicleCalcs[idx];
            return (
              <div key={idx} className="flex items-center justify-between px-3 py-2 bg-white rounded-lg border border-blue-100 text-sm">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="font-semibold text-slate-700">{ve.vehicle_number ?? `Vehicle ${idx + 1}`}</span>
                  <span className="text-slate-500">Duration: <span className="font-semibold text-slate-800">{formatDuration(calcResult.total_hours)}</span></span>
                  <span className="text-slate-500">Rental: <span className="font-semibold text-slate-800">{formatCurrency(calcResult.rental_amount)}</span></span>
                  <span className="text-slate-500">Batha: <span className="font-semibold text-slate-800">{formatCurrency(calcResult.batha)}</span></span>
                </div>
                <span className="font-bold text-slate-900">{formatCurrency(calcResult.rental_amount + calcResult.batha)}</span>
              </div>
            );
          })}
        </div>

        {(upTransportEnabled || downTransportEnabled) && (
          <div className="grid grid-cols-2 gap-3 text-sm mb-2">
            {upTransportEnabled && <div><span className="text-slate-500">UP Transport: </span><span className="font-semibold text-slate-800">{formatCurrency(upTransportAmount)}</span></div>}
            {downTransportEnabled && <div><span className="text-slate-500">DOWN Transport: </span><span className="font-semibold text-slate-800">{formatCurrency(downTransportAmount)}</span></div>}
          </div>
        )}

        <div className="border-t border-blue-200 pt-2 mt-2 flex justify-between text-sm">
          <span className="font-bold text-blue-800">Grand Total</span>
          <span className="font-bold text-slate-900 text-base">{formatCurrency(billTotals.grandTotal)}</span>
        </div>
      </div>

      <Field label={t('remarks')}>
        <input className={inputClass()} value={remarks} onChange={e => setRemarks(e.target.value)} />
      </Field>

      {extraBottom}

      <div className="flex justify-end gap-3">
        {onCancel && (
          <Button variant="secondary" onClick={onCancel} disabled={submitting}>{t('cancel')}</Button>
        )}
        <Button onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Saving...' : submitLabel}
        </Button>
      </div>
    </div>
  );
}
