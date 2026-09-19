-- Previously gst_monthly_reviews, gst_manual_adjustments and gst_purchase_itc used
-- USING (true) WITH CHECK (true) on INSERT/UPDATE/DELETE for every authenticated user.
-- The "GST Agent" role was only a page-visibility restriction in the UI (via role_pages);
-- at the database/API level any authenticated user (e.g. Staff) could write to these
-- tables directly. This restricts write access to users holding an active Owner, Admin,
-- or GST Agent role. SELECT remains open to all authenticated users (unchanged).

CREATE OR REPLACE FUNCTION public.has_gst_write_access()
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
      AND r.name IN ('Owner', 'Admin', 'GST Agent')
  );
$$;

-- gst_monthly_reviews
DROP POLICY IF EXISTS auth_insert_gst_monthly_reviews ON gst_monthly_reviews;
DROP POLICY IF EXISTS auth_update_gst_monthly_reviews ON gst_monthly_reviews;
DROP POLICY IF EXISTS auth_delete_gst_monthly_reviews ON gst_monthly_reviews;

CREATE POLICY auth_insert_gst_monthly_reviews ON gst_monthly_reviews
  FOR INSERT TO authenticated
  WITH CHECK (public.has_gst_write_access());

CREATE POLICY auth_update_gst_monthly_reviews ON gst_monthly_reviews
  FOR UPDATE TO authenticated
  USING (public.has_gst_write_access())
  WITH CHECK (public.has_gst_write_access());

CREATE POLICY auth_delete_gst_monthly_reviews ON gst_monthly_reviews
  FOR DELETE TO authenticated
  USING (public.has_gst_write_access());

-- gst_manual_adjustments
DROP POLICY IF EXISTS auth_insert_gst_manual_adjustments ON gst_manual_adjustments;
DROP POLICY IF EXISTS auth_update_gst_manual_adjustments ON gst_manual_adjustments;
DROP POLICY IF EXISTS auth_delete_gst_manual_adjustments ON gst_manual_adjustments;

CREATE POLICY auth_insert_gst_manual_adjustments ON gst_manual_adjustments
  FOR INSERT TO authenticated
  WITH CHECK (public.has_gst_write_access());

CREATE POLICY auth_update_gst_manual_adjustments ON gst_manual_adjustments
  FOR UPDATE TO authenticated
  USING (public.has_gst_write_access())
  WITH CHECK (public.has_gst_write_access());

CREATE POLICY auth_delete_gst_manual_adjustments ON gst_manual_adjustments
  FOR DELETE TO authenticated
  USING (public.has_gst_write_access());

-- gst_purchase_itc
DROP POLICY IF EXISTS auth_insert_gst_purchase_itc ON gst_purchase_itc;
DROP POLICY IF EXISTS auth_update_gst_purchase_itc ON gst_purchase_itc;
DROP POLICY IF EXISTS auth_delete_gst_purchase_itc ON gst_purchase_itc;

CREATE POLICY auth_insert_gst_purchase_itc ON gst_purchase_itc
  FOR INSERT TO authenticated
  WITH CHECK (public.has_gst_write_access());

CREATE POLICY auth_update_gst_purchase_itc ON gst_purchase_itc
  FOR UPDATE TO authenticated
  USING (public.has_gst_write_access())
  WITH CHECK (public.has_gst_write_access());

CREATE POLICY auth_delete_gst_purchase_itc ON gst_purchase_itc
  FOR DELETE TO authenticated
  USING (public.has_gst_write_access());
