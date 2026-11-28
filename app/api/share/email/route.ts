import { createHmac } from 'node:crypto';
import { appUrl, assertSameOrigin, handle, HttpError, readJson, requireUser, sha256, supabaseService } from '@/lib/cloud/server';
import { buildShareEmail, validEmail } from '@/lib/shareEmail';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Body = { projectId?: string; to?: string; subject?: string; message?: string; days?: number; requestKey?: string };

// Sends a shared report link by e-mail through the signed Apps Script bridge (Gmail).
// "sent" here means Gmail accepted the message; delivery to the inbox is not confirmed.
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const { sb, user } = await requireUser();
  const b = await readJson<Body>(req, 8 * 1024);
  const to = String(b.to ?? '').trim().toLowerCase();
  if (!validEmail(to)) throw new HttpError(400, 'Enter a valid e-mail address.');
  if (!b.projectId || !/^[0-9a-f-]{36}$/i.test(b.projectId)) throw new HttpError(400, 'Choose a project.');
  const url = process.env.SHEETS_WEBHOOK_URL;
  const secret = process.env.SHEETS_WEBHOOK_SECRET;
  if (!url || !secret) throw new HttpError(503, 'E-mail is not configured on the server.');

  // permission, expiry limits, rate limit and duplicate-request check all happen in the database as this user
  const { data: share, error } = await sb.rpc('create_report_share', {
    p_project: b.projectId, p_method: 'email', p_days: Number(b.days) || 7, p_recipient: to, p_label: `E-mail to ${to}`.slice(0, 120),
    p_request_key: typeof b.requestKey === 'string' ? b.requestKey.slice(0, 80) : null,
  });
  if (error || !share) throw new HttpError(error?.code === '42501' ? 403 : error?.code === '23505' ? 409 : 400, error?.message ?? 'Could not create the link.');
  const { id, token, expires_at } = share as { id: string; token: string; expires_at: string };

  const svc = supabaseService();
  const [{ data: project }, { data: me }] = await Promise.all([
    svc.from('projects').select('id, code, name').eq('id', b.projectId).single(),
    svc.from('profiles').select('full_name, email').eq('id', user.id).single(),
  ]);
  if (!project) throw new HttpError(503, 'Could not load the project. Nothing was sent.');
  const mail = buildShareEmail({
    projectCode: project?.code ?? '', projectName: project?.name ?? '', senderName: me?.full_name || me?.email || 'NEAS',
    message: String(b.message ?? ''), subject: b.subject, link: `${appUrl(req)}/share#${token}`, expiresAt: expires_at,
  });

  const payload = JSON.stringify({ shareEmail: { to, subject: mail.subject, html: mail.html, text: mail.text } });
  const key = sha256(`share-email:${id}`);
  const ts = Date.now();
  const sig = createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex');
  let ok = false;
  let err = '';
  let uncertain = false;
  try {
    // one attempt only: a retry could send the e-mail twice
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ts, sig, key, payload }), redirect: 'follow' });
    const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string; emailed?: boolean } | null;
    ok = Boolean(r.ok && j?.ok && j.emailed);
    // an older script answers ok without sending: treat that as "needs the updated script"
    if (!ok) err = j?.error ?? (j?.ok ? 'unknown_action' : `HTTP ${r.status}`);
  } catch (e) {
    err = (e as Error).message;
    uncertain = true; // the request may have reached Gmail before the connection failed
  }
  await svc.from('report_share_events').insert({
    share_id: id, project_id: b.projectId, actor_id: user.id, event: ok ? 'email_sent' : 'email_failed',
    detail: ok ? { to, provider: 'gmail' } : { to, error: err.slice(0, 200) },
  });
  if (!ok) {
    // the link must not stay usable if nobody received it
    const { error: rev } = await svc.from('report_shares').update({ revoked_at: new Date().toISOString(), revoked_by: user.id }).eq('id', id);
    if (rev) console.error('[share] revoke after failed e-mail', rev.message);
    throw new HttpError(502, err === 'unknown_action' || err === 'bad_json'
      ? 'The e-mail service needs the updated Apps Script. Nothing was sent.'
      : uncertain
        ? 'The e-mail service did not answer. The e-mail may or may not have gone out; its link was withdrawn. Check with the recipient before sending again.'
        : 'The e-mail could not be sent. Nothing was sent; try again later.');
  }
  return Response.json({ status: 'accepted_by_gmail', shareId: id, expiresAt: expires_at });
});
