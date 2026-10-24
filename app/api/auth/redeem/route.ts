import { assertSameOrigin, handle, HttpError, ipHash, readJson, supabaseService } from '@/lib/cloud/server';
import { checkEmail, checkPassword, checkPin, checkUsername, normaliseUsername } from '@/lib/cloud/validate';
import { pinPassword } from '@/lib/cloud/pin';

export const dynamic = 'force-dynamic';

// Account activation with a one-time code handed over by the administrator.
// The code is checked (and used up) in the database; then the person's own PIN (or, for e-mail
// sign-in, password) is set. The administrator never sees or chooses it. One generic message for every failure.
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const body = await readJson<{ email?: string; username?: string; code?: string; password?: string; pin?: string }>(req, 2048);
  const code = (body.code ?? '').slice(0, 40);
  const usingPin = body.pin !== undefined;
  const svc = supabaseService();

  let email: string | null = null;
  if (usingPin) {
    const u = normaliseUsername(body.username ?? '');
    if (!checkUsername(u) || code.replace(/[^A-Za-z0-9]/g, '').length !== 12) throw new HttpError(400, 'Enter your username and the 12-character code from your administrator.');
    const bad = checkPin(body.pin ?? '');
    if (bad) throw new HttpError(400, bad);
    const { data } = await svc.from('profiles').select('email').eq('username', u).maybeSingle();
    // an unknown username goes through the same check (and the same attempt counter) with a placeholder
    email = (data?.email as string | undefined) ?? `unknown+${u}@invalid.neas`;
  } else {
    const e = checkEmail(body.email ?? '');
    if (!e.ok || code.replace(/[^A-Za-z0-9]/g, '').length !== 12) throw new HttpError(400, 'Enter your e-mail and the 12-character code from your administrator.');
    const problems = checkPassword(body.password ?? '');
    if (problems.length) throw new HttpError(400, `Use ${problems.join('; ')}.`);
    email = e.email;
  }

  const { data, error } = await svc.rpc('redeem_setup_code', { p_email: email, p_code: code, p_ip_hash: ipHash(req) });
  if (error) throw new HttpError(500, 'Activation is unavailable right now.');
  const row = (Array.isArray(data) ? data[0] : data) as { ok: boolean; error: string | null; user_id: string | null } | undefined;
  const generic = usingPin ? 'Username or code is not valid, or the code has expired.' : 'E-mail or code is not valid, or the code has expired.';
  if (!row?.ok || !row.user_id) throw new HttpError(row?.error?.startsWith('Too many') ? 429 : 401, row?.error?.startsWith('Too many') ? row.error : generic);

  // a PIN is stored as a long password derived on the server (lib/cloud/pin.ts), never as the 6 digits
  const { error: upd } = await svc.auth.admin.updateUserById(row.user_id, { password: usingPin ? pinPassword(row.user_id, body.pin!) : body.password!, email_confirm: true });
  if (upd) throw new HttpError(500, 'Your code was accepted but it could not be saved. Ask your administrator for a new code.');
  if (usingPin) {
    // a new PIN starts with a clean slate: clear the lock and the earlier wrong attempts
    await svc.from('profiles').update({ pin_locked_at: null }).eq('id', row.user_id);
    await svc.from('pin_login_attempts').delete().eq('username', normaliseUsername(body.username ?? '')).eq('ok', false);
  }
  return Response.json({ ok: true });
});
