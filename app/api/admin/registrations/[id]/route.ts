import { createClient } from '@supabase/supabase-js';
import { appUrl, assertSameOrigin, handle, HttpError, readJson, requireSuperAdmin, supabaseService } from '@/lib/cloud/server';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/cloud/env';
import { UUID_RE } from '@/lib/cloud/validate';

export const dynamic = 'force-dynamic';

// Approve or reject a pending registration. On approval the user receives a single-use,
// time-limited link to set their own password (the administrator never sees or sets it).
export const POST = handle(async (req, { params }) => {
  assertSameOrigin(req);
  if (!UUID_RE.test(params.id)) throw new HttpError(400, 'Invalid user id');
  const { sb } = await requireSuperAdmin();
  const body = await readJson<{ action: 'approve' | 'reject'; reason?: string; silent?: boolean }>(req, 4096);
  if (body.action !== 'approve' && body.action !== 'reject') throw new HttpError(400, 'Unknown action');
  const { error } = await sb.rpc('admin_review_registration', { p_user: params.id, p_approve: body.action === 'approve', p_reason: body.reason?.slice(0, 500) ?? null });
  if (error) throw new HttpError(400, error.message);
  // silent: the administrator will hand over a one-time code instead of an e-mailed link
  if (body.action === 'approve' && !body.silent) {
    const { data: p } = await sb.from('profiles').select('email').eq('id', params.id).single();
    if (p?.email) {
      const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
      await anon.auth.resetPasswordForEmail(p.email, { redirectTo: `${appUrl(req)}/auth/callback?next=/auth/setup-password` });
      await supabaseService().from('profiles').update({ password_reset_requested_at: new Date().toISOString() }).eq('id', params.id);
    }
  }
  return Response.json({ ok: true });
});
