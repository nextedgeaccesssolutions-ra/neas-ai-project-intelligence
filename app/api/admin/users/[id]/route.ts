import { createClient } from '@supabase/supabase-js';
import { appUrl, assertSameOrigin, handle, HttpError, readJson, requireSuperAdmin, supabaseService } from '@/lib/cloud/server';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/cloud/env';
import { UUID_RE } from '@/lib/cloud/validate';

export const dynamic = 'force-dynamic';

type Action = 'suspend' | 'reactivate' | 'reset_password' | 'make_admin' | 'make_staff' | 'revoke_sessions' | 'issue_code' | 'update_profile' | 'delete' | 'set_username' | 'unlock_pin';

export const POST = handle(async (req, { params }) => {
  assertSameOrigin(req);
  if (!UUID_RE.test(params.id)) throw new HttpError(400, 'Invalid user id');
  const { sb, user } = await requireSuperAdmin();
  const body = await readJson<{ action: Action; reason?: string; hours?: number; fullName?: string; jobTitle?: string; username?: string }>(req, 4096);
  const svc = supabaseService();
  const reason = body.reason?.slice(0, 500) ?? null;

  switch (body.action) {
    case 'suspend': {
      const { error } = await sb.rpc('admin_set_user_status', { p_user: params.id, p_status: 'suspended', p_reason: reason });
      if (error) throw new HttpError(400, error.message);
      // RLS already denies data access; the ban also stops new sign-ins and token refresh.
      await svc.auth.admin.updateUserById(params.id, { ban_duration: '876000h' });
      break;
    }
    case 'reactivate': {
      const { error } = await sb.rpc('admin_set_user_status', { p_user: params.id, p_status: 'active', p_reason: reason });
      if (error) throw new HttpError(400, error.message);
      await svc.auth.admin.updateUserById(params.id, { ban_duration: 'none' });
      break;
    }
    case 'reset_password': {
      const { data: p } = await sb.from('profiles').select('email').eq('id', params.id).single();
      if (!p?.email) throw new HttpError(404, 'User not found');
      const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
      const { error } = await anon.auth.resetPasswordForEmail(p.email, { redirectTo: `${appUrl(req)}/auth/callback?next=/auth/setup-password` });
      if (error) throw new HttpError(429, 'Could not send the reset e-mail right now. Try again shortly.');
      await svc.from('profiles').update({ password_reset_requested_at: new Date().toISOString() }).eq('id', params.id);
      await svc.from('audit_logs').insert({ actor_id: user.id, action: 'account:password_reset_sent', target_type: 'profiles', target_id: params.id });
      break;
    }
    case 'issue_code': {
      // one-time activation code, shown once to the admin; only its hash is stored
      const hours = Math.min(720, Math.max(1, Math.round(Number(body.hours) || 72)));
      const { data, error } = await sb.rpc('admin_issue_setup_code', { p_user: params.id, p_hours: hours });
      if (error) throw new HttpError(400, error.message);
      const row = (Array.isArray(data) ? data[0] : data) as { code: string; expires_at: string };
      return Response.json({ ok: true, code: row.code, expiresAt: row.expires_at });
    }
    case 'revoke_sessions': {
      // Deletes refresh sessions and makes already-issued access tokens useless at the database.
      const { error } = await sb.rpc('admin_revoke_sessions', { p_user: params.id, p_reason: reason });
      if (error) throw new HttpError(400, error.message);
      break;
    }
    case 'update_profile': {
      const { error } = await sb.rpc('admin_update_profile', { p_user: params.id, p_full_name: body.fullName ?? '', p_job_title: body.jobTitle ?? '' });
      if (error) throw new HttpError(400, error.message);
      break;
    }
    case 'delete': {
      // Reversible: the profile stays so reports keep their author; the database revokes access and sessions.
      const { error } = await sb.rpc('admin_delete_user', { p_user: params.id, p_reason: reason });
      if (error) throw new HttpError(400, error.message);
      await svc.auth.admin.updateUserById(params.id, { ban_duration: '876000h' });
      break;
    }
    case 'make_admin':
    case 'make_staff': {
      const { error } = await sb.rpc('admin_set_global_role', { p_user: params.id, p_role: body.action === 'make_admin' ? 'super_admin' : 'staff' });
      if (error) throw new HttpError(400, error.message);
      break;
    }
    case 'set_username': {
      const { error } = await sb.rpc('admin_set_username', { p_user: params.id, p_username: String(body.username ?? '') });
      if (error) throw new HttpError(error.code === '23505' ? 409 : 400, error.message);
      break;
    }
    case 'unlock_pin': {
      const { error } = await sb.rpc('admin_unlock_pin', { p_user: params.id });
      if (error) throw new HttpError(400, error.message);
      break;
    }
    default:
      throw new HttpError(400, 'Unknown action');
  }
  return Response.json({ ok: true });
});
