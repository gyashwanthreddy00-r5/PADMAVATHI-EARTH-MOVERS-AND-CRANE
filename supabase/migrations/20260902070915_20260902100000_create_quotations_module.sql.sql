/*
# Create Quotations Module

## Purpose
Create a complete quotations system for generating, saving, editing, printing, and managing
customer quotations for crane/JCB/equipment rentals. Quotations are separate from trips/invoices.

## New Tables

### 1. quotations
- id (uuid PK)
- quotation_number (text, unique) — e.g. QUO/02-09-2026/001
- quotation_date (date NOT NULL), valid_until (date NULL)
- customer_id (uuid FK to customers), customer_name/address/phone/email/gstin
- reference_subject, site_location
- subtotal, gst_amount, grand_total (numeric)
- up/down transportation enabled/description/amount
- other_charges_description/amount
- gst_enabled, gst_percent
- terms_and_conditions (text), payment_terms (text)
- status (text CHECK in Draft/Sent/Accepted/Rejected/Expired/Converted)
- created_by (uuid FK to user_profiles.auth_user_id)
- created_at, updated_at

### 2. quotation_equipment
- id (uuid PK)
- quotation_id (uuid FK ON DELETE CASCADE)
- vehicle_type (text NOT NULL), capacity_tons, vehicle_number (optional)
- rate_type (text NOT NULL), quantity, rate, minimum_hours, minimum_charge, batha, amount
- rate_master_id (uuid FK to rate_master NULL), rate_master_rate (snapshot)
- is_custom_rate, is_manual_rate (booleans)
- sort_order, created_at, updated_at

### 3. quotation_counter — single-row global counter

## New Function
### next_quotation_number(p_quote_date text) — atomic, returns QUO/DD-MM-YYYY/NNN

## Security
- RLS on quotations + quotation_equipment, TO authenticated, ownership via created_by = auth.uid()
*/

-- 1. quotation_counter
CREATE TABLE IF NOT EXISTS public.quotation_counter (
  id integer PRIMARY KEY DEFAULT 1,
  last_number integer NOT NULL DEFAULT 0,
  CONSTRAINT quotation_single_row CHECK (id = 1)
);
INSERT INTO public.quotation_counter (id, last_number) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;

-- 2. next_quotation_number function
CREATE OR REPLACE FUNCTION public.next_quotation_number(p_quote_date text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  next_num integer;
  date_part text;
  parsed_date date;
  raw_date text;
BEGIN
  raw_date := COALESCE(p_quote_date, to_char(now()::date, 'DD-MM-YYYY'));
  BEGIN
    parsed_date := to_date(raw_date, 'DD-MM-YYYY');
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      parsed_date := to_date(raw_date, 'YYYY-MM-DD');
    EXCEPTION WHEN OTHERS THEN
      parsed_date := now()::date;
    END;
  END;
  date_part := to_char(parsed_date, 'DD-MM-YYYY');

  UPDATE public.quotation_counter
  SET last_number = last_number + 1
  WHERE id = 1
  RETURNING last_number INTO next_num;

  IF next_num IS NULL THEN
    INSERT INTO public.quotation_counter (id, last_number) VALUES (1, 1)
    ON CONFLICT (id) DO UPDATE SET last_number = quotation_counter.last_number + 1
    RETURNING last_number INTO next_num;
  END IF;

  RETURN 'QUO/' || date_part || '/' || lpad(next_num::text, 3, '0');
END;
$$;

-- 3. quotations table
CREATE TABLE IF NOT EXISTS public.quotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_number text UNIQUE NOT NULL,
  quotation_date date NOT NULL DEFAULT CURRENT_DATE,
  valid_until date,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name text,
  customer_address text,
  customer_phone text,
  customer_email text,
  customer_gstin text,
  reference_subject text,
  site_location text,
  subtotal numeric NOT NULL DEFAULT 0,
  up_transportation_enabled boolean NOT NULL DEFAULT false,
  up_transportation_description text,
  up_transportation_amount numeric NOT NULL DEFAULT 0,
  down_transportation_enabled boolean NOT NULL DEFAULT false,
  down_transportation_description text,
  down_transportation_amount numeric NOT NULL DEFAULT 0,
  other_charges_description text,
  other_charges_amount numeric NOT NULL DEFAULT 0,
  gst_enabled boolean NOT NULL DEFAULT true,
  gst_percent numeric NOT NULL DEFAULT 18,
  gst_amount numeric NOT NULL DEFAULT 0,
  grand_total numeric NOT NULL DEFAULT 0,
  terms_and_conditions text NOT NULL DEFAULT '',
  payment_terms text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Sent','Accepted','Rejected','Expired','Converted')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.quotations ALTER COLUMN created_by SET DEFAULT auth.uid();
ALTER TABLE public.quotations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_quotations" ON public.quotations;
CREATE POLICY "select_own_quotations" ON public.quotations FOR SELECT
  TO authenticated USING (auth.uid() = created_by);

DROP POLICY IF EXISTS "insert_own_quotations" ON public.quotations;
CREATE POLICY "insert_own_quotations" ON public.quotations FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = created_by);

DROP POLICY IF EXISTS "update_own_quotations" ON public.quotations;
CREATE POLICY "update_own_quotations" ON public.quotations FOR UPDATE
  TO authenticated USING (auth.uid() = created_by) WITH CHECK (auth.uid() = created_by);

DROP POLICY IF EXISTS "delete_own_quotations" ON public.quotations;
CREATE POLICY "delete_own_quotations" ON public.quotations FOR DELETE
  TO authenticated USING (auth.uid() = created_by);

-- 4. quotation_equipment table
CREATE TABLE IF NOT EXISTS public.quotation_equipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES public.quotations(id) ON DELETE CASCADE,
  vehicle_type text NOT NULL,
  capacity_tons text,
  vehicle_number text,
  rate_type text NOT NULL CHECK (rate_type IN ('Hourly','Daily','Monthly','Couple Hours')),
  quantity numeric NOT NULL DEFAULT 1,
  rate numeric NOT NULL DEFAULT 0,
  minimum_hours numeric,
  minimum_charge numeric,
  batha numeric NOT NULL DEFAULT 0,
  amount numeric NOT NULL DEFAULT 0,
  rate_master_id uuid,
  rate_master_rate numeric,
  is_custom_rate boolean NOT NULL DEFAULT false,
  is_manual_rate boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.quotation_equipment ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_quotation_equipment" ON public.quotation_equipment;
CREATE POLICY "select_own_quotation_equipment" ON public.quotation_equipment FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM public.quotations q WHERE q.id = quotation_id AND q.created_by = auth.uid())
  );

DROP POLICY IF EXISTS "insert_own_quotation_equipment" ON public.quotation_equipment;
CREATE POLICY "insert_own_quotation_equipment" ON public.quotation_equipment FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.quotations q WHERE q.id = quotation_id AND q.created_by = auth.uid())
  );

DROP POLICY IF EXISTS "update_own_quotation_equipment" ON public.quotation_equipment;
CREATE POLICY "update_own_quotation_equipment" ON public.quotation_equipment FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM public.quotations q WHERE q.id = quotation_id AND q.created_by = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.quotations q WHERE q.id = quotation_id AND q.created_by = auth.uid())
  );

DROP POLICY IF EXISTS "delete_own_quotation_equipment" ON public.quotation_equipment;
CREATE POLICY "delete_own_quotation_equipment" ON public.quotation_equipment FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM public.quotations q WHERE q.id = quotation_id AND q.created_by = auth.uid())
  );

-- 5. updated_at triggers
CREATE OR REPLACE FUNCTION public.handle_updated_at_quotations()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quotations_updated_at ON public.quotations;
CREATE TRIGGER quotations_updated_at BEFORE UPDATE ON public.quotations
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at_quotations();

DROP TRIGGER IF EXISTS quotation_equipment_updated_at ON public.quotation_equipment;
CREATE TRIGGER quotation_equipment_updated_at BEFORE UPDATE ON public.quotation_equipment
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at_quotations();

-- 6. Indexes
CREATE INDEX IF NOT EXISTS idx_quotations_customer_id ON public.quotations(customer_id);
CREATE INDEX IF NOT EXISTS idx_quotations_quotation_date ON public.quotations(quotation_date DESC);
CREATE INDEX IF NOT EXISTS idx_quotation_equipment_quotation_id ON public.quotation_equipment(quotation_id);
