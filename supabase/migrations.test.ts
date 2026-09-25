// @vitest-environment node
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (name: string) => readFileSync(join(dir, 'migrations', name), 'utf8');

const v1 = read('20260925_real_auth_rls.sql');
const v2 = read('20260926_herds_rbac.sql');
const v3 = read('20260926_herd_profiles.sql');

const RKT = '0c1542e6-a870-4ed9-8384-426e553da905';
const VIKI = '53356132-4efc-4b46-85fe-6b383ac85943';

describe('v1 migration (real auth + tight RLS)', () => {
  it('remaps both demo ids to the known auth UUIDs', () => {
    expect(v1).toContain(RKT);
    expect(v1).toContain(VIKI);
    expect(v1).toMatch(/where farmer_id = 'RKT'/);
    expect(v1).toMatch(/where farmer_id = 'VIKI'/);
  });

  it('enables RLS on all five data tables', () => {
    for (const table of ['goats', 'weights', 'deworming', 'vaccinations', 'sales']) {
      expect(v1).toMatch(new RegExp(`alter table ${table} enable row level security`));
    }
  });

  it('scopes goats directly and child tables through the goat join', () => {
    expect(v1).toMatch(/auth\.uid\(\) = farmer_id/);
    expect(v1).toMatch(/goats g where g\.id = weights\.goat_id/);
    expect(v1).toMatch(/goats g where g\.id = sales\.goat_id/);
  });
});

describe('v2 migration (shared herds + RBAC)', () => {
  it('creates membership and role tables with an admin seed', () => {
    expect(v2).toContain('create table if not exists herd_members');
    expect(v2).toContain('create table if not exists user_roles');
    expect(v2).toMatch(new RegExp(`'${VIKI}', 'admin'`));
    expect(v2).toMatch(new RegExp(`'${RKT}', 'farmer'`));
  });

  it('backfills self-memberships from existing herds without clobbering', () => {
    expect(v2).toMatch(/select distinct farmer_id, farmer_id from goats/);
    expect(v2).toMatch(/on conflict do nothing/);
  });

  it('defines the admin and herd-membership helpers', () => {
    expect(v2).toContain('create or replace function is_admin()');
    expect(v2).toContain('create or replace function can_access_herd(herd uuid)');
  });

  it('keeps the admin view-only on goats (no admin write policies)', () => {
    const insertPolicy = v2.match(/create policy "goats_insert_herd"[\s\S]*?;/);
    expect(insertPolicy).not.toBeNull();
    expect(insertPolicy?.[0]).not.toContain('is_admin');
    const updatePolicy = v2.match(/create policy "goats_update_herd"[\s\S]*?;/);
    expect(updatePolicy?.[0]).not.toContain('is_admin');
    const deletePolicy = v2.match(/create policy "goats_delete_herd"[\s\S]*?;/);
    expect(deletePolicy?.[0]).not.toContain('is_admin');
    const selectPolicy = v2.match(/create policy "goats_select_herd_or_admin"[\s\S]*?;/);
    expect(selectPolicy?.[0]).toContain('is_admin()');
  });

  it('restricts herd assignment to admins only', () => {
    const writePolicy = v2.match(/create policy "members_write_admin"[\s\S]*?;/);
    expect(writePolicy?.[0]).toContain('with check (is_admin())');
  });

  it('lets any login bootstrap only their own farmer role', () => {
    const insertPolicy = v2.match(/create policy "roles_insert_self_or_admin"[\s\S]*?;/);
    expect(insertPolicy?.[0]).toMatch(/auth\.uid\(\) = user_id and role = 'farmer'/);
  });
});

describe('v3 migration (profiles)', () => {
  it('creates profiles backfilled from auth metadata', () => {
    expect(v3).toContain('create table if not exists profiles');
    expect(v3).toMatch(/from auth\.users/);
    expect(v3).toContain("raw_user_meta_data->>'display_name'");
  });

  it('opens name reads to all logins but writes to self/admin', () => {
    expect(v3).toMatch(/for select\s+to authenticated using \(true\)/);
    const updatePolicy = v3.match(/create policy "profiles_update_self_or_admin"[\s\S]*?;/);
    expect(updatePolicy?.[0]).toContain('auth.uid() = user_id or is_admin()');
  });
});
