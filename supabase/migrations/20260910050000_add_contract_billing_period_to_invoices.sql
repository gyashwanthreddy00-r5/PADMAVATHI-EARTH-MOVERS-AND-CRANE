/*
# Monthly Contract invoices — link to contract + billing period, prevent duplicates

Root cause of "Monthly Contract invoice not appearing in Billing -> Customer
Invoices": that page's query only ever asked for invoice_type = 'GST'. Fixed
on the frontend (Invoices.tsx) in the same change as this migration — no
schema change was needed for that part.

This migration addresses the SEPARATE "duplicate invoice" problem: nothing
today records which Monthly Contract (and which billing month) an invoice
was generated for, so Create Invoice can be clicked repeatedly for the same
contract/month with no way to detect it — confirmed live on the GYR FRAMS
contract, which already has 6 invoices for the same September 2026 period.

Adds two nullable columns to `invoices`:
  - contract_id: which monthly_contracts row this invoice was generated for
    (NULL for every invoice that isn't a Monthly Contract invoice, and for
    historical Monthly Contract invoices generated before this column
    existed — those are left exactly as they are, never backfilled/guessed).
  - billing_period_month: the first day of the month this invoice bills for
    (e.g. 2026-09-01 for a September 2026 bill).

A partial unique index then enforces, at the database level, that a given
contract can have at most one non-cancelled invoice per billing month. The
`WHERE contract_id IS NOT NULL` clause means every existing row (all of
which have NULL contract_id, including the 6 existing GYR FRAMS invoices)
is completely unaffected and the index can be created without conflict.
`AND is_cancelled = false` means cancelling a contract invoice frees up
that month for a corrected one, consistent with how is_cancelled is already
used elsewhere (e.g. Customer Statement already excludes cancelled invoices).

Only `invoices` is touched. No existing row is updated, no other table is
changed.
*/

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS contract_id uuid REFERENCES public.monthly_contracts(id),
  ADD COLUMN IF NOT EXISTS billing_period_month date;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_contract_billing_period_uniq
  ON public.invoices (contract_id, billing_period_month)
  WHERE contract_id IS NOT NULL AND is_cancelled = false;
