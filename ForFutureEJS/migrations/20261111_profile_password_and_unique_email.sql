ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS profile_password text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE email IS NOT NULL
    GROUP BY lower(btrim(email))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce unique profile emails: duplicate addresses exist after normalization.';
  END IF;
END
$$;

UPDATE public.profiles
SET email = lower(btrim(email))
WHERE email IS NOT NULL
  AND email <> lower(btrim(email));

CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_normalized_unique_idx
  ON public.profiles (lower(btrim(email)))
  WHERE email IS NOT NULL;
