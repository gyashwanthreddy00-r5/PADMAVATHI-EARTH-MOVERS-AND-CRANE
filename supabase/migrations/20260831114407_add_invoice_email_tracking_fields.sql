/*
# Add email tracking fields to invoices table

## Purpose
Track the status of invoice emails sent to customers via the Resend integration.

## New Columns
1. `email_status` (text, default 'NOT_SENT') — tracks email delivery state.
   Values: 'NOT_SENT', 'SENT', 'FAILED'.
2. `email_sent_at` (timestamptz, nullable) — timestamp of last successful send.
3. `email_sent_to` (text, nullable) — recipient email address of last successful send.
4. `email_error` (text, nullable) — error message if last send failed.

## Safety
- All new columns are nullable or have safe defaults, so existing rows are unaffected.
- No data is lost or transformed.
*/

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS email_status text NOT NULL DEFAULT 'NOT_SENT',
  ADD COLUMN IF NOT EXISTS email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_sent_to text,
  ADD COLUMN IF NOT EXISTS email_error text;
