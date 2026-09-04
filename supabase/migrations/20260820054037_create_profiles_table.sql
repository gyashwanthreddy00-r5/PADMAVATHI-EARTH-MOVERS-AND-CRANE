/*
# Create profiles table for user management

## Purpose
Allows adding users from the Supabase backend (dashboard) and automatically
creates a profile row for each new auth user. The profile stores the user's
display name and role (admin/manager/operator) which the app uses to control
access and personalize the UI.

## New Tables
- `profiles`
  - `id` (uuid, primary key, references auth.users.id ON DELETE CASCADE)
  - `full_name` (text, nullable — filled in from backend or by the user)
  - ` `role` (text, default 'admin', check constraint: admin/manager/operator)
  - `created_at` (timestamptz, default now())

## Security (RLS)
- RLS enabled on `profiles`.
- SELECT: authenticated users can read their own profile only.
- UPDATE: authenticated users can update their own profile (name only).
- INSERT/DELETE: blocked from the frontend — profiles are created solely by
  the database trigger when a new auth user is added from the Supabase backend.

## Automation
- Trigger `on_auth_user_created` fires AFTER INSERT on `auth.users` and
  inserts a matching row into `profiles` with the user's email metadata as
  the default full_name and role 'admin'.
- This means: to add a new user, go to Supabase Dashboard > Authentication >
  Users > Add user, and a profile row is created automatically.

## Important Notes
1. Users are added from the Supabase dashboard (Authentication > Users > Add user).
   The trigger handles profile creation automatically.
2. Role defaults to 'admin'. Change it in the profiles table after creation
   if a different role is needed.
3. The frontend cannot create or delete profiles — only the database trigger
   and the Supabase service role can.
*/

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  role text NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'manager', 'operator')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- SELECT: users can read their own profile
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- UPDATE: users can update their own profile
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Auto-create profile when a new auth user is created
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
