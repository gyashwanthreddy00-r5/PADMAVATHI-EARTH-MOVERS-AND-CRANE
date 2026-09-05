/*
# Create username resolution function

## Purpose
Allows the frontend to resolve a username to the internal auth email
so it can authenticate directly with the Supabase Auth API using the
anon key. This is needed because the edge function's signInWithPassword
with the service role key doesn't create real user sessions.

## What it does
- Creates a SECURITY DEFINER function `resolve_username` that takes a
  username and returns the associated auth email, but only if the
  user profile is active.
- EXECUTE granted to anon and authenticated so the login flow (before
  authentication) can call it.

## Security
- The function only returns the internal email, never the password or
  any sensitive data.
- Only returns for active users.
- SECURITY DEFINER is needed to access auth.users table.
*/

CREATE OR REPLACE FUNCTION public.resolve_username(p_username text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_auth_user_id uuid;
  v_email text;
BEGIN
  SELECT auth_user_id INTO v_auth_user_id
  FROM public.user_profiles
  WHERE username = lower(trim(p_username))
    AND active = true;

  IF v_auth_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_auth_user_id;

  RETURN v_email;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_username(text) TO anon, authenticated;
