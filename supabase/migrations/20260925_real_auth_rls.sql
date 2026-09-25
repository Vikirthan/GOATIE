-- GOATIE: migrate off demo logins (RKT/VIKI) to real Supabase Auth + tight RLS.
--
-- Run ONCE in Supabase dashboard → SQL Editor with the SERVICE-ROLE context
-- (or as postgres owner). Steps 1–2 remap data, steps 3–4 lock down access.
--
-- Real users (already created via Authentication → Add user):
--   RKT  (rkte4e@gmail.com)       = 0c1542e6-a870-4ed9-8384-426e553da905
--   VIKI (vikirthan06@gmail.com)  = 53356132-4efc-4b46-85fe-6b383ac85943

-- ─── 1+2. Remap goats.farmer_id to auth UUIDs + ensure uuid type ─────────────
-- Type-aware: works whether farmer_id is still text (original demo schema) or
-- already uuid (e.g. table was created with uuid type). A uuid column can never
-- hold 'RKT'/'VIKI' strings, so in that case the remap is skipped by design.
do $$
declare
  coltype text;
  bad text;
begin
  select data_type into coltype from information_schema.columns
    where table_schema = 'public' and table_name = 'goats' and column_name = 'farmer_id';

  if coltype in ('text', 'character varying') then
    update goats set farmer_id = '0c1542e6-a870-4ed9-8384-426e553da905' where farmer_id = 'RKT';
    update goats set farmer_id = '53356132-4efc-4b46-85fe-6b383ac85943' where farmer_id = 'VIKI';

    -- Fail loudly if any other legacy value remains (don't convert half-migrated).
    select string_agg(distinct farmer_id, ', ') into bad from goats
      where farmer_id not in ('0c1542e6-a870-4ed9-8384-426e553da905', '53356132-4efc-4b46-85fe-6b383ac85943');
    if bad is not null then
      raise exception 'Unmapped farmer_id values remain: %', bad;
    end if;

    alter table goats alter column farmer_id type uuid using farmer_id::uuid;
    raise notice 'goats.farmer_id converted text → uuid';
  elsif coltype = 'uuid' then
    raise notice 'goats.farmer_id is already uuid — text remap skipped';
  else
    raise exception 'Unexpected goats.farmer_id type: % (expected text or uuid)', coalesce(coltype, 'missing');
  end if;
end $$;

-- Optional FK to auth.users (cascade farmer deletion removes herd). Safe to
-- skip if the project prefers to keep goats after user deletion.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'goats_farmer_id_fkey') then
    alter table goats add constraint goats_farmer_id_fkey
      foreign key (farmer_id) references auth.users (id) on delete cascade;
  end if;
end $$;

-- NOTE on child tables (weights, deworming, vaccinations, sales): they carry
-- only goat_id, no farmer_id — ownership is resolved through goats.farmer_id.
-- No data remap needed there; the policies below join via goat_id.

-- ─── 3. Enable RLS everywhere ────────────────────────────────────────────────
alter table goats enable row level security;
alter table weights enable row level security;
alter table deworming enable row level security;
alter table vaccinations enable row level security;
alter table sales enable row level security;

-- ─── 4. Strict per-farmer policies (drop permissive ones first) ──────────────
-- goats: direct owner check
drop policy if exists "goats_select_own" on goats;
drop policy if exists "goats_insert_own" on goats;
drop policy if exists "goats_update_own" on goats;
drop policy if exists "goats_delete_own" on goats;
-- legacy permissive names (drop if they exist from the demo era)
drop policy if exists "public read" on goats;
drop policy if exists "public insert" on goats;
drop policy if exists "public update" on goats;
drop policy if exists "public delete" on goats;
drop policy if exists "Enable all for anon" on goats;
drop policy if exists "Enable read access for all users" on goats;

create policy "goats_select_own" on goats for select using (auth.uid() = farmer_id);
create policy "goats_insert_own" on goats for insert with check (auth.uid() = farmer_id);
create policy "goats_update_own" on goats for update using (auth.uid() = farmer_id) with check (auth.uid() = farmer_id);
create policy "goats_delete_own" on goats for delete using (auth.uid() = farmer_id);

-- weights: ownership via parent goat
drop policy if exists "weights_select_own" on weights;
drop policy if exists "weights_insert_own" on weights;
drop policy if exists "weights_update_own" on weights;
drop policy if exists "weights_delete_own" on weights;
drop policy if exists "public read" on weights;
drop policy if exists "Enable all for anon" on weights;

create policy "weights_select_own" on weights for select
  using (exists (select 1 from goats g where g.id = weights.goat_id and g.farmer_id = auth.uid()));
create policy "weights_insert_own" on weights for insert
  with check (exists (select 1 from goats g where g.id = weights.goat_id and g.farmer_id = auth.uid()));
create policy "weights_update_own" on weights for update
  using (exists (select 1 from goats g where g.id = weights.goat_id and g.farmer_id = auth.uid()))
  with check (exists (select 1 from goats g where g.id = weights.goat_id and g.farmer_id = auth.uid()));
create policy "weights_delete_own" on weights for delete
  using (exists (select 1 from goats g where g.id = weights.goat_id and g.farmer_id = auth.uid()));

-- deworming: ownership via parent goat
drop policy if exists "deworming_select_own" on deworming;
drop policy if exists "deworming_insert_own" on deworming;
drop policy if exists "deworming_update_own" on deworming;
drop policy if exists "deworming_delete_own" on deworming;
drop policy if exists "public read" on deworming;
drop policy if exists "Enable all for anon" on deworming;

create policy "deworming_select_own" on deworming for select
  using (exists (select 1 from goats g where g.id = deworming.goat_id and g.farmer_id = auth.uid()));
create policy "deworming_insert_own" on deworming for insert
  with check (exists (select 1 from goats g where g.id = deworming.goat_id and g.farmer_id = auth.uid()));
create policy "deworming_update_own" on deworming for update
  using (exists (select 1 from goats g where g.id = deworming.goat_id and g.farmer_id = auth.uid()))
  with check (exists (select 1 from goats g where g.id = deworming.goat_id and g.farmer_id = auth.uid()));
create policy "deworming_delete_own" on deworming for delete
  using (exists (select 1 from goats g where g.id = deworming.goat_id and g.farmer_id = auth.uid()));

-- vaccinations: ownership via parent goat
drop policy if exists "vaccinations_select_own" on vaccinations;
drop policy if exists "vaccinations_insert_own" on vaccinations;
drop policy if exists "vaccinations_update_own" on vaccinations;
drop policy if exists "vaccinations_delete_own" on vaccinations;
drop policy if exists "public read" on vaccinations;
drop policy if exists "Enable all for anon" on vaccinations;

create policy "vaccinations_select_own" on vaccinations for select
  using (exists (select 1 from goats g where g.id = vaccinations.goat_id and g.farmer_id = auth.uid()));
create policy "vaccinations_insert_own" on vaccinations for insert
  with check (exists (select 1 from goats g where g.id = vaccinations.goat_id and g.farmer_id = auth.uid()));
create policy "vaccinations_update_own" on vaccinations for update
  using (exists (select 1 from goats g where g.id = vaccinations.goat_id and g.farmer_id = auth.uid()))
  with check (exists (select 1 from goats g where g.id = vaccinations.goat_id and g.farmer_id = auth.uid()));
create policy "vaccinations_delete_own" on vaccinations for delete
  using (exists (select 1 from goats g where g.id = vaccinations.goat_id and g.farmer_id = auth.uid()));

-- sales: ownership via parent goat
drop policy if exists "sales_select_own" on sales;
drop policy if exists "sales_insert_own" on sales;
drop policy if exists "sales_update_own" on sales;
drop policy if exists "sales_delete_own" on sales;
drop policy if exists "public read" on sales;
drop policy if exists "Enable all for anon" on sales;

create policy "sales_select_own" on sales for select
  using (exists (select 1 from goats g where g.id = sales.goat_id and g.farmer_id = auth.uid()));
create policy "sales_insert_own" on sales for insert
  with check (exists (select 1 from goats g where g.id = sales.goat_id and g.farmer_id = auth.uid()));
create policy "sales_update_own" on sales for update
  using (exists (select 1 from goats g where g.id = sales.goat_id and g.farmer_id = auth.uid()))
  with check (exists (select 1 from goats g where g.id = sales.goat_id and g.farmer_id = auth.uid()));
create policy "sales_delete_own" on sales for delete
  using (exists (select 1 from goats g where g.id = sales.goat_id and g.farmer_id = auth.uid()));

-- ─── 5. Verify (run after, expect 2 rows grouped by new UUIDs) ───────────────
-- select farmer_id, count(*) from goats group by farmer_id;
-- Signed-out check with the anon key must return zero rows on all five tables.
