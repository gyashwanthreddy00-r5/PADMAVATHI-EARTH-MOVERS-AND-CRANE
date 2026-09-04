ALTER TABLE quotation_equipment
  ADD COLUMN IF NOT EXISTS first_hour_rate numeric,
  ADD COLUMN IF NOT EXISTS second_hour_rate numeric;

COMMENT ON COLUMN quotation_equipment.first_hour_rate IS '1st hour rate snapshot for this quotation line';
COMMENT ON COLUMN quotation_equipment.second_hour_rate IS '2nd hour rate snapshot for this quotation line';
