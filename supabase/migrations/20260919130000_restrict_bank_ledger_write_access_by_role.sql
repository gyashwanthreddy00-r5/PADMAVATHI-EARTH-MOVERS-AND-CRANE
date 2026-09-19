-- Same open-RLS gap as the GST module: bank_accounts, bank_transactions,
-- salary_payments, other_expenses, invoice_payments, purchase_payments,
-- diesel_payments and maintenance_payments all used USING (true) WITH CHECK (true)
-- for every authenticated user on INSERT/UPDATE/DELETE. Today only Admin and
-- GST Agent roles exist, and GST Agent has no UI access to any of these pages,
-- but the database itself never enforced that. This restricts write access to
-- users holding an active Owner or Admin role. SELECT remains open to all
-- authenticated users (unchanged).
--
-- emi_records has the identical open pattern (policies named auth_insert_emi,
-- auth_update_emi, auth_delete_emi rather than the table-name suffix used by
-- the other tables) and also feeds bank_transactions via its own sync trigger,
-- so it's included via a separate block below with the matching policy names.

CREATE OR REPLACE FUNCTION public.has_finance_write_access()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_profiles up
    JOIN user_roles ur ON ur.user_id = up.id
    JOIN roles r ON r.id = ur.role_id
    WHERE up.auth_user_id = auth.uid()
      AND up.active = true
      AND r.is_active = true
      AND r.name IN ('Owner', 'Admin')
  );
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'bank_accounts',
    'bank_transactions',
    'salary_payments',
    'other_expenses',
    'invoice_payments',
    'purchase_payments',
    'diesel_payments',
    'maintenance_payments'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS auth_insert_%1$s ON %1$s', t);
    EXECUTE format('DROP POLICY IF EXISTS auth_update_%1$s ON %1$s', t);
    EXECUTE format('DROP POLICY IF EXISTS auth_delete_%1$s ON %1$s', t);

    EXECUTE format(
      'CREATE POLICY auth_insert_%1$s ON %1$s FOR INSERT TO authenticated WITH CHECK (public.has_finance_write_access())',
      t
    );
    EXECUTE format(
      'CREATE POLICY auth_update_%1$s ON %1$s FOR UPDATE TO authenticated USING (public.has_finance_write_access()) WITH CHECK (public.has_finance_write_access())',
      t
    );
    EXECUTE format(
      'CREATE POLICY auth_delete_%1$s ON %1$s FOR DELETE TO authenticated USING (public.has_finance_write_access())',
      t
    );
  END LOOP;
END $$;

DROP POLICY IF EXISTS auth_insert_emi ON emi_records;
DROP POLICY IF EXISTS auth_update_emi ON emi_records;
DROP POLICY IF EXISTS auth_delete_emi ON emi_records;

CREATE POLICY auth_insert_emi ON emi_records
  FOR INSERT TO authenticated
  WITH CHECK (public.has_finance_write_access());

CREATE POLICY auth_update_emi ON emi_records
  FOR UPDATE TO authenticated
  USING (public.has_finance_write_access())
  WITH CHECK (public.has_finance_write_access());

CREATE POLICY auth_delete_emi ON emi_records
  FOR DELETE TO authenticated
  USING (public.has_finance_write_access());
