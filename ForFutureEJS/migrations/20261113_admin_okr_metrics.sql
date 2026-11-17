-- OKR calculations are performed in the Express backend using the Supabase Data API.
-- Remove the earlier database-side aggregate if it was installed.
DROP FUNCTION IF EXISTS public.get_admin_okr_metrics();

NOTIFY pgrst, 'reload schema';
