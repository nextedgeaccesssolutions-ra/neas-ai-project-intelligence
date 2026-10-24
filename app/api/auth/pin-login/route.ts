import { assertSameOrigin, handle, HttpError, ipHash, readJson, supabaseAsUser, supabaseService } from '@/lib/cloud/server';
import { checkUsername, normaliseUsername } from '@/lib/cloud/validate';
import { notifyAdmin } from '@/lib/cloud/notify';

export const dynamic = 'force-dynamic';

const GENERIC = 'Username or PIN is not correct, or the account is not active.';

// Username + 6-digit PIN sign-in. The PIN is the account's Supabase password; the database decides
// whether the username may be tried (lockout) and records every attempt. The session cookies are set
// on this response, so the PIN never travels anywhere but here.
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const b = await readJson<{ username?: string; pin?: string }>(req, 1024);
  const username = normaliseUsername(b.username ?? '');
  const pin = String(b.pin ?? '');
  if (!checkUsername(username) || !/^\d{6}$/.test(pin)) throw new HttpError(401, GENERIC);
  const ip = ipHash(req);
  const svc = supabaseService();

  const { data: begin, error: beginErr } = await svc.rpc('pin_login_begin', { p_username: username, p_ip_hash: ip });
  if (beginErr) throw new HttpError(503, 'Sign-in is unavailable right now. Try again shortly.');
  const g = (Array.isArray(begin) ? begin[0] : begin) as { allowed: boolean; email: string | null; error: string } | undefined;
  if (!g?.allowed) throw new HttpError(429, g?.error ?? 'Too many attempts. Try again later.');

  let ok = false;
  if (g.email) {
    const { error } = await supabaseAsUser().auth.signInWithPassword({ email: g.email, password: pin });
    ok = !error;
  }
  const { data: outcome } = await svc.rpc('pin_login_finish', { p_username: username, p_ip_hash: ip, p_ok: ok });
  if (ok) return Response.json({ ok: true });
  if (outcome === 'locked_15' || outcome === 'locked_admin') {
    void notifyAdmin(
      outcome === 'locked_admin' ? `NEAS: account locked (${username})` : `NEAS: repeated wrong PINs (${username})`,
      outcome === 'locked_admin'
        ? `The username "${username}" had 10 wrong PINs in 24 hours and is now locked. If this was the person, unlock it in Control panel → User directory. If not, treat it as an attack and contact them.`
        : `The username "${username}" had 5 wrong PINs in 15 minutes and is paused for 15 minutes.`,
      `pin-lock:${username}:${outcome}:${new Date().toISOString().slice(0, 13)}`,
    );
    throw new HttpError(429, outcome === 'locked_admin' ? 'This account is locked after repeated wrong PINs. Ask your NEAS administrator to unlock it.' : 'Too many wrong PINs. Try again in 15 minutes.');
  }
  throw new HttpError(401, GENERIC);
});
