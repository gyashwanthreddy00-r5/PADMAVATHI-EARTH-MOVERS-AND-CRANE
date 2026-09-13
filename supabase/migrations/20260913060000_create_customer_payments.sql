/*
  # Customer-wise payments for GST / Company Billing

  Adds a customer-level payment record ("Record Company Payment") that sits on
  top of the existing per-invoice `invoice_payments` ledger rather than
  replacing it - every other screen that already reads `invoice_payments`
  (Settlement Report, Customer Billing Report, statements, reminders,
  Dashboard totals) keeps working unchanged and automatically reflects
  customer-wise payments too, since each one is just tagged allocation rows
  in the same table.

  1. New table: `customer_payments`
     - One row per "Record Company Payment" action: customer_id, payment_date,
       payment_mode, amount (the total received), reference, notes.
     - This is the header a single payment is split from; the actual per-
       invoice allocations are ordinary `invoice_payments` rows (see below).

  2. `invoice_payments.customer_payment_id` (nullable, FK to customer_payments)
     - Tags which customer-wise payment (if any) an allocation row came from,
       so Payment History can group them back together and show "Allocated
       Invoices" for one payment. NULL for every existing row and for any
       future payment still recorded per-invoice (e.g. Settlement Report's
       own Record Payment action, which is unchanged) - fully backward
       compatible, no data migration needed.

  3. Security
     - Same pattern as every other table here: RLS enabled, authenticated
       users get full CRUD.
*/

CREATE TABLE IF NOT EXISTS public.customer_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  payment_mode text NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  reference text,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_payments_customer ON public.customer_payments (customer_id, payment_date DESC);

ALTER TABLE public.customer_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_select_customer_payments" ON public.customer_payments FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_customer_payments" ON public.customer_payments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_customer_payments" ON public.customer_payments FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_delete_customer_payments" ON public.customer_payments FOR DELETE TO authenticated USING (true);

ALTER TABLE public.invoice_payments
  ADD COLUMN IF NOT EXISTS customer_payment_id uuid REFERENCES public.customer_payments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_payments_customer_payment ON public.invoice_payments (customer_payment_id);
