/*
  # Add Insurance Expiry Date to vehicles

  Adds an optional insurance expiry date to the Crane/Vehicle Master, powering
  a new Insurance expiry alert on the Important Alerts / Compliance & Expiry
  sections (same notification engine already used for Fitness Expiry).

  1. Changes
    - `vehicles.insurance_expiry_date` (date, nullable) — NULL means "not yet
      tracked", matching the existing fitness_expiry_date column exactly.
*/

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS insurance_expiry_date date;
