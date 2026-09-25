# TODO — later

## Migrate off demo logins to real Supabase Auth + tight RLS

**Why:** RKT/VIKI demo logins have no Supabase session, so RLS on the tables is
effectively permissive — anyone extracting `VITE_SUPABASE_URL` + anon key from
the public JS bundle can read/write all goat data. Real auth gives RLS an
identity (`auth.uid()`) to enforce per-farmer access.

### Status (2026-09-25)

- [x] **1. Real Supabase Auth users created** — UUIDs known:
  - RKT (`rkte4e@gmail.com`) → `0c1542e6-a870-4ed9-8384-426e553da905`
  - VIKI (`vikirthan06@gmail.com`) → `53356132-4efc-4b46-85fe-6b383ac85943`
- [x] **3. Demo backdoor removed from `src/services/authService.ts`** — pure
  `signInWithPassword`; stale `goatie_logged_in_user` sessions are cleared on
  auth calls; `isDemoMode()` kept as deprecated `false`; `getAuthToken()` now
  returns only the real session token.
- [x] **3b. Per-farmer filtering fixed** — `getFarmerGoats` now
  `.eq('farmer_id', farmerId)` (was ignoring it); stale `RKT`/`VIKI` rows and
  offline-queue entries are pruned client-side; Login page is email-only.
- [x] **4. RLS migration written** — `supabase/migrations/20260925_real_auth_rls.sql`
  (run once, service-role): remaps `goats.farmer_id` → UUIDs, alters column
  text → uuid, enables RLS on all five tables, creates per-farmer policies
  (`goats` direct; `weights`/`deworming`/`vaccinations`/`sales` via `goats`
  join on `goat_id` — child tables have no `farmer_id` of their own).
- [ ] **2+4. RUN the SQL migration** (manual, Supabase dashboard → SQL Editor).
- [ ] **5. Verify** (manual, after migration + redeploy).

### Steps (remaining manual work)

1. ~~**Create real Supabase Auth users for RKT and VIKI**~~ — DONE (UUIDs above).

2. **Run the migration (service-role, one-time SQL)**
   - Supabase dashboard → SQL Editor → paste
     `supabase/migrations/20260925_real_auth_rls.sql` → run.
   - It remaps `goats.farmer_id` (`RKT`/`VIKI` → UUIDs above), converts the
     column to `uuid`, enables RLS, and creates strict policies. Child tables
     need no remap (ownership via `goats.farmer_id = auth.uid()` join).
   - Sanity: `select farmer_id, count(*) from goats group by farmer_id;`
     should show exactly the two UUIDs above.

3. ~~**Replace the demo backdoor in `src/services/authService.ts`**~~ — DONE in
   code (see Status). No `RKT`/`VIKI` matching, no `goatie_logged_in_user`
   path, no `demo_token` remains.

4. ~~**Enable RLS + per-farmer policies on all five tables**~~ — DONE in the
   migration file (see Status). Anon key stays in `VITE_` (safe now:
   strangers' keys entitle zero rows).

5. **Verify**
   - Log in as RKT on two devices; confirm each sees only its own goats.
   - Confirm signed-out direct API calls with the anon key return nothing.
   - Confirm Recon Now, launch sync, Verify now, Restore still work on the new session.
   - Rebuild + redeploy.

### Notes / side effects

- Both devices must log in with the new passwords (no more shared demo accounts).
- Offline IndexedDB cache works unchanged (sits behind the same service calls).
  Stale `RKT`/`VIKI` rows are pruned automatically on the next `getFarmerGoats`
  fetch after login.
- Service-role key stays server-only forever; optional Vercel cron re-enable is a
  separate job (see `google-apps-script/master-sync/README.md` step 3).

---

## Shared herds + RBAC admin (2026-09-25)

**Model:** a herd is anchored by the original owner's UUID (`goats.farmer_id`
unchanged — no goat rows move). `herd_members(herd_id, user_id)` grants access;
assigning a login to a herd = one row. `user_roles` holds `admin`/`farmer`
(server-checked by RLS, never `user_metadata`). Admin (`vikirthan06@gmail.com`)
sees all herds read-only; farmers have full access inside their herds only.

### Status

- [x] **Migration v2 written** — `supabase/migrations/20260926_herds_rbac.sql`
  (run once AFTER the v1 migration): creates `user_roles` + `herd_members`,
  backfills self-memberships, seeds VIKI=admin / RKT=farmer, replaces all
  five-table policies with herd-aware versions (`can_access_herd()` helper;
  admin select-only, member write).
- [x] **Admin API** — `api/admin/users.ts` (same-origin, Bearer-gated, admin-only):
  list users, create login (+role seed, self-membership, optional herd assign),
  send password-recovery email, ban/unban, set role. No delete (user FK cascades
  to the herd — ban instead). Set `SITE_URL` env for reset-link redirect.
- [x] **Admin UI** — `/admin` (role-gated `AdminRoute`, Navbar link for admins):
  Herds tab (all herds, goat counts, members, assign/unassign — owner
  self-membership locked) + Users tab (create, role change, reset password,
  disable/enable).
- [x] **Herd-aware client** — `getMyHerdIds()` (server + IndexedDB `memberships`
  cache, new DB v3 store); `getFarmerGoats` queries `.in('farmer_id', herdIds)`;
  general cache pruning (revoked herds dropped offline); poison-queue handling
  (RLS failures dropped to history instead of infinite retry); `activeHerdId`
  in `AuthContext` drives registration / Excel import / restore herd;
  Dashboard + GoatsList offline snapshots herd-scoped.
- [ ] **RUN the v2 migration** (manual, SQL Editor, after v1). Sanity:
  `select * from herd_members;` → 2 rows (self-memberships);
  `select * from user_roles;` → VIKI=admin, RKT=farmer.
- [x] **Migration v3 written** — `supabase/migrations/20260926_herd_profiles.sql`
  (run after v2): `profiles` table (display names readable by any login,
  backfilled from auth metadata) so herd/member labels show names everywhere
  without needing `/api`. App upserts own profile on login.
- [ ] **RUN the v3 migration**, then `select * from profiles;` → 2 rows.
- [ ] **Commit + push + redeploy.** Nothing here is in production yet (all work
  is uncommitted on `dev`), which is exactly why Recon/Verify/Restore return
  HTTP 404 — the `/api` routes don't exist server-side. Note: `dev-dist/sw.js`
  has a merge conflict (`UU`) that must be resolved before committing
  (it's generated output — simplest is to accept either side and rebuild).
  `vercel.json` now excludes `/api/*` from the SPA rewrite so the functions
  can't be swallowed by `index.html`.

## Herd viewing on home + readonly oversight (2026-09-25)

- [x] **Admin sees all herds** — `getHerdScope()` reads `herd_members` with no
  client-side filter; RLS scopes it (own rows for farmers, all rows for admin).
  Only own rows are cached offline. Split into `herdIds` (visible) vs
  `writableHerdIds` (own + member).
- [x] **Home herd switcher** — `HerdSwitcher` on Dashboard + GoatsList ("All
  herds" + per-herd, view-only marked). `viewingHerdId` filters both pages;
  persisted per login. Admin with an empty own herd switches to RKT's herd.
- [x] **Readonly mode** — viewing a non-writable herd shows a banner and
  disables: dashboard quick actions + all four record submits (guarded
  per-goat), list edit/delete buttons + handlers, Excel import, detail quick
  actions (hidden). Registration/import/restore always target the writable
  active herd. RLS remains the real enforcement; UI is defense in depth.
- [x] **Tests** — `npm test` (vitest): 143 tests green covering converters,
  recon, master-sync client, both API routes, auth, herd scope/adopt/sync,
  admin client, firebase fallback, AuthContext RBAC, AdminRoute, AdminPage,
  HerdSwitcher, and SQL migration regression checks.
- [ ] **Recover VIKI's herd (2026-09-25 finding: Supabase holds only RKT's 90
  goats).** VIKI's demo-era rows never reached Supabase (uuid column rejects
  text ids) — they live only in VIKI device's IndexedDB. The app now
  auto-adopts them on VIKI's next online login (email→tag matched, ear-tag
  deduped, weights/deworm/vacc/sales pushed too). Deploy first, then log in
  as VIKI on the data device and confirm the count. RKT login is duplicate-safe
  (matching ear tags are dropped, not re-pushed).
- [ ] **Verify** (manual, after deploy): member of herd A sees A's goats on all
  devices; non-member sees nothing; admin sees all herds at `/admin` but writes
  to others' herds fail; signed-out anon sees nothing; offline create in a
  shared herd syncs on reconnect; unassign → herd disappears after next sync.
- [ ] **Redeploy** — migration(s) BEFORE code (new code queries UUID herds;
  old rows/policies mismatch until migrations run).
