-- GOATIE v2: shared herds + RBAC (admin view-only, farmers share herds).
--
-- Run AFTER 20260925_real_auth_rls.sql (requires goats.farmer_id uuid + v1 RLS).
-- Run ONCE in Supabase dashboard → SQL Editor (service-role / postgres owner).
--
-- Model:
--   * A herd is anchored by the original owner's UUID (existing goats.farmer_id
--     values stay untouched — no goat rows move).
--   * herd_members(herd_id, user_id): assigning a login to a herd = one row.
--   * user_roles(user_id, role): 'admin' sees all herds (select-only),
--     'farmer' has full access inside their own herds only.
--   * Seed: vikirthan06@gmail.com (VIKI) = admin, rkte4e@gmail.com (RKT) = farmer.

-- ─── 0. Preconditions ────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'goats' and column_name = 'farmer_id') then
    raise exception 'goats.farmer_id missing — run the v1 migration first';
  end if;
end $$;

-- ─── 1. Roles + membership tables ────────────────────────────────────────────
create table if not exists user_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'farmer')),
  created_at timestamptz not null default now()
);

create table if not exists herd_members (
  herd_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (herd_id, user_id)
);
create index if not exists herd_members_user_idx on herd_members (user_id);

-- Backfill: every existing herd anchor gets its owner as first member.
insert into herd_members (herd_id, user_id)
  select distinct farmer_id, farmer_id from goats
  on conflict do nothing;

-- Seed roles (only where missing — never demote an existing admin).
insert into user_roles (user_id, role) values
  ('53356132-4efc-4b46-85fe-6b383ac85943', 'admin')
  on conflict (user_id) do nothing;
insert into user_roles (user_id, role) values
  ('0c1542e6-a870-4ed9-8384-426e553da905', 'farmer')
  on conflict (user_id) do nothing;

-- ─── 2. Helpers ──────────────────────────────────────────────────────────────
create or replace function is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from user_roles r
    where r.user_id = auth.uid() and r.role = 'admin'
  );
$$;

-- True when the caller owns the herd anchor or is assigned to it.
create or replace function can_access_herd(herd uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select auth.uid() = herd
    or exists (
      select 1 from herd_members m
      where m.herd_id = herd and m.user_id = auth.uid()
    );
$$;

-- ─── 3. RLS on the new tables ────────────────────────────────────────────────
alter table user_roles enable row level security;
alter table herd_members enable row level security;

drop policy if exists "roles_select_own_or_admin" on user_roles;
drop policy if exists "roles_insert_self_or_admin" on user_roles;
drop policy if exists "roles_update_admin" on user_roles;
drop policy if exists "roles_delete_admin" on user_roles;

-- Read your own role (login needs this); admin reads all.
create policy "roles_select_own_or_admin" on user_roles for select
  using (auth.uid() = user_id or is_admin());
-- First-login bootstrap: anyone may insert ONLY their own row as farmer.
-- Promotion to admin is admin-only (no update path for self).
create policy "roles_insert_self_or_admin" on user_roles for insert
  with check ((auth.uid() = user_id and role = 'farmer') or is_admin());
create policy "roles_update_admin" on user_roles for update
  using (is_admin()) with check (is_admin());
create policy "roles_delete_admin" on user_roles for delete using (is_admin());

drop policy if exists "members_select_own_or_admin" on herd_members;
drop policy if exists "members_write_admin" on herd_members;
drop policy if exists "members_delete_admin" on herd_members;

-- A farmer sees the memberships that grant them access; admin sees all.
create policy "members_select_own_or_admin" on herd_members for select
  using (auth.uid() = user_id or is_admin());
-- Only admin assigns/unassigns (request → admin approves in /admin).
create policy "members_write_admin" on herd_members for insert with check (is_admin());
create policy "members_delete_admin" on herd_members for delete using (is_admin());

-- ─── 4. Goats policies v2 (replace v1) ───────────────────────────────────────
drop policy if exists "goats_select_own" on goats;
drop policy if exists "goats_insert_own" on goats;
drop policy if exists "goats_update_own" on goats;
drop policy if exists "goats_delete_own" on goats;

-- Farmers read goats in their herds; admin reads everything (view-only).
create policy "goats_select_herd_or_admin" on goats for select
  using (can_access_herd(farmer_id) or is_admin());
-- Writes: herd members only. Admin is intentionally excluded (view-only).
create policy "goats_insert_herd" on goats for insert
  with check (can_access_herd(farmer_id));
create policy "goats_update_herd" on goats for update
  using (can_access_herd(farmer_id)) with check (can_access_herd(farmer_id));
create policy "goats_delete_herd" on goats for delete using (can_access_herd(farmer_id));

-- ─── 5. Child-table policies v2 (ownership still resolved via goats) ─────────
drop policy if exists "weights_select_own" on weights;
drop policy if exists "weights_insert_own" on weights;
drop policy if exists "weights_update_own" on weights;
drop policy if exists "weights_delete_own" on weights;

create policy "weights_select_herd_or_admin" on weights for select
  using (is_admin() or exists (
    select 1 from goats g where g.id = weights.goat_id and can_access_herd(g.farmer_id)));
create policy "weights_insert_herd" on weights for insert
  with check (exists (
    select 1 from goats g where g.id = weights.goat_id and can_access_herd(g.farmer_id)));
create policy "weights_update_herd" on weights for update
  using (exists (
    select 1 from goats g where g.id = weights.goat_id and can_access_herd(g.farmer_id)))
  with check (exists (
    select 1 from goats g where g.id = weights.goat_id and can_access_herd(g.farmer_id)));
create policy "weights_delete_herd" on weights for delete
  using (exists (
    select 1 from goats g where g.id = weights.goat_id and can_access_herd(g.farmer_id)));

drop policy if exists "deworming_select_own" on deworming;
drop policy if exists "deworming_insert_own" on deworming;
drop policy if exists "deworming_update_own" on deworming;
drop policy if exists "deworming_delete_own" on deworming;

create policy "deworming_select_herd_or_admin" on deworming for select
  using (is_admin() or exists (
    select 1 from goats g where g.id = deworming.goat_id and can_access_herd(g.farmer_id)));
create policy "deworming_insert_herd" on deworming for insert
  with check (exists (
    select 1 from goats g where g.id = deworming.goat_id and can_access_herd(g.farmer_id)));
create policy "deworming_update_herd" on deworming for update
  using (exists (
    select 1 from goats g where g.id = deworming.goat_id and can_access_herd(g.farmer_id)))
  with check (exists (
    select 1 from goats g where g.id = deworming.goat_id and can_access_herd(g.farmer_id)));
create policy "deworming_delete_herd" on deworming for delete
  using (exists (
    select 1 from goats g where g.id = deworming.goat_id and can_access_herd(g.farmer_id)));

drop policy if exists "vaccinations_select_own" on vaccinations;
drop policy if exists "vaccinations_insert_own" on vaccinations;
drop policy if exists "vaccinations_update_own" on vaccinations;
drop policy if exists "vaccinations_delete_own" on vaccinations;

create policy "vaccinations_select_herd_or_admin" on vaccinations for select
  using (is_admin() or exists (
    select 1 from goats g where g.id = vaccinations.goat_id and can_access_herd(g.farmer_id)));
create policy "vaccinations_insert_herd" on vaccinations for insert
  with check (exists (
    select 1 from goats g where g.id = vaccinations.goat_id and can_access_herd(g.farmer_id)));
create policy "vaccinations_update_herd" on vaccinations for update
  using (exists (
    select 1 from goats g where g.id = vaccinations.goat_id and can_access_herd(g.farmer_id)))
  with check (exists (
    select 1 from goats g where g.id = vaccinations.goat_id and can_access_herd(g.farmer_id)));
create policy "vaccinations_delete_herd" on vaccinations for delete
  using (exists (
    select 1 from goats g where g.id = vaccinations.goat_id and can_access_herd(g.farmer_id)));

drop policy if exists "sales_select_own" on sales;
drop policy if exists "sales_insert_own" on sales;
drop policy if exists "sales_update_own" on sales;
drop policy if exists "sales_delete_own" on sales;

create policy "sales_select_herd_or_admin" on sales for select
  using (is_admin() or exists (
    select 1 from goats g where g.id = sales.goat_id and can_access_herd(g.farmer_id)));
create policy "sales_insert_herd" on sales for insert
  with check (exists (
    select 1 from goats g where g.id = sales.goat_id and can_access_herd(g.farmer_id)));
create policy "sales_update_herd" on sales for update
  using (exists (
    select 1 from goats g where g.id = sales.goat_id and can_access_herd(g.farmer_id)))
  with check (exists (
    select 1 from goats g where g.id = sales.goat_id and can_access_herd(g.farmer_id)));
create policy "sales_delete_herd" on sales for delete
  using (exists (
    select 1 from goats g where g.id = sales.goat_id and can_access_herd(g.farmer_id)));

-- ─── 6. Verify ───────────────────────────────────────────────────────────────
-- select * from herd_members;  -- expect 2 rows (each farmer self-member)
-- select * from user_roles;    -- expect VIKI=admin, RKT=farmer
-- As admin, full-table selects return all rows; as farmer, only own herd.
