/*
# Customer CC Email Addresses

## Summary
Lets each customer have zero or more CC email addresses that automatically
receive a copy whenever an invoice is emailed to them - a data field plus a
change to the existing send-invoice-email flow, nothing else.

## Changes
1. `customers.cc_emails` (text, nullable) - one comma-separated string of CC
   email addresses for this customer, entered/edited in Customer Master.
   Mirrors the existing `quotation_email_settings.cc_email` precedent (also a
   plain comma-separated text column) rather than introducing a join table
   for what is always a short, customer-owned list.
2. `invoices.email_sent_cc` (text, nullable) - records which CC addresses
   actually received the last successful send, alongside the existing
   `email_sent_to` single-recipient snapshot (email_status/email_sent_at/
   email_sent_to/email_error).

## Data safety
Both are nullable additive columns - no existing customer or invoice row is
modified. A customer with no CC addresses continues to send exactly as
before (primary email only).
*/

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS cc_emails text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS email_sent_cc text;
