import { createClient } from '@supabase/supabase-js';
import { assertSameOrigin, handle, HttpError, ipHash, readJson, requireUser, supabaseService } from '@/lib/cloud/server';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/cloud/env';

export const dynamic = 'force-dynamic';

// PIN re-check before a sensitive change. The PIN is verified with a throwaway client (no session is
// kept), then the database records the re-check; sensitive changes are allowed for 10 minutes after.
// Wrong PINs count towards the same lockout as sign-in.
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const { user } = await requireUser();
  const { pin } = await readJson<{ pin?: string }>(req, 256);
  if (!/^[\s\S]{6,128}$/.test(String(pin ?? ''))) throw new HttpError(400, 'Enter your PIN.');
  const svc = supabaseService();
  const { data: me } = await svc.from('profiles').select('username, email').eq('id', user.id).single();
  const key = me?.username ?? `id:${user.id}`;
  const ip = ipHash(req);
  if (me?.username) {
    const { data: begin } = await svc.rpc('pin_login_begin', { p_username: me.username, p_ip_hash: ip });
    const g = (Array.isArray(begin) ? begin[0] : begin) as { allowed: boolean; error: string } | undefined;
    if (!g?.allowed) throw new HttpError(429, g?.error ?? 'Too many attempts. Try again later.');
  }
  const probe = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await probe.auth.signInWithPassword({ email: me?.email ?? user.email ?? '', password: String(pin) });
  const ok = !error && data.user?.id === user.id;
  if (data.session) await probe.auth.signOut({ scope: 'local' }).catch(() => undefined);
  if (me?.username) await svc.rpc('pin_login_finish', { p_username: key, p_ip_hash: ip, p_ok: ok });
  if (!ok) throw new HttpError(401, 'That PIN is not correct.');
  await svc.rpc('mark_reauth', { p_user: user.id });
  return Response.json({ ok: true, validMinutes: 10 });
});
