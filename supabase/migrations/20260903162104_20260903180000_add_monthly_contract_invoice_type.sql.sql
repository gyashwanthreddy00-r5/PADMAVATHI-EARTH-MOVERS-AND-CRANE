/*
# Add MONTHLY_CONTRACT Invoice Type

## Purpose
Monthly Full-Time Contract invoices were previously stored as invoice_type='GST'
with rate_type='Monthly'. This made it impossible to distinguish them from
regular GST invoices in reports.

This migration:
1. Adds 'MONTHLY_CONTRACT' to the invoice_type CHECK constraint
2. Backfills existing contract invoices (rate_type='Monthly') to the new type

## Safety
- No existing data is deleted or renumbered
- Only the type label changes for Monthly invoices; all other fields untouched
- Existing reports that filter by invoice_type will simply exclude the new type
  until the frontend is updated
*/

-- 1. Drop the old constraint and add the new one with MONTHLY_CONTRACT
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_invoice_type_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_invoice_type_check
  CHECK (invoice_type = ANY (ARRAY['Cash'::text, 'GST'::text, 'MONTHLY_CONTRACT'::text]));

-- 2. Backfill existing Monthly contract invoices
UPDATE public.invoices
SET invoice_type = 'MONTHLY_CONTRACT'
WHERE rate_type = 'Monthly' AND invoice_type = 'GST';
