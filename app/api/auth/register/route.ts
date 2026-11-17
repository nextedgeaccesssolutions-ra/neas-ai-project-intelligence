import { createClient } from '@supabase/supabase-js';
import { appUrl, assertSameOrigin, handle, HttpError, readJson } from '@/lib/cloud/server';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/cloud/env';
import { checkEmail, checkName } from '@/lib/cloud/validate';
import { notifyAdmin } from '@/lib/cloud/notify';

export const dynamic = 'force-dynamic';

// Registration step 1: name + e-mail. Supabase sends a single-use verification link; the
// database trigger creates a PENDING profile that a Super Admin must approve. The response is
// identical whether or not the address is already registered (no account enumeration).
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const body = await readJson<{ fullName?: string; email?: string; website?: string }>(req, 4096);
  if (body.website) return Response.json({ ok: true }); // honeypot field filled by bots
  const n = checkName(body.fullName ?? '');
  if (!n.ok) throw new HttpError(400, n.error);
  const e = checkEmail(body.email ?? '');
  if (!e.ok) throw new HttpError(400, e.error);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new HttpError(503, 'Registration is not available yet.');
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { error } = await anon.auth.signInWithOtp({
    email: e.email,
    options: { shouldCreateUser: true, data: { full_name: n.name }, emailRedirectTo: `${appUrl(req)}/auth/callback?next=/account` },
  });
  if (error && /rate|too many/i.test(error.message)) throw new HttpError(429, 'Too many requests. Try again in a few minutes.');
  if (!error) {
    // tell the administrator; deduplicated per address for an hour so the form cannot spam the inbox
    await notifyAdmin(
      'NEAS: new account request waiting for approval',
      `${n.name} <${e.email}> asked for an account on NEAS Project Control.\n\nThey must verify their e-mail first. Then review the request in Control panel → Pending approvals:\n${appUrl(req)}/admin#approvals\n\nOnly approve people you know work with NEAS.`,
      e.email,
    );
  }
  return Response.json({ ok: true, message: 'Check your inbox for a verification link. After you verify, an administrator will review your request.' });
});
