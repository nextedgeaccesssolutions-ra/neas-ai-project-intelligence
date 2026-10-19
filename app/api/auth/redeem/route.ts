import { assertSameOrigin, handle, HttpError, ipHash, readJson, supabaseService } from '@/lib/cloud/server';
import { checkEmail, checkPassword } from '@/lib/cloud/validate';

export const dynamic = 'force-dynamic';

// Account activation with a one-time code handed over by the administrator.
// The code is checked (and used up) in the database; then the person's own password is set.
// The administrator never sees or chooses the password. One generic message for every failure.
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const body = await readJson<{ email?: string; code?: string; password?: string }>(req, 2048);
  const e = checkEmail(body.email ?? '');
  const code = (body.code ?? '').slice(0, 40);
  if (!e.ok || code.replace(/[^A-Za-z0-9]/g, '').length !== 12) throw new HttpError(400, 'Enter your e-mail and the 12-character code from your administrator.');
  const problems = checkPassword(body.password ?? '');
  if (problems.length) throw new HttpError(400, `Use ${problems.join('; ')}.`);

  const svc = supabaseService();
  const { data, error } = await svc.rpc('redeem_setup_code', { p_email: e.email, p_code: code, p_ip_hash: ipHash(req) });
  if (error) throw new HttpError(500, 'Activation is unavailable right now.');
  const row = (Array.isArray(data) ? data[0] : data) as { ok: boolean; error: string | null; user_id: string | null } | undefined;
  if (!row?.ok || !row.user_id) throw new HttpError(row?.error?.startsWith('Too many') ? 429 : 401, row?.error ?? 'E-mail or code is not valid, or the code has expired.');

  const { error: upd } = await svc.auth.admin.updateUserById(row.user_id, { password: body.password!, email_confirm: true });
  if (upd) throw new HttpError(500, 'Your code was accepted but the password could not be saved. Ask your administrator for a new code.');
  return Response.json({ ok: true });
});
