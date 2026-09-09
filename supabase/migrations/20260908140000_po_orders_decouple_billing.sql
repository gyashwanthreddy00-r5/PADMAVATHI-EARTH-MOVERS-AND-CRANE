/*
# PO Orders — decouple working-day entry from billing

Reworks the PO Orders working-record/billing relationship based on the real
workflow: working days get logged directly under a PO as they happen (no
Invoice Number/Bill Date required at that point), and are billed later by
selecting any combination of UNBILLED records into one invoice.

Changes (additive/preserving — no data is dropped, only reshaped):

1. `po_working_records`
   - Add `po_order_id` (NOT NULL after backfill) — a working record now
     belongs to a specific PO Order directly, matching the new one-step
     entry form (Working Date -> Vehicle -> Ton auto -> VL No -> Rate Type
     -> [Hours/Minutes if Hourly]) instead of being a customer-wide pool.
     Existing rows are backfilled to their customer's (only) existing PO
     Order.
   - Add `vl_no` (NOT NULL, default '' for backfill) — VL No moves here
     from the old po_order_lines, since it's entered when the working day
     is logged, not when it's billed.
   - Drop `batta` — removed from this module per updated requirements.

2. `po_order_lines`
   - Becomes a pure billing junction: a row only exists once a working
     record has actually been included in an invoice. All the working-day
     detail (date, ton, vehicle, rate type, hours, minutes, vl_no) already
     lives on the linked `po_working_records` row, so it's no longer
     duplicated here.
   - Drops the now-redundant snapshot columns (customer_id, working_date,
     ton, vehicle_id, vehicle_number, rate_type, hours, minutes, vl_no) and
     `batta`.
   - `working_record_id` becomes NOT NULL (a line cannot exist without its
     source working record) and remains UNIQUE (a working record can only
     be billed once, across any PO).

No table is dropped. RLS policies are unchanged (same authenticated
full-CRUD pattern already in place).
*/

-- =============================================================
-- 1. po_working_records: add po_order_id + vl_no, drop batta
-- =============================================================
ALTER TABLE public.po_working_records
  ADD COLUMN IF NOT EXISTS po_order_id uuid REFERENCES public.po_orders(id) ON DELETE CASCADE;

-- Backfill existing rows to their customer's existing PO Order (there is
-- exactly one per customer with data at this point in the module's life).
UPDATE public.po_working_records w
SET po_order_id = (
  SELECT p.id FROM public.po_orders p
  WHERE p.customer_id = w.customer_id
  ORDER BY p.created_at ASC
  LIMIT 1
)
WHERE w.po_order_id IS NULL;

ALTER TABLE public.po_working_records
  ALTER COLUMN po_order_id SET NOT NULL;

ALTER TABLE public.po_working_records
  ADD COLUMN IF NOT EXISTS vl_no text NOT NULL DEFAULT '';

ALTER TABLE public.po_working_records
  DROP COLUMN IF EXISTS batta;

CREATE INDEX IF NOT EXISTS idx_po_working_records_po_order ON public.po_working_records (po_order_id, working_date);

-- =============================================================
-- 2. po_order_lines: simplify to a pure billing junction
-- =============================================================
ALTER TABLE public.po_order_lines
  DROP COLUMN IF EXISTS customer_id,
  DROP COLUMN IF EXISTS working_date,
  DROP COLUMN IF EXISTS ton,
  DROP COLUMN IF EXISTS vehicle_id,
  DROP COLUMN IF EXISTS vehicle_number,
  DROP COLUMN IF EXISTS rate_type,
  DROP COLUMN IF EXISTS hours,
  DROP COLUMN IF EXISTS minutes,
  DROP COLUMN IF EXISTS vl_no,
  DROP COLUMN IF EXISTS batta;

ALTER TABLE public.po_order_lines
  ALTER COLUMN working_record_id SET NOT NULL;
