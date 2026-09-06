export function formatCurrency(amount: number | null | undefined): string {
  const value = Number(amount) || 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatNumber(amount: number | null | undefined, decimals = 2): string {
  const value = Number(amount) || 0;
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '-';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(date: string | Date | null | undefined): string {
  if (!date) return '-';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatTime(date: string | Date | null | undefined): string {
  if (!date) return '-';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function todayISO(): string {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().split('T')[0];
}

export function addDays(dateISO: string, days: number): string {
  const d = new Date(dateISO + 'T00:00:00');
  d.setDate(d.getDate() + days);
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().split('T')[0];
}

export function toISODate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().split('T')[0];
}

export function monthName(month: number): string {
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return names[month] || '';
}

export function amountInWords(amount: number): string {
  const num = Math.round(amount);
  if (num === 0) return 'Zero Rupees Only';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function twoDigits(n: number): string {
    if (n < 20) return ones[n];
    return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
  }
  function threeDigits(n: number): string {
    const h = Math.floor(n / 100);
    const r = n % 100;
    let str = '';
    if (h) str += ones[h] + ' Hundred';
    if (r) str += (h ? ' ' : '') + twoDigits(r);
    return str;
  }

  let result = '';
  let n = num;
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  const hundred = n;

  if (crore) result += twoDigits(crore) + ' Crore ';
  if (lakh) result += twoDigits(lakh) + ' Lakh ';
  if (thousand) result += twoDigits(thousand) + ' Thousand ';
  if (hundred) result += threeDigits(hundred);
  result = result.trim() || 'Zero';
  result += ' Rupees Only';
  return result;
}

export function calcHoursFromMeter(opening: number | null, closing: number | null): number {
  if (opening == null || closing == null) return 0;
  if (closing < opening) return 0;
  return Math.round((closing - opening) * 1000) / 1000;
}

export function calcHoursFromTime(inTime: string | null, outTime: string | null): number {
  if (!inTime || !outTime) return 0;
  const i = new Date(inTime).getTime();
  const o = new Date(outTime).getTime();
  if (isNaN(i) || isNaN(o) || o < i) return 0;
  return Math.round(((o - i) / (1000 * 60 * 60)) * 1000) / 1000;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function calcRentalFromSlabs(totalHours: number, rate: Pick<Rate, 'hour_1_rate' | 'hour_2_rate' | 'hour_3_rate' | 'hour_4_rate' | 'hour_5_rate'>): number {
  if (totalHours <= 0) return 0;
  const r1 = Number(rate.hour_1_rate) || 0;
  const r2 = Number(rate.hour_2_rate) || 0;
  const totalMinutes = Math.round(totalHours * 60);
  return calcSessionAmount(totalMinutes, r1, r2, 0);
}

export function calcRentalFromRateMaster(totalHours: number, rateType: string, rate: RateMaster | null): number {
  if (!rate) return 0;
  if (rateType === 'Daily') return Number(rate.daily_rate) || 0;
  if (rateType === 'Monthly') return Number(rate.monthly_rate) || 0;
  if (rateType === 'Weekly') return Number(rate.weekly_rate) || 0;
  if (rateType === 'Both' || rateType === 'Hourly') {
    if (totalHours <= 0) return 0;
    const r1 = Number(rate.first_hour_rate) || 0;
    const r2 = Number(rate.second_hour_rate) || 0;
    const daily = Number(rate.daily_rate) || 0;
    const totalMinutes = Math.round(totalHours * 60);
    return calcSessionAmount(totalMinutes, r1, r2, daily);
  }
  return Number(rate.daily_rate) || 0;
}

export function calcRentalForTrip(
  totalHours: number,
  rateType: string,
  rate: Rate | null,
  vehicle: { hourly_rate?: number | null; daily_rate?: number | null } | null,
): number {
  if (!rate) {
    if (rateType === 'Monthly') return 0;
    if (rateType === 'Weekly') return 0;
    if (totalHours <= 0) return 0;
    const totalMinutes = Math.round(totalHours * 60);
    return calcSessionAmount(totalMinutes, Number(vehicle?.hourly_rate) || 0, Number(vehicle?.hourly_rate) || 0, Number(vehicle?.daily_rate) || 0);
  }
  if (rateType === 'Daily') return Number(rate.daily_rate) || Number(vehicle?.daily_rate) || 0;
  if (rateType === 'Monthly') return Number(rate.monthly_rate) || 0;
  if (rateType === 'Weekly') return Number(rate.weekly_rate) || 0;
  return calcRentalFromSlabs(totalHours, rate);
}

export function downloadCSV(filename: string, rows: (string | number)[][]): void {
  const csv = rows.map(row =>
    row.map(cell => {
      const s = String(cell ?? '');
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }).join(',')
  ).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export interface ExportCompanyInfo {
  company_name: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  gstin?: string | null;
  pan?: string | null;
}

export function exportToExcelWithCompany(
  filename: string,
  title: string,
  company: ExportCompanyInfo,
  dateRange: string,
  generatedDate: string,
  filters: string,
  headers: string[],
  dataRows: (string | number)[][],
  totalRow?: (string | number)[],
): void {
  const contactParts = [
    company.phone ? `Phone: ${company.phone}` : null,
    company.email ? `Email: ${company.email}` : null,
    company.gstin ? `GSTIN: ${company.gstin}` : null,
    company.pan ? `PAN: ${company.pan}` : null,
  ].filter(Boolean);

  const rows: (string | number)[][] = [];
  rows.push([company.company_name]);
  if (company.address) rows.push([company.address]);
  if (contactParts.length > 0) rows.push([contactParts.join('  |  ')]);
  rows.push([]);
  rows.push([title]);
  rows.push(['Date Range:', dateRange]);
  rows.push(['Generated:', generatedDate]);
  if (filters) rows.push(['Filters:', filters]);
  rows.push([]);
  rows.push(headers);
  dataRows.forEach(r => rows.push(r));
  if (totalRow) rows.push(totalRow);
  downloadCSV(filename, rows);
}

// @deprecated Use calcSessionAmount from rentalCalc.ts instead.
// Kept for backward compatibility — delegates to the unified engine.
export function calcHourlyBilling(totalHours: number, rate1hr: number, rate2hr: number, fullDayRate: number): number {
  if (totalHours <= 0) return 0;
  const totalMinutes = Math.round(totalHours * 60);
  return calcSessionAmount(totalMinutes, rate1hr, rate2hr, fullDayRate);
}

export function getBillingBreakdown(totalHours: number, rate1hr: number, rate2hr: number, fullDayRate: number, rateType: string): string {
  if (rateType === 'Daily') {
    return `Full Day Rate = ${formatCurrency(fullDayRate)}`;
  }
  if (totalHours <= 0) return 'No duration entered';
  const totalMinutes = Math.round(totalHours * 60);
  const amount = calcSessionAmount(totalMinutes, rate1hr, rate2hr, fullDayRate);
  if (fullDayRate > 0 && totalMinutes >= 8 * 60) {
    return `Duration >= 8 Hr → Full Day Rate = ${formatCurrency(fullDayRate)}`;
  }
  const fullHours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  if (fullHours < 1) {
    const fracAmount = round2((totalMinutes / 60) * rate1hr);
    return `${totalMinutes} Min × (${formatCurrency(rate1hr)}/60) = ${formatCurrency(fracAmount)}`;
  }
  const parts: string[] = [`1st Hr = ${formatCurrency(rate1hr)}`];
  if (fullHours > 1) parts.push(`${fullHours - 1} Hr × ${formatCurrency(rate2hr)} = ${formatCurrency(round2((fullHours - 1) * rate2hr))}`);
  if (remainingMinutes > 0) {
    const perMin = rate2hr / 60;
    const fracAmount = round2(remainingMinutes * perMin);
    parts.push(`${remainingMinutes} Min × (${formatCurrency(rate2hr)}/60) = ${formatCurrency(fracAmount)}`);
  }
  parts.push(`= ${formatCurrency(amount)}`);
  return parts.join(' + ');
}

export function formatDuration(hours: number): string {
  if (!hours || hours <= 0) return '0 Min';
  const totalMinutes = Math.round(hours * 60);
  const days = Math.floor(totalMinutes / (24 * 60));
  const remainingAfterDays = totalMinutes % (24 * 60);
  const h = Math.floor(remainingAfterDays / 60);
  const m = remainingAfterDays % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} Day${days > 1 ? 's' : ''}`);
  if (h > 0) parts.push(`${h} Hr`);
  if (m > 0) parts.push(`${m} Min`);
  return parts.length > 0 ? parts.join(' ') : '0 Min';
}

export function vehicleTypeLabel(
  type: string | null | undefined,
  capacityTons?: string | number | null,
): string {
  if (type === 'JCB') return 'JCB';
  if (type === 'Crane') {
    if (capacityTons != null) {
      const num = String(capacityTons).replace(/[^0-9.]/g, '');
      if (num) return `${num} Tons`;
    }
    return 'Crane';
  }
  if (type) return type;
  return '';
}

export function sanitizePhone(value: string): string {
  return value.replace(/\D/g, '').slice(0, 10);
}

export function isValidPhone(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  return digits.length === 10;
}

export function phoneValidationError(value: string, required = false): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return required ? 'Phone number is required' : null;
  }
  if (!isValidPhone(trimmed)) {
    return 'Phone number must be exactly 10 digits';
  }
  return null;
}

export function classNames(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function debounce<T extends (...args: never[]) => void>(fn: T, delay: number): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

import { calcSessionAmount, calcFullDayAmountRaw } from '@/lib/rentalCalc';
import type { Rate, RateMaster, Trip } from '@/types';

export interface InvoiceLineDesc {
  description: string;
  calculation_details: string;
}

export function buildInvoiceLineDescription(tr: Pick<Trip,
  'rate_type' | 'total_hours' | 'rental_amount' | 'trip_date' | 'place_of_work' |
  'capacity_tons' | 'first_hour_rate' | 'second_hour_rate' |
  'weekly_rate_snapshot' | 'daily_rate_snapshot' | 'monthly_rate_snapshot'
> & {
  vehicle?: { registration_number?: string | null; type?: string | null; capacity?: string | number | null } | null;
  sessions?: { session_number: number; duration_hours: number; duration_minutes?: number; session_amount?: number; in_time?: string | null; rate_type?: string | null }[] | null;
  work_date?: string | null;
}): InvoiceLineDesc {
  const rateType = tr.rate_type;
  const vType = tr.vehicle?.type;
  const capacity = tr.capacity_tons || tr.vehicle?.capacity;
  let typeLabel = 'Vehicle';
  if (vType === 'JCB') {
    typeLabel = 'JCB';
  } else if (vType === 'Crane') {
    const tonsNum = capacity ? String(capacity).replace(/[^0-9.]/g, '') : '';
    typeLabel = tonsNum ? `${tonsNum} Tons Crane` : 'Crane';
  } else if (vType) {
    typeLabel = vType;
  }

  const tripDateStr = formatDate(tr.work_date || tr.trip_date);
  const placeStr = tr.place_of_work ?? '';
  const hoursStr = tr.total_hours != null && Number(tr.total_hours) > 0 ? formatDuration(Number(tr.total_hours)) : '';
  const vehicleStr = tr.vehicle?.registration_number ?? '';
  const sessions = tr.sessions;
  const sessionCount = sessions && sessions.length > 0 ? sessions.length : 1;
  const sessionStr = sessionCount > 1 ? `${sessionCount} Sessions` : '';
  const metaStr = [tripDateStr, vehicleStr, hoursStr, sessionStr].filter(Boolean).join(' | ');

  const rentalAmount = Number(tr.rental_amount) || 0;
  const r1 = Number(tr.first_hour_rate) || 0;
  const r2 = Number(tr.second_hour_rate) || 0;
  const dailyRate = Number(tr.daily_rate_snapshot) || 0;
  const coupleRate = Number(tr.weekly_rate_snapshot) || 0;
  const monthlyRate = Number(tr.monthly_rate_snapshot) || 0;

  const description = `${typeLabel}${metaStr ? ' — ' + metaStr : ''}`;

  // A recorded session is only "usable" for a per-session breakdown if it carries a real
  // duration, or it's a flat rate type (Daily/Weekly/Monthly) that doesn't need one. Some
  // older/other save paths record sessions with duration_minutes stuck at 0 — in that case
  // there's nothing per-session worth showing, so we fall back to the vehicle-level total
  // (total_hours / rental_amount, which are always saved correctly) instead of showing blanks.
  const hasUsableSessions = !!sessions && sessions.some(s =>
    (s.duration_minutes ?? Math.round(Number(s.duration_hours) * 60)) > 0 ||
    (!!s.rate_type && s.rate_type !== 'Hourly')
  );
  const hasMultipleSessions = hasUsableSessions && sessions!.length > 1;

  // These flat-rate shortcuts only apply when there's a single (or no) session to describe.
  // A vehicle with multiple usable recorded sessions — even if its overall rate_type is
  // Daily/Weekly/Monthly — is always handled per-session below so each session's own detail
  // still shows.
  if (rateType === 'Daily' && !hasMultipleSessions) {
    return {
      description,
      calculation_details: `Rental Amount = ${formatCurrency(rentalAmount)}`,
    };
  }
  if (rateType === 'Monthly' && !hasMultipleSessions) {
    return {
      description,
      calculation_details: `Monthly Rate = 1 Month × ${formatCurrency(monthlyRate || rentalAmount)} = ${formatCurrency(rentalAmount)}`,
    };
  }
  if (rateType === 'Weekly' && !hasMultipleSessions) {
    return {
      description,
      calculation_details: `Weekly Rate = ${formatCurrency(coupleRate || rentalAmount)} = ${formatCurrency(rentalAmount)}`,
    };
  }

  // If rates are missing but rental_amount exists (e.g. JCB with no rate snapshot), show the stored amount.
  // Only applies to the single-session fallback — a vehicle with multiple usable (possibly mixed
  // rate-type) sessions is always handled per-session below so each session's own rate is respected.
  if (r1 <= 0 && r2 <= 0 && rentalAmount > 0 && !hasMultipleSessions) {
    return {
      description,
      calculation_details: `Rental Amount = ${formatCurrency(rentalAmount)}\nNote: Rate is not configured in Rate Master.`,
    };
  }

  // Per-session breakdown. When no sessions are recorded (or none are usable — see above),
  // treat the whole booking as one synthetic session derived from total_hours so the same
  // logic handles both cases.
  const parts: string[] = [];
  const effectiveSessions = hasUsableSessions
    ? sessions!
    : [{
        session_number: 1,
        duration_hours: Number(tr.total_hours) || 0,
        duration_minutes: Math.round((Number(tr.total_hours) || 0) * 60),
        rate_type: rateType,
      }];
  const multiSession = effectiveSessions.length > 1;

  effectiveSessions.forEach(s => {
    const sRateType = s.rate_type ?? rateType;
    const sMinutes = s.duration_minutes ?? Math.round(Number(s.duration_hours) * 60);
    let sAmount: number;
    let sLabel: string;

    if (sRateType === 'Daily') {
      sAmount = s.session_amount != null ? Number(s.session_amount) : dailyRate;
      sLabel = `Full Day Amt = ${formatCurrency(sAmount)}`;
    } else if (sRateType === 'Weekly') {
      sAmount = s.session_amount != null ? Number(s.session_amount) : coupleRate;
      sLabel = `Weekly Rate = ${formatCurrency(sAmount)}`;
    } else if (sRateType === 'Monthly') {
      sAmount = s.session_amount != null ? Number(s.session_amount) : monthlyRate;
      sLabel = `Monthly Rate = ${formatCurrency(sAmount)}`;
    } else if (dailyRate > 0 && sMinutes >= 8 * 60) {
      sAmount = dailyRate;
      sLabel = `Duration >= 8 Hr → Full Day Rate = ${formatCurrency(dailyRate)}`;
    } else if (sMinutes > 0) {
      sAmount = s.session_amount != null ? Number(s.session_amount) : calcSessionAmount(sMinutes, r1, r2, dailyRate);
      const fullHours = Math.floor(sMinutes / 60);
      const remainingMinutes = sMinutes % 60;
      const extraHours = fullHours > 1 ? fullHours - 1 : 0;
      const minutesAmount = remainingMinutes > 0 ? round2(remainingMinutes * r2 / 60) : 0;
      const subParts: string[] = [`1st Hr ${formatCurrency(r1)}`];
      if (extraHours > 0) {
        subParts.push(`2nd Hr Onwards ${formatCurrency(r2)} × ${extraHours} Hr = ${formatCurrency(round2(extraHours * r2))}`);
      }
      if (remainingMinutes > 0) {
        subParts.push(`${remainingMinutes} Min ${formatCurrency(minutesAmount)}`);
      }
      sLabel = `${subParts.join(' + ')} = ${formatCurrency(sAmount)}`;
    } else {
      return;
    }

    parts.push(multiSession ? `Session ${s.session_number}: ${sLabel}` : sLabel);
  });

  parts.push(`Rental Amount = ${formatCurrency(rentalAmount)}`);
  return { description, calculation_details: parts.join('\n') };
}
