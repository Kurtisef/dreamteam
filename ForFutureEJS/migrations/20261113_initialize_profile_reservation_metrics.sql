-- Create zeroed metrics rows for profiles that already exist. Leave any
-- existing metrics untouched if this migration is safely rerun.
INSERT INTO public.profile_reservation_metrics (profile_id)
SELECT profile_id
FROM public.profiles
ON CONFLICT (profile_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.initialize_profile_reservation_metrics()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.profile_reservation_metrics (profile_id)
  VALUES (NEW.profile_id)
  ON CONFLICT (profile_id) DO NOTHING;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.initialize_profile_reservation_metrics()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profile_reservation_metrics_after_insert
  ON public.profiles;

CREATE TRIGGER profile_reservation_metrics_after_insert
AFTER INSERT ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.initialize_profile_reservation_metrics();

NOTIFY pgrst, 'reload schema';
