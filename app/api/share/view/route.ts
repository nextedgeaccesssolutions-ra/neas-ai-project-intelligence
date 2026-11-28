import { handle, HttpError, readJson, supabaseService } from '@/lib/cloud/server';
import { FILES_BUCKET } from '@/lib/cloud/env';
import { buildClientView, todayIn, type SnapshotInput } from '@/lib/cloud/clientView';

export const dynamic = 'force-dynamic';

// Opens a shared report link. The token travels in the request body (the page reads it from the
// URL fragment), so it never appears in server logs or Referer headers. The database checks the
// token, expiry and revocation on every open.
export const POST = handle(async (req) => {
  const { token } = await readJson<{ token?: string }>(req, 1024);
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) throw new HttpError(404, 'This link is not valid');
  const svc = supabaseService();
  const { data, error } = await svc.rpc('share_snapshot', { p_token: token });
  if (error || !data) {
    const msg = error?.code === 'P0401' ? error.message : 'This link cannot be opened right now. Try again later.';
    throw new HttpError(error?.code === 'P0401' ? 410 : 503, msg);
  }
  const snap = data as SnapshotInput & { share_expires_at: string };
  const paths = (snap.files ?? []).map((f) => f.storage_path);
  const signed: Record<string, string> = {};
  if (paths.length) {
    const { data: urls } = await svc.storage.from(FILES_BUCKET).createSignedUrls(paths, 600);
    for (const u of urls ?? []) if (u.path && u.signedUrl) signed[u.path] = u.signedUrl;
  }
  const view = buildClientView({ ...snap, session_expires_at: snap.share_expires_at }, todayIn(process.env.APP_TIMEZONE || 'Asia/Manila'), signed);
  return Response.json(view, { headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } });
});
