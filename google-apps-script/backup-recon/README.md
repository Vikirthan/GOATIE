# Weekly Sheets Backup — setup

One-time setup for the backup/reconciliation Google Sheet. This is a **separate** sheet
from any existing Google Sheets integration in the app — it doesn't touch the offline-storage
backend used by `firebaseService.ts`.

## 1. Create the sheet

Create a new Google Sheet with 4 tabs, named exactly:

- `Goats Data`
- `Monthly Weights`
- `Deworming`
- `Vaccination`

**Leave all 4 tabs completely empty** (no header row, no pasted data). The first time the
"Recon Now" button (or the Sunday cron) runs, it writes the header row itself and adds every
row with a `Record ID` already attached, so later runs can correctly detect edits/deletes.

> If you paste data from an Excel export into these tabs yourself first, those rows won't
> have a `Record ID` and the reconciler can't match them to app records — they'll be
> re-added as duplicates on the first run instead of recognized as already present. It's
> simplest to let the button do the very first population.

## 2. Deploy the Apps Script

1. In the sheet, go to **Extensions > Apps Script**.
2. Delete any starter code and paste in the full contents of `Code.gs` from this folder.
3. Click **Deploy > New deployment**.
4. Type: **Web app**.
5. Execute as: **Me**.
6. Who has access: **Anyone with the link**.
7. Deploy, and copy the `/exec` URL it gives you.

## 3. Configure Vercel

In the Vercel project's environment variables, add:

- `GOOGLE_SHEETS_BACKUP_WEBAPP_URL` — the `/exec` URL from step 2.
- `SUPABASE_SERVICE_ROLE_KEY` — from Supabase project settings > API (server-only secret,
  never exposed to the browser).
- `CRON_SECRET` — any random string. Vercel automatically sends this as
  `Authorization: Bearer <value>` when it invokes the scheduled cron route, which is how
  that route authenticates the request.

Redeploy afterwards — Vercel only registers `crons` entries from a production deployment.

## 4. Try it

Once deployed, click **Recon Now** in the app (Goats list page). It should report added counts
for all 4 tabs on the first run. Edit or delete a record and click it again — only the changed
rows should move.
