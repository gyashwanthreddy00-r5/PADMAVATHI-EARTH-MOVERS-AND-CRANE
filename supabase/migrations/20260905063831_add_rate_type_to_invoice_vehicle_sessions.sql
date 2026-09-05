ALTER TABLE invoice_vehicle_sessions
  ADD COLUMN IF NOT EXISTS rate_type text DEFAULT 'Hourly';

COMMENT ON COLUMN invoice_vehicle_sessions.rate_type IS 'Per-session rate type (Hourly, Daily, Weekly, Monthly) so each session retains its own billing configuration independently.';
