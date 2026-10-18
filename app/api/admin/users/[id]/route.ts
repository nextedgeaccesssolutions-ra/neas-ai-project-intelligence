import { createClient } from '@supabase/supabase-js';
import { appUrl, assertSameOrigin, handle, HttpError, readJson, requireSuperAdmin, supabaseService } from '@/lib/cloud/server';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/cloud/env';
import { UUID_RE } from '@/lib/cloud/validate';

export const dynamic = 'force-dynamic';

type Action = 'suspend' | 'reactivate' | 'reset_password' | 'make_admin' | 'make_staff';

export const POST = handle(async (req, { params }) => {
  assertSameOrigin(req);
  if (!UUID_RE.test(params.id)) throw new HttpError(400, 'Invalid user id');
  const { sb, user } = await requireSuperAdmin();
  const body = await readJson<{ action: Action; reason?: string }>(req, 4096);
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
    case 'make_admin':
    case 'make_staff': {
      const { error } = await sb.rpc('admin_set_global_role', { p_user: params.id, p_role: body.action === 'make_admin' ? 'super_admin' : 'staff' });
      if (error) throw new HttpError(400, error.message);
      break;
    }
    default:
      throw new HttpError(400, 'Unknown action');
  }
  return Response.json({ ok: true });
});
