/*
# Create user_profiles table for username-based authentication

## Purpose
Maps application-level usernames to Supabase Auth accounts so users can log
in with a username instead of an email address. Each auth user gets a
profile row with a unique username, display name, role, and active flag.

## New Tables
- `user_profiles`
  - `id` (uuid, primary key)
  - `auth_user_id` (uuid, unique, not null, references auth.users ON DELETE CASCADE)
  - `username` (text, unique, not null)
  - `display_name` (text, nullable)
  - `role` (text, not null, default 'admin', check: admin/manager/operator)
  - `active` (boolean, not null, default true)
  - `created_at` (timestamptz, default now())
  - `updated_at` (timestamptz, default now())

## Security (RLS)
- RLS enabled on `user_profiles`.
- SELECT: authenticated users can read all profiles (needed to resolve
  usernames during login and display user info). The edge function uses
  the service role key which bypasses RLS for the actual resolution.
- INSERT/UPDATE/DELETE: blocked from the frontend — profiles are managed
  exclusively through the edge function using the service role key.

## Important Notes
1. The admin user is created by the `auth-helper` edge function during setup.
2. User profiles can only be created/modified through the edge function,
   not directly from the frontend.
3. The `username` column has a unique constraint — no two users can share
   the same username.
4. The `active` flag must be true for a user to log in.
*/

CREATE TABLE IF NOT EXISTS public.user_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  username text UNIQUE NOT NULL,
  display_name text,
  role text NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'manager', 'operator')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- SELECT: authenticated users can read all profiles (for display purposes)
DROP POLICY IF EXISTS "user_profiles_select" ON public.user_profiles;
CREATE POLICY "user_profiles_select"
  ON public.user_profiles FOR SELECT
  TO authenticated
  USING (true);

-- No INSERT/UPDATE/DELETE policies — managed only via edge function with service role

-- Index for fast username lookups
CREATE INDEX IF NOT EXISTS idx_user_profiles_username ON public.user_profiles (username);
CREATE INDEX IF NOT EXISTS idx_user_profiles_auth_user_id ON public.user_profiles (auth_user_id);

-- Auto-update updated_at on row changes
CREATE OR REPLACE FUNCTION public.update_user_profiles_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_profiles_updated_at ON public.user_profiles;
CREATE TRIGGER trg_user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_user_profiles_updated_at();
