-- Drop the old CHECK constraint that restricted maintenance_type to only 'Tyre', 'Repair', 'Others'
-- The new Maintenance Types module uses configurable types stored in maintenance_types table,
-- and maintenance.maintenance_type is plain text referencing the type name.
ALTER TABLE maintenance DROP CONSTRAINT IF EXISTS maintenance_maintenance_type_check;