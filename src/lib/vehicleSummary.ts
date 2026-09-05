import type { InvoiceVehicle, InvoiceVehicleSession } from '@/types';
import { calcSessionAmount } from '@/lib/rentalCalc';

export interface VehicleSummaryRow {
  vehicle: string;
  driver: string;
  sessions: number;
  hrs: string;
  rental: number;
  batha: number;
  total: number;
}

function formatHrsShort(minutes: number): string {
  if (minutes <= 0) return '-';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (m === 0) return `${h}H`;
  return `${h}H${m}M`;
}

function sessionLabel(s: InvoiceVehicleSession, dailyRate: number, fallbackRateType: string | null): string {
  const minutes = s.duration_minutes || 0;
  const sRateType = s.rate_type ?? fallbackRateType;
  if (sRateType === 'Daily' || (dailyRate > 0 && minutes >= 8 * 60)) return 'FULLDAY';
  if (sRateType === 'Monthly') return '1MONTH';
  if (sRateType === 'Weekly') return '1WEEK';
  return formatHrsShort(minutes);
}

export function buildVehicleSummary(invVehicles: InvoiceVehicle[]): VehicleSummaryRow[] {
  return invVehicles.map(iv => {
    const sessions = iv.sessions ?? [];
    const sessionCount = sessions.length || 1;
    const r1 = Number(iv.first_hour_rate) || 0;
    const r2 = Number(iv.second_hour_rate) || 0;
    const dRate = Number(iv.daily_rate_snapshot) || 0;
    const baseRental = Number(iv.rental_amount) || 0;
    const batha = Number(iv.batha) || 0;
    const rateType = iv.rate_type ?? '';

    const hrs = sessions.length > 0
      ? sessions.map(s => sessionLabel(s, dRate, rateType)).join(' & ')
      : (rateType === 'Daily' || (dRate > 0 && Math.round(Number(iv.total_hours) * 60) >= 8 * 60)
        ? 'FULLDAY'
        : formatHrsShort(Math.round(Number(iv.total_hours) * 60)));

    let rental = baseRental;
    if (rateType === 'Hourly' && sessions.length > 0) {
      const totalMinutes = Math.round(Number(iv.total_hours) * 60);
      const hourlyAmount = calcSessionAmount(totalMinutes, r1, r2, dRate);
      if (hourlyAmount > 0 && baseRental > 0 && Math.abs(hourlyAmount - baseRental) > 0.01) {
        rental = Math.round((baseRental + hourlyAmount) * 100) / 100;
      }
    }

    const total = Math.round((rental + batha) * 100) / 100;

    return {
      vehicle: [iv.vehicle_type, iv.vehicle_number].filter(Boolean).join(' ') || '-',
      driver: iv.driver_name ?? '-',
      sessions: sessionCount,
      hrs,
      rental,
      batha,
      total,
    };
  });
}
