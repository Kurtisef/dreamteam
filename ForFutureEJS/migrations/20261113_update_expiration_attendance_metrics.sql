CREATE OR REPLACE FUNCTION public.expire_planned_visits_and_update_metrics(
  p_before_arrival timestamp without time zone
)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH deleted AS (
    DELETE FROM public.planned_visits
    WHERE intended_arrival < p_before_arrival
    RETURNING profile_id, did_attend
  ),
  per_profile AS (
    SELECT
      profile_id,
      count(*)::integer AS expired_count,
      count(*) FILTER (WHERE did_attend IS NOT NULL)::integer AS answered_count,
      count(*) FILTER (WHERE did_attend IS TRUE)::integer AS kept_count
    FROM deleted
    GROUP BY profile_id
  ),
  updated AS (
    INSERT INTO public.profile_reservation_metrics AS metrics (
      profile_id,
      reservations_total,
      reservations_answered,
      reservations_kept,
      updated_at
    )
    SELECT profile_id, expired_count, answered_count, kept_count, now()
    FROM per_profile
    ON CONFLICT (profile_id) DO UPDATE
      SET reservations_total = metrics.reservations_total + EXCLUDED.reservations_total,
          reservations_answered = metrics.reservations_answered + EXCLUDED.reservations_answered,
          reservations_kept = metrics.reservations_kept + EXCLUDED.reservations_kept,
          updated_at = now()
    RETURNING profile_id
  )
  SELECT COALESCE(SUM(per_profile.expired_count), 0)::integer
  FROM per_profile
  CROSS JOIN (SELECT count(*) FROM updated) AS applied;
$function$;

REVOKE ALL ON FUNCTION public.expire_planned_visits_and_update_metrics(timestamp without time zone)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_planned_visits_and_update_metrics(timestamp without time zone)
  TO service_role;

NOTIFY pgrst, 'reload schema';
