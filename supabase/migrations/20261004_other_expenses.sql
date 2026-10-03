-- GOATIE v5: other_expenses (one entry per herd per calendar month).
--
-- Why: the Other Expenses page stores 7 Tamil-labelled monthly cost fields
-- (இவை செலவு, குத்தகை, Medicine & Others, சம்பளம், பெட்ரோல்,
-- டி & சாப்பாடு, செலவு) plus the month total. Analytics adds this to the
-- goat purchase cost as Total Investment.
--
-- Run in Supabase SQL editor, or via `supabase db push`.
-- Safe to re-run (IF NOT EXISTS / idempotent policies).

create table if not exists other_expenses (
  id text primary key,
  farmer_id uuid not null references auth.users (id) on delete cascade,
  month_key text not null,
  expense_date timestamptz not null,
  ilai_selavu numeric not null default 0,
  kuthagai numeric not null default 0,
  medicine_others numeric not null default 0,
  sambalam numeric not null default 0,
  petrol numeric not null default 0,
  tea_food numeric not null default 0,
  selavu numeric not null default 0,
  total numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint other_expenses_herd_month_unique unique (farmer_id, month_key)
);

alter table other_expenses enable row level security;

drop policy if exists "expenses_select_herd_or_admin" on other_expenses;
drop policy if exists "expenses_insert_herd" on other_expenses;
drop policy if exists "expenses_update_herd" on other_expenses;
drop policy if exists "expenses_delete_herd" on other_expenses;

-- Farmers read their herds' months; admin reads everything (view-only).
create policy "expenses_select_herd_or_admin" on other_expenses for select
  using (can_access_herd(farmer_id) or is_admin());
-- Writes: herd members only. Admin is intentionally excluded (view-only).
create policy "expenses_insert_herd" on other_expenses for insert
  with check (can_access_herd(farmer_id));
create policy "expenses_update_herd" on other_expenses for update
  using (can_access_herd(farmer_id)) with check (can_access_herd(farmer_id));
create policy "expenses_delete_herd" on other_expenses for delete
  using (can_access_herd(farmer_id));
