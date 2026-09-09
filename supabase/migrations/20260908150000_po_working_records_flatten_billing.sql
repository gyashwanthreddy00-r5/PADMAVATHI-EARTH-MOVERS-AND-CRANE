/*
# PO Orders — flatten billing onto po_working_records, remove invoice-creation step

This screen is for maintaining working-day billing data and printing/exporting
it — it must NOT create a record in the Customer Invoices module, and must not
force an invoice-creation step at all. Simplifies the structure to exactly two
tables (matching the required logical structure):

  po_orders
  po_working_records

`po_order_lines` is removed — there is no separate "billing junction" anymore.
Each working record carries its own computed rate/amount snapshot plus
OPTIONAL `invoice_number` / `bill_date` that the user can fill in whenever
they like (at entry time, later, or never) directly on that row.

1. `po_working_records` gains:
   - `first_hour_rate`, `second_hour_rate`, `first_hour_amount`,
     `second_hour_amount` (nullable — blank for Full Day rows, matching the
     required table columns).
   - `subtotal`, `gst_amount`, `total_amount` — computed once when the row is
     added (GST 18% on that row's subtotal), stored so Print/Export Excel
     read exactly what's on screen without recomputing.
   - `invoice_number` (nullable text), `bill_date` (nullable date) — OPTIONAL,
     editable any time, never required to save a working record.
   No `valid_from`/`valid_to`/`batta` — not part of this table, as required.

2. `po_order_lines` is dropped. Its `invoice_number`/`bill_date` are migrated
   back onto the `po_working_records` rows they referenced first, so nothing
   already entered is lost.

Existing working-day rows (9 rows, all test/demo data entered while building
this module — no real customer billing has gone through it yet) keep their
core fields; their new rate/amount columns are left NULL since replicating
the point-in-time Rate Master lookup in SQL isn't reliable — the UI shows
"—" for these until they're re-saved, which is a one-time cosmetic gap only
for this pre-migration test data.
*/

-- =============================================================
-- 1. po_working_records: add rate/amount snapshot + optional billing fields
-- =============================================================
ALTER TABLE public.po_working_records
  ADD COLUMN IF NOT EXISTS first_hour_rate numeric,
  ADD COLUMN IF NOT EXISTS second_hour_rate numeric,
  ADD COLUMN IF NOT EXISTS first_hour_amount numeric,
  ADD COLUMN IF NOT EXISTS second_hour_amount numeric,
  ADD COLUMN IF NOT EXISTS subtotal numeric,
  ADD COLUMN IF NOT EXISTS gst_amount numeric,
  ADD COLUMN IF NOT EXISTS total_amount numeric,
  ADD COLUMN IF NOT EXISTS invoice_number text,
  ADD COLUMN IF NOT EXISTS bill_date date;

-- Migrate invoice_number/bill_date back from po_order_lines before dropping it.
UPDATE public.po_working_records w
SET invoice_number = l.invoice_number,
    bill_date = l.bill_date
FROM public.po_order_lines l
WHERE l.working_record_id = w.id;

CREATE INDEX IF NOT EXISTS idx_po_working_records_invoice ON public.po_working_records (invoice_number);

-- =============================================================
-- 2. Drop po_order_lines — no invoice-creation step in this module anymore
-- =============================================================
DROP TABLE IF EXISTS public.po_order_lines;
