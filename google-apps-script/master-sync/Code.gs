/**
 * GOATIE — Master Sheets Sync (v2, habit-tracker style).
 *
 * ONE master spreadsheet holds the 4 view tabs, updated every day:
 *   - `Goats Data`, `Monthly Weights`, `Deworming`, `Vaccination`
 *
 * Replaces google-apps-script/backup-recon/Code.gs. Why the old Recon
 * "didn't do a very good job":
 *   1. The diff ran in Vercel with strict `JSON.stringify` compare, so
 *      `12` vs `"12"`, `""` vs null, and Date-serial vs `YYYY-MM-DD`
 *      all counted as "changed" — every run rewrote every row.
 *   2. Updates were one `setValues` per row + one `deleteRow` per delete,
 *      which hits the 6-minute Apps Script limit on bigger herds and
 *      leaves partial writes / timeouts.
 *   3. Missing tabs threw `Sheet tab not found` instead of being created,
 *      so a fresh sheet failed on the first run.
 *
 * This script fixes all three, borrowing the Habit Tracker bridge pattern
 * (../Habit Tracker/sync/google-apps-script.gs):
 *   - Shared SECRET (BYOK-style). Browser posts text/plain (no CORS
 *     preflight); Vercel cron posts the same payload with the secret from
 *     env, so the button and the daily cron do the identical job.
 *   - Server-side NORMALIZED compare (String coercion + trim, Dates to
 *     YYYY-MM-DD) — re-running with identical data is a no-op.
 *   - Bulk append (one setValues), per-row updates only for truly changed
 *     rows, bottom-up deletes, all under LockService. Safe to re-run.
 *   - Tabs auto-created with header row on first use.
 *
 * SYNC MODES (per user spec):
 *   - DAILY verify: every push ends with prune=true + full `allIds`, so the
 *     sheet is verified against CURRENT app data — a goat deleted today that
 *     was there yesterday is removed from the sheet the same day. Re-running
 *     with identical data is a no-op (normalized compare).
 *   - MONTHLY full rewrite: once per calendar month the client sends
 *     erase=true on the first chunk — all data rows are cleared and the tab
 *     is re-fetched from the DB as new (fresh Record IDs kept, stale/ghost
 *     rows impossible). The `Goats Data` tab always mirrors the View Goats
 *     page (full farmer goat list, all statuses).
 *   - RESTORE (DB lost): GET ?secret=..&all=1 returns all 4 tabs in one round
 *     trip; the app upserts them back into Supabase by Record ID
 *     (incremental — re-running changes nothing).
 *
 * PROTOCOL (POST, JSON, Content-Type: text/plain):
 *   New style (browser direct + Vercel):
 *     { secret, tab, rows: [{id,...}], allIds: [...], prune: true|false,
 *       erase: true|false }
 *     - upserts `rows` by Record ID (insert if missing, update if different)
 *     - if erase === true, data rows are cleared FIRST, then `rows` are bulk
 *       appended (monthly rewrite; deleted = rows cleared)
 *     - else if prune === true, deletes any sheet id NOT in `allIds`
 *       (frontend sends the full tab id list on the last chunk — daily verify)
 *     - returns { ok, tab, inserted, updated, skipped, deleted, erased }
 *   Legacy style (old Vercel api/_lib/reconcile.ts, kept for migration):
 *     { action: 'reconcile', sheet, toAdd, toUpdate, toDeleteIds }
 *     { action: 'read', sheet } via GET ?action=read&sheet=...
 *
 * RESTORE/DEBUG (GET):
 *   ?secret=..&tab=Goats%20Data        -> { ok, tab, rows: [...] }
 *   ?secret=..&all=1                   -> { ok, tabs: { 'Goats Data': [...], ... } }
 *   ?secret=..&tabs=1                  -> { ok, tabs: [...] }
 *
 * DEPLOY (5 minutes, free)
 * 1. sheets.new → name it e.g. "GOATIE Master".
 * 2. Extensions → Apps Script → paste this whole file → set SECRET below → Save.
 * 3. Deploy → New deployment → Web app → Execute as: Me,
 *    Who has access: Anyone → Deploy → copy the /exec URL.
 * 4. GOATIE app: paste URL + SECRET into Sync Status → Master Sheets backup
 *    (stored in localStorage). Vercel env: GOOGLE_SHEETS_BACKUP_WEBAPP_URL
 *    (same URL) + GOOGLE_SHEETS_BACKUP_SECRET (same secret) + CRON_SECRET.
 *    After any script edit: Deploy → Manage deployments → Edit → New version.
 */

var SECRET = 'PASTE_YOUR_SECRET_HERE';

var TAB_CONFIG = {
  'Goats Data': {
    idHeader: 'Record ID',
    fields: [
      { key: 'earTagNumber',   header: 'Goat Number (Ear Tag)' },
      { key: 'variant',        header: 'Variant/Breed' },
      { key: 'gender',         header: 'Gender' },
      { key: 'purchaseDate',   header: 'Purchase Date' },
      { key: 'purchaseWeight', header: 'Purchase Weight (kg)' },
      { key: 'purchasePrice',  header: 'Purchase Price (₹)' },
      { key: 'sellerName',     header: 'Seller Name' },
      { key: 'vaccination',    header: 'Vaccination Status' },
      { key: 'deworming',      header: 'Deworming Status' },
      { key: 'status',         header: 'Status' },
      { key: 'saleWeight',     header: 'Sale Weight (kg)' },
      { key: 'saleRatePerKg',  header: 'Sale Rate (₹/kg)' },
      { key: 'saleAmount',     header: 'Sale Amount (₹)' },
      { key: 'netProfit',      header: 'Net Profit (₹)' },
      { key: 'notes',          header: 'Notes' },
    ],
  },
  'Monthly Weights': {
    idHeader: 'Record ID',
    fields: [
      { key: 'earTagNumber', header: 'Goat Number (Ear Tag)' },
      { key: 'weightNumber', header: 'Weight # (0=Purchase)' },
      { key: 'weight',       header: 'Weight (kg)' },
      { key: 'recordedDate', header: 'Recorded Date' },
      { key: 'dueDate',      header: 'Due Date' },
      { key: 'weightGain',   header: 'Weight Gain (kg)' },
      { key: 'remarks',      header: 'Remarks' },
    ],
  },
  'Deworming': {
    idHeader: 'Record ID',
    fields: [
      { key: 'earTagNumber',   header: 'Goat Number (Ear Tag)' },
      { key: 'roundNumber',    header: 'Round #' },
      { key: 'dewormingDate',  header: 'Deworming Date' },
      { key: 'medicineUsed',   header: 'Medicine Used' },
      { key: 'administeredBy', header: 'Administered By' },
      { key: 'batchNumber',    header: 'Batch Number' },
      { key: 'remarks',        header: 'Remarks' },
    ],
  },
  'Vaccination': {
    idHeader: 'Record ID',
    fields: [
      { key: 'earTagNumber',    header: 'Goat Number (Ear Tag)' },
      { key: 'roundNumber',     header: 'Round #' },
      { key: 'vaccinationDate', header: 'Vaccination Date' },
      { key: 'vaccineBrand',    header: 'Vaccine Brand' },
      { key: 'administeredBy',  header: 'Administered By' },
      { key: 'batchNumber',     header: 'Batch Number' },
      { key: 'remarks',         header: 'Remarks' },
    ],
  },
};

// ─── Normalization: the core fix ─────────────────────────────────────────────
// Sheets returns Dates as Date objects and numbers as numbers, while the app
// sends YYYY-MM-DD strings and JSON numbers. Strict compare flagged every
// row as changed. Normalizing both sides to trimmed strings makes identical
// data a no-op.
function normVal_(v) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return '';
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  var s = String(v).trim();
  if (s === 'null' || s === 'undefined') return '';
  return s;
}

function rowsEqual_(a, b, config) {
  for (var i = 0; i < config.fields.length; i++) {
    var k = config.fields[i].key;
    if (normVal_(a[k]) !== normVal_(b[k])) return false;
  }
  return true;
}

// ─── Sheet helpers ───────────────────────────────────────────────────────────

function getConfig_(name) {
  var config = TAB_CONFIG[name];
  if (!config) throw new Error('Unknown tab: ' + name + ' (expected one of: ' + Object.keys(TAB_CONFIG).join(', ') + ')');
  return config;
}

function expectedHeaders_(config) {
  return [config.idHeader].concat(config.fields.map(function (f) { return f.header; }));
}

// Creates the tab on first use (old script threw here) and ensures headers.
function getSheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    var config = getConfig_(name);
    sheet = ss.insertSheet(name);
    sheet.appendRow(expectedHeaders_(config));
    sheet.setFrozenRows(1);
    return sheet;
  }
  return sheet;
}

function headerRow_(sheet, config) {
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  if (!headers[0]) {
    headers = expectedHeaders_(config);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  } else {
    // Add any missing columns (config grew) without disturbing existing data.
    var want = expectedHeaders_(config);
    var missing = want.filter(function (h) { return headers.indexOf(h) === -1; });
    if (missing.length > 0) {
      sheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
      headers = headers.concat(missing);
    }
  }
  return headers;
}

function colIndex_(headers, headerName) {
  for (var i = 0; i < headers.length; i++) {
    if (headers[i] === headerName) return i;
  }
  return -1;
}

function rowValues_(headers, config, row) {
  return headers.map(function (header) {
    if (header === config.idHeader) return row.id;
    var field = null;
    for (var i = 0; i < config.fields.length; i++) {
      if (config.fields[i].header === header) { field = config.fields[i]; break; }
    }
    return field ? (row[field.key] === undefined || row[field.key] === null ? '' : row[field.key]) : '';
  });
}

function checkSecret_(provided) {
  if (!SECRET || SECRET === 'PASTE_YOUR_SECRET_HERE') return; // not configured yet — allow (migration)
  if (provided !== SECRET) throw new Error('bad secret');
}

// ─── Core upsert ─────────────────────────────────────────────────────────────

function upsertTab_(tabName, rows, allIds, prune, erase) {
  var config = getConfig_(tabName);
  var sheet = getSheet_(tabName);
  var headers = headerRow_(sheet, config);
  var idCol = colIndex_(headers, config.idHeader);
  if (idCol < 0) throw new Error('Missing "' + config.idHeader + '" column in tab: ' + tabName);

  // Monthly full rewrite: erase all data rows, then bulk-append the fresh
  // snapshot as new. Keeps the header row. Returns cleared count as deleted.
  if (erase) {
    var prev = Math.max(sheet.getLastRow() - 1, 0);
    if (prev > 0) sheet.deleteRows(2, prev);
    var fresh = (rows || []).filter(function (row) { return normVal_(row && row.id) !== ''; });
    if (fresh.length > 0) {
      var vals = fresh.map(function (row) { return rowValues_(headers, config, row); });
      sheet.getRange(2, 1, vals.length, headers.length).setValues(vals);
    }
    return { inserted: fresh.length, updated: 0, skipped: (rows || []).length - fresh.length, deleted: prev, erased: true };
  }

  var inserted = 0;
  var updated = 0;
  var skipped = 0;

  var lastRow = sheet.getLastRow();
  var idToSheetRow = {}; // id -> 1-based sheet row
  var existingById = {}; // id -> normalized row object
  if (lastRow >= 2) {
    var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
    for (var r = 0; r < values.length; r++) {
      var id = normVal_(values[r][idCol]);
      if (!id) continue;
      idToSheetRow[id] = r + 2;
      var obj = { id: id };
      for (var c = 0; c < config.fields.length; c++) {
        var f = config.fields[c];
        var idx = colIndex_(headers, f.header);
        obj[f.key] = idx >= 0 ? values[r][idx] : '';
      }
      existingById[id] = obj;
    }
  }

  var toAppend = [];
  var updates = []; // { sheetRow, values }
  var seenInPayload = {};

  (rows || []).forEach(function (row) {
    var id = normVal_(row && row.id);
    if (!id) { skipped++; return; }
    if (seenInPayload[id]) { skipped++; return; } // dedupe within payload (retries safe)
    seenInPayload[id] = true;
    var prior = existingById[id];
    if (!prior) {
      toAppend.push(rowValues_(headers, config, row));
      inserted++;
    } else if (!rowsEqual_(prior, row, config)) {
      updates.push({ sheetRow: idToSheetRow[id], values: rowValues_(headers, config, row) });
      updated++;
    } else {
      skipped++;
    }
  });

  // True updates only (normalized compare) — usually a handful on daily runs.
  updates.forEach(function (u) {
    sheet.getRange(u.sheetRow, 1, 1, headers.length).setValues([u.values]);
  });

  // One bulk append for all inserts.
  if (toAppend.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, toAppend.length, headers.length).setValues(toAppend);
  }

  // Prune: delete sheet rows whose id is absent from the client's full list.
  var deleted = 0;
  if (prune && allIds) {
    var keep = {};
    allIds.forEach(function (id) { keep[normVal_(id)] = true; });
    var delRows = [];
    Object.keys(idToSheetRow).forEach(function (id) {
      if (!keep[id]) delRows.push(idToSheetRow[id]);
    });
    delRows.sort(function (a, b) { return b - a; }); // bottom-up
    delRows.forEach(function (sheetRow) { sheet.deleteRow(sheetRow); });
    deleted = delRows.length;
  }

  return { inserted: inserted, updated: updated, skipped: skipped, deleted: deleted };
}

function readTab_(tabName) {
  var config = getConfig_(tabName);
  var sheet = getSheet_(tabName);
  var headers = headerRow_(sheet, config);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var idCol = colIndex_(headers, config.idHeader);
  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var rows = [];
  values.forEach(function (row) {
    var id = idCol >= 0 ? normVal_(row[idCol]) : '';
    if (!id) return;
    var obj = { id: id };
    config.fields.forEach(function (f) {
      var idx = colIndex_(headers, f.header);
      var v = idx >= 0 ? row[idx] : '';
      obj[f.key] = Object.prototype.toString.call(v) === '[object Date]'
        ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd')
        : v;
    });
    rows.push(obj);
  });
  return rows;
}

// ─── HTTP entry points ───────────────────────────────────────────────────────

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (err) {
    return json_({ ok: false, error: 'busy, retry' });
  }
  try {
    var payload = JSON.parse(e.postData.contents);

    // Legacy Vercel reconcile payload (migration window).
    if (payload.action === 'reconcile') {
      if (payload.secret) checkSecret_(payload.secret);
      var r = upsertTab_(
        payload.sheet,
        (payload.toAdd || []).concat(payload.toUpdate || []),
        null,
        false
      );
      var legacyDeleted = 0;
      if (payload.toDeleteIds && payload.toDeleteIds.length > 0) {
        var cfg = getConfig_(payload.sheet);
        var sh = getSheet_(payload.sheet);
        var hdrs = headerRow_(sh, cfg);
        var idC = colIndex_(hdrs, cfg.idHeader);
        var lr = sh.getLastRow();
        if (lr >= 2) {
          var want = {};
          payload.toDeleteIds.forEach(function (id) { want[normVal_(id)] = true; });
          var ids = sh.getRange(2, idC + 1, lr - 1, 1).getValues();
          var del = [];
          for (var i = ids.length - 1; i >= 0; i--) {
            if (want[normVal_(ids[i][0])]) del.push(i + 2);
          }
          del.forEach(function (sheetRow) { sh.deleteRow(sheetRow); });
          legacyDeleted = del.length;
        }
      }
      return json_({ ok: true, added: r.inserted, updated: r.updated, deleted: legacyDeleted });
    }

    // New style: { secret, tab, rows, allIds, prune, erase }.
    if (!payload.tab) throw new Error('Missing "tab" (expected one of: ' + Object.keys(TAB_CONFIG).join(', ') + ')');
    checkSecret_(payload.secret);
    var res = upsertTab_(payload.tab, payload.rows || [], payload.allIds || null, !!payload.prune, !!payload.erase);
    return json_({ ok: true, tab: payload.tab, inserted: res.inserted, updated: res.updated, skipped: res.skipped, deleted: res.deleted, erased: !!res.erased });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    // Legacy read: ?action=read&sheet=Goats%20Data
    if (p.action === 'read') {
      if (p.secret) checkSecret_(p.secret);
      return json_(readTab_(p.sheet));
    }
    if (p.tabs === '1') {
      checkSecret_(p.secret);
      return json_({ ok: true, tabs: Object.keys(TAB_CONFIG) });
    }
    // Restore all tabs in one round trip (DB-lost recovery): ?secret=..&all=1
    if (p.all === '1') {
      checkSecret_(p.secret);
      var out = {};
      Object.keys(TAB_CONFIG).forEach(function (t) { out[t] = readTab_(t); });
      return json_({ ok: true, tabs: out });
    }
    checkSecret_(p.secret);
    if (!p.tab) throw new Error('Missing ?tab= (or use ?tabs=1 to list tabs, ?all=1 for restore)');
    return json_({ ok: true, tab: p.tab, rows: readTab_(p.tab) });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
