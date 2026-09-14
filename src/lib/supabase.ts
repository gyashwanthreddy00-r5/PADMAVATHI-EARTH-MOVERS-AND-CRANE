import { createClient } from '@supabase/supabase-js';

// __SUPABASE_URL__ / __SUPABASE_ANON_KEY__ are injected at build/dev time by
// Vite's `define` (see vite.config.ts), mapping the project's SUPABASE_URL /
// SUPABASE_ANON_KEY env vars into the client bundle. They are declared as
// ambient globals in vite-env.d.ts. Fall back to VITE_-prefixed overrides.
const supabaseUrl =
  (typeof __SUPABASE_URL__ !== 'undefined' && __SUPABASE_URL__) ||
  (import.meta.env.VITE_SUPABASE_URL as string) ||
  '';
const supabaseAnonKey =
  (typeof __SUPABASE_ANON_KEY__ !== 'undefined' && __SUPABASE_ANON_KEY__) ||
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string) ||
  '';

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Check .env for VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  realtime: { params: { eventsPerSecond: 2 } },
});
