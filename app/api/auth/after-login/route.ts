import { assertSameOrigin, handle, HttpError, supabaseAsUser, supabaseService } from '@/lib/cloud/server';

export const dynamic = 'force-dynamic';

// Records the sign-in time and an audit entry. Called by the app right after a successful login.
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const sb = supabaseAsUser();
  const { data } = await sb.auth.getUser();
  if (!data.user) throw new HttpError(401, 'Sign in required');
  const svc = supabaseService();
  await svc.from('profiles').update({ last_login_at: new Date().toISOString() }).eq('id', data.user.id);
  await svc.from('audit_logs').insert({ actor_id: data.user.id, action: 'auth:login', target_type: 'profiles', target_id: data.user.id });
  const { data: profile } = await sb.from('profiles').select('status, global_role, email_verified_at').eq('id', data.user.id).single();
  return Response.json({ ok: true, profile });
});
