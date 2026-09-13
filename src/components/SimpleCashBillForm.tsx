import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { Field, inputClass, LoadingSpinner } from '@/components/ui/common';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { DatePicker } from '@/components/ui/DatePicker';
import { formatCurrency, formatNumber, formatDuration, todayISO, classNames } from '@/lib/utils';
import { calcSessionAmount } from '@/lib/rentalCalc';
import { findRateMasterForVehicle } from '@/lib/rateLookup';
import type { Vehicle, RateMaster } from '@/types';
import type { MultiVehicleTripFormData, VehicleEntryData } from '@/components/TripEntryForm';

type SimpleRateType = 'Daily' | 'Hourly' | 'Monthly';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Vehicle.capacity is stored inconsistently across records - some already include a
// "Ton" suffix, some don't - so strip it first and re-append once, rather than assuming
// either way and risking "11 Ton Ton".
function formatTons(capacity: string | null | undefined): string {
  if (!capacity) return '';
  const bare = capacity.replace(/\s*tons?$/i, '').trim();
  return bare ? `${bare} Ton` : '';
}

interface Props {
  /** Fires on every change with the current bill data, or null while the entry isn't
   * complete/valid yet (no vehicle picked, no rate found, zero duration, etc.) - the
   * parent (CashBills.tsx) uses this to enable/disable its own Save Bill button and,
   * on click, passes the last non-null value straight into the existing save() pipeline. */
  onChange: (data: MultiVehicleTripFormData | null) => void;
}

/**
 * Fast, single-vehicle Cash/UPI billing entry: pick a vehicle (Ton/Type auto-fill from
 * Vehicle Master), pick Full Day or Hourly, and - for Hourly - type Hours/Minutes
 * directly instead of in/out times. Rate Master lookup and the hourly first/second-hour
 * calculation reuse the same engine as the rest of the app (rateLookup.ts +
 * rentalCalc.calcSessionAmount) - nothing here re-derives billing math. Operator Batha is
 * a manual, transaction-level charge only — it is never read from Rate Master.
 */
export function SimpleCashBillForm({ onChange }: Props) {
  const [loading, setLoading] = useState(true);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [rateMasterRows, setRateMasterRows] = useState<RateMaster[]>([]);

  const [workingDate, setWorkingDate] = useState(todayISO());
  const [vehicleId, setVehicleId] = useState('');
  const [rateType, setRateType] = useState<SimpleRateType>('Hourly');
  const [hours, setHours] = useState('');
  const [minutes, setMinutes] = useState('');
  // Full Day only — number of full days billed. Whole numbers only (no existing Cash/UPI
  // calculation supports fractional days), minimum 1, default 1. Not used for Hourly.
  const [days, setDays] = useState('1');
  // Monthly only — decimal quantity of months billed (e.g. 1.5), mirrors GST Billing's
  // "Quantity (Months)" field. Not used for Hourly/Daily.
  const [months, setMonths] = useState('1');
  // Operator Batha — manual, transaction-level entry only. Never auto-filled from Rate
  // Master; blank by default (never shows a "0") and treated as ₹0 in every
  // calculation below until the user actually types a value.
  const [batha, setBatha] = useState('');

  useEffect(() => {
    (async () => {
      const [vehRes, rateRes] = await Promise.all([
        supabase.from('vehicles').select('*').eq('active', true).order('registration_number'),
        supabase.from('rate_master').select('*').in('status', ['Active', 'Closed']),
      ]);
      setVehicles((vehRes.data ?? []) as Vehicle[]);
      setRateMasterRows((rateRes.data ?? []) as RateMaster[]);
      setLoading(false);
    })();
  }, []);

  const selectedVehicle = vehicles.find(v => v.id === vehicleId) ?? null;
  const rateMaster = useMemo(
    () => (selectedVehicle ? findRateMasterForVehicle(selectedVehicle, rateMasterRows, workingDate) : null),
    [selectedVehicle, rateMasterRows, workingDate]
  );

  const totalMinutes = rateType === 'Hourly' ? (Number(hours) || 0) * 60 + (Number(minutes) || 0) : 0;
  const r1 = Number(rateMaster?.first_hour_rate) || 0;
  const r2 = Number(rateMaster?.second_hour_rate) || 0;
  const dailyRate = Number(rateMaster?.daily_rate) || 0;
  const monthlyRate = Number(rateMaster?.monthly_rate) || 0;
  // Full Day only — Hourly's own duration/rate math (calcSessionAmount below) is
  // completely unaffected by Number of Days.
  const daysNum = rateType === 'Daily' ? Math.max(1, Math.floor(Number(days) || 1)) : 1;
  // Monthly only — decimal quantity of months, e.g. 1.5 or 3.25 (never rounded to a
  // whole number, unlike Number of Days).
  const monthsNum = rateType === 'Monthly' ? Math.max(0.01, Number(months) || 1) : 1;

  // here — this is the one calculation source, reused as-is.
  // Full Day: Rental = Full Day Rate x Number of Days (at Days = 1 this is identical to
  // the previous flat-rate behavior). Batha scales the same way for Full Day; Hourly's
  // Batha stays the single flat amount it always was.
  // Monthly: Rental = Monthly Rate x Quantity (Months) — same shape as Full Day, just a
  // different Rate Master field and a decimal-capable quantity.
  const rentalAmount = !rateMaster ? 0
    : rateType === 'Daily' ? round2(dailyRate * daysNum)
    : rateType === 'Monthly' ? round2(monthlyRate * monthsNum)
    : calcSessionAmount(totalMinutes, r1, r2, 0);
  const bathaAmount = rateType === 'Daily' ? round2((Number(batha) || 0) * daysNum)
    : rateType === 'Monthly' ? round2((Number(batha) || 0) * monthsNum)
    : (Number(batha) || 0);
  const totalAmount = round2(rentalAmount + bathaAmount);

  const monthlyRateMissing = rateType === 'Monthly' && !!rateMaster && monthlyRate <= 0;
  const isReady = !!selectedVehicle && !!rateMaster && !monthlyRateMissing && (rateType === 'Hourly' ? totalMinutes > 0 : true);

  useEffect(() => {
    if (!isReady || !selectedVehicle || !rateMaster) { onChange(null); return; }
    const vehicleEntry: VehicleEntryData = {
      vehicle_id: selectedVehicle.id,
      vehicle_number: selectedVehicle.registration_number,
      vehicle_type: selectedVehicle.type,
      vehicle_type_filter: selectedVehicle.type === 'JCB' ? 'JCB' : 'Crane',
      vehicle_capacity: selectedVehicle.capacity,
      driver_id: '',
      driver_name: null,
      place_of_work: '',
      rate_type: rateType,
      tons: selectedVehicle.capacity ?? '',
      sessions: [],
      batha: bathaAmount,
      total_hours: rateType === 'Hourly' ? round2(totalMinutes / 60) : 0,
      rental_amount: rentalAmount,
      total_amount: totalAmount,
      rate_master_id: rateMaster.id,
      rate_version: rateMaster.version_number,
      capacity_tons: rateMaster.capacity_tons,
      first_hour_rate: rateMaster.first_hour_rate,
      second_hour_rate: rateMaster.second_hour_rate,
      third_hour_rate_snapshot: rateMaster.third_hour_rate,
      fourth_hour_rate_snapshot: rateMaster.fourth_hour_rate,
      fifth_hour_rate_snapshot: rateMaster.fifth_hour_rate,
      weekly_rate_snapshot: rateMaster.weekly_rate,
      daily_rate_snapshot: rateMaster.daily_rate,
      monthly_rate_snapshot: rateMaster.monthly_rate,
      batha_snapshot: rateMaster.batha,
    };
    const data: MultiVehicleTripFormData = {
      trip_date: workingDate,
      place_of_work: '',
      customer_id: null,
      vehicles: [vehicleEntry],
      up_transportation_enabled: false,
      up_transportation_amount: 0,
      down_transportation_enabled: false,
      down_transportation_amount: 0,
      remarks: null,
      total_hours: vehicleEntry.total_hours,
      total_amount: totalAmount,
      total_batha: bathaAmount,
      total_rental: rentalAmount,
    };
    onChange(data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, selectedVehicle, rateMaster, rateType, totalMinutes, daysNum, monthsNum, batha, bathaAmount, workingDate, rentalAmount, totalAmount]);

  if (loading) return <LoadingSpinner />;

  const autoFieldClass = classNames(inputClass(), 'bg-slate-100 text-slate-600 font-medium');

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Work Details</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Working Date" required>
            <DatePicker value={workingDate} onChange={setWorkingDate} />
          </Field>
          <Field label="Vehicle" required>
            <SearchableSelect
              value={vehicleId}
              onChange={setVehicleId}
              placeholder="Select vehicle"
              searchPlaceholder="Search vehicle number..."
              options={vehicles.map(v => ({
                value: v.id,
                label: `${v.registration_number} - ${v.type}${v.capacity ? ' ' + formatTons(v.capacity) : ''}`,
              }))}
            />
          </Field>
          <Field label="Ton">
            <div className={autoFieldClass}>{formatTons(selectedVehicle?.capacity) || '-'}</div>
          </Field>
          <Field label="Type">
            <div className={autoFieldClass}>{selectedVehicle?.type ?? '-'}</div>
          </Field>
        </div>
      </div>

      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Billing</p>
        <div className="grid grid-cols-3 gap-2 mb-3 max-w-md">
          {(['Hourly', 'Daily', 'Monthly'] as const).map(rt => (
            <button
              key={rt}
              type="button"
              onClick={() => setRateType(rt)}
              className={classNames(
                'p-2.5 border rounded-lg text-sm font-semibold transition-colors',
                rateType === rt ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              )}
            >
              {rt === 'Daily' ? 'Full Day' : rt}
            </button>
          ))}
        </div>

        {selectedVehicle && !rateMaster && (
          <p className="text-xs text-amber-600 mb-3">Rate not configured for {selectedVehicle.registration_number}. Please configure it in Rate Master.</p>
        )}
        {monthlyRateMissing && (
          <p className="text-xs text-red-600 mb-3">Monthly rate not configured in Rate Master.</p>
        )}

        {rateType === 'Hourly' ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Field label="Hours" required>
              <input type="number" min="0" className={inputClass()} value={hours} onChange={e => setHours(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)).toString())} placeholder="0" />
            </Field>
            <Field label="Minutes" required>
              <input type="number" min="0" max="59" className={inputClass()} value={minutes} onChange={e => setMinutes(Math.min(59, Math.max(0, Number(e.target.value) || 0)).toString())} placeholder="0" />
            </Field>
            <Field label="Rate (1st Hr / 2nd Hr)">
              <div className={autoFieldClass}>{rateMaster ? `${formatNumber(r1)} / ${formatNumber(r2)}` : '-'}</div>
            </Field>
            <Field label="Operator Batha">
              <input type="number" min="0" step="0.01" className={inputClass()} value={batha} onChange={e => setBatha(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)).toString())} placeholder="Enter Operator Batha (Optional)" />
            </Field>
          </div>
        ) : rateType === 'Daily' ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Field label="Number of Days" required>
              <input type="number" min="1" step="1" className={inputClass()} value={days} onChange={e => setDays(Math.max(1, Math.floor(Number(e.target.value) || 1)).toString())} placeholder="1" />
            </Field>
            <Field label="Full Day Rate">
              <div className={autoFieldClass}>{rateMaster ? formatCurrency(dailyRate) : '-'}</div>
            </Field>
            <Field label="Operator Batha">
              <input type="number" min="0" step="0.01" className={inputClass()} value={batha} onChange={e => setBatha(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)).toString())} placeholder="Enter Operator Batha (Optional)" />
            </Field>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Field label="Quantity (Months)" required>
              <input type="number" min="0.01" step="0.01" className={inputClass()} value={months} onChange={e => setMonths(e.target.value)} placeholder="1" />
            </Field>
            <Field label="Monthly Rate">
              <div className={autoFieldClass}>{rateMaster ? formatCurrency(monthlyRate) : '-'}</div>
            </Field>
            <Field label="Operator Batha">
              <input type="number" min="0" step="0.01" className={inputClass()} value={batha} onChange={e => setBatha(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)).toString())} placeholder="Enter Operator Batha (Optional)" />
            </Field>
          </div>
        )}

        {isReady && (
          <div className="mt-3 flex flex-wrap items-center gap-4 p-3 bg-blue-50 rounded-lg text-sm">
            {rateType === 'Hourly' && <span className="text-slate-500">Duration: <b className="text-slate-800">{formatDuration(totalMinutes / 60)}</b></span>}
            {rateType === 'Daily' && <span className="text-slate-500">Days: <b className="text-slate-800">{daysNum}</b></span>}
            {rateType === 'Monthly' && <span className="text-slate-500">Quantity: <b className="text-slate-800">{monthsNum} month{monthsNum === 1 ? '' : 's'}</b></span>}
            <span className="text-slate-500">Rental: <b className="text-slate-800">{formatCurrency(rentalAmount)}</b></span>
            <span className="text-slate-500">Operator Batha: <b className="text-slate-800">{formatCurrency(bathaAmount)}</b></span>
            <span className="ml-auto font-bold text-blue-700 text-base">{formatCurrency(totalAmount)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
