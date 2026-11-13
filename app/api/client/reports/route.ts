import { cookies } from 'next/headers';
import { assertSameOrigin, handle, HttpError, readJson, supabaseService } from '@/lib/cloud/server';
import { FILES_BUCKET } from '@/lib/cloud/env';
import { normaliseProjectCode, UUID_RE } from '@/lib/cloud/validate';

export const dynamic = 'force-dynamic';

export interface ClientReport {
  id: string; report_ref: string; period_from: string | null; period_to: string | null; generated_at: string; sent_at: string;
  status: 'pending' | 'approved' | 'changes_requested'; sha256: string; url: string | null;
  review: { name: string; decision: string; comment: string; at: string } | null;
}

function session(code: string) {
  const [cookieCode, token] = (cookies().get('neas_client')?.value ?? '').split('.');
  if (!token || cookieCode !== normaliseProjectCode(code)) throw new HttpError(401, 'Your viewing session has ended. Sign in again.');
  return token;
}

// Reports sent to this client for review, each with a short-lived link to the exact file.
export const GET = handle(async (req) => {
  const token = session(new URL(req.url).searchParams.get('code') ?? '');
  const svc = supabaseService();
  const { data, error } = await svc.rpc('client_reports', { p_token: token });
  if (error) throw new HttpError(401, 'Your viewing session has ended. Sign in again.');
  const rows = (data ?? []) as (Omit<ClientReport, 'url'> & { file_path: string })[];
  const { data: urls } = rows.length ? await svc.storage.from(FILES_BUCKET).createSignedUrls(rows.map((r) => r.file_path), 900) : { data: [] };
  return Response.json(rows.map(({ file_path: _p, ...r }, i) => ({ ...r, url: urls?.[i]?.signedUrl ?? null })));
});

// Approve or request changes on one report. The fingerprint ties the decision to the file shown.
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const b = await readJson<{ code?: string; exportId?: string; decision?: string; name?: string; comment?: string; sha256?: string }>(req, 8192);
  const token = session(b.code ?? '');
  if (!UUID_RE.test(b.exportId ?? '')) throw new HttpError(400, 'Invalid report');
  const { data, error } = await supabaseService().rpc('client_review_report', {
    p_token: token, p_export: b.exportId, p_decision: b.decision ?? '', p_name: (b.name ?? '').slice(0, 120), p_comment: (b.comment ?? '').slice(0, 2000), p_sha256: b.sha256 ?? '',
  });
  if (error) throw new HttpError(error.code === 'P0401' ? 401 : 400, error.code === 'P0401' ? 'Your viewing session has ended. Sign in again.' : error.message);
  return Response.json({ ok: true, decision: data });
});
