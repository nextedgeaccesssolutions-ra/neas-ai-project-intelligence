import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { directImageUrl as direct, isPrivateIp as privateIp } from '@/lib/photoUrlSafety';
import { assertSameOrigin, handle, HttpError, readJson, requireUser } from '@/lib/cloud/server';

// Fetches a photo from a web link for Site evidence / Field reports (most sites block the browser from reading their
// images directly). Signed-in users only; public https/http addresses only, so the server cannot be pointed at its own
// network; images only, at most 20 MB, every redirect checked again.
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX_BYTES = 20 * 1024 * 1024;

async function safeUrl(raw: string): Promise<URL> {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new HttpError(400, 'That is not a valid link. It should start with https://'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new HttpError(400, 'Only https:// or http:// links can be used.');
  if (u.username || u.password) throw new HttpError(400, 'Links with a user name or password cannot be used.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addrs.length) throw new HttpError(400, 'That website could not be found.');
  if (addrs.some(privateIp)) throw new HttpError(400, 'That link points to a private network address.');
  return u;
}

export const POST = handle(async (req) => {
  assertSameOrigin(req);
  await requireUser();
  const b = await readJson<{ url?: string }>(req, 4096);
  let url = direct(await safeUrl(String(b.url ?? '')));
  let res: Response | null = null;
  for (let hop = 0; hop < 4; hop++) {
    await safeUrl(url.toString());
    res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20000), headers: { Accept: 'image/*', 'User-Agent': 'NEAS-Project-Control/1.0 (photo import)' } })
      .catch(() => { throw new HttpError(502, 'The website did not answer. Check the link and try again.'); });
    const next = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!next) break;
    url = new URL(next, url);
  }
  if (!res || !res.ok) throw new HttpError(400, `The website refused the photo (${res?.status ?? 'no answer'}). Use a direct, public image link.`);
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!type.startsWith('image/')) throw new HttpError(400, 'That link is a web page, not an image. Open the image itself and copy its address.');
  if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) throw new HttpError(400, 'That image is over 20 MB.');
  const reader = res.body?.getReader();
  if (!reader) throw new HttpError(400, 'The image could not be read.');
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) { await reader.cancel(); throw new HttpError(400, 'That image is over 20 MB.'); }
    parts.push(value);
  }
  const name = decodeURIComponent(url.pathname.split('/').pop() || '').replace(/[^\w.\- ]+/g, '').slice(0, 80) || 'photo-from-link';
  return new Response(Buffer.concat(parts), { headers: { 'Content-Type': type, 'X-File-Name': name, 'Cache-Control': 'no-store' } });
});
