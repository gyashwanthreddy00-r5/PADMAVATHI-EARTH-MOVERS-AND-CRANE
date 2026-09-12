/*
# Pin search_path on all functions missing it

## Security issue
14 functions in this database never pinned their search_path, meaning
Postgres resolves any unqualified table/function reference inside them
using whichever search_path the CALLING session currently has set. For
the 8 that are SECURITY DEFINER (running with the function owner's
elevated privileges, not the caller's), this is the classic
search-path-hijack pattern: an authenticated user could create their own
schema with a same-named object placed earlier in their session's search
path, redirecting the function's unqualified lookups to an object they
control while it still runs with elevated privileges.

## Fix
Pin search_path = public on every one of them. Metadata-only change - no
function body is touched, no behavior changes for legitimate use. This
makes resolution always go through `public` regardless of what the
calling session's own search_path is set to, closing the redirect vector
permanently (including against future edits to these functions that might
otherwise reintroduce an unqualified reference).
*/

-- SECURITY DEFINER functions (higher risk - elevated privileges)
ALTER FUNCTION public.current_financial_year() SET search_path = public;
ALTER FUNCTION public.next_fy_invoice_number(text) SET search_path = public;
ALTER FUNCTION public.next_gst_invoice_number() SET search_path = public;
ALTER FUNCTION public.next_invoice_number(text) SET search_path = public;
ALTER FUNCTION public.next_pcs_invoice_number(text) SET search_path = public;
ALTER FUNCTION public.next_quotation_number(text) SET search_path = public;
ALTER FUNCTION public.next_trip_number() SET search_path = public;
ALTER FUNCTION public.peek_pcs_invoice_number(text) SET search_path = public;

-- Plain trigger functions (lower risk - run as caller, not elevated)
ALTER FUNCTION public.set_updated_at() SET search_path = public;
ALTER FUNCTION public.handle_updated_at_quotations() SET search_path = public;
ALTER FUNCTION public.update_invoice_vehicle_sessions_updated_at() SET search_path = public;
ALTER FUNCTION public.update_invoice_vehicles_updated_at() SET search_path = public;
ALTER FUNCTION public.update_updated_at_column() SET search_path = public;
ALTER FUNCTION public.update_user_profiles_updated_at() SET search_path = public;
