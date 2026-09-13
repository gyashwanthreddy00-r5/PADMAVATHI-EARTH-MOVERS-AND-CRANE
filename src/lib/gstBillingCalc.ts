import type { PoRateType } from '@/types';
import { calcSessionAmount } from '@/lib/rentalCalc';

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface BillingLineAmounts {
  rateFound: boolean;
  /** Set only when rateFound is false because Rate Master exists for this vehicle but
   *  its Monthly Rate specifically is empty/zero - lets the UI show the exact
   *  "Monthly rate not configured in Rate Master" message instead of the generic
   *  "no rate master entry" one. */
  reason?: 'monthly_rate_missing';
  firstRate: number | null;
  secondRate: number | null;
  firstAmt: number | null;
  secondAmt: number | null;
  /** First + second hour amount (or Full Day/Monthly rate x quantity) - excludes Batta. */
  rentalAmount: number | null;
}

/**
 * Compute one GST-billing line's rate/amount breakdown from a Rate Master
 * record already resolved via `findRateMasterForVehicle`
 * (src/lib/rateLookup.ts) - no separate rate table for this module.
 *
 * - `Daily` ("Full Day"): bills at the Rate Master's flat daily_rate times
 *   `days` - the per-day Rate itself is never multiplied/changed, only the
 *   resulting Rental Amount is.
 * - `Monthly`: bills at the Rate Master's flat monthly_rate times `days`
 *   (reused as a decimal month-quantity, e.g. 1.5 or 3.25) - same shape as
 *   Daily, just a different Rate Master field and never rounded to a whole
 *   number.
 * - `Hourly`: first hour at first_hour_rate; every whole hour after that at
 *   second_hour_rate; remaining minutes at second_hour_rate/60 - the same
 *   engine Trips/Invoices already use (calcSessionAmount). `days` is not
 *   used here.
 */
export function computeBillingLineAmounts(
  rateType: PoRateType,
  hours: number,
  minutes: number,
  rate: { daily_rate: number | null; first_hour_rate: number | null; second_hour_rate: number | null; monthly_rate?: number | null } | null,
  days: number = 1,
): BillingLineAmounts {
  if (!rate) {
    return { rateFound: false, firstRate: null, secondRate: null, firstAmt: null, secondAmt: null, rentalAmount: null };
  }

  if (rateType === 'Daily') {
    const dayRate = Number(rate.daily_rate) || 0;
    const numDays = days > 0 ? days : 1;
    const rentalAmount = round2(dayRate * numDays);
    return { rateFound: true, firstRate: dayRate, secondRate: 0, firstAmt: rentalAmount, secondAmt: 0, rentalAmount };
  }

  if (rateType === 'Monthly') {
    const monthlyRate = Number(rate.monthly_rate) || 0;
    if (monthlyRate <= 0) {
      return { rateFound: false, reason: 'monthly_rate_missing', firstRate: null, secondRate: null, firstAmt: null, secondAmt: null, rentalAmount: null };
    }
    const numMonths = days > 0 ? days : 1;
    const rentalAmount = round2(monthlyRate * numMonths);
    return { rateFound: true, firstRate: monthlyRate, secondRate: 0, firstAmt: rentalAmount, secondAmt: 0, rentalAmount };
  }

  const r1 = Number(rate.first_hour_rate) || 0;
  const r2 = Number(rate.second_hour_rate) || 0;
  const totalMinutes = Math.round(hours * 60 + minutes);
  const rentalAmount = calcSessionAmount(totalMinutes, r1, r2, 0);
  const firstAmt = totalMinutes < 60 ? round2((totalMinutes / 60) * r1) : r1;
  const secondAmt = round2(rentalAmount - firstAmt);

  return { rateFound: true, firstRate: r1, secondRate: r2, firstAmt, secondAmt, rentalAmount };
}
