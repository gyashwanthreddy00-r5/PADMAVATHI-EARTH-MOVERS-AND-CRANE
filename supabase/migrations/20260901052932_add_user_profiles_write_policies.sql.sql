/*
# Add INSERT/UPDATE/DELETE policies on user_profiles

1. Security
- user_profiles currently only has a SELECT policy (authenticated can read).
- Adds INSERT, UPDATE, DELETE policies scoped to authenticated users.
- The create-user edge function uses the service role key (bypasses RLS),
  but these policies ensure any direct client writes are also permitted.
*/

DROP POLICY IF EXISTS "user_profiles_insert" ON public.user_profiles;
CREATE POLICY "user_profiles_insert"
  ON public.user_profiles FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "user_profiles_update" ON public.user_profiles;
CREATE POLICY "user_profiles_update"
  ON public.user_profiles FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "user_profiles_delete" ON public.user_profiles;
CREATE POLICY "user_profiles_delete"
  ON public.user_profiles FOR DELETE
  TO authenticated USING (true);
