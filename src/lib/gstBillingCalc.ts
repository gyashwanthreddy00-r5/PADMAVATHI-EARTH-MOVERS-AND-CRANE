import type { PoRateType } from '@/types';
import { calcSessionAmount } from '@/lib/rentalCalc';

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface BillingLineAmounts {
  rateFound: boolean;
  firstRate: number | null;
  secondRate: number | null;
  firstAmt: number | null;
  secondAmt: number | null;
  /** First + second hour amount (or Full Day rate) — excludes Batta. */
  rentalAmount: number | null;
}

/**
 * Compute one GST-billing line's rate/amount breakdown from a Rate Master
 * record already resolved via `findRateMasterForVehicle`
 * (src/lib/rateLookup.ts) — no separate rate table for this module.
 *
 * - `Daily` ("Full Day"): bills at the Rate Master's flat daily_rate.
 * - `Hourly`: first hour at first_hour_rate; every whole hour after that at
 *   second_hour_rate; remaining minutes at second_hour_rate/60 — the same
 *   engine Trips/Invoices already use (calcSessionAmount).
 */
export function computeBillingLineAmounts(
  rateType: PoRateType,
  hours: number,
  minutes: number,
  rate: { daily_rate: number | null; first_hour_rate: number | null; second_hour_rate: number | null } | null,
): BillingLineAmounts {
  if (!rate) {
    return { rateFound: false, firstRate: null, secondRate: null, firstAmt: null, secondAmt: null, rentalAmount: null };
  }

  if (rateType === 'Daily') {
    const dayRate = Number(rate.daily_rate) || 0;
    return { rateFound: true, firstRate: dayRate, secondRate: 0, firstAmt: dayRate, secondAmt: 0, rentalAmount: dayRate };
  }

  const r1 = Number(rate.first_hour_rate) || 0;
  const r2 = Number(rate.second_hour_rate) || 0;
  const totalMinutes = Math.round(hours * 60 + minutes);
  const rentalAmount = calcSessionAmount(totalMinutes, r1, r2, 0);
  const firstAmt = totalMinutes < 60 ? round2((totalMinutes / 60) * r1) : r1;
  const secondAmt = round2(rentalAmount - firstAmt);

  return { rateFound: true, firstRate: r1, secondRate: r2, firstAmt, secondAmt, rentalAmount };
}
