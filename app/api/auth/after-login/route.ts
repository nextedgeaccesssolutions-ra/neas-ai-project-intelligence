import { assertSameOrigin, handle, HttpError, supabaseAsUser, supabaseService } from '@/lib/cloud/server';

export const dynamic = 'force-dynamic';

// Records the sign-in time and an audit entry. Called by the app right after a successful login.
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const sb = supabaseAsUser();
  const { data } = await sb.auth.getUser();
  if (!data.user) throw new HttpError(401, 'Sign in required');
  const svc = supabaseService();
  const { data: profile } = await svc.from('profiles').select('status, global_role, email_verified_at').eq('id', data.user.id).single();
  const approved = profile?.status === 'active' && !!profile?.email_verified_at;
  if (approved) await svc.from('profiles').update({ last_login_at: new Date().toISOString() }).eq('id', data.user.id);
  // sign-ins of accounts that are not approved are refused by the app and recorded for the administrator
  await svc.from('audit_logs').insert({ actor_id: data.user.id, action: approved ? 'auth:login' : 'auth:login_blocked', target_type: 'profiles', target_id: data.user.id, details: approved ? {} : { status: profile?.status ?? 'unknown' } });
  return Response.json({ ok: true, profile });
});
