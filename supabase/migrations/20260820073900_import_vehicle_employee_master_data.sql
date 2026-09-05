/*
# Import Vehicle and Employee Master Data

## Summary
1. Inserts 21 vehicle master records (20 Cranes + 1 JCB) with exact serial numbers, registration numbers, models, capacities, and EMI details.
2. Inserts 9 employee master records with names, roles, phone numbers, salaries, license numbers, license expiry dates, and advance salary values.
3. Updates the trips bill_status CHECK constraint to allow 'Partially Paid' in addition to 'Paid' and 'Pending'.

## Vehicle Data
- 20 Crane vehicles with capacities ranging from 11 Ton to 80 Ton
- 1 JCB vehicle (TS08GM7378) with NULL capacity
- EMI Status mapped: 'EMI' in source → 'EMI Applicable' in database
- Registration numbers normalized to uppercase
- Serial numbers stored as text ('1' through '21')

## Employee Data
- 7 Drivers, 2 Helpers
- License expiry dates converted from DD-MM-YYYY to YYYY-MM-DD
- Advance salary: Sai=4000, Baba=3000, Krishna=8000, all others=0
- Phone numbers stored as text

## Constraint Changes
- trips.bill_status CHECK updated to include 'Partially Paid'

## Safety
- Uses NOT EXISTS guards to prevent duplicates
- No existing data modified or deleted
- All inserts are idempotent
*/

-- ============================================================
-- Fix trips bill_status constraint to allow 'Partially Paid'
-- ============================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='trips_bill_status_check' AND table_name='trips') THEN
    ALTER TABLE trips DROP CONSTRAINT trips_bill_status_check;
  END IF;
END $$;
ALTER TABLE trips ADD CONSTRAINT trips_bill_status_check CHECK (bill_status IN ('Paid','Pending','Partially Paid'));

-- ============================================================
-- Insert 21 Vehicle Master Records
-- ============================================================

INSERT INTO vehicles (serial_number, registration_number, model, type, capacity, emi_status, emi_amount, status, active)
SELECT '1', 'AP28BP1578', 'HYDRA', 'Crane', '11 Ton', 'No EMI', 0, 'Available', true
WHERE NOT EXISTS (SELECT 1 FROM vehicles WHERE registration_number = 'AP28BP1578');

INSERT INTO vehicles (serial_number, registration_number, model, type, capacity, emi_status, emi_amount, status, active)
SELECT '2', 'TS08WF7819', 'HYDRA', 'Crane', '12 Ton', 'No EMI', 0, 'Available', true
WHERE NOT EXISTS (SELECT 1 FROM vehicles WHERE registration_number = 'TS08WF7819');

INSERT INTO vehicles (serial_number, registration_number, model, type, capacity, emi_status, emi_amount, status, active)
SELECT '3', 'TS07EB2617', 'HYDRA', 'Crane', '14 Ton', 'No EMI', 0, 'Available', true
WHERE NOT EXISTS (SELECT 1 FROM vehicles WHERE registration_number = 'TS07EB2617');

INSERT INTO vehicles (serial_number, registration_number, model, type, capacity, emi_status, emi_amount, status, active)
SELECT '4', 'TS08EW4678', 'HYDRA', 'Crane', '14 Ton', 'No EMI', 0, 'Available', true
WHERE NOT EXISTS (SELECT 1 FROM vehicles WHERE registration_number = 'TS08EW4678');

INSERT INTO vehicles (serial_number, registration_number, model, type, capacity, emi_status, emi_amount, status, active)
SELECT '5', 'TS08ZG2779', 'HYDRA', 'Crane', '14 Ton', 'No EMI', 0, 'Available', true
WHERE NOT EXISTS (SELECT 1 FROM vehicles WHERE registration_number = 'TS08ZG2779');

INSERT INTO vehicles (serial_number, registration_number, model, type, capacity, emi_status, emi_amount, status, active)
SELECT '6', 'TS08HS7558', 'HYDRA', 'Crane', '14 Ton', 'No EMI', 0, 'Available', true
WHERE NOT EXISTS (SELECT 1 FROM vehicles WHERE registration_number = 'TS08HS7558');

INSERT INTO vehicles (serial_number, registration_number, model, type, capacity, emi_status, emi_amount, status, active)
SELECT '7', 'TS08HS7549', 'HYDRA', 'Crane', '16 Ton', 'No EMI', 0, 'Available', true
WHERE NOT EXISTS (SELECT 1 FROM vehicles WHERE registration_number = 'TS08HS7549');

INSERT INTO vehicles (serial_number, registration_number, model, type, capacity, emi_status, emi_amount, status, active)
SELECT '8', 'TS08GM7378', 'JCB 3DX', 'JCB', NULL, 'EMI Applicable', 25000, 'Available', true
WHERE NOT EXISTS (SELECT 1 FROM vehicles WHERE registration_number = 'TS08GM7378');

INSERT INTO vehicles (serial_number, registration_number, model, type, capacity, emi_status, emi_amount, status, active)
SELECT '9', 'GJ03HE6288', NULL, 'Crane', '30 Ton', 'EMI Applicable', 25000, 'Available', true
WHERE NOT EXISTS (SELECT 1 FROM vehicles WHERE registration_number = 'GJ03HE6288');

INSERT INTO vehicles (serial_number, registration_number, model, type, capacity, emi_status, emi_amount, status, active)
SELECT '10', 'TS08JD9178', NULL, 'Crane', '80 Ton', 'EMI Applicable', 25000, 'Available', true
WHERE NOT EXISTS (SELECT 1 FROM vehicles WHERE registration_number = 'TS08JD9178');

INSERT INTO vehicles (serial_number, registration_number, model, type, capacity, emi_status, emi_amount, status, active)
SELECT '11', 'MH01EN6353', NULL, 'Crane', '80 Ton', 'EMI Applicable', 25000, 'Available', true
WHERE NOT EXISTS (SELECT 1 FROM vehicles WHERE registration_number = 'MH01EN6353');

INSERT INTO vehicles (serial_number, registration_number, model, type, capacity, emi_status, emi_amount, status, active)
SELECT '12', 'TS08GU1978', 'FARANA', 'Crane', '15 Ton', 'EMI Applicable', 25000, 'Available', true
WHERE NOT EXISTS (SELECT 1 FROM vehicles WHERE registration_number = 'TS08GU1978');

INSERT INTO vehicles (serial_number, registration_number, model, type, capacity, emi_status, emi_amount, status, active)
SELECT '13', 'TS08GZ2878', 'FARANA', 'Crane', '15 Ton', 'EMI Applicable', 30000, 'Available', true
WHERE NOT EXISTS (SELECT 1 FROM vehicles WHERE registration_number = 'TS08GZ2878');

INSERT INTO vehicles (serial_number, registration_number, model, type, capacity, emi_status, emi_amount, status, active)
SELECT '14', 'TS08HQ1987', 'FARANA', 'Crane', '15 Ton', 'EMI Applicable', 30000, 'Available', true
WHERE NOT EXISTS (SELECT 1 FROM vehicles WHERE registration_number = 'TS08HQ1987');

INSERT INTO vehicles (serial_number, registration_number, model, type, capacity, emi_status, emi_amount, status, active)
SELECT '15', 'TS08JH4768', 'FARANA', 'Crane', '15 Ton', 'EMI Applicable', 30000, 'Available', true
WHERE NOT EXISTS (SELECT 1 FROM vehicles WHERE registration_number = 'TS08JH4768');

INSERT INTO vehicles (serial_number, registration_number, model, type, capacity, emi_status, emi_amount, status, active)
SELECT '16', 'TS08JM7378', 'FARANA', 'Crane', '15 Ton', 'EMI Applicable', 30000, 'Available', true
WHERE NOT EXISTS (SELECT 1 FROM vehicles WHERE registration_number = 'TS08JM7378');

INSERT INTO vehicles (serial_number, registration_number, model, type, capacity, emi_status, emi_amount, status, active)
SELECT '17', 'TS08JM4768', 'FARANA', 'Crane', '15 Ton', 'EMI Applicable', 30000, 'Available', true
WHERE NOT EXISTS (SELECT 1 FROM vehicles WHERE registration_number = 'TS08JM4768');

INSERT INTO vehicles (serial_number, registration_number, model, type, capacity, emi_status, emi_amount, status, active)
SELECT '18', 'TG08AD8287', NULL, 'Crane', '17 Ton', 'EMI Applicable', 30000, 'Available', true
WHERE NOT EXISTS (SELECT 1 FROM vehicles WHERE registration_number = 'TG08AD8287');

INSERT INTO vehicles (serial_number, registration_number, model, type, capacity, emi_status, emi_amount, status, active)
SELECT '19', 'TG08AD8278', NULL, 'Crane', '17 Ton', 'EMI Applicable', 30000, 'Available', true
WHERE NOT EXISTS (SELECT 1 FROM vehicles WHERE registration_number = 'TG08AD8278');

INSERT INTO vehicles (serial_number, registration_number, model, type, capacity, emi_status, emi_amount, status, active)
SELECT '20', 'GJ27CQ2691', NULL, 'Crane', '30 Ton', 'EMI Applicable', 30000, 'Available', true
WHERE NOT EXISTS (SELECT 1 FROM vehicles WHERE registration_number = 'GJ27CQ2691');

INSERT INTO vehicles (serial_number, registration_number, model, type, capacity, emi_status, emi_amount, status, active)
SELECT '21', 'GJ27CQ2902', NULL, 'Crane', '55 Ton', 'EMI Applicable', 30000, 'Available', true
WHERE NOT EXISTS (SELECT 1 FROM vehicles WHERE registration_number = 'GJ27CQ2902');

-- ============================================================
-- Insert 9 Employee Master Records
-- ============================================================

INSERT INTO employees (name, role, phone, salary, license_number, license_expiry, advance_salary, active)
SELECT 'Ramu', 'Driver', '8989811111', 20000, 'ABCD1234', '2028-08-20', 0, true
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE phone = '8989811111' OR license_number = 'ABCD1234');

INSERT INTO employees (name, role, phone, salary, license_number, license_expiry, advance_salary, active)
SELECT 'Suresh', 'Driver', '8989811112', 20000, 'ABCD1235', '2028-08-20', 0, true
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE phone = '8989811112' OR license_number = 'ABCD1235');

INSERT INTO employees (name, role, phone, salary, license_number, license_expiry, advance_salary, active)
SELECT 'Sai', 'Driver', '8989811113', 20000, 'ABCD1236', '2028-08-19', 4000, true
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE phone = '8989811113' OR license_number = 'ABCD1236');

INSERT INTO employees (name, role, phone, salary, license_number, license_expiry, advance_salary, active)
SELECT 'Baba', 'Driver', '8989811114', 20000, 'ABCD1237', '2028-08-20', 3000, true
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE phone = '8989811114' OR license_number = 'ABCD1237');

INSERT INTO employees (name, role, phone, salary, license_number, license_expiry, advance_salary, active)
SELECT 'Manish', 'Helper', '8989811115', 10000, 'ABCD1238', '2028-08-20', 0, true
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE phone = '8989811115' OR license_number = 'ABCD1238');

INSERT INTO employees (name, role, phone, salary, license_number, license_expiry, advance_salary, active)
SELECT 'Kumar', 'Helper', '8989811116', 10000, 'ABCD1239', '2028-08-20', 0, true
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE phone = '8989811116' OR license_number = 'ABCD1239');

INSERT INTO employees (name, role, phone, salary, license_number, license_expiry, advance_salary, active)
SELECT 'Vamish', 'Driver', '8989811117', 30000, 'ABCD1240', '2028-08-20', 0, true
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE phone = '8989811117' OR license_number = 'ABCD1240');

INSERT INTO employees (name, role, phone, salary, license_number, license_expiry, advance_salary, active)
SELECT 'Krishna', 'Driver', '8989811118', 30000, 'ABCD1241', '2028-08-20', 8000, true
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE phone = '8989811118' OR license_number = 'ABCD1241');

INSERT INTO employees (name, role, phone, salary, license_number, license_expiry, advance_salary, active)
SELECT 'Sagar', 'Driver', '8989811119', 30000, 'ABCD1242', '2028-08-20', 0, true
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE phone = '8989811119' OR license_number = 'ABCD1242');
