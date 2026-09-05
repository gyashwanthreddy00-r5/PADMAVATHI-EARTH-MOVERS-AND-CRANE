/*
# Add created_at and updated_at timestamps to all tables

## Summary
Ensures every table in the public schema has both `created_at` and `updated_at`
timestamp columns, and that `updated_at` is automatically refreshed on every
row update via a trigger.

## Tables modified (add updated_at where missing)
- attendance
- invoice_items
- invoice_payments
- profiles

## Tables modified (add both created_at and updated_at)
- gst_invoice_counter
- invoice_counter
- invoice_fy_counter

## Trigger function
- `set_updated_at()` — reusable PL/pgSQL function that sets `NEW.updated_at = now()`

## Triggers created
- One `BEFORE UPDATE` trigger per table that has an `updated_at` column,
  calling `set_updated_at()`.

## Notes
1. Existing rows get `updated_at` set to their `created_at` value (or now() if
   created_at is also new).
2. Counter tables (gst_invoice_counter, invoice_counter, invoice_fy_counter)
   are internal bookkeeping tables; timestamps are added for consistency but
   these tables are rarely updated.
3. All statements are idempotent — safe to re-run.
*/

-- =============================================================
-- 1. Reusable trigger function
-- =============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- =============================================================
-- 2. Add updated_at to tables that have created_at but not updated_at
-- =============================================================

ALTER TABLE attendance ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
UPDATE attendance SET updated_at = created_at WHERE updated_at IS NULL;
ALTER TABLE attendance ALTER COLUMN updated_at SET DEFAULT now();

ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
UPDATE invoice_items SET updated_at = created_at WHERE updated_at IS NULL;
ALTER TABLE invoice_items ALTER COLUMN updated_at SET DEFAULT now();

ALTER TABLE invoice_payments ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
UPDATE invoice_payments SET updated_at = created_at WHERE updated_at IS NULL;
ALTER TABLE invoice_payments ALTER COLUMN updated_at SET DEFAULT now();

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
UPDATE profiles SET updated_at = created_at WHERE updated_at IS NULL;
ALTER TABLE profiles ALTER COLUMN updated_at SET DEFAULT now();

-- =============================================================
-- 3. Add created_at + updated_at to counter tables (neither exists)
-- =============================================================

ALTER TABLE gst_invoice_counter ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE gst_invoice_counter ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
UPDATE gst_invoice_counter SET created_at = now() WHERE created_at IS NULL;
UPDATE gst_invoice_counter SET updated_at = now() WHERE updated_at IS NULL;

ALTER TABLE invoice_counter ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE invoice_counter ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
UPDATE invoice_counter SET created_at = now() WHERE created_at IS NULL;
UPDATE invoice_counter SET updated_at = now() WHERE updated_at IS NULL;

ALTER TABLE invoice_fy_counter ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE invoice_fy_counter ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
UPDATE invoice_fy_counter SET created_at = now() WHERE created_at IS NULL;
UPDATE invoice_fy_counter SET updated_at = now() WHERE updated_at IS NULL;

-- =============================================================
-- 4. Create BEFORE UPDATE triggers on every table with updated_at
--    Drop first for idempotency, then create.
-- =============================================================

DO $$
DECLARE
  t text;
  tbls text[] := ARRAY[
    'attendance', 'company_settings', 'customers', 'diesel_distributions',
    'diesel_entries', 'emi_records', 'employees', 'gst_invoice_counter',
    'invoice_counter', 'invoice_fy_counter', 'invoice_items',
    'invoice_payments', 'invoice_reminders', 'invoice_settings', 'invoices',
    'maintenance', 'maintenance_types', 'monthly_contracts', 'profiles',
    'rate_master', 'rates', 'reminder_settings', 'salary_advance_recoveries',
    'salary_advances', 'trips', 'user_profiles', 'vehicles'
  ];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_set_updated_at ON %I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
      t
    );
  END LOOP;
END;
$$;
