/*
# GST Billing lines — add No. of Days for Full Day entries

The New GST Invoice flow (`GstBillingEntry.tsx`, `invoice_billing_lines`)
needs a "No. of Days" quantity for Full Day ("Daily") working-day entries,
so Rental Amount = No. of Days x Full Day Rate and Batha Amount = No. of
Days x Batha/day, while the per-day Rate itself (first_hour_rate) and the
per-day Batha rate (batha) stay exactly as looked up from Rate Master.

Inspected the existing schema first: there is no pre-existing
quantity-style column on this table that could be reused for this —
`hours`/`minutes` are Hourly-only fields, and there is no generic
"quantity" column — so `days` is a genuinely new, additive column.

Nullable (no NOT NULL, no DEFAULT) on purpose: existing Full Day rows
created before this column existed have no real day-count on record, and
must be left as NULL rather than silently backfilled with a guessed value
(e.g. 1) that could misrepresent historical billing. The application
treats a NULL `days` as 1 for historical display only — it never writes
that guess back to the row.

Only `invoice_billing_lines` is touched, only by adding this one column.
No existing column, row, or other table (`invoices`, `invoice_vehicles`,
`invoice_vehicle_sessions`, `invoice_items`, every PO Orders table) is
altered or deleted.
*/

ALTER TABLE public.invoice_billing_lines
  ADD COLUMN IF NOT EXISTS days integer CHECK (days IS NULL OR days > 0);
