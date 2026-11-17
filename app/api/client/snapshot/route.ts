import { cookies } from 'next/headers';
import { handle, HttpError, supabaseService } from '@/lib/cloud/server';
import { FILES_BUCKET } from '@/lib/cloud/env';
import { buildClientView, todayIn, type SnapshotInput } from '@/lib/cloud/clientView';
import { normaliseProjectCode } from '@/lib/cloud/validate';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  const code = normaliseProjectCode(new URL(req.url).searchParams.get('code') ?? '');
  const raw = cookies().get('neas_client')?.value ?? '';
  const [cookieCode, token] = raw.split('.');
  if (!token || cookieCode !== code) throw new HttpError(401, 'Enter the passcode to view this project.');
  const svc = supabaseService();
  const { data, error } = await svc.rpc('client_snapshot', { p_token: token });
  if (error || !data) {
    cookies().delete('neas_client');
    throw new HttpError(401, 'Your viewing session has ended. Enter the passcode again.');
  }
  const snap = data as SnapshotInput;
  const paths = (snap.files ?? []).map((f) => f.storage_path);
  const signed: Record<string, string> = {};
  if (paths.length) {
    const { data: urls } = await svc.storage.from(FILES_BUCKET).createSignedUrls(paths, 600);
    for (const u of urls ?? []) if (u.path && u.signedUrl) signed[u.path] = u.signedUrl;
  }
  const view = buildClientView(snap, todayIn(process.env.APP_TIMEZONE || 'Asia/Manila'), signed);
  return Response.json(view, { headers: { 'Cache-Control': 'private, no-store' } });
});
