/**
 * NEAS AI Project Intelligence — Google Sheets bridge v1.2.0
 *
 * Apps Script Script Properties:
 *   SPREADSHEET_ID = 19e14iR4X8ZLDARO2auYe0Cm4jPoZGUlGvC9O2f9EIAQ
 *   API_TOKEN = same strong secret as Vercel NEAS_SHEETS_API_TOKEN
 *
 * Only call this endpoint through the authenticated Vercel server API.
 */
const CFG = {
  SPREADSHEET_ID_PROPERTY: 'SPREADSHEET_ID',
  TOKEN_PROPERTY: 'API_TOKEN',
  MAX_ROWS: 1000,
  MAX_CELL_CHARS: 45000,
  ALLOWED_SHEETS: ['Projects', 'Activities', 'FieldReports', 'Evidence', 'BOQ', 'Quotations']
};

function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    authorize_(p.token);
    const action = String(p.action || 'health');

    if (action === 'health') {
      const ss = spreadsheet_();
      return json_({
        ok: true,
        service: 'NEAS Sheets Bridge',
        version: '1.2.0',
        spreadsheet: ss.getName(),
        sheets: ss.getSheets().map(s => s.getName()),
        time: new Date().toISOString()
      });
    }

    if (action === 'list') {
      const name = sheetName_(p.sheet);
      const sh = spreadsheet_().getSheetByName(name);
      if (!sh || sh.getLastRow() < 2) return json_({ ok: true, sheet: name, records: [] });
      const values = sh.getDataRange().getValues();
      const headers = values.shift().map(String);
      const records = values.slice(-CFG.MAX_ROWS)
        .filter(row => row.some(v => v !== ''))
        .map(row => {
          const obj = {};
          headers.forEach((h, i) => {
            if (h) obj[h] = vJson_(row[i]);
          });
          return obj;
        });
      return json_({ ok: true, sheet: name, records });
    }

    throw new Error('Unknown action. Use health or list.');
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function doPost(e) {
  try {
    const raw = e && e.postData && e.postData.contents;
    if (!raw) throw new Error('Request body is required.');
    const body = JSON.parse(raw);
    authorize_(body.token);

    if (body.action !== 'upsert') throw new Error('Unknown action. Use upsert.');
    const name = sheetName_(body.sheet);
    const records = Array.isArray(body.records) ? body.records : [body.record];
    if (!records.length || records.some(r => !r || typeof r !== 'object' || Array.isArray(r))) {
      throw new Error('records must contain JSON objects.');
    }
    if (records.length > CFG.MAX_ROWS) throw new Error('Maximum 1000 records per request.');

    const result = upsertRecords_(name, records);
    return json_({ ok: true, sheet: name, result });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function upsertRecords_(name, records) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    const sh = ensureSheet_(name);
    let headers = headers_(sh);

    // Expand headers as the app's schema evolves; existing columns/data are preserved.
    records.forEach(record => Object.keys(record).forEach(key => {
      if (!headers.includes(key)) headers.push(key);
    }));
    if (!headers.includes('id')) headers.push('id');
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);

    const lastRow = sh.getLastRow();
    const existing = lastRow >= 2
      ? sh.getRange(2, 1, lastRow - 1, headers.length).getValues()
      : [];
    const idCol = headers.indexOf('id');
    const indexById = {};

    existing.forEach((row, i) => {
      const id = String(row[idCol] || '').trim();
      if (id) indexById[id] = i + 2;
    });

    let inserted = 0;
    let updated = 0;
    records.forEach(record => {
      const id = String(record.id || '').trim();
      if (!id) throw new Error('Every record must contain an id field.');

      const row = headers.map(header => safeCell_(record[header]));
      const target = indexById[id];

      if (target) {
        sh.getRange(target, 1, 1, headers.length).setValues([row]);
        updated++;
      } else {
        const targetRow = sh.getLastRow() + 1;
        sh.getRange(targetRow, 1, 1, headers.length).setValues([row]);
        indexById[id] = targetRow;
        inserted++;
      }
    });

    SpreadsheetApp.flush();
    return { inserted, updated };
  } finally {
    lock.releaseLock();
  }
}

function authorize_(provided) {
  const expected = PropertiesService.getScriptProperties().getProperty(CFG.TOKEN_PROPERTY);
  if (!expected || expected.length < 32) throw new Error('API_TOKEN is not configured correctly in Script Properties.');
  if (!provided || !constantTimeEquals_(String(provided), expected)) throw new Error('Unauthorized.');
}

function constantTimeEquals_(a, b) {
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function spreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty(CFG.SPREADSHEET_ID_PROPERTY)
    || '19e14iR4X8ZLDARO2auYe0Cm4jPoZGUlGvC9O2f9EIAQ';
  if (!id) throw new Error('SPREADSHEET_ID is not configured.');
  return SpreadsheetApp.openById(id);
}

function sheetName_(name) {
  name = String(name || '');
  if (!CFG.ALLOWED_SHEETS.includes(name)) throw new Error('Sheet is not allowed.');
  return name;
}

function ensureSheet_(name) {
  const ss = spreadsheet_();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0 || sh.getLastColumn() === 0) {
    sh.getRange(1, 1).setValue('id');
  }
  return sh;
}

function headers_(sh) {
  if (sh.getLastColumn() === 0) return ['id'];
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0]
    .map(String).filter((value, index, arr) => value !== '' || index < arr.length);
}

function safeCell_(value) {
  if (value === null || value === undefined) return '';
  let out = typeof value === 'object' ? JSON.stringify(value) : value;
  if (typeof out === 'string') {
    if (out.length > CFG.MAX_CELL_CHARS) throw new Error('A field exceeds the Google Sheets cell size limit.');
    if (/^[=+@]/.test(out.trimStart())) out = "'" + out;
  }
  return out;
}

function vJson_(value) {
  return value instanceof Date ? value.toISOString() : value;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
