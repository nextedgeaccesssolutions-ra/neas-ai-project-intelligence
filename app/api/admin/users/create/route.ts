import { assertSameOrigin, handle, HttpError, readJson, requireSuperAdmin, supabaseService } from '@/lib/cloud/server';
import { checkEmail, checkName, checkUsername, normaliseUsername, UUID_RE } from '@/lib/cloud/validate';

export const dynamic = 'force-dynamic';

// Super Admin adds a person directly (no e-mail needed): the account is created approved, optionally
// given access to one project, and a one-time activation code is returned for the admin to hand over.
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const { sb } = await requireSuperAdmin();
  // check the PIN re-check before creating anything, so a prompt never leaves a half-made account
  const { error: pinErr } = await sb.rpc('require_reauth');
  if (pinErr) throw new HttpError(403, pinErr.message);
  const body = await readJson<{ fullName?: string; email?: string; username?: string; projectId?: string; role?: string; hours?: number }>(req, 4096);
  const username = normaliseUsername(body.username ?? '');
  if (username && !checkUsername(username)) throw new HttpError(400, 'Usernames are 3 to 32 lowercase letters, numbers, dots or dashes.');
  const n = checkName(body.fullName ?? '');
  if (!n.ok) throw new HttpError(400, n.error);
  const e = checkEmail(body.email ?? '');
  if (!e.ok) throw new HttpError(400, e.error);
  if (body.projectId && !UUID_RE.test(body.projectId)) throw new HttpError(400, 'Invalid project');
  const role = body.role === 'project_manager' ? 'project_manager' : 'employee';
  const hours = Math.min(720, Math.max(1, Math.round(Number(body.hours) || 72)));

  const svc = supabaseService();
  const { data: created, error } = await svc.auth.admin.createUser({ email: e.email, email_confirm: true, user_metadata: { full_name: n.name } });
  if (error || !created.user) {
    const { data: existing } = await svc.from('profiles').select('full_name, status, username').ilike('email', e.email).maybeSingle();
    if (existing) {
      const who = existing.full_name || e.email;
      throw new HttpError(409, existing.status === 'active'
        ? `${who} already has an account with this e-mail. Open it in User directory and use “Reset PIN / password (one-time code)”.`
        : `${who} already has an account with this e-mail, currently ${existing.status}. Open it in User directory, press Activate, then use “Reset PIN / password (one-time code)”.`);
    }
    throw new HttpError(400, `Supabase did not create the account: ${error?.message ?? 'unknown reason'}.`);
  }
  const id = created.user.id;

  // approval and code go through the admin's own session, so the database checks Super Admin rights and audits them
  const { error: apErr } = await sb.rpc('admin_review_registration', { p_user: id, p_approve: true, p_reason: null });
  if (apErr && !/No pending registration/.test(apErr.message)) throw new HttpError(400, apErr.message);
  if (username) {
    const { error: uErr } = await sb.rpc('admin_set_username', { p_user: id, p_username: username });
    if (uErr) throw new HttpError(409, `Account created, but the username was not saved: ${uErr.message}. Set it in the User directory.`);
  }
  if (body.projectId) {
    const { error: mErr } = await sb.from('project_memberships').upsert({ project_id: body.projectId, user_id: id, role, can_approve_reports: role === 'project_manager' });
    if (mErr) throw new HttpError(400, mErr.message);
  }
  const { data: codeRows, error: cErr } = await sb.rpc('admin_issue_setup_code', { p_user: id, p_hours: hours });
  if (cErr) throw new HttpError(400, cErr.message);
  const row = (Array.isArray(codeRows) ? codeRows[0] : codeRows) as { code: string; expires_at: string };
  return Response.json({ ok: true, userId: id, code: row.code, expiresAt: row.expires_at });
});
