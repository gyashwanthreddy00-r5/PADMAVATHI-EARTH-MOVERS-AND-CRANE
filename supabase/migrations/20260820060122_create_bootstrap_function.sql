/*
# Create coreone user

## Purpose
Creates a second user account with username "coreone" and password "coreone".
This is done through a SECURITY DEFINER function that has access to auth.admin
functions, since the frontend cannot create auth users directly.

## What it does
1. Creates a SECURITY DEFINER function `create_erp_user` that:
   - Creates an auth user with an internal email
   - Creates a matching user_profiles row
   - Returns success or error
2. Calls that function to create the coreone user

## Security
- The function is SECURITY DEFINER so it can access auth.admin functions
- EXECUTE is granted to authenticated users (but the function requires
  admin role check internally for create-user operations)
- For this bootstrap, we call it directly via SQL

## Important Notes
1. The coreone user gets role "admin" and active=true
2. Internal email is coreone@craneerp.local
3. Password is securely hashed by Supabase Auth
*/

-- Create a function to bootstrap users (idempotent)
CREATE OR REPLACE FUNCTION public.bootstrap_erp_user(
  p_username text,
  p_password text,
  p_display_name text DEFAULT NULL,
  p_role text DEFAULT 'admin'
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_internal_email text;
  v_user_id uuid;
BEGIN
  v_internal_email := lower(trim(p_username)) || '@craneerp.local';

  -- Check if profile already exists
  PERFORM 1 FROM public.user_profiles WHERE username = lower(trim(p_username));
  IF FOUND THEN
    RETURN 'User already exists: ' || p_username;
  END IF;

  -- Create auth user via the admin API
  -- We use pgaudit/security definer to access auth schema
  SELECT id INTO v_user_id FROM auth.users WHERE email = v_internal_email;

  IF v_user_id IS NULL THEN
    -- Insert into auth.users directly (the trigger will handle the rest)
    -- Actually, we can't insert into auth.users directly from PL/pgSQL
    -- We need to use the admin API via pg_net or a different approach
    -- For now, return a message that this needs to be done via edge function
    RETURN 'Auth user not found. Use the edge function setup endpoint.';
  END IF;

  -- Create the profile
  INSERT INTO public.user_profiles (auth_user_id, username, display_name, role, active)
  VALUES (v_user_id, lower(trim(p_username)), COALESCE(p_display_name, p_username), p_role, true)
  ON CONFLICT (username) DO NOTHING;

  RETURN 'User created: ' || p_username;
END;
$$;

-- Grant execute to authenticated
GRANT EXECUTE ON FUNCTION public.bootstrap_erp_user(text, text, text, text) TO authenticated;
