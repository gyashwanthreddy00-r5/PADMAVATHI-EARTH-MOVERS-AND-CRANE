-- Add quotation_amount field to replace equipment line totals
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS quotation_amount numeric DEFAULT 0;

-- Backfill existing quotations: use sum of equipment amounts as the quotation_amount
UPDATE quotations q
SET quotation_amount = COALESCE((
  SELECT SUM(amount) FROM quotation_equipment WHERE quotation_id = q.id
), 0)
WHERE q.quotation_amount = 0 OR q.quotation_amount IS NULL;
