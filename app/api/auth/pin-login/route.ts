import { cookies } from 'next/headers';
import { assertSameOrigin, handle, HttpError, ipHash, readJson, supabaseAsUser, supabaseService } from '@/lib/cloud/server';
import { checkUsername, normaliseUsername } from '@/lib/cloud/validate';
import { notifyAdmin } from '@/lib/cloud/notify';
import { padTiming, pinPassword } from '@/lib/cloud/pin';

export const dynamic = 'force-dynamic';

const GENERIC = 'Username or PIN is not correct, or the account is not active.';

// Username + 6-digit PIN sign-in. The database decides whether the username may be tried (lockout)
// and records every attempt; the Supabase password is derived from the PIN on the server
// (lib/cloud/pin.ts), so this route is the only place a PIN can be tried. Session cookies are set on
// this response. Every answer takes about the same time.
export const POST = handle(async (req) => {
  const started = Date.now();
  assertSameOrigin(req);
  const b = await readJson<{ username?: string; pin?: string }>(req, 1024);
  const username = normaliseUsername(b.username ?? '');
  const pin = String(b.pin ?? '');
  if (!checkUsername(username) || !/^\d{6}$/.test(pin)) throw await padTiming(started, new HttpError(401, GENERIC));
  const ip = ipHash(req);
  const svc = supabaseService();

  // client usernames open the client portal for their project (approved content only)
  const { data: clientCred } = await svc.from('client_access_credentials').select('id').eq('username', username).is('revoked_at', null).maybeSingle();
  if (clientCred) {
    const { data, error } = await svc.rpc('client_login_username', { p_username: username, p_passcode: pin, p_ip_hash: ip, p_user_agent: req.headers.get('user-agent')?.slice(0, 300) ?? null });
    if (error) throw new HttpError(503, 'Sign-in is unavailable right now. Try again shortly.');
    const row = (Array.isArray(data) ? data[0] : data) as { ok: boolean; error: string | null; session_token: string | null; project_code: string | null; expires_at: string | null } | undefined;
    if (!row?.ok || !row.session_token || !row.project_code) {
      throw await padTiming(started, new HttpError(row?.error?.startsWith('Too many') ? 429 : 401, row?.error?.startsWith('Too many') ? row.error : GENERIC));
    }
    cookies().set('neas_client', `${row.project_code}.${row.session_token}`, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/',
      expires: row.expires_at ? new Date(row.expires_at) : undefined,
    });
    return padTiming(started, Response.json({ ok: true, redirect: `/client/${encodeURIComponent(row.project_code)}` }));
  }

  const { data: begin, error: beginErr } = await svc.rpc('pin_login_begin', { p_username: username, p_ip_hash: ip });
  if (beginErr) throw new HttpError(503, 'Sign-in is unavailable right now. Try again shortly.');
  const g = (Array.isArray(begin) ? begin[0] : begin) as { allowed: boolean; email: string | null; user_id: string | null; error: string } | undefined;
  if (!g?.allowed) throw await padTiming(started, new HttpError(429, g?.error ?? 'Too many attempts. Try again later.'));

  let ok = false;
  if (g.email && g.user_id) {
    const { error } = await supabaseAsUser().auth.signInWithPassword({ email: g.email, password: pinPassword(g.user_id, pin) });
    ok = !error;
  }
  const { data: outcome } = await svc.rpc('pin_login_finish', { p_username: username, p_ip_hash: ip, p_ok: ok });
  if (ok) return padTiming(started, Response.json({ ok: true }));
  if (outcome === 'locked_15' || outcome === 'locked_admin') {
    void notifyAdmin(
      outcome === 'locked_admin' ? `NEAS: account locked (${username})` : `NEAS: repeated wrong PINs (${username})`,
      outcome === 'locked_admin'
        ? `The username "${username}" had 10 wrong PINs in 24 hours and is locked for 24 hours. If this was the person, unlock it sooner in Control panel → User directory. If not, treat it as an attack and contact them.`
        : `The username "${username}" had 5 wrong PINs in 15 minutes and is paused for 15 minutes.`,
      `pin-lock:${username}:${outcome}:${new Date().toISOString().slice(0, 13)}`,
    );
    throw await padTiming(started, new HttpError(429, outcome === 'locked_admin' ? 'This account is locked for 24 hours after repeated wrong PINs. Ask your NEAS administrator to unlock it sooner.' : 'Too many wrong PINs. Try again in 15 minutes.'));
  }
  throw await padTiming(started, new HttpError(401, GENERIC));
});
