ALTER TABLE public.profile_reservation_metrics
  ADD COLUMN IF NOT EXISTS reservations_total integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profile_reservation_metrics_reservations_total_nonnegative'
      AND conrelid = 'public.profile_reservation_metrics'::regclass
  ) THEN
    ALTER TABLE public.profile_reservation_metrics
      ADD CONSTRAINT profile_reservation_metrics_reservations_total_nonnegative
      CHECK (reservations_total >= 0);
  END IF;
END
$$;

NOTIFY pgrst, 'reload schema';
