/**
 * Vercel serverless API: secure NEAS Supabase -> Google Sheets mirror.
 * Required server-only environment variables:
 *   NEAS_SHEETS_WEBAPP_URL = deployed Apps Script /exec URL
 *   NEAS_SHEETS_API_TOKEN = same secret as Apps Script Script Property API_TOKEN
 */
const SUPABASE_URL = 'https://smlxekhbaefbvdbfxpew.supabase.co';
const SUPABASE_KEY = 'sb_publishable_XJ55i-jpRPoX3hha8Q2WRQ_sPnKoRTB';

const TABLES = {
  projects: 'Projects',
  project_activities: 'Activities',
  field_reports: 'FieldReports',
  project_evidence: 'Evidence',
  estimates: null
};
const ALLOWED_SHEETS = new Set([
  'Projects', 'Activities', 'FieldReports', 'Evidence', 'BOQ', 'Quotations'
]);
const MAX_BATCH = 1000;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  }

  try {
    const auth = String(req.headers.authorization || '');
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (!match) return res.status(401).json({ ok: false, error: 'Sign in is required.' });

    const accessToken = match[1];
    const userResponse = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + accessToken }
    });
    if (!userResponse.ok) return res.status(401).json({ ok: false, error: 'Your session is invalid or expired. Sign in again.' });
    const user = await userResponse.json();

    const roleResponse = await fetch(
      SUPABASE_URL + '/rest/v1/user_roles?select=role,active&user_id=eq.' + encodeURIComponent(user.id),
      { headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + accessToken } }
    );
    if (!roleResponse.ok) return res.status(403).json({ ok: false, error: 'Could not verify your NEAS role.' });
    const roleRows = await roleResponse.json();
    const roleRow = roleRows.find(r => r.active === true);
    if (!roleRow) return res.status(403).json({ ok: false, error: 'An active NEAS role is required.' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const webAppUrl = process.env.NEAS_SHEETS_WEBAPP_URL;
    const apiToken = process.env.NEAS_SHEETS_API_TOKEN;
    if (!webAppUrl || !/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(webAppUrl)) {
      return res.status(503).json({ ok: false, error: 'Google Apps Script /exec URL is not configured in Vercel.' });
    }
    if (!apiToken || apiToken.length < 32) {
      return res.status(503).json({ ok: false, error: 'Google Sheets API token is not configured in Vercel.' });
    }

    let grouped;
    if (body.mode === 'bulk') {
      if (roleRow.role !== 'admin') {
        return res.status(403).json({ ok: false, error: 'Only a NEAS administrator can run full synchronization.' });
      }
      grouped = {};
      for (const [table, sheet] of Object.entries(TABLES)) {
        const rows = await readSupabaseTable(table, accessToken);
        if (table === 'estimates') {
          grouped.BOQ = rows.filter(r => r.record_type !== 'quotation');
          grouped.Quotations = rows.filter(r => r.record_type === 'quotation');
        } else {
          grouped[sheet] = rows;
        }
      }
    } else if (body.mode === 'record') {
      const table = String(body.table || '');
      if (!Object.prototype.hasOwnProperty.call(TABLES, table)) {
        return res.status(400).json({ ok: false, error: 'Table is not allowed.' });
      }
      if (!body.id) return res.status(400).json({ ok: false, error: 'Record ID is required.' });
      if (table === 'estimates' && !['admin', 'estimator', 'project_manager'].includes(roleRow.role)) {
        return res.status(403).json({ ok: false, error: 'Your role cannot sync estimates.' });
      }
      const rows = await readSupabaseTable(table, accessToken, String(body.id));
      if (!rows.length) return res.status(404).json({ ok: false, error: 'Record not found or not accessible under database permissions.' });
      const record = rows[0];
      const sheet = table === 'estimates'
        ? (record.record_type === 'quotation' ? 'Quotations' : 'BOQ')
        : TABLES[table];
      grouped = { [sheet]: [record] };
    } else {
      return res.status(400).json({ ok: false, error: 'Use mode record or bulk.' });
    }

    let synced = 0;
    let sheetCount = 0;
    for (const [sheet, records] of Object.entries(grouped)) {
      if (!ALLOWED_SHEETS.has(sheet)) throw new Error('Blocked sheet name.');
      if (!records.length) continue;
      if (records.length > MAX_BATCH) throw new Error('Too many records in one sheet batch.');
      const response = await fetch(webAppUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ token: apiToken, action: 'upsert', sheet, records })
      });
      const raw = await response.text();
      let result;
      try { result = JSON.parse(raw); } catch (_) { throw new Error('Apps Script returned a non-JSON response for ' + sheet + '.'); }
      if (!response.ok || !result.ok) throw new Error(result.error || 'Google Sheets write failed for ' + sheet + '.');
      synced += records.length;
      sheetCount++;
    }

    return res.status(200).json({ ok: true, synced, sheets: sheetCount, mode: body.mode });
  } catch (err) {
    console.error('NEAS Sheets sync error:', err && err.message);
    return res.status(500).json({ ok: false, error: String(err && err.message || 'Google Sheets sync failed.') });
  }
};

async function readSupabaseTable(table, accessToken, id) {
  const params = new URLSearchParams({ select: '*' });
  if (id) params.set('id', 'eq.' + id);
  const response = await fetch(SUPABASE_URL + '/rest/v1/' + encodeURIComponent(table) + '?' + params.toString(), {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: 'Bearer ' + accessToken
    }
  });
  if (!response.ok) throw new Error('Could not read ' + table + ' under your database permissions.');
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error('Unexpected database response for ' + table + '.');
  return rows;
}
