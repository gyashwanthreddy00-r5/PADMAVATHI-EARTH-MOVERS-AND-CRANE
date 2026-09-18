/*
  # Add payment-mode fields to Purchase, Diesel, Maintenance

  These three modules track payment as a single cumulative `paid_amount`
  field on the record itself, with no `payment_mode` column at all. To
  classify a payment as Bank (Bank Transfer/UPI/Cheque/NEFT/RTGS) vs Cash
  for the new Bank module sync, each needs a payment mode + reference
  fields. Additive and nullable — no data loss, no change to existing
  amount/balance calculations.
*/

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='purchases' AND column_name='payment_mode') THEN
    ALTER TABLE public.purchases ADD COLUMN payment_mode text CHECK (payment_mode IN ('Cash','Bank Transfer','UPI','Cheque','NEFT','RTGS','Online','Other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='purchases' AND column_name='payment_reference') THEN
    ALTER TABLE public.purchases ADD COLUMN payment_reference text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='purchases' AND column_name='cheque_number') THEN
    ALTER TABLE public.purchases ADD COLUMN cheque_number text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='diesel_entries' AND column_name='payment_mode') THEN
    ALTER TABLE public.diesel_entries ADD COLUMN payment_mode text CHECK (payment_mode IN ('Cash','Bank Transfer','UPI','Cheque','NEFT','RTGS','Online','Other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='diesel_entries' AND column_name='payment_reference') THEN
    ALTER TABLE public.diesel_entries ADD COLUMN payment_reference text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='diesel_entries' AND column_name='cheque_number') THEN
    ALTER TABLE public.diesel_entries ADD COLUMN cheque_number text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='maintenance' AND column_name='payment_mode') THEN
    ALTER TABLE public.maintenance ADD COLUMN payment_mode text CHECK (payment_mode IN ('Cash','Bank Transfer','UPI','Cheque','NEFT','RTGS','Online','Other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='maintenance' AND column_name='payment_reference') THEN
    ALTER TABLE public.maintenance ADD COLUMN payment_reference text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='maintenance' AND column_name='cheque_number') THEN
    ALTER TABLE public.maintenance ADD COLUMN cheque_number text;
  END IF;
END $$;
