/**
 * NEAS AI Project Intelligence → Google Sheets bridge (cloud version).
 * The web app server signs every request with HMAC-SHA256; this script refuses anything
 * unsigned, stale (> 5 minutes) or already processed (idempotency key).
 *
 * Setup
 * 1. Open the NEAS sheet → Extensions → Apps Script → paste this file → Save.
 * 2. Project Settings → Script properties: NEAS_HMAC_SECRET = the same value as the
 *    server's SHEETS_WEBHOOK_SECRET (32+ random characters).
 * 3. Deploy → New deployment → Web app → Execute as: Me · Who has access: Anyone.
 * 4. Put the web app URL in the server's SHEETS_WEBHOOK_URL.
 * 5. Optional: script property ADMIN_EMAIL (default info.nextedgeaccesssolutions@gmail.com) receives
 *    "new registration waiting for approval" notices. The first run asks you to allow sending mail.
 * The sheet is a reporting copy. Supabase is the system of record.
 */
const SHEET_ID = '19e14iR4X8ZLDARO2auYe0Cm4jPoZGUlGvC9O2f9EIAQ';
const MAX_SKEW_MS = 5 * 60 * 1000;

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function hex_(bytes) {
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  var r = 0;
  for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function doPost(e) {
  var secret = PropertiesService.getScriptProperties().getProperty('NEAS_HMAC_SECRET');
  if (!secret) return json_({ ok: false, error: 'not_configured' });
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad_json' }); }
  var ts = Number(body.ts);
  if (!ts || Math.abs(Date.now() - ts) > MAX_SKEW_MS) return json_({ ok: false, error: 'stale' });
  var expected = hex_(Utilities.computeHmacSha256Signature(ts + '.' + body.payload, secret));
  if (!safeEqual_(expected, String(body.sig || ''))) return json_({ ok: false, error: 'bad_signature' });

  var cache = CacheService.getScriptCache();
  if (body.key && cache.get('done:' + body.key)) return json_({ ok: true, duplicate: true });

  var data = JSON.parse(body.payload);
  if (data.notify) {
    // administrator notice: recipient is fixed here, never taken from the request
    var to = PropertiesService.getScriptProperties().getProperty('ADMIN_EMAIL') || 'info.nextedgeaccesssolutions@gmail.com';
    MailApp.sendEmail(to, String(data.notify.subject || 'NEAS notice').slice(0, 150), String(data.notify.text || '').slice(0, 2000));
    if (body.key) cache.put('done:' + body.key, '1', 3600);
    return json_({ ok: true, notified: true });
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var written = 0;
    Object.keys(data.tabs || {}).forEach(function (name) {
      if (!/^[A-Za-z_]{1,40}$/.test(name)) return;
      var grid = data.tabs[name];
      var sh = ss.getSheetByName(name) || ss.insertSheet(name);
      sh.clearContents();
      if (grid.length && grid[0].length) {
        sh.getRange(1, 1, grid.length, grid[0].length).setValues(grid);
        written += grid.length - 1;
      }
      sh.setFrozenRows(1);
    });
    if (body.key) cache.put('done:' + body.key, '1', 21600);
    return json_({ ok: true, rows: written });
  } finally {
    lock.releaseLock();
  }
}
