/*
  # Rename PO Orders "Closed" status to "Completed"

  The PO Orders workflow no longer uses the word "Closed" anywhere - a PO
  moves from Active to Completed once its Invoice Number has been entered
  (enforced in the app, not the database). This only affects `po_orders`;
  `rate_master`'s own unrelated 'Closed' lifecycle status is untouched.

  1. Changes
    - Migrates any existing `po_orders.status = 'Closed'` rows to 'Completed'.
    - Replaces the status CHECK constraint to allow ('Active', 'Completed')
      instead of ('Active', 'Closed').
*/

UPDATE public.po_orders SET status = 'Completed' WHERE status = 'Closed';

ALTER TABLE public.po_orders DROP CONSTRAINT IF EXISTS po_orders_status_check;

ALTER TABLE public.po_orders
  ADD CONSTRAINT po_orders_status_check CHECK (status IN ('Active', 'Completed'));
