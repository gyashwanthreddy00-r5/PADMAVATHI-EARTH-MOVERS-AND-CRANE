/*
  # Add pre-tax Discount to invoices (GST / Company Billing)

  Adds a flat ₹ discount that GST/Company Billing invoices deduct from the
  taxable amount BEFORE GST is calculated. This is a distinct concept from
  the existing `discount_enabled`/`discount_percent`/`discount_amount`/
  `final_payable_amount` columns, which are a post-GST percentage rebate off
  the grand total (used by Quotations, Cash/UPI, Monthly Contracts, and
  Customer Invoices' own statement/reminder screens) — that feature is
  completely untouched by this migration.

  1. New columns on `invoices`
    - `pretax_discount_enabled` (boolean, default false)
    - `pretax_discount_amount` (numeric, default 0) — the discount actually
      applied (already clamped to the pre-discount taxable total by the app,
      never negative).
*/

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS pretax_discount_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pretax_discount_amount numeric NOT NULL DEFAULT 0;
