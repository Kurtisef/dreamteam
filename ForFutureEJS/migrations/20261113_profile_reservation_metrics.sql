ALTER TABLE public.planned_visits
  ADD COLUMN IF NOT EXISTS did_attend boolean,
  ADD COLUMN IF NOT EXISTS attendance_responded_at timestamptz;

CREATE TABLE IF NOT EXISTS public.profile_reservation_metrics (
  profile_id uuid PRIMARY KEY
    REFERENCES public.profiles(profile_id)
    ON DELETE CASCADE,
  reservations_answered integer NOT NULL DEFAULT 0
    CHECK (reservations_answered >= 0),
  reservations_kept integer NOT NULL DEFAULT 0
    CHECK (reservations_kept >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (reservations_kept <= reservations_answered)
);

ALTER TABLE public.profile_reservation_metrics ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON TABLE public.profile_reservation_metrics TO service_role;

NOTIFY pgrst, 'reload schema';
