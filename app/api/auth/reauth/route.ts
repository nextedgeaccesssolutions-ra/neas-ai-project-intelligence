import { createClient } from '@supabase/supabase-js';
import { assertSameOrigin, handle, HttpError, ipHash, readJson, requireUser, supabaseService } from '@/lib/cloud/server';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/cloud/env';
import { padTiming, pinPassword } from '@/lib/cloud/pin';

export const dynamic = 'force-dynamic';

// PIN re-check before a sensitive change. The PIN (or, for e-mail accounts, the password) is verified
// with a throwaway client; the session that check creates is closed again at once. Every attempt
// counts towards the same lockout as sign-in, whether or not the account has a username yet.
// On success the database accepts sensitive changes for 10 minutes.
export const POST = handle(async (req) => {
  const started = Date.now();
  assertSameOrigin(req);
  const { user } = await requireUser();
  const { pin } = await readJson<{ pin?: string }>(req, 256);
  const secret = String(pin ?? '');
  if (secret.length < 6 || secret.length > 128) throw new HttpError(400, 'Enter your PIN.');
  const svc = supabaseService();
  const { data: me } = await svc.from('profiles').select('username, email').eq('id', user.id).single();
  const key = (me?.username as string | null) ?? `id:${user.id}`;
  const ip = ipHash(req);

  const { data: begin } = await svc.rpc('pin_login_begin', { p_username: key, p_ip_hash: ip });
  const g = (Array.isArray(begin) ? begin[0] : begin) as { allowed: boolean; error: string } | undefined;
  if (!g?.allowed) throw await padTiming(started, new HttpError(429, g?.error ?? 'Too many attempts. Try again later.'));

  // a PIN account's password is derived from the PIN; e-mail accounts use their password as typed
  const candidates = /^\d{6}$/.test(secret) ? [pinPassword(user.id, secret), secret] : [secret];
  const probe = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  let ok = false;
  for (const password of candidates) {
    const { data, error } = await probe.auth.signInWithPassword({ email: (me?.email as string) ?? user.email ?? '', password });
    if (data.session) await svc.auth.admin.signOut(data.session.access_token, 'local').catch(() => undefined);
    if (!error && data.user?.id === user.id) { ok = true; break; }
  }
  await svc.rpc('pin_login_finish', { p_username: key, p_ip_hash: ip, p_ok: ok });
  if (!ok) throw await padTiming(started, new HttpError(401, 'That PIN is not correct.'));
  await svc.rpc('mark_reauth', { p_user: user.id });
  return Response.json({ ok: true, validMinutes: 10 });
});
