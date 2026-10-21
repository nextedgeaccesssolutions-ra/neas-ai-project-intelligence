import 'server-only';
import { createHmac } from 'node:crypto';
import { sha256 } from './server';

/**
 * Sends a short notice to the NEAS administrator's mailbox through the signed Apps Script bridge
 * (the same one that mirrors data to Google Sheets). The recipient is fixed in the script
 * (ADMIN_EMAIL property, default info.nextedgeaccesssolutions@gmail.com), never taken from a request.
 * Best effort: a failure never blocks the user's action.
 */
export async function notifyAdmin(subject: string, text: string, dedupeKey?: string): Promise<boolean> {
  const url = process.env.SHEETS_WEBHOOK_URL;
  const secret = process.env.SHEETS_WEBHOOK_SECRET;
  if (!url || !secret) return false;
  const payload = JSON.stringify({ notify: { subject: subject.slice(0, 150), text: text.slice(0, 2000) } });
  const ts = Date.now();
  const sig = createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex');
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ts, sig, key: dedupeKey ? sha256(`notify:${dedupeKey}`) : undefined, payload }), redirect: 'follow' });
    const j = (await r.json().catch(() => null)) as { ok?: boolean } | null;
    return !!j?.ok;
  } catch {
    return false;
  }
}
