-- GOATIE v3: profiles (display names readable by any login).
--
-- Run AFTER 20260926_herds_rbac.sql (uses is_admin()).
-- Why: auth.users emails/metadata are not readable with the anon key, so the
-- app had no way to show farmer names (herd labels, member lists) without the
-- /api route. profiles mirrors id → display_name with open read access.

create table if not exists profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Backfill from existing auth metadata (or email prefix when unset).
insert into profiles (user_id, display_name)
  select
    id,
    coalesce(
      nullif(raw_user_meta_data->>'display_name', ''),
      nullif(split_part(email, '@', 1), ''),
      'Farmer'
    )
  from auth.users
  on conflict (user_id) do nothing;

alter table profiles enable row level security;

drop policy if exists "profiles_select_authenticated" on profiles;
drop policy if exists "profiles_insert_self_or_admin" on profiles;
drop policy if exists "profiles_update_self_or_admin" on profiles;

-- Any signed-in login can read all names (needed for herd/member labels).
create policy "profiles_select_authenticated" on profiles for select
  to authenticated using (true);
-- Bootstrap own row on first login; admin may seed others.
create policy "profiles_insert_self_or_admin" on profiles for insert
  with check (auth.uid() = user_id or is_admin());
create policy "profiles_update_self_or_admin" on profiles for update
  using (auth.uid() = user_id or is_admin())
  with check (auth.uid() = user_id or is_admin());

-- Verify: select * from profiles;  -- expect 2 rows (RKT + VIKI names)
