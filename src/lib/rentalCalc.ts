import type { RateMaster, RateType } from '@/types';
import { formatDuration, formatCurrency } from '@/lib/utils';

export interface SessionInput {
  in_time: string | null;
  out_time: string | null;
  opening_hour_meter: number | null;
  closing_hour_meter: number | null;
  remarks?: string | null;
}

export interface SessionResult extends SessionInput {
  session_number: number;
  duration_minutes: number;
  duration_hours: number;
  session_amount: number;
  session_breakdown: string;
}

export interface TransportationCharges {
  up_enabled: boolean;
  up_amount: number;
  down_enabled: boolean;
  down_amount: number;
}

export interface RentalCalcResult {
  sessions: SessionResult[];
  total_minutes: number;
  total_hours: number;
  rental_amount: number;
  batha: number;
  up_transportation: number;
  down_transportation: number;
  taxable_amount: number;
  rate_type: RateType;
  rate_master_id: string | null;
  rate_version: number | null;
  first_hour_rate: number;
  second_hour_rate: number;
  daily_rate: number;
  monthly_rate: number;
  weekly_rate: number;
  capacity_tons: string | null;
  batha_snapshot: number | null;
  calculation_breakdown: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function calcMinutesFromTime(inTime: string | null, outTime: string | null): number {
  if (!inTime || !outTime) return 0;
  const i = new Date(inTime).getTime();
  const o = new Date(outTime).getTime();
  if (isNaN(i) || isNaN(o) || o < i) return 0;
  return Math.round((o - i) / (1000 * 60));
}

function calcMinutesFromMeter(opening: number | null, closing: number | null): number {
  if (opening == null || closing == null) return 0;
  if (closing < opening) return 0;
  return Math.round((closing - opening) * 60);
}

export function calcSessionMinutes(session: SessionInput): number {
  const fromMeter = calcMinutesFromMeter(session.opening_hour_meter, session.closing_hour_meter);
  const fromTime = calcMinutesFromTime(session.in_time, session.out_time);
  return fromMeter || fromTime;
}

/**
 * Core hourly billing for a single session.
 *
 * Rules:
 * - First 1 hour: first_hour_rate × 1
 * - Each full hour after the first: second_hour_rate × 1
 * - Remaining partial minutes: (second_hour_rate / 60) × minutes
 * - If duration >= 8 hours and fullDayRate > 0: use fullDayRate (do NOT keep adding hourly)
 *
 * Returns raw (unrounded) amount.
 */
export function calcSessionAmountRaw(totalMinutes: number, rate1hr: number, rate2hr: number, fullDayRate: number): number {
  if (totalMinutes <= 0) return 0;

  // Full day rule: 8 hours or more
  if (fullDayRate > 0 && totalMinutes >= 8 * 60) {
    return fullDayRate;
  }

  const fullHours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;

  // First hour (or fraction thereof if under 1 hour)
  if (fullHours < 1) {
    // Partial first hour: prorate first_hour_rate
    return (totalMinutes / 60) * rate1hr;
  }

  let total = rate1hr; // first full hour
  // Each subsequent full hour at second_hour_rate
  for (let i = 1; i < fullHours; i++) {
    total += rate2hr;
  }
  // Remaining minutes at per-minute second_hour_rate
  if (remainingMinutes > 0) {
    total += (remainingMinutes / 60) * rate2hr;
  }
  return total;
}

const MINUTES_PER_DAY = 24 * 60;

/**
 * Full Day billing: split duration into full 24-hour days + remaining partial time.
 * Full days × dailyRate + remaining time billed hourly.
 */
export function calcFullDayAmountRaw(totalMinutes: number, rate1hr: number, rate2hr: number, dailyRate: number): number {
  if (totalMinutes <= 0 || dailyRate <= 0) return 0;
  const fullDays = Math.floor(totalMinutes / MINUTES_PER_DAY);
  const remainingMinutes = totalMinutes % MINUTES_PER_DAY;
  let total = fullDays * dailyRate;
  if (remainingMinutes > 0) {
    total += calcSessionAmountRaw(remainingMinutes, rate1hr, rate2hr, 0);
  }
  return total;
}

export function calcFullDayAmount(totalMinutes: number, rate1hr: number, rate2hr: number, dailyRate: number): number {
  return round2(calcFullDayAmountRaw(totalMinutes, rate1hr, rate2hr, dailyRate));
}

/**
 * Human-readable breakdown for Full Day billing.
 */
function buildFullDayBreakdown(
  minutes: number,
  r1: number,
  r2: number,
  dailyRate: number,
  amount: number,
): string {
  if (minutes <= 0) return '0';
  const fullDays = Math.floor(minutes / MINUTES_PER_DAY);
  const remainingMinutes = minutes % MINUTES_PER_DAY;
  const parts: string[] = [];
  if (fullDays > 0) {
    parts.push(`${fullDays} Day${fullDays > 1 ? 's' : ''} × ${formatCurrency(dailyRate)} = ${formatCurrency(round2(fullDays * dailyRate))}`);
  }
  if (remainingMinutes > 0) {
    const fullHours = Math.floor(remainingMinutes / 60);
    const remMinutes = remainingMinutes % 60;
    if (fullHours < 1) {
      const fracAmount = round2((remainingMinutes / 60) * r1);
      parts.push(`${remainingMinutes} Min × (${formatCurrency(r1)}/60) = ${formatCurrency(fracAmount)}`);
    } else {
      const subParts: string[] = [`1st Hr = ${formatCurrency(r1)}`];
      if (fullHours > 1) {
        subParts.push(`${fullHours - 1} Hr × ${formatCurrency(r2)} = ${formatCurrency(round2((fullHours - 1) * r2))}`);
      }
      if (remMinutes > 0) {
        subParts.push(`${remMinutes} Min × (${formatCurrency(r2)}/60) = ${formatCurrency(round2(remMinutes * (r2 / 60)))}`);
      }
      parts.push(subParts.join(' + '));
    }
  }
  parts.push(`= ${formatCurrency(amount)}`);
  return parts.join(' + ');
}

/**
 * Returns rounded session amount.
 */
export function calcSessionAmount(totalMinutes: number, rate1hr: number, rate2hr: number, fullDayRate: number): number {
  return round2(calcSessionAmountRaw(totalMinutes, rate1hr, rate2hr, fullDayRate));
}

export interface LineCalcInput {
  rate_type: RateType;
  quantity: number;
  rate: number;
  first_hour_rate: number | null;
  second_hour_rate: number | null;
  daily_rate: number | null;
  minimum_hours: number | null;
  minimum_charge: number | null;
  batha: number;
  from_date?: string | null;
  to_date?: string | null;
}

export function calcLineAmount(line: LineCalcInput): number {
  const r1 = Number(line.first_hour_rate) || 0;
  const r2 = Number(line.second_hour_rate) || 0;
  const dailyRate = Number(line.daily_rate) || 0;
  const batha = Number(line.batha) || 0;
  const qty = Number(line.quantity) || 0;

  if (line.rate_type === 'Couple of Dates') {
    let days = 0;
    if (line.from_date && line.to_date) {
      const d1 = new Date(line.from_date).getTime();
      const d2 = new Date(line.to_date).getTime();
      days = Math.max(1, Math.round((d2 - d1) / 86400000) + 1);
    }
    const effectiveQty = days > 0 ? days : 1;
    return round2(dailyRate * effectiveQty + batha);
  }

  if (line.rate_type === 'Daily') {
    const totalMinutes = qty * 60;
    return round2(calcFullDayAmountRaw(totalMinutes, r1, r2, dailyRate) + batha);
  }

  if (line.rate_type === 'Weekly') {
    return round2(Number(line.rate) * qty + batha);
  }

  if (line.rate_type === 'Monthly') {
    return round2(Number(line.rate) * qty + batha);
  }

  // Hourly — same engine as Trip Entry
  const totalMinutes = qty * 60;
  let calcAmount = calcSessionAmount(totalMinutes, r1, r2, dailyRate);

  const minCharge = Number(line.minimum_charge) || 0;
  const minHours = Number(line.minimum_hours) || 0;
  if (minCharge > 0 && minHours > 0 && qty < minHours) {
    calcAmount = Math.max(calcAmount, minCharge);
  }

  return round2(calcAmount + batha);
}

/**
 * Human-readable breakdown for a single session.
 */
function buildSessionBreakdown(
  minutes: number,
  r1: number,
  r2: number,
  fullDayRate: number,
  amount: number,
): string {
  if (minutes <= 0) return '0';

  if (fullDayRate > 0 && minutes >= 8 * 60) {
    return `Duration >= 8 Hr → Full Day Rate = ${formatCurrency(fullDayRate)}`;
  }

  const fullHours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (fullHours < 1) {
    // Partial first hour
    const fracAmount = round2((minutes / 60) * r1);
    return `${minutes} Min × (${formatCurrency(r1)}/60) = ${formatCurrency(fracAmount)}`;
  }

  const parts: string[] = [`1st Hr = ${formatCurrency(r1)}`];
  if (fullHours > 1) {
    const extraHrs = fullHours - 1;
    parts.push(`${extraHrs} Hr × ${formatCurrency(r2)} = ${formatCurrency(round2(extraHrs * r2))}`);
  }
  if (remainingMinutes > 0) {
    const perMin = r2 / 60;
    const fracAmount = round2(remainingMinutes * perMin);
    parts.push(`${remainingMinutes} Min × (${formatCurrency(r2)}/60) = ${formatCurrency(fracAmount)}`);
  }
  parts.push(`= ${formatCurrency(amount)}`);
  return parts.join(' + ');
}

export function calcRental(
  sessions: SessionInput[],
  rateType: RateType,
  rateMaster: RateMaster | null,
  batha: number,
  transportation?: TransportationCharges,
): RentalCalcResult {
  const r1 = rateMaster ? Number(rateMaster.first_hour_rate) || 0 : 0;
  const r2 = rateMaster ? Number(rateMaster.second_hour_rate) || 0 : 0;
  const dailyRate = rateMaster ? Number(rateMaster.daily_rate) || 0 : 0;
  const monthlyRate = rateMaster ? Number(rateMaster.monthly_rate) || 0 : 0;
  const weeklyRate = rateMaster ? Number(rateMaster.weekly_rate) || 0 : 0;

  const sessionResults: SessionResult[] = sessions.map((s, idx) => {
    const minutes = calcSessionMinutes(s);
    let sessionAmount = 0;
    let sessionBd = '';

    if (rateType === 'Daily') {
      sessionAmount = dailyRate;
      sessionBd = `Full Day Rate = ${formatCurrency(dailyRate)}`;
    } else if (rateType === 'Monthly') {
      sessionAmount = monthlyRate;
      sessionBd = `Monthly Rate = ${formatCurrency(monthlyRate)}`;
    } else if (rateType === 'Weekly') {
      sessionAmount = weeklyRate;
      sessionBd = `Weekly Rate = ${formatCurrency(weeklyRate)}`;
    } else {
      // Hourly / Both
      sessionAmount = calcSessionAmount(minutes, r1, r2, dailyRate);
      sessionBd = buildSessionBreakdown(minutes, r1, r2, dailyRate, sessionAmount);
    }

    return {
      ...s,
      session_number: idx + 1,
      duration_minutes: minutes,
      duration_hours: round2(minutes / 60),
      session_amount: sessionAmount,
      session_breakdown: sessionBd,
    };
  });

  const totalMinutes = sessionResults.reduce((sum, s) => sum + s.duration_minutes, 0);
  const totalHours = round2(totalMinutes / 60);

  let rentalAmount: number;
  if (rateType === 'Daily') {
    // For Daily/Monthly/Weekly with multiple sessions, each session gets the flat rate
    rentalAmount = round2(sessionResults.reduce((sum, s) => sum + s.session_amount, 0));
  } else if (rateType === 'Monthly') {
    rentalAmount = round2(sessionResults.reduce((sum, s) => sum + s.session_amount, 0));
  } else if (rateType === 'Weekly') {
    rentalAmount = round2(sessionResults.reduce((sum, s) => sum + s.session_amount, 0));
  } else {
    // Hourly: sum of per-session amounts
    rentalAmount = round2(sessionResults.reduce((sum, s) => sum + s.session_amount, 0));
  }

  const bathaAmount = round2(batha);
  const upTransport = round2(transportation?.up_enabled ? Number(transportation.up_amount) || 0 : 0);
  const downTransport = round2(transportation?.down_enabled ? Number(transportation.down_amount) || 0 : 0);
  const taxableAmount = round2(rentalAmount + bathaAmount + upTransport + downTransport);

  const breakdown = buildCalculationBreakdown(sessionResults, totalHours, rateType, r1, r2, dailyRate, rentalAmount);

  return {
    sessions: sessionResults,
    total_minutes: totalMinutes,
    total_hours: totalHours,
    rental_amount: rentalAmount,
    batha: bathaAmount,
    up_transportation: upTransport,
    down_transportation: downTransport,
    taxable_amount: taxableAmount,
    rate_type: rateType,
    rate_master_id: rateMaster?.id ?? null,
    rate_version: rateMaster?.version_number ?? null,
    first_hour_rate: r1,
    second_hour_rate: r2,
    daily_rate: dailyRate,
    monthly_rate: monthlyRate,
    weekly_rate: weeklyRate,
    capacity_tons: rateMaster?.capacity_tons ?? null,
    batha_snapshot: rateMaster ? Number(rateMaster.batha) || null : null,
    calculation_breakdown: breakdown,
  };
}

function buildCalculationBreakdown(
  sessions: SessionResult[],
  totalHours: number,
  rateType: RateType,
  r1: number,
  r2: number,
  dailyRate: number,
  rentalAmount: number,
): string {
  const parts: string[] = [];

  if (rateType === 'Daily') {
    parts.push(`Full Day Rate = ${formatCurrency(dailyRate)}`);
    parts.push(`Total Rental = ${formatCurrency(rentalAmount)}`);
    return parts.join('\n');
  }
  if (rateType === 'Monthly' || rateType === 'Weekly') {
    sessions.forEach(s => {
      if (s.duration_minutes > 0) {
        parts.push(`Session ${s.session_number}: ${formatDuration(s.duration_hours)} = ${formatCurrency(s.session_amount)}`);
      }
    });
    parts.push(`Total Rental = ${formatCurrency(rentalAmount)}`);
    return parts.join('\n');
  }

  // Hourly: show per-session breakdown
  sessions.forEach(s => {
    if (s.duration_minutes > 0) {
      parts.push(`Session ${s.session_number}: ${formatDuration(s.duration_hours)} — ${s.session_breakdown}`);
    }
  });
  parts.push(`Total Rental Amount = ${formatCurrency(rentalAmount)}`);
  return parts.join('\n');
}

export function formatSessionsForInvoice(sessions: SessionResult[]): string {
  if (sessions.length === 0) return '';
  if (sessions.length === 1) {
    const s = sessions[0];
    return `Session 1: ${formatSessionTime(s)} (${formatDuration(s.duration_hours)}) = ${formatCurrency(s.session_amount)}`;
  }
  return sessions.map(s =>
    `Session ${s.session_number}: ${formatSessionTime(s)} (${formatDuration(s.duration_hours)}) = ${formatCurrency(s.session_amount)}`
  ).join('\n');
}

function formatSessionTime(s: SessionResult): string {
  const inStr = s.in_time ? new Date(s.in_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '--:--';
  const outStr = s.out_time ? new Date(s.out_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '--:--';
  return `${inStr} - ${outStr}`;
}

export function validateSessions(sessions: SessionInput[], rateType?: RateType): string[] {
  const errors: string[] = [];
  const skipTimeValidation = rateType === 'Daily' || rateType === 'Weekly' || rateType === 'Monthly';
  const validSessions = skipTimeValidation
    ? sessions
    : sessions.filter(s => s.in_time || s.out_time || s.opening_hour_meter != null || s.closing_hour_meter != null);

  if (validSessions.length === 0 && !skipTimeValidation) {
    errors.push('At least one session is required.');
  }

  if (!skipTimeValidation) {
    validSessions.forEach((s, idx) => {
      if (!s.in_time) errors.push(`Session ${idx + 1}: In-Time is required.`);
      if (!s.out_time) errors.push(`Session ${idx + 1}: Out-Time is required.`);
      if (s.in_time && s.out_time && new Date(s.out_time).getTime() < new Date(s.in_time).getTime()) {
        errors.push(`Session ${idx + 1}: Out-Time cannot be before In-Time.`);
      }
      if (s.opening_hour_meter != null && s.closing_hour_meter != null && Number(s.closing_hour_meter) < Number(s.opening_hour_meter)) {
        errors.push(`Session ${idx + 1}: Closing Hour Meter cannot be less than Opening Hour Meter.`);
      }
    });
  }

  return errors;
}
