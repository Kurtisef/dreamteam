-- Make the per-profile overlap and daily-limit checks atomic with insertion.
-- Run this migration in the Supabase SQL editor before using the updated server.

CREATE OR REPLACE FUNCTION public.reserve_planned_visit_atomic(p_visit jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  requested_visit public.planned_visits%ROWTYPE;
  inserted_visit public.planned_visits%ROWTYPE;
  reservation_date date;
  reservation_minutes numeric;
  already_booked_minutes numeric;
BEGIN
  requested_visit := jsonb_populate_record(NULL::public.planned_visits, p_visit);

  IF requested_visit.profile_id IS NULL
    OR requested_visit.intended_arrival IS NULL
    OR requested_visit.exit_time IS NULL THEN
    RAISE EXCEPTION 'A profile and reservation start and end times are required.';
  END IF;

  reservation_date := requested_visit.intended_arrival::date;
  reservation_minutes := EXTRACT(
    EPOCH FROM (requested_visit.exit_time - requested_visit.intended_arrival)
  ) / 60;

  IF reservation_minutes NOT IN (30, 60, 90, 120)
    OR requested_visit.exit_time::date <> reservation_date THEN
    RAISE EXCEPTION 'The reservation duration or date is invalid.';
  END IF;

  IF NOT (
    COALESCE(requested_visit.racks, false)
    OR COALESCE(requested_visit.dumbbells, false)
    OR COALESCE(requested_visit.cable_stacks, false)
    OR COALESCE(requested_visit.weight_machines, false)
    OR COALESCE(requested_visit.cardio_machines, false)
  ) THEN
    RAISE EXCEPTION 'Select at least one intended equipment type.';
  END IF;

  -- Requests for this profile and gym date queue behind one another until each
  -- check-and-insert transaction finishes.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(requested_visit.profile_id::text || ':' || reservation_date::text, 0)
  );

  IF EXISTS (
    SELECT 1
    FROM public.planned_visits AS existing_visit
    WHERE existing_visit.profile_id = requested_visit.profile_id
      AND existing_visit.intended_arrival::date = reservation_date
      AND existing_visit.intended_arrival < requested_visit.exit_time
      AND existing_visit.exit_time > requested_visit.intended_arrival
  ) THEN
    RETURN jsonb_build_object('status', 'overlap');
  END IF;

  SELECT COALESCE(SUM(
    EXTRACT(EPOCH FROM (existing_visit.exit_time - existing_visit.intended_arrival)) / 60
  ), 0)
  INTO already_booked_minutes
  FROM public.planned_visits AS existing_visit
  WHERE existing_visit.profile_id = requested_visit.profile_id
    AND existing_visit.intended_arrival::date = reservation_date;

  IF already_booked_minutes + reservation_minutes > 120 THEN
    RETURN jsonb_build_object(
      'status', 'daily_limit',
      'remaining_minutes', GREATEST(0, 120 - already_booked_minutes)
    );
  END IF;

  INSERT INTO public.planned_visits (
    profile_id,
    intended_arrival,
    exit_time,
    racks,
    dumbbells,
    cable_stacks,
    weight_machines,
    cardio_machines
  ) VALUES (
    requested_visit.profile_id,
    requested_visit.intended_arrival,
    requested_visit.exit_time,
    COALESCE(requested_visit.racks, false),
    COALESCE(requested_visit.dumbbells, false),
    COALESCE(requested_visit.cable_stacks, false),
    COALESCE(requested_visit.weight_machines, false),
    COALESCE(requested_visit.cardio_machines, false)
  )
  RETURNING * INTO inserted_visit;

  RETURN jsonb_build_object(
    'status', 'saved',
    'visit', to_jsonb(inserted_visit)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.reserve_planned_visit_atomic(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_planned_visit_atomic(jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
