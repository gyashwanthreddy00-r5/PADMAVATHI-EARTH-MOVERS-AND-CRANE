/*
  # Allow decimal quantities on invoice_billing_lines.days (for Monthly billing)

  `days` was an integer, fine for "No. of Days" (Full Day billing) but too
  narrow for the new Monthly rate type's "Quantity (Months)", which must
  support decimals like 1.5 or 3.25. Widens the column to numeric - every
  existing integer value converts losslessly, and the existing
  `days > 0` check still applies to decimals.

  This column is reused (not renamed) for both Full Day's day-count and
  Monthly's month-count, distinguished by the row's own `rate_type`.
*/

ALTER TABLE public.invoice_billing_lines
  ALTER COLUMN days TYPE numeric USING days::numeric;
