/**
 * NEAS AI Project Intelligence — Google Sheets bridge
 * Deploy as a Web App after setting Script Properties:
 *   SPREADSHEET_ID = 19e14iR4X8ZLDARO2auYe0Cm4jPoZGUlGvC9O2f9EIAQ
 *   API_TOKEN = a long random secret (keep server-side; never put in browser code)
 *
 * This endpoint is intended to be called by a Vercel server route, not directly
 * from browser JavaScript. GET ?action=health&token=... checks deployment.
 * GET ?action=list&sheet=FieldReports&token=... reads rows.
 * POST JSON {token, action:"upsert", sheet:"FieldReports", record:{...}} upserts by id.
 */
const CFG = {
  SPREADSHEET_ID_PROPERTY: 'SPREADSHEET_ID',
  TOKEN_PROPERTY: 'API_TOKEN',
  DEFAULT_SHEET: 'FieldReports',
  ALLOWED_SHEETS: ['Projects', 'Activities', 'FieldReports', 'Evidence', 'BOQ', 'Quotations'],
  MAX_ROWS: 1000,
  MAX_CELL_CHARS: 45000
};

function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    authorize_(p.token);
    const action = String(p.action || 'health');
    if (action === 'health') {
      const ss = spreadsheet_();
      return json_({ ok: true, service: 'NEAS Sheets Bridge', spreadsheet: ss.getName(), sheets: ss.getSheets().map(s => s.getName()), time: new Date().toISOString() });
    }
    if (action === 'list') {
      const name = sheetName_(p.sheet || CFG.DEFAULT_SHEET);
      const sh = ensureSheet_(name);
      const values = sh.getDataRange().getValues();
      if (!values.length) return json_({ ok: true, sheet: name, records: [] });
      const headers = values.shift().map(String);
      const records = values.slice(-CFG.MAX_ROWS).filter(row => row.some(v => v !== '')).map(row => {
        const o = {};
        headers.forEach((h, i) => { if (h) o[h] = row[i] instanceof Date ? row[i].toISOString() : row[i]; });
        return o;
      });
      return json_({ ok: true, sheet: name, records });
    }
    return json_({ ok: false, error: 'Unknown action. Use health or list.' });
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
    const name = sheetName_(body.sheet || CFG.DEFAULT_SHEET);
    const record = body.record;
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('record must be a JSON object.');
    const sh = ensureSheet_(name);
    const headers = headers_(sh);
    const fields = Object.keys(record);
    if (!fields.length) throw new Error('record is empty.');
    fields.forEach(k => {
      if (!headers.includes(k)) {
        headers.push(k);
        sh.getRange(1, headers.length).setValue(k);
      }
    });
    const id = String(record.id || record.ID || '');
    let targetRow = 0;
    if (id && headers.includes('id')) {
      const idCol = headers.indexOf('id') + 1;
      const last = sh.getLastRow();
      if (last >= 2) {
        const found = sh.getRange(2, idCol, last - 1, 1).createTextFinder(id).matchEntireCell(true).findNext();
        if (found) targetRow = found.getRow();
      }
    }
    if (!targetRow) targetRow = sh.getLastRow() + 1;
    const row = headers.map(h => {
      let v = Object.prototype.hasOwnProperty.call(record, h) ? record[h] : '';
      if (v === null || v === undefined) return '';
      if (typeof v === 'object') v = JSON.stringify(v);
      v = String(v);
      if (v.length > CFG.MAX_CELL_CHARS) throw new Error('Field ' + h + ' exceeds cell size limit.');
      return v;
    });
    sh.getRange(targetRow, 1, 1, row.length).setValues([row]);
    return json_({ ok: true, sheet: name, row: targetRow, id: id || null });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function authorize_(provided) {
  const expected = PropertiesService.getScriptProperties().getProperty(CFG.TOKEN_PROPERTY);
  if (!expected) throw new Error('API_TOKEN is not configured in Script Properties.');
  if (!provided || String(provided) !== expected) throw new Error('Unauthorized.');
}
function spreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty(CFG.SPREADSHEET_ID_PROPERTY);
  if (!id) throw new Error('SPREADSHEET_ID is not configured in Script Properties.');
  return SpreadsheetApp.openById(id);
}
function sheetName_(name) {
  name = String(name || '');
  if (!CFG.ALLOWED_SHEETS.includes(name)) throw new Error('Sheet not allowed: ' + name);
  return name;
}
function ensureSheet_(name) {
  const ss = spreadsheet_();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) sh.getRange(1, 1).setValue('id');
  return sh;
}
function headers_(sh) {
  const lastCol = Math.max(1, sh.getLastColumn());
  return sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(String);
}
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
