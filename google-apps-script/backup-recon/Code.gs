/**
 * GOATIE — Weekly Sheets Backup + Reconciliation.
 *
 * Paste this whole file into Extensions > Apps Script on the backup Google
 * Sheet, then deploy it (Deploy > New deployment > Web app, Execute as: Me,
 * Who has access: Anyone with the link). Copy the resulting /exec URL into
 * the GOOGLE_SHEETS_BACKUP_WEBAPP_URL environment variable in Vercel.
 *
 * See README.md in this folder for full setup steps.
 */

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

function doGet(e) {
  try {
    var action = e.parameter.action;
    if (action !== 'read') throw new Error('Unsupported GET action: ' + action);
    return jsonResponse_(readSheet_(e.parameter.sheet));
  } catch (err) {
    return jsonResponse_({ error: err.message });
  }
}

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    if (payload.action !== 'reconcile') throw new Error('Unsupported POST action: ' + payload.action);
    return jsonResponse_(
      reconcileSheet_(payload.sheet, payload.toAdd || [], payload.toUpdate || [], payload.toDeleteIds || [])
    );
  } catch (err) {
    return jsonResponse_({ error: err.message });
  }
}

function getConfig_(sheetName) {
  var config = TAB_CONFIG[sheetName];
  if (!config) throw new Error('Unknown sheet: ' + sheetName);
  return config;
}

function getSheet_(sheetName) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) throw new Error('Sheet tab not found: ' + sheetName);
  return sheet;
}

// Writes the header row (Record ID + one column per field) if the sheet is empty.
function headerRow_(sheet, config) {
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  if (!headers[0]) {
    headers = [config.idHeader].concat(config.fields.map(function (f) { return f.header; }));
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return headers;
}

function colIndex_(headers, headerName) {
  for (var i = 0; i < headers.length; i++) {
    if (headers[i] === headerName) return i;
  }
  return -1;
}

function readSheet_(sheetName) {
  var config = getConfig_(sheetName);
  var sheet = getSheet_(sheetName);
  var headers = headerRow_(sheet, config);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var idCol = colIndex_(headers, config.idHeader);
  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var rows = [];
  values.forEach(function (row) {
    var id = idCol >= 0 ? row[idCol] : '';
    if (!id) return; // rows without a Record ID can't be matched — see README
    var obj = { id: String(id) };
    config.fields.forEach(function (f) {
      var idx = colIndex_(headers, f.header);
      obj[f.key] = idx >= 0 ? row[idx] : '';
    });
    rows.push(obj);
  });
  return rows;
}

function rowValues_(headers, config, row) {
  return headers.map(function (header) {
    if (header === config.idHeader) return row.id;
    var field = config.fields.filter(function (f) { return f.header === header; })[0];
    return field ? (row[field.key] === undefined ? '' : row[field.key]) : '';
  });
}

function reconcileSheet_(sheetName, toAdd, toUpdate, toDeleteIds) {
  var config = getConfig_(sheetName);
  var sheet = getSheet_(sheetName);
  var headers = headerRow_(sheet, config);
  var idCol = colIndex_(headers, config.idHeader);
  if (idCol < 0) throw new Error('Missing "' + config.idHeader + '" column in sheet: ' + sheetName);

  var deleteIds = {};
  toDeleteIds.forEach(function (id) { deleteIds[String(id)] = true; });
  var updateById = {};
  toUpdate.forEach(function (row) { updateById[String(row.id)] = row; });

  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var ids = sheet.getRange(2, idCol + 1, lastRow - 1, 1).getValues();
    // Bottom-up so deleting a row doesn't shift the index of rows still to process.
    for (var r = ids.length - 1; r >= 0; r--) {
      var id = String(ids[r][0]);
      var sheetRow = r + 2;
      if (deleteIds[id]) {
        sheet.deleteRow(sheetRow);
      } else if (updateById[id]) {
        sheet.getRange(sheetRow, 1, 1, headers.length).setValues([rowValues_(headers, config, updateById[id])]);
      }
    }
  }

  if (toAdd.length > 0) {
    var newRows = toAdd.map(function (row) { return rowValues_(headers, config, row); });
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, headers.length).setValues(newRows);
  }

  return { added: toAdd.length, updated: toUpdate.length, deleted: toDeleteIds.length };
}

function jsonResponse_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
