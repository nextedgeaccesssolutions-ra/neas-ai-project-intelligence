import { createClient } from '@supabase/supabase-js';
import { appUrl, assertSameOrigin, handle, HttpError, readJson, requireSuperAdmin, supabaseService } from '@/lib/cloud/server';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/cloud/env';
import { UUID_RE } from '@/lib/cloud/validate';

export const dynamic = 'force-dynamic';

type Action = 'suspend' | 'reactivate' | 'reset_password' | 'make_admin' | 'make_staff' | 'revoke_sessions' | 'issue_code';

export const POST = handle(async (req, { params }) => {
  const { id } = await params as { id: string };
  assertSameOrigin(req);
  if (!UUID_RE.test(id)) throw new HttpError(400, 'Invalid user id');
  const { sb, user } = await requireSuperAdmin();
  const body = await readJson<{ action: Action; reason?: string; hours?: number }>(req, 4096);
  const svc = supabaseService();
  const reason = body.reason?.slice(0, 500) ?? null;

  switch (body.action) {
    case 'suspend': {
      const { error } = await sb.rpc('admin_set_user_status', { p_user: id, p_status: 'suspended', p_reason: reason });
      if (error) throw new HttpError(400, error.message);
      // RLS and active-user checks deny application access; the Auth ban also blocks new sign-ins
      // and token refresh. Surface a partial failure instead of claiming the ban succeeded.
      const { error: banError } = await svc.auth.admin.updateUserById(id, { ban_duration: '876000h' });
      if (banError) {
        console.error('[admin:suspend] Auth ban failed after database suspension:', banError.message);
        throw new HttpError(502, 'The account is suspended in NEAS data access, but the sign-in ban did not complete. Contact the system administrator.');
      }
      break;
    }
    case 'reactivate': {
      const { error } = await sb.rpc('admin_set_user_status', { p_user: id, p_status: 'active', p_reason: reason });
      if (error) throw new HttpError(400, error.message);
      const { error: unbanError } = await svc.auth.admin.updateUserById(id, { ban_duration: 'none' });
      if (unbanError) {
        console.error('[admin:reactivate] Auth unban failed after database reactivation:', unbanError.message);
        throw new HttpError(502, 'The account status was reactivated, but sign-in remains blocked. Contact the system administrator.');
      }
      break;
    }
    case 'reset_password': {
      const { data: p, error: profileError } = await sb.from('profiles').select('email').eq('id', id).single();
      if (profileError || !p?.email) throw new HttpError(404, 'User not found');
      const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
      const { error } = await anon.auth.resetPasswordForEmail(p.email, {
        redirectTo: `${appUrl(req)}/auth/callback?next=/auth/setup-password`,
      });
      if (error) {
        const rateLimited = error.status === 429 || /rate|limit|security purposes|after \\d+ seconds/i.test(error.message);
        throw new HttpError(rateLimited ? 429 : 502, rateLimited
          ? 'The password reset e-mail limit has been reached. Wait before requesting another link.'
          : 'The password reset e-mail could not be sent. Verify the Supabase Auth e-mail configuration and try again.');
      }
      const { error: updateError } = await svc.from('profiles')
        .update({ password_reset_requested_at: new Date().toISOString() }).eq('id', id);
      if (updateError) {
        console.error('[admin:password-reset] request sent but profile timestamp failed:', updateError.message);
      }
      const { error: auditError } = await svc.from('audit_logs').insert({
        actor_id: user.id,
        action: 'account:password_reset_sent',
        target_type: 'profiles',
        target_id: id,
      });
      if (auditError) console.error('[admin:password-reset] audit log write failed:', auditError.message);
      break;
    }
    case 'issue_code': {
      const hours = Math.min(720, Math.max(1, Math.round(Number(body.hours) || 72)));
      const { data, error } = await sb.rpc('admin_issue_setup_code', { p_user: id, p_hours: hours });
      if (error) throw new HttpError(400, error.message);
      const row = (Array.isArray(data) ? data[0] : data) as { code?: string; expires_at?: string } | null;
      if (!row?.code || !row.expires_at) throw new HttpError(500, 'The activation code could not be issued. Try again or contact the system administrator.');
      return Response.json({ ok: true, code: row.code, expiresAt: row.expires_at });
    }
    case 'revoke_sessions': {
      const { error } = await sb.rpc('admin_revoke_sessions', { p_user: id, p_reason: reason });
      if (error) throw new HttpError(400, error.message);
      break;
    }
    case 'make_admin':
    case 'make_staff': {
      const { error } = await sb.rpc('admin_set_global_role', {
        p_user: id,
        p_role: body.action === 'make_admin' ? 'super_admin' : 'staff',
      });
      if (error) throw new HttpError(400, error.message);
      break;
    }
    default:
      throw new HttpError(400, 'Unknown action');
  }
  return Response.json({ ok: true });
});
