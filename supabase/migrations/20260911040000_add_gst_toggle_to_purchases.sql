/*
# Purchases — add GST ON/OFF toggle

Purchase entries currently always apply 18% GST (GST_RATE hardcoded in the
app). This adds the ability to record a purchase with GST OFF (no tax),
per line item.

Adds one column to `purchases`:
  gst_enabled boolean NOT NULL DEFAULT true

DEFAULT true (not false) is intentional for EXISTING rows specifically:
every purchase recorded before this feature existed already had 18% GST
applied unconditionally (confirmed live: the one existing row has
gst_amount > 0), so defaulting existing rows to gst_enabled = true
correctly preserves their actual state — "treat existing purchases that
already contain 18% GST as GST ON." New rows going forward always set
this explicitly from the Add Purchase form (whose own UI default is GST
OFF), so the column default only matters for backfilling history.

gst_rate already existed (numeric, default 18) and continues to store the
applied rate (18 when gst_enabled, 0 when not) — no new rate column
needed. No existing row's amount/gst_amount/total_amount/paid_amount/
balance_amount is modified; only this one new column is added.
*/

ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS gst_enabled boolean NOT NULL DEFAULT true;
