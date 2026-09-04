-- rate_master: drop old couple_hours_rate (weekly_rate already exists)
ALTER TABLE rate_master DROP COLUMN couple_hours_rate;

-- trips: rename snapshot column
ALTER TABLE trips RENAME COLUMN couple_hours_rate_snapshot TO weekly_rate_snapshot;

-- invoice_vehicles: rename snapshot column
ALTER TABLE invoice_vehicles RENAME COLUMN couple_hours_rate_snapshot TO weekly_rate_snapshot;