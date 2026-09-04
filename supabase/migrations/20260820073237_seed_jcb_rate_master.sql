/*
# Seed default JCB rate master

## Summary
Inserts a default JCB rate master record so JCB trips can find applicable rates.
The administrator can edit this rate at any time — versioning will preserve old records.

## New Data
- JCB rate master V1: vehicle_type='JCB', vehicle_category='JCB', no capacity required
  - 1st Hour = ₹950, 2nd Hour = ₹500, Daily = ₹9,500, Batha = ₹200

## Security
- No schema changes, no RLS changes.
- Data only — safe to re-run (uses NOT EXISTS guard).
*/

INSERT INTO rate_master (vehicle_category, vehicle_type, capacity_tons, rate_type, first_hour_rate, second_hour_rate, daily_rate, batha, effective_from, effective_to, status, version_number)
SELECT 'JCB', 'JCB', NULL, 'Both', 950, 500, 9500, 200, CURRENT_DATE, NULL, 'Active', 1
WHERE NOT EXISTS (
  SELECT 1 FROM rate_master WHERE vehicle_type = 'JCB' AND status = 'Active'
);
