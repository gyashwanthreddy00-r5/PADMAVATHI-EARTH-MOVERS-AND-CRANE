import type { PoRateType } from '@/types';
import { calcSessionAmount } from '@/lib/rentalCalc';

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface PoLineAmounts {
  rateFound: boolean;
  firstRate: number | null;
  secondRate: number | null;
  firstAmt: number | null;
  secondAmt: number | null;
  /** Row total before GST. */
  subtotal: number | null;
  /** 18% of subtotal. */
  gstAmount: number | null;
  /** subtotal + gstAmount. */
  totalAmount: number | null;
}

const GST_RATE = 0.18;

/**
 * Compute one working-day row's full billing breakdown, using a Rate Master
 * record already resolved via `findRateMasterForVehicle`
 * (src/lib/rateLookup.ts) — PO Orders has no rate table of its own, it reuses
 * the same Rate Master as Trips/Invoices.
 *
 * - `Daily` ("Full Day" in the UI): bills at the Rate Master's flat
 *   daily_rate. First/Second Hour Rate and Amt are not applicable (null).
 * - `Hourly`: first hour at first_hour_rate; every whole hour after that at
 *   second_hour_rate; remaining minutes at second_hour_rate/60 — the same
 *   engine Trips/Invoices already use (calcSessionAmount).
 *
 * GST 18% is computed per row (on that row's own subtotal) and also sums
 * linearly across rows for the PO-level Subtotal/GST/Grand Total.
 */
export function computePoLineAmounts(
  rateType: PoRateType,
  hours: number,
  minutes: number,
  rate: { daily_rate: number | null; first_hour_rate: number | null; second_hour_rate: number | null } | null,
): PoLineAmounts {
  if (!rate) {
    return { rateFound: false, firstRate: null, secondRate: null, firstAmt: null, secondAmt: null, subtotal: null, gstAmount: null, totalAmount: null };
  }

  if (rateType === 'Daily') {
    const dayRate = Number(rate.daily_rate) || 0;
    const gst = round2(dayRate * GST_RATE);
    return { rateFound: true, firstRate: null, secondRate: null, firstAmt: null, secondAmt: null, subtotal: dayRate, gstAmount: gst, totalAmount: round2(dayRate + gst) };
  }

  const r1 = Number(rate.first_hour_rate) || 0;
  const r2 = Number(rate.second_hour_rate) || 0;
  const totalMinutes = Math.round(hours * 60 + minutes);
  const subtotal = calcSessionAmount(totalMinutes, r1, r2, 0);
  const firstAmt = totalMinutes < 60 ? round2((totalMinutes / 60) * r1) : r1;
  const secondAmt = round2(subtotal - firstAmt);
  const gst = round2(subtotal * GST_RATE);

  return { rateFound: true, firstRate: r1, secondRate: r2, firstAmt, secondAmt, subtotal, gstAmount: gst, totalAmount: round2(subtotal + gst) };
}
