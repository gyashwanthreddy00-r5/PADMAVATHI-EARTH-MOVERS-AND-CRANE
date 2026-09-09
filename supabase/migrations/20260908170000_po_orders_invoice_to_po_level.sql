/*
# PO Orders — Invoice Number / Bill Date move to PO level

Invoice Number and Bill Date are entered ONCE per PO Order, at the final
stage after all working days have been added — not per working-day record.
The PO Order is the source of truth; it must not be duplicated per row.

1. `po_orders` gains `invoice_number` (text, nullable) and `bill_date`
   (date, nullable) — both optional, entered whenever the user is ready to
   bill, never required to create/save a PO or its working days.

2. Existing per-row values on `po_working_records` are backfilled up to
   their parent PO (one representative value per po_order_id, picking the
   earliest row that had one set) before being removed, so nothing already
   entered is lost.

3. `po_working_records.invoice_number` / `bill_date` are dropped — the UI
   and Print/Excel export now read these from the parent `po_orders` row
   and apply the same value to every working-day row, instead of storing
   it redundantly on each one.

This does not create or touch any row in the `invoices` table — PO Orders
still never creates a Customer Invoice automatically.
*/

ALTER TABLE public.po_orders
  ADD COLUMN IF NOT EXISTS invoice_number text,
  ADD COLUMN IF NOT EXISTS bill_date date;

UPDATE public.po_orders o
SET invoice_number = sub.invoice_number,
    bill_date = sub.bill_date
FROM (
  SELECT DISTINCT ON (po_order_id) po_order_id, invoice_number, bill_date
  FROM public.po_working_records
  WHERE invoice_number IS NOT NULL
  ORDER BY po_order_id, created_at
) sub
WHERE o.id = sub.po_order_id
  AND o.invoice_number IS NULL;

ALTER TABLE public.po_working_records
  DROP COLUMN IF EXISTS invoice_number,
  DROP COLUMN IF EXISTS bill_date;
