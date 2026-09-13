import type { PurchaseOrder, PurchaseOrderStatus } from '@/types';
import { todayISO } from '@/lib/utils';

// Fixed per spec - PO calculation always uses CGST 9% + SGST 9% (18%),
// independent of the company's configurable GST Billing tax rate.
export const PO_CGST_PERCENT = 9;
export const PO_SGST_PERCENT = 9;

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface PoItemAmounts {
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  totalAmount: number;
}

export function computePoItemAmounts(quantity: number, unitRate: number): PoItemAmounts {
  const taxableAmount = round2((Number(quantity) || 0) * (Number(unitRate) || 0));
  const cgstAmount = round2(taxableAmount * PO_CGST_PERCENT / 100);
  const sgstAmount = round2(taxableAmount * PO_SGST_PERCENT / 100);
  const totalAmount = round2(taxableAmount + cgstAmount + sgstAmount);
  return { taxableAmount, cgstAmount, sgstAmount, totalAmount };
}

/**
 * The PO's status is only ever fully authoritative right after a write (create or
 * utilization deduction), since "Valid To passed" can become true purely with the
 * passage of time with no write happening. Every read path (list, filters,
 * dashboard alerts) should derive the *effective* status from the raw fields
 * instead of trusting a possibly-stale stored `status` column - this is what
 * satisfies "Automatic Status Update" without needing a cron job/DB trigger.
 */
export function getEffectivePoStatus(po: Pick<PurchaseOrder, 'remaining_amount' | 'valid_to'>): PurchaseOrderStatus {
  if (Number(po.remaining_amount) <= 0) return 'Completed';
  if (po.valid_to && po.valid_to < todayISO()) return 'Expired';
  return 'Active';
}

// Fixed per spec - a PO is "low balance" once its remaining amount drops to (or
// below) this exact figure, e.g. Remaining ₹20,000.00 alerts, ₹20,001 does not.
export const PO_LOW_BALANCE_THRESHOLD = 20000;

export function isPoLowBalance(po: Pick<PurchaseOrder, 'remaining_amount' | 'valid_to'>): boolean {
  if (getEffectivePoStatus(po) !== 'Active') return false;
  return Number(po.remaining_amount) > 0 && Number(po.remaining_amount) <= PO_LOW_BALANCE_THRESHOLD;
}
