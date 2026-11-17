import { cookies } from 'next/headers';
import { assertSameOrigin, handle, HttpError, ipHash, readJson, supabaseService } from '@/lib/cloud/server';
import { normaliseProjectCode, PROJECT_CODE_RE } from '@/lib/cloud/validate';

export const dynamic = 'force-dynamic';
const CLIENT_COOKIE = 'neas_client';

// Passcode sign-in for the client portal. Validation, throttling and session issue happen in
// the database (service role); the browser only gets an HttpOnly cookie, never a Supabase key.
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const body = await readJson<{ code?: string; passcode?: string }>(req, 1024);
  const code = normaliseProjectCode(body.code ?? '');
  const passcode = (body.passcode ?? '').slice(0, 64);
  if (!PROJECT_CODE_RE.test(code) || passcode.replace(/[^A-Za-z0-9]/g, '').length < 8) throw new HttpError(400, 'Enter the project code and passcode you were given.');
  const { data, error } = await supabaseService().rpc('client_login', {
    p_code: code,
    p_passcode: passcode,
    p_ip_hash: ipHash(req),
    p_user_agent: req.headers.get('user-agent')?.slice(0, 300) ?? null,
  });
  if (error) throw new HttpError(500, 'Sign-in is unavailable right now.');
  const row = (Array.isArray(data) ? data[0] : data) as { ok: boolean; error: string | null; session_token: string | null; expires_at: string | null } | undefined;
  if (!row?.ok || !row.session_token) {
    const throttled = row?.error?.startsWith('Too many');
    throw new HttpError(throttled ? 429 : 401, row?.error ?? 'Invalid project code or passcode');
  }
  cookies().set(CLIENT_COOKIE, `${code}.${row.session_token}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    expires: row.expires_at ? new Date(row.expires_at) : undefined,
  });
  return Response.json({ ok: true, expiresAt: row.expires_at });
});
