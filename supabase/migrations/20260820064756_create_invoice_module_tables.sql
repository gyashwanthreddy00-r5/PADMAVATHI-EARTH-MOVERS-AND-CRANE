/*
# Invoice Module - Multi-Trip GST Invoice System

## Summary
Creates a full multi-trip GST invoice module. Extends the existing `invoices` table
into a multi-trip invoice system with line items, adds payment tracking, company
profile settings, invoice settings, and marks trip entries as invoiced to prevent
duplicate billing.

## Changes

### 1. New Tables

#### invoice_items
- id (uuid PK)
- invoice_id (uuid FK -> invoices, CASCADE)
- trip_entry_id (uuid FK -> trips, SET NULL)
- sl_no (integer)
- description (text)
- hsn_sac (text, default '997319')
- quantity (numeric)
- rate (numeric)
- unit (text, default 'nos')
- amount (numeric)
- batha (numeric, default 0)
- created_at (timestamptz)

#### invoice_payments
- id (uuid PK)
- invoice_id (uuid FK -> invoices, CASCADE)
- amount (numeric)
- payment_date (date)
- payment_mode (text, CHECK in Cash/Online/Bank Transfer/Other)
- remarks (text)
- created_at (timestamptz)

#### invoice_settings
- id (uuid PK, single row)
- hsn_sac (text, default '997319')
- default_payment_terms (text, default '30 days')
- declaration (text, editable declaration text)
- authorized_signatory (text)
- terms_of_delivery (text)
- cgst_percent (numeric, default 9)
- sgst_percent (numeric, default 9)
- igst_percent (numeric, default 18)
- add_gst_by_default (boolean, default true)

#### invoice_fy_counter
- financial_year (text PK)
- last_number (integer)

### 2. Extended Tables

#### invoices (ALTER - additive only)
- financial_year, consignee fields, destination, motor_vehicle_numbers,
  terms_of_payment, delivery_note, reference_no, buyer_order_no, dispatch_doc_no,
  delivery_note_date, amount_received, balance_amount, invoice_status,
  amount_in_words, declaration, remarks, created_by_name

#### company_settings (ALTER - additive only)
- state, state_code, bank_name, bank_account_name, bank_account_number,
  bank_branch, bank_ifsc, authorized_signatory, signature_url

#### customers (ALTER - additive only)
- state, state_code, payment_terms, shipping_address

#### trips (ALTER - additive only)
- invoice_id (uuid FK -> invoices, SET NULL)
- invoice_status (text, NULL/Pending/Invoiced)
- invoice_number (text)
- invoiced_at (timestamptz)

### 3. Security
- RLS enabled on all new tables
- 4 policies each (SELECT/INSERT/UPDATE/DELETE) scoped TO authenticated
- USING (true) is correct: data is intentionally shared among all signed-in ERP users

### 4. Functions
- current_financial_year(): returns FY label like '2026-27'
- next_fy_invoice_number(prefix): atomic FY-based invoice number generator
*/

-- ============================================================
-- 1. ALTER invoices: add multi-trip invoice columns
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='financial_year') THEN
    ALTER TABLE invoices ADD COLUMN financial_year text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='consignee_name') THEN
    ALTER TABLE invoices ADD COLUMN consignee_name text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='consignee_address') THEN
    ALTER TABLE invoices ADD COLUMN consignee_address text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='consignee_gstin') THEN
    ALTER TABLE invoices ADD COLUMN consignee_gstin text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='consignee_state') THEN
    ALTER TABLE invoices ADD COLUMN consignee_state text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='consignee_state_code') THEN
    ALTER TABLE invoices ADD COLUMN consignee_state_code text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='destination') THEN
    ALTER TABLE invoices ADD COLUMN destination text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='motor_vehicle_numbers') THEN
    ALTER TABLE invoices ADD COLUMN motor_vehicle_numbers text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='terms_of_payment') THEN
    ALTER TABLE invoices ADD COLUMN terms_of_payment text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='delivery_note') THEN
    ALTER TABLE invoices ADD COLUMN delivery_note text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='reference_no') THEN
    ALTER TABLE invoices ADD COLUMN reference_no text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='buyer_order_no') THEN
    ALTER TABLE invoices ADD COLUMN buyer_order_no text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='dispatch_doc_no') THEN
    ALTER TABLE invoices ADD COLUMN dispatch_doc_no text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='delivery_note_date') THEN
    ALTER TABLE invoices ADD COLUMN delivery_note_date date;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='amount_received') THEN
    ALTER TABLE invoices ADD COLUMN amount_received numeric(12,2) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='balance_amount') THEN
    ALTER TABLE invoices ADD COLUMN balance_amount numeric(12,2) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='invoice_status') THEN
    ALTER TABLE invoices ADD COLUMN invoice_status text NOT NULL DEFAULT 'Generated' CHECK (invoice_status IN ('Draft','Generated','Paid','Partially Paid','Pending','Cancelled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='amount_in_words') THEN
    ALTER TABLE invoices ADD COLUMN amount_in_words text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='declaration') THEN
    ALTER TABLE invoices ADD COLUMN declaration text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='remarks') THEN
    ALTER TABLE invoices ADD COLUMN remarks text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='created_by_name') THEN
    ALTER TABLE invoices ADD COLUMN created_by_name text;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_invoices_fy_status ON invoices(financial_year, invoice_status);

-- ============================================================
-- 2. ALTER company_settings: add bank, state, signatory fields
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='company_settings' AND column_name='state') THEN
    ALTER TABLE company_settings ADD COLUMN state text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='company_settings' AND column_name='state_code') THEN
    ALTER TABLE company_settings ADD COLUMN state_code text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='company_settings' AND column_name='bank_name') THEN
    ALTER TABLE company_settings ADD COLUMN bank_name text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='company_settings' AND column_name='bank_account_name') THEN
    ALTER TABLE company_settings ADD COLUMN bank_account_name text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='company_settings' AND column_name='bank_account_number') THEN
    ALTER TABLE company_settings ADD COLUMN bank_account_number text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='company_settings' AND column_name='bank_branch') THEN
    ALTER TABLE company_settings ADD COLUMN bank_branch text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='company_settings' AND column_name='bank_ifsc') THEN
    ALTER TABLE company_settings ADD COLUMN bank_ifsc text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='company_settings' AND column_name='authorized_signatory') THEN
    ALTER TABLE company_settings ADD COLUMN authorized_signatory text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='company_settings' AND column_name='signature_url') THEN
    ALTER TABLE company_settings ADD COLUMN signature_url text;
  END IF;
END $$;

-- Update the existing default company_settings row with reference invoice values
UPDATE company_settings SET
  company_name = COALESCE(NULLIF(company_name, 'Crane ERP'), 'PADMAVATHI EARTH MOVERS AND CRANE SERVICES'),
  address = COALESCE(address, 'H.NO 1-5-364/40, SURYA NAGAR, OLD ALWAL, HYDERABAD - 500010'),
  gstin = COALESCE(gstin, '36ALVPA9612Q2ZA'),
  state = COALESCE(state, 'Telangana'),
  state_code = COALESCE(state_code, '36'),
  email = COALESCE(email, 'padmavathicranes@gmail.com'),
  bank_name = COALESCE(bank_name, 'Axis Bank Ltd'),
  bank_account_name = COALESCE(bank_account_name, 'PADMAVATHI CRANE SERVICES'),
  bank_account_number = COALESCE(bank_account_number, '914020039371713'),
  bank_ifsc = COALESCE(bank_ifsc, 'UTIB0001378')
WHERE id = (SELECT id FROM company_settings LIMIT 1);

-- ============================================================
-- 3. ALTER customers: add state, state_code, payment_terms, shipping
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='customers' AND column_name='state') THEN
    ALTER TABLE customers ADD COLUMN state text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='customers' AND column_name='state_code') THEN
    ALTER TABLE customers ADD COLUMN state_code text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='customers' AND column_name='payment_terms') THEN
    ALTER TABLE customers ADD COLUMN payment_terms text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='customers' AND column_name='shipping_address') THEN
    ALTER TABLE customers ADD COLUMN shipping_address text;
  END IF;
END $$;

-- ============================================================
-- 4. ALTER trips: add invoice tracking columns
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='trips' AND column_name='invoice_id') THEN
    ALTER TABLE trips ADD COLUMN invoice_id uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='trips' AND column_name='invoice_status') THEN
    ALTER TABLE trips ADD COLUMN invoice_status text CHECK (invoice_status IS NULL OR invoice_status IN ('Pending','Invoiced'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='trips' AND column_name='invoice_number') THEN
    ALTER TABLE trips ADD COLUMN invoice_number text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='trips' AND column_name='invoiced_at') THEN
    ALTER TABLE trips ADD COLUMN invoiced_at timestamptz;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trips_invoice_id_fkey') THEN
    ALTER TABLE trips ADD CONSTRAINT trips_invoice_id_fkey
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_trips_invoice ON trips(invoice_id, invoice_status);

-- ============================================================
-- 5. Create invoice_items table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  trip_entry_id uuid REFERENCES public.trips(id) ON DELETE SET NULL,
  sl_no integer NOT NULL DEFAULT 0,
  description text NOT NULL,
  hsn_sac text NOT NULL DEFAULT '997319',
  quantity numeric(12,2) NOT NULL DEFAULT 0,
  rate numeric(12,2) NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'nos',
  amount numeric(12,2) NOT NULL DEFAULT 0,
  batha numeric(12,2) DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON public.invoice_items(invoice_id);

DROP POLICY IF EXISTS "auth_select_invoice_items" ON public.invoice_items;
CREATE POLICY "auth_select_invoice_items" ON public.invoice_items FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_invoice_items" ON public.invoice_items;
CREATE POLICY "auth_insert_invoice_items" ON public.invoice_items FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_invoice_items" ON public.invoice_items;
CREATE POLICY "auth_update_invoice_items" ON public.invoice_items FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_invoice_items" ON public.invoice_items;
CREATE POLICY "auth_delete_invoice_items" ON public.invoice_items FOR DELETE TO authenticated USING (true);

-- ============================================================
-- 6. Create invoice_payments table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.invoice_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  payment_mode text CHECK (payment_mode IN ('Cash','Online','Bank Transfer','Other')),
  remarks text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.invoice_payments ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON public.invoice_payments(invoice_id, payment_date);

DROP POLICY IF EXISTS "auth_select_invoice_payments" ON public.invoice_payments;
CREATE POLICY "auth_select_invoice_payments" ON public.invoice_payments FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_invoice_payments" ON public.invoice_payments;
CREATE POLICY "auth_insert_invoice_payments" ON public.invoice_payments FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_invoice_payments" ON public.invoice_payments;
CREATE POLICY "auth_update_invoice_payments" ON public.invoice_payments FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_invoice_payments" ON public.invoice_payments;
CREATE POLICY "auth_delete_invoice_payments" ON public.invoice_payments FOR DELETE TO authenticated USING (true);

-- ============================================================
-- 7. Create invoice_settings table (single row)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.invoice_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hsn_sac text NOT NULL DEFAULT '997319',
  default_payment_terms text NOT NULL DEFAULT '30 days',
  declaration text NOT NULL DEFAULT 'We declare that this invoice shows the actual price of the services described and that all particulars are true and correct.',
  authorized_signatory text,
  terms_of_delivery text,
  cgst_percent numeric(5,2) DEFAULT 9,
  sgst_percent numeric(5,2) DEFAULT 9,
  igst_percent numeric(5,2) DEFAULT 18,
  add_gst_by_default boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.invoice_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_invoice_settings" ON public.invoice_settings;
CREATE POLICY "auth_select_invoice_settings" ON public.invoice_settings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_invoice_settings" ON public.invoice_settings;
CREATE POLICY "auth_insert_invoice_settings" ON public.invoice_settings FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_invoice_settings" ON public.invoice_settings;
CREATE POLICY "auth_update_invoice_settings" ON public.invoice_settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_delete_invoice_settings" ON public.invoice_settings;
CREATE POLICY "auth_delete_invoice_settings" ON public.invoice_settings FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_invoice_settings_updated BEFORE UPDATE ON public.invoice_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed default row
INSERT INTO public.invoice_settings (hsn_sac)
SELECT '997319'
WHERE NOT EXISTS (SELECT 1 FROM public.invoice_settings);

-- ============================================================
-- 8. Financial-year invoice counter + generator function
-- ============================================================
CREATE TABLE IF NOT EXISTS public.invoice_fy_counter (
  financial_year text PRIMARY KEY,
  last_number integer NOT NULL DEFAULT 0
);
ALTER TABLE public.invoice_fy_counter ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_invoice_fy_counter" ON public.invoice_fy_counter;
CREATE POLICY "auth_select_invoice_fy_counter" ON public.invoice_fy_counter FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_insert_invoice_fy_counter" ON public.invoice_fy_counter;
CREATE POLICY "auth_insert_invoice_fy_counter" ON public.invoice_fy_counter FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "auth_update_invoice_fy_counter" ON public.invoice_fy_counter;
CREATE POLICY "auth_update_invoice_fy_counter" ON public.invoice_fy_counter FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Indian financial year: Apr 1 to Mar 31. FY label: "2026-27"
CREATE OR REPLACE FUNCTION public.current_financial_year()
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN extract(month from now())::int >= 4
    THEN extract(year from now())::int::text || '-' || lpad(((extract(year from now())::int + 1) % 100)::text, 2, '0')
    ELSE (extract(year from now())::int - 1)::text || '-' || lpad((extract(year from now())::int % 100)::text, 2, '0')
  END;
$$;

-- Atomic next invoice number: PREFIX/FY/0001
CREATE OR REPLACE FUNCTION public.next_fy_invoice_number(prefix text DEFAULT 'PCS')
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  fy text;
  next_num integer;
  result text;
BEGIN
  fy := public.current_financial_year();
  INSERT INTO public.invoice_fy_counter (financial_year, last_number)
  VALUES (fy, 1)
  ON CONFLICT (financial_year)
  DO UPDATE SET last_number = public.invoice_fy_counter.last_number + 1
  RETURNING last_number INTO next_num;
  result := prefix || '/' || fy || '/' || lpad(next_num::text, 4, '0');
  RETURN result;
END;
$$;