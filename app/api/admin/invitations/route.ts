import { appUrl, assertSameOrigin, handle, HttpError, readJson, requireSuperAdmin, supabaseService } from '@/lib/cloud/server';
import { checkEmail, checkName, UUID_RE } from '@/lib/cloud/validate';

export const dynamic = 'force-dynamic';

// Invite a person to a project. They receive a single-use link to set their password; on first
// sign-in the database trigger activates the account and adds the project membership.
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const { sb, user } = await requireSuperAdmin();
  const body = await readJson<{ email: string; fullName: string; projectId?: string; role?: 'project_manager' | 'employee' }>(req, 4096);
  const e = checkEmail(body.email);
  if (!e.ok) throw new HttpError(400, e.error);
  const n = checkName(body.fullName);
  if (!n.ok) throw new HttpError(400, n.error);
  if (body.projectId && !UUID_RE.test(body.projectId)) throw new HttpError(400, 'Invalid project');
  const role = body.role === 'project_manager' ? 'project_manager' : 'employee';

  const { error } = await sb.from('project_invitations').insert({ email: e.email, full_name: n.name, project_id: body.projectId ?? null, role, invited_by: user.id });
  if (error) throw new HttpError(400, error.message);

  const svc = supabaseService();
  const { error: inviteErr } = await svc.auth.admin.inviteUserByEmail(e.email, { data: { full_name: n.name }, redirectTo: `${appUrl(req)}/auth/callback?next=/auth/setup-password` });
  if (inviteErr) {
    // Existing account: grant the project directly instead of inviting.
    const { data: existing } = await svc.from('profiles').select('id').ilike('email', e.email).maybeSingle();
    if (existing && body.projectId) {
      await sb.from('project_memberships').upsert({ project_id: body.projectId, user_id: existing.id, role, added_by: user.id });
      await sb.from('project_invitations').update({ status: 'accepted', accepted_at: new Date().toISOString() }).eq('email', e.email).eq('status', 'pending');
      return Response.json({ ok: true, message: 'This person already has an account. They were added to the project.' });
    }
    throw new HttpError(400, 'The invitation e-mail could not be sent.');
  }
  return Response.json({ ok: true, message: `Invitation sent to ${e.email}. The link is single-use and expires.` });
});
