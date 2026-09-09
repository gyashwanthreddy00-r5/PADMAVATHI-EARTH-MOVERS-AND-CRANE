/*
# GST Invoice — editable invoice-details fields

The GST Tax Invoice print's top-right "invoice details" block (Buyer's Order
Date, Dispatched through, Bill of Lading/LR-RR No., Reference Date, Terms of
Delivery day-count) needs to be user-editable and persisted per invoice, not
just computed at print time. Most of the underlying fields already exist on
`invoices` (delivery_note, reference_no, buyer_order_no, dispatch_doc_no,
delivery_note_date, destination, terms_of_payment, motor_vehicle_numbers) —
this only adds the ones that don't.

Only `invoices` is touched. Nothing else changes.
*/

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS reference_date date,
  ADD COLUMN IF NOT EXISTS buyer_order_date date,
  ADD COLUMN IF NOT EXISTS dispatched_through text,
  ADD COLUMN IF NOT EXISTS bill_of_lading_no text,
  ADD COLUMN IF NOT EXISTS terms_of_delivery_days integer NOT NULL DEFAULT 28;
