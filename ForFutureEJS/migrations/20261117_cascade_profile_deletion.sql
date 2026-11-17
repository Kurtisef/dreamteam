-- Account deletion should remove the profile's reservations and app-open
-- history along with the profile row. Replace any existing profile_id
-- foreign keys on these tables with cascading constraints.
DO $migration$
DECLARE
  child_table text;
  constraint_name text;
BEGIN
  FOREACH child_table IN ARRAY ARRAY['planned_visits', 'app_opens'] LOOP
    FOR constraint_name IN
      SELECT c.conname
      FROM pg_constraint AS c
      JOIN pg_class AS child ON child.oid = c.conrelid
      JOIN pg_namespace AS child_schema ON child_schema.oid = child.relnamespace
      JOIN pg_class AS parent ON parent.oid = c.confrelid
      JOIN pg_namespace AS parent_schema ON parent_schema.oid = parent.relnamespace
      WHERE c.contype = 'f'
        AND child_schema.nspname = 'public'
        AND child.relname = child_table
        AND parent_schema.nspname = 'public'
        AND parent.relname = 'profiles'
        AND c.conkey = ARRAY[
          (SELECT attnum FROM pg_attribute
           WHERE attrelid = child.oid AND attname = 'profile_id' AND NOT attisdropped)
        ]::smallint[]
    LOOP
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', child_table, constraint_name);
    END LOOP;

    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (profile_id) REFERENCES public.profiles(profile_id) ON DELETE CASCADE',
      child_table,
      child_table || '_profile_id_fkey'
    );
  END LOOP;
END;
$migration$;

NOTIFY pgrst, 'reload schema';
