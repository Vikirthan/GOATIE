# Master Sheets Sync — setup

ONE master spreadsheet holds the 4 view tabs, updated every day. This replaces
the old `backup-recon` script (kept in `../backup-recon/` for reference only).

Tabs (named exactly):

- `Goats Data` — mirrors the **View Goats page** (full farmer goat list, all statuses)
- `Monthly Weights`
- `Deworming`
- `Vaccination`

**Leave all 4 tabs empty on first setup** (or let the script create them — missing
tabs are auto-created with headers now). Do not hand-edit data rows: every push
ends with prune + full id list, so hand edits get overwritten by the next verify.

## Architecture (secrets live on the server, never in the app)

- Browser → same-origin `POST /api/master-sync` (Recon Now, once-a-day launch
  sync, Verify now) and `GET /api/master-sync?view=status|tabs` (timestamp,
  restore). No sheet credentials in the app, no `localStorage` config.
- Vercel route (`api/master-sync.ts`) reads Supabase with the service-role key
  and pushes to the Apps Script with the secret. Both are plain (non-`VITE_`)
  env vars, so they never enter the JS bundle.

## Sync modes

- **Daily verify** (button + once-a-day launch sync): upsert by Record ID with
  normalized compare; the push ends with the full id list + prune, so a goat
  deleted today that was there yesterday disappears from the sheet the same day.
  Re-running with identical data changes nothing.
- **Monthly full rewrite**: on the 1st of each month each tab is erased and
  re-fetched as new from current DB state. Stale/ghost rows impossible.
- **Restore (DB lost)**: Sync Status → *Restore from sheets* pulls all 4 tabs
  through the server and upserts them back into Supabase by Record ID, skipping
  ids already present — incremental, safe to re-run. Note: sales are stored
  merged into the goat row, so restored sales get id `sale_<goatId>`,
  buyer `Restored`, and today's date for the unknown fields.

## 1. Deploy the Apps Script

1. `sheets.new` → name it e.g. `GOATIE Master`.
2. **Extensions > Apps Script** → delete starter code → paste `Code.gs` → set
   `SECRET` to a long random string → Save.
3. **Deploy > New deployment > Web app** → Execute as: **Me** → Who has
   access: **Anyone** → Deploy → copy the `/exec` URL.
4. After any script edit: **Deploy → Manage deployments → Edit → New version**.

## 2. Create the sync-state table (one SQL paste)

Supabase dashboard → SQL Editor → run:

```sql
create table if not exists master_sync_state (
  id int primary key,
  last_sync_at timestamptz,
  rewrite_month text,
  last_result jsonb
);
insert into master_sync_state (id) values (1) on conflict (id) do nothing;

-- Timestamp must be readable by the app (anon key); rows are written only
-- with the service-role key, which bypasses RLS anyway.
alter table master_sync_state enable row level security;
drop policy if exists "public read" on master_sync_state;
create policy "public read" on master_sync_state for select using (true);
```

This single row is the cross-device "Last sync …" timestamp shown near Recon Now.

## 3. Configure Vercel (required)

Vercel → Project → Settings → Environment Variables (Production). Plain names,
NEVER `VITE_`-prefixed:

- `GOOGLE_SHEETS_BACKUP_WEBAPP_URL` — the `/exec` URL from step 1
- `GOOGLE_SHEETS_BACKUP_SECRET` — the same `SECRET`
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase project settings → API (server-only)

(`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` were already set for the app.)
Redeploy afterwards so the new env vars and the new `/api/master-sync` route
go live together.

## 4. Try it

Open the app (log in with a farmer account) → press **Recon Now** → toast shows added/updated/removed
and the timestamp appears under the button. Relaunch the app the same day:
nothing fires (one push per calendar day). Next calendar day: one silent push.

## Local dev note

`/api/*` routes only exist under `vercel dev`, not `vite dev` (`npm run dev`).
To test sync locally: `vercel dev` (pulls Vercel env with `vercel env pull`
first), then open the local URL and press Recon Now.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Master Sheets not configured on the server` | One of the 3 Vercel env vars is missing → set them → redeploy. |
| Timestamp stuck on `Not synced yet` | The `master_sync_state` table/SQL (step 2) wasn't run, or the first push hasn't succeeded yet. |
| `bad secret` | `SECRET` in script ≠ `GOOGLE_SHEETS_BACKUP_SECRET` in Vercel. Fix + redeploy Apps Script as a **New version**. |
| `HTTP 401/403` from Google | Deployment access must be **Anyone**. |
| `busy, retry` | A sync was already running — press again. Chunks dedupe by id, safe. |
| Button spins then times out | Large herd vs serverless time limits — press again; completed chunks are skipped on retry. First-ever push is the slowest; daily verifies are incremental. |
| Sheet has ghost rows | Run Verify once (prune) — or wait for the monthly rewrite. Never paste rows by hand (no Record ID → re-added as duplicates). |

## Closed-app cron (enabled)

`GET /api/master-sync?run=1` with `CRON_SECRET` as bearer runs the same push —
`vercel.json` schedules it daily at 19:30 UTC (01:00 IST), so the master sheet is verified
even on days nobody opens the app (the monthly rewrite still happens on the
1st). `CRON_SECRET` must be set in Vercel env or the scheduled run gets 401.
The `POST` trigger stays intentionally open (session auth would lock out valid
edge cases like an expired session on launch sync); the only abuse is triggering an idempotent sync of your own data.
