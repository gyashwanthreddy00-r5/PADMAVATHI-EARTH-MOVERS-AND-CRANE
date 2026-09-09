/*
# GST Billing — multi working-day / multi-vehicle billing lines

Adds support for one GST invoice to contain many independent
(working date + vehicle) billing lines, instead of the single
date + nested vehicle/session model.

This is purely ADDITIVE:
  - `invoices`, `invoice_vehicles`, `invoice_vehicle_sessions`, `invoice_items`
    are completely untouched. Existing invoices keep working exactly as
    they do today (view, print, email, reports, settlement).
  - `invoice_vehicle_sessions`/`invoice_vehicles` remain in place because
    they're also used by Cash/UPI Billing (`TripEntryForm`, shared with
    `CashBills.tsx`) — this redesign only changes GST Billing's own
    creation flow, not that shared component.

New table:
  `invoice_billing_lines` — one row per (working date, vehicle) billing
  line under a GST invoice. No In-Time/Out-Time/hour-meter/session
  concept — hours and minutes are entered directly. Rate/amount fields
  are snapshotted once when the line is added (same pattern as the
  PO Orders module), so historical invoices don't silently change if
  Rate Master is edited later.
*/

CREATE TABLE IF NOT EXISTS public.invoice_billing_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  working_date date NOT NULL,
  vehicle_id uuid REFERENCES public.vehicles(id),
  vehicle_number text NOT NULL,
  vehicle_type text NOT NULL,
  ton numeric,
  rate_type text NOT NULL DEFAULT 'Hourly' CHECK (rate_type IN ('Hourly', 'Daily')),
  hours integer NOT NULL DEFAULT 0,
  minutes integer NOT NULL DEFAULT 0 CHECK (minutes >= 0 AND minutes < 60),
  first_hour_rate numeric,
  second_hour_rate numeric,
  first_hour_amount numeric,
  second_hour_amount numeric,
  batha numeric NOT NULL DEFAULT 0,
  total_amount numeric NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_billing_lines_invoice ON public.invoice_billing_lines (invoice_id, working_date);

ALTER TABLE public.invoice_billing_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_select_invoice_billing_lines" ON public.invoice_billing_lines FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_invoice_billing_lines" ON public.invoice_billing_lines FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_invoice_billing_lines" ON public.invoice_billing_lines FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_delete_invoice_billing_lines" ON public.invoice_billing_lines FOR DELETE TO authenticated USING (true);

DROP TRIGGER IF EXISTS trg_set_updated_at ON public.invoice_billing_lines;
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.invoice_billing_lines FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
