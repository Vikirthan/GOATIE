-- GOATIE v4: goats.death_date for deceased tracking.
--
-- Why: the app (GoatsListPage edit form + Goat type deathDate) already sends
-- death_date via updateGoat -> camelToSnake, but the column was never created,
-- so Supabase/PostgREST rejects the update with:
--   "Could not find the 'death_date' column of 'goats' in the schema cache"
--
-- Run in Supabase SQL editor, or via `supabase db push`.
-- Safe to re-run (IF NOT EXISTS).

alter table goats add column if not exists death_date timestamptz;
    