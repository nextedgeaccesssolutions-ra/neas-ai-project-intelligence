import { assertSameOrigin, handle, HttpError, requireUser, supabaseService, readJson } from '@/lib/cloud/server';
import { checkPin } from '@/lib/cloud/validate';
import { pinPassword } from '@/lib/cloud/pin';

export const dynamic = 'force-dynamic';

// A password-recovery e-mail establishes the session first. Only that authenticated,
// active account may replace its own PIN; no username or account lookup is exposed.
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const body = await readJson<{ pin?: string; confirmPin?: string }>(req, 1024);
  const pin = String(body.pin ?? '');
  const confirmPin = String(body.confirmPin ?? '');
  const problem = checkPin(pin);
  if (problem) throw new HttpError(400, problem);
  if (pin !== confirmPin) throw new HttpError(400, 'The two PINs do not match.');

  const { user } = await requireUser();
  const svc = supabaseService();
  const { data: profile, error: profileError } = await svc
    .from('profiles')
    .select('username, status, email_verified_at')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError) throw new HttpError(503, 'Could not verify your account. Try again shortly.');
  if (!profile || profile.status !== 'active' || !profile.email_verified_at) {
    throw new HttpError(403, 'Only active, e-mail-verified NEAS accounts can reset a PIN.');
  }
  if (!profile.username) throw new HttpError(409, 'No username is assigned to this account. Contact your NEAS administrator.');

  // Clear failed attempts before changing the credential. If cleanup fails, the existing PIN
  // remains valid and the user can safely retry this recovery flow.
  const { error: unlockError } = await svc.from('profiles').update({ pin_locked_at: null }).eq('id', user.id);
  const { error: attemptsError } = await svc.from('pin_login_attempts')
    .delete()
    .eq('username', profile.username)
    .eq('ok', false);
  if (unlockError || attemptsError) {
    throw new HttpError(503, 'The sign-in lock could not be cleared. Request a new recovery link and try again.');
  }

  const { error: passwordError } = await svc.auth.admin.updateUserById(user.id, {
    password: pinPassword(user.id, pin),
  });
  if (passwordError) throw new HttpError(503, 'Your PIN could not be saved. Request a new recovery link and try again.');

  return Response.json({ ok: true, username: profile.username });
});
