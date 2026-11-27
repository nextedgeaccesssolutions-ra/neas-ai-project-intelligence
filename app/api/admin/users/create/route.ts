import { assertSameOrigin, handle, HttpError, readJson, requireSuperAdmin, supabaseService } from '@/lib/cloud/server';
import { checkEmail, checkName, UUID_RE } from '@/lib/cloud/validate';

export const dynamic = 'force-dynamic';

// Super Admin adds a person directly (no e-mail needed): the account is created approved, optionally
// given access to one project, and a one-time activation code is returned for the admin to hand over.
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const { sb, user } = await requireSuperAdmin();
  const body = await readJson<{ fullName?: string; email?: string; projectId?: string; role?: string; hours?: number }>(req, 4096);
  const n = checkName(body.fullName ?? '');
  if (!n.ok) throw new HttpError(400, n.error);
  const e = checkEmail(body.email ?? '');
  if (!e.ok) throw new HttpError(400, e.error);
  if (body.projectId && !UUID_RE.test(body.projectId)) throw new HttpError(400, 'Invalid project');
  const role = body.role === 'project_manager' ? 'project_manager' : 'employee';
  const hours = Math.min(720, Math.max(1, Math.round(Number(body.hours) || 72)));

  const svc = supabaseService();
  const { data: created, error } = await svc.auth.admin.createUser({
    email: e.email,
    email_confirm: true,
    user_metadata: { full_name: n.name },
  });
  if (error || !created.user) {
    throw new HttpError(409, 'Could not create the account. If this e-mail already has an account, issue a code from the User directory instead.');
  }

  const id = created.user.id;
  // Account provisioning spans Auth and several database operations. If any later step fails,
  // remove the newly-created Auth identity so a half-provisioned account cannot be left behind.
  try {
    const { error: apErr } = await sb.rpc('admin_review_registration', {
      p_user: id,
      p_approve: true,
      p_reason: null,
    });
    if (apErr && !/No pending registration/.test(apErr.message)) {
      throw new HttpError(400, apErr.message);
    }

    if (body.projectId) {
      const { error: membershipError } = await sb.from('project_memberships').upsert({
        project_id: body.projectId,
        user_id: id,
        role,
        can_approve_reports: role === 'project_manager',
      });
      if (membershipError) throw new HttpError(400, membershipError.message);
    }

    const { data: codeRows, error: codeError } = await sb.rpc('admin_issue_setup_code', {
      p_user: id,
      p_hours: hours,
    });
    if (codeError) throw new HttpError(400, codeError.message);

    const row = (Array.isArray(codeRows) ? codeRows[0] : codeRows) as
      | { code?: string; expires_at?: string }
      | null;
    if (!row?.code || !row.expires_at) {
      throw new HttpError(500, 'The account was created but its activation code could not be issued.');
    }

    const { error: auditError } = await svc.from('audit_logs').insert({
      actor_id: user.id,
      action: 'account:admin_created',
      target_type: 'profiles',
      target_id: id,
      details: { role, project_assigned: !!body.projectId },
    });
    if (auditError) {
      // Do not discard a valid activation code because audit logging is temporarily unavailable.
      console.error('[admin:create-user] audit log write failed:', auditError.message);
    }

    return Response.json({ ok: true, userId: id, code: row.code, expiresAt: row.expires_at });
  } catch (error) {
    const { error: cleanupError } = await svc.auth.admin.deleteUser(id);
    if (cleanupError) {
      console.error('[admin:create-user] failed to roll back partially provisioned Auth user:', cleanupError.message);
      throw new HttpError(500, 'Account setup did not complete and automatic cleanup failed. Contact the system administrator before retrying.');
    }
    throw error;
  }
});
