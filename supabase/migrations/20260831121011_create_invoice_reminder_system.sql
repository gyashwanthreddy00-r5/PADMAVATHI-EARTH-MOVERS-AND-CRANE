/*
# Create invoice reminder system tables

## Purpose
Add automatic service-cost reminder email tracking for invoices. Reminders are
scheduled at 1, 10, and 20 days after the invoice/service date, and sent via the
existing Resend integration.

## New Tables

### 1. invoice_reminders
Tracks each individual reminder stage per invoice.
- `id` (uuid PK)
- `invoice_id` (uuid FK → invoices.id, ON DELETE CASCADE)
- `customer_id` (uuid, nullable FK → customers.id)
- `reminder_stage` (integer: 1, 10, or 20 — days after service date)
- `scheduled_at` (timestamptz — when the reminder should be sent)
- `sent_at` (timestamptz, nullable — when it was actually sent)
- `status` (text: 'pending', 'sent', 'failed', 'cancelled', 'missing_email')
- `recipient_email` (text, nullable — customer email at time of send)
- `subject` (text, nullable — subject line used)
- `error_message` (text, nullable — Resend error if failed)
- `created_at` (timestamptz, default now())
- `updated_at` (timestamptz, default now())

Unique constraint on (invoice_id, reminder_stage) prevents duplicate reminders.

### 2. reminder_settings
Stores the configurable reminder templates and enable flags.
- `id` (uuid PK)
- `enabled` (boolean, default true — master switch)
- `day1_enabled` (boolean, default true)
- `day10_enabled` (boolean, default true)
- `day20_enabled` (boolean, default true)
- `day1_subject` / `day1_body` (text — Day 1 template)
- `day10_subject` / `day10_body` (text — Day 10 template)
- `day20_subject` / `day20_body` (text — Day 20 template)
- `created_at` / `updated_at` (timestamptz)

## Security
- RLS enabled on both tables.
- Policies: authenticated users can SELECT, INSERT, UPDATE, DELETE.
- Uses TO authenticated since this app has a sign-in screen.

## Idempotency
All statements use IF NOT EXISTS. Policies are dropped before creation.
*/

-- ============================================================
-- 1. invoice_reminders table
-- ============================================================
CREATE TABLE IF NOT EXISTS invoice_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  reminder_stage integer NOT NULL,
  scheduled_at timestamptz NOT NULL,
  sent_at timestamptz,
  status text NOT NULL DEFAULT 'pending',
  recipient_email text,
  subject text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE invoice_reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_reminders" ON invoice_reminders;
CREATE POLICY "auth_select_reminders" ON invoice_reminders FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_insert_reminders" ON invoice_reminders;
CREATE POLICY "auth_insert_reminders" ON invoice_reminders FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "auth_update_reminders" ON invoice_reminders;
CREATE POLICY "auth_update_reminders" ON invoice_reminders FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_delete_reminders" ON invoice_reminders;
CREATE POLICY "auth_delete_reminders" ON invoice_reminders FOR DELETE
  TO authenticated USING (true);

-- Unique constraint: one reminder per stage per invoice
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoice_reminders_invoice_id_reminder_stage_key'
  ) THEN
    ALTER TABLE invoice_reminders
      ADD CONSTRAINT invoice_reminders_invoice_id_reminder_stage_key
      UNIQUE (invoice_id, reminder_stage);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_invoice_reminders_status_scheduled
  ON invoice_reminders (status, scheduled_at);

-- ============================================================
-- 2. reminder_settings table
-- ============================================================
CREATE TABLE IF NOT EXISTS reminder_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enabled boolean NOT NULL DEFAULT true,
  day1_enabled boolean NOT NULL DEFAULT true,
  day10_enabled boolean NOT NULL DEFAULT true,
  day20_enabled boolean NOT NULL DEFAULT true,
  day1_subject text NOT NULL DEFAULT 'Service Cost Reminder – {{invoice_number}}',
  day1_body text NOT NULL DEFAULT 'Dear {{customer_name}},

Please find attached the service cost details for the crane/equipment service provided on {{service_date}}.

We kindly request you to review the attached document and arrange the payment at your earliest convenience.

Please find the attached document for your reference.

This is a gentle reminder.

Regards,
{{company_name}}
{{company_phone}}
{{company_email}}',
  day10_subject text NOT NULL DEFAULT 'Gentle Reminder – Service Cost Payment – {{invoice_number}}',
  day10_body text NOT NULL DEFAULT 'Dear {{customer_name}},

This is a gentle reminder regarding the service cost for the crane/equipment service provided on {{service_date}}.

The payment is still pending. We kindly request you to review the attached service cost details and arrange the payment at the earliest.

Please find the attached document for your reference.

If the payment has already been made, kindly ignore this reminder and share the payment details/confirmation with us.

Regards,
{{company_name}}
{{company_phone}}
{{company_email}}',
  day20_subject text NOT NULL DEFAULT 'Final Reminder – Service Cost Payment Pending – {{invoice_number}}',
  day20_body text NOT NULL DEFAULT 'Dear {{customer_name}},

This is a final reminder regarding the outstanding service cost for the crane/equipment service provided on {{service_date}}.

As the payment is still pending, we request you to kindly arrange the payment at the earliest.

Please find the attached service cost/invoice document for your reference.

If the payment has already been made, please share the payment confirmation with us.

Regards,
{{company_name}}
{{company_phone}}
{{company_email}}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE reminder_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_reminder_settings" ON reminder_settings;
CREATE POLICY "auth_select_reminder_settings" ON reminder_settings FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_insert_reminder_settings" ON reminder_settings;
CREATE POLICY "auth_insert_reminder_settings" ON reminder_settings FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "auth_update_reminder_settings" ON reminder_settings;
CREATE POLICY "auth_update_reminder_settings" ON reminder_settings FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_delete_reminder_settings" ON reminder_settings;
CREATE POLICY "auth_delete_reminder_settings" ON reminder_settings FOR DELETE
  TO authenticated USING (true);

-- ============================================================
-- 3. updated_at trigger function
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_reminders_updated_at ON invoice_reminders;
CREATE TRIGGER trg_invoice_reminders_updated_at
  BEFORE UPDATE ON invoice_reminders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_reminder_settings_updated_at ON reminder_settings;
CREATE TRIGGER trg_reminder_settings_updated_at
  BEFORE UPDATE ON reminder_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 4. Seed a default reminder_settings row if none exists
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM reminder_settings LIMIT 1) THEN
    INSERT INTO reminder_settings DEFAULT VALUES;
  END IF;
END $$;
