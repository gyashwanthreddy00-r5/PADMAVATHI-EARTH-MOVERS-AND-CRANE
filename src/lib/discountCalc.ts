/**
 * Shared discount calculation engine.
 * Used by Quotations, Cash/UPI Invoices, GST/Company Billing Invoices, and Monthly Contracts.
 *
 * Discount is a percentage of the FINAL GRAND TOTAL (after GST).
 * Formula: Discount Amount = Grand Total × Discount % / 100
 *         Final Payable = Grand Total - Discount Amount
 */

export interface DiscountInput {
  grandTotal: number;
  discountEnabled: boolean;
  discountPercentage: number | null | undefined;
}

export interface DiscountResult {
  discountAmount: number;
  finalPayableAmount: number;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function calculateDiscount(input: DiscountInput): DiscountResult {
  const grandTotal = round2(Number(input.grandTotal) || 0);

  if (!input.discountEnabled) {
    return { discountAmount: 0, finalPayableAmount: grandTotal };
  }

  const pct = Number(input.discountPercentage) || 0;

  if (pct <= 0 || pct > 100) {
    return { discountAmount: 0, finalPayableAmount: grandTotal };
  }

  const discountAmount = round2((grandTotal * pct) / 100);
  const finalPayableAmount = round2(grandTotal - discountAmount);

  return { discountAmount, finalPayableAmount };
}

export function validateDiscountPercentage(value: number | null | undefined): string | null {
  if (value == null || value === 0) return null;
  const num = Number(value);
  if (isNaN(num)) return 'Discount percentage must be a number';
  if (num < 0) return 'Discount percentage cannot be negative';
  if (num > 100) return 'Discount percentage cannot exceed 100';
  return null;
}
