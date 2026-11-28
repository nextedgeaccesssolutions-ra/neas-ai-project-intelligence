import { assertSameOrigin, handle, HttpError, readJson, requireSuperAdmin, supabaseService } from '@/lib/cloud/server';
import { checkEmail, checkName, checkPin, checkUsername, normaliseUsername, UUID_RE } from '@/lib/cloud/validate';
import { pinPassword } from '@/lib/cloud/pin';

export const dynamic = 'force-dynamic';

// Super Admin adds a person directly (no e-mail needed): the account is created approved, optionally
// given access to one project, and a one-time activation code is returned for the admin to hand over.
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const { sb, user } = await requireSuperAdmin();
  // Re-authenticate before creating an identity or client login.
  const { error: pinErr } = await sb.rpc('require_reauth');
  if (pinErr) throw new HttpError(403, pinErr.message);

  const body = await readJson<{
    fullName?: string;
    email?: string;
    username?: string;
    projectId?: string;
    role?: string;
    hours?: number;
    pin?: string;
  }>(req, 4096);
  const username = normaliseUsername(body.username ?? '');
  if (!checkUsername(username)) throw new HttpError(400, 'Usernames are 3 to 32 lowercase letters, numbers, dots or dashes.');
  const n = checkName(body.fullName ?? '');
  if (!n.ok) throw new HttpError(400, n.error);
  if (body.projectId && !UUID_RE.test(body.projectId)) throw new HttpError(400, 'Invalid project');
  const pin = body.pin ? String(body.pin) : '';
  if (pin) {
    const bad = checkPin(pin);
    if (bad) throw new HttpError(400, bad.replace('Your PIN', 'The passcode'));
  }

  // Client logins are scoped to a single project and never create staff identities.
  if (body.role === 'client') {
    if (!body.projectId) throw new HttpError(400, 'Choose the project this client may see.');
    if (!pin) throw new HttpError(400, 'Enter or generate a 6-digit passcode for the client.');
    const { error } = await sb.rpc('admin_create_client_login', {
      p_project: body.projectId,
      p_label: n.name,
      p_username: username,
      p_passcode: pin,
      p_days: null,
    });
    if (error) throw new HttpError(error.code === '23505' ? 409 : 400, error.code === '23505' ? await taken(username) : error.message);
    return Response.json({ ok: true, client: true });
  }

  const svc = supabaseService();
  const { data: clash } = await svc.rpc('username_taken', { p_username: username });
  if (clash) throw new HttpError(409, await taken(username));

  // E-mail is optional; the reserved .invalid domain cannot receive mail.
  const e = body.email?.trim()
    ? checkEmail(body.email)
    : { ok: true as const, email: `${username}@users.neas.invalid` };
  if (!e.ok) throw new HttpError(400, e.error);
  const role = body.role === 'project_manager' ? 'project_manager' : 'employee';
  const hours = Math.min(720, Math.max(1, Math.round(Number(body.hours) || 72)));

  const { data: created, error: createError } = await svc.auth.admin.createUser({
    email: e.email,
    email_confirm: true,
    user_metadata: { full_name: n.name },
  });
  if (createError || !created.user) {
    const { data: existing } = await svc.from('profiles').select('full_name, status, username').ilike('email', e.email).maybeSingle();
    if (existing) {
      const who = existing.full_name || e.email;
      throw new HttpError(409, existing.status === 'active'
        ? `${who} already has an account with this e-mail. Open it in User directory and use “Reset PIN / password (one-time code)”.`
        : `${who} already has an account with this e-mail, currently ${existing.status}. Open it in User directory, press Activate, then use “Reset PIN / password (one-time code)”.`);
    }
    throw new HttpError(400, `Supabase did not create the account: ${createError?.message ?? 'unknown reason'}.`);
  }

  const id = created.user.id;
  // Provisioning spans Auth and several database writes. Roll the Auth identity back if any
  // required step fails, so callers never have to recover a half-created account manually.
  try {
    const { error: approvalError } = await sb.rpc('admin_review_registration', {
      p_user: id,
      p_approve: true,
      p_reason: null,
    });
    if (approvalError && !/No pending registration/.test(approvalError.message)) {
      throw new HttpError(400, approvalError.message);
    }

    const { error: usernameError } = await sb.rpc('admin_set_username', { p_user: id, p_username: username });
    if (usernameError) throw new HttpError(409, `Account created, but the username was not saved: ${usernameError.message}. Set it in the User directory.`);

    if (body.projectId) {
      const { error: membershipError } = await sb.from('project_memberships').upsert({
        project_id: body.projectId,
        user_id: id,
        role,
        can_approve_reports: role === 'project_manager',
      });
      if (membershipError) throw new HttpError(400, membershipError.message);
    }

    if (pin) {
      const { error: passwordError } = await svc.auth.admin.updateUserById(id, { password: pinPassword(id, pin) });
      if (passwordError) throw new HttpError(500, `The account was created but its passcode was not saved (${passwordError.message}).`);
    }

    let code: string | undefined;
    let expiresAt: string | undefined;
    if (!pin) {
      const { data, error: codeError } = await sb.rpc('admin_issue_setup_code', { p_user: id, p_hours: hours });
      if (codeError) throw new HttpError(400, codeError.message);
      const row = (Array.isArray(data) ? data[0] : data) as { code?: string; expires_at?: string } | null;
      if (!row?.code || !row.expires_at) throw new HttpError(500, 'The account was created but its activation code could not be issued.');
      code = row.code;
      expiresAt = row.expires_at;
    }

    const { error: auditError } = await svc.from('audit_logs').insert({
      actor_id: user.id,
      action: 'account:admin_created',
      target_type: 'profiles',
      target_id: id,
      details: { role, project_assigned: !!body.projectId, passcode_set: !!pin },
    });
    if (auditError) console.error('[admin:create-user] audit log write failed:', auditError.message);

    return Response.json({ ok: true, userId: id, ...(code ? { code, expiresAt } : {}) });
  } catch (error) {
    const { error: cleanupError } = await svc.auth.admin.deleteUser(id);
    if (cleanupError) {
      console.error('[admin:create-user] failed to roll back partially provisioned Auth user:', cleanupError.message);
      throw new HttpError(500, 'Account setup did not complete and automatic cleanup failed. Contact the system administrator before retrying.');
    }
    throw error;
  }
});

// Only Super Admins reach this helper; identify the conflicting account without exposing it to other users.
async function taken(username: string): Promise<string> {
  const svc = supabaseService();
  const { data: cred } = await svc.from('client_access_credentials').select('label, projects(code)').eq('username', username).is('revoked_at', null).maybeSingle();
  if (cred) {
    const code = (cred as { projects?: { code?: string } | null }).projects?.code;
    return `"${username}" is already the client login of ${cred.label}${code ? ` (${code})` : ''}. Choose another username, or manage that login under Client viewer access.`;
  }
  const { data: profile } = await svc.from('profiles').select('full_name, email').eq('username', username).maybeSingle();
  if (profile) return `"${username}" is already used by ${profile.full_name || profile.email} (User directory). Choose another username.`;
  return 'That username is already used. Choose another.';
}
