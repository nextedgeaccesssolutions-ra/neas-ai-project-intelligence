// Turns a pasted image link into a File for the normal photo path (compression, local save, sync). The app server
// fetches it, because most websites do not let a browser read their images directly.
const fromLink = new WeakSet<File>();

/** A photo that came from a link: only the GPS saved inside the image is used, never this device's position. */
export const isLinkPhoto = (f: File) => fromLink.has(f);

export async function photoFromUrl(url: string): Promise<File> {
  // "Copy image address" on Google Images and similar often gives the picture itself (data:image/...;base64,...).
  // Read that here in the browser: it is already the photo, and it is too big to send to the server.
  const raw = url.trim();
  if (/^data:/i.test(raw)) {
    const m = /^data:(image\/[\w.+-]+)(;[^,]*)?,/i.exec(raw);
    if (!m) throw new Error('That link is not an image. Copy the image itself, or its https:// address.');
    const blob = await (await fetch(raw)).blob().catch(() => { throw new Error('That pasted image could not be read.'); });
    if (blob.size > 20 * 1024 * 1024) throw new Error('That image is over 20 MB.');
    const ext = m[1].split('/')[1].replace('jpeg', 'jpg').replace(/\+.*/, '');
    const file = new File([blob], `photo-from-link.${ext}`, { type: m[1].toLowerCase(), lastModified: Date.now() });
    fromLink.add(file);
    return file;
  }
  const res =await fetch('/api/photos/from-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) })
    .catch(() => { throw new Error('No connection: adding a photo from a link needs internet.'); });
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(j?.error ?? `The photo could not be fetched (${res.status}).`);
  }
  const blob = await res.blob();
  const file = new File([blob], res.headers.get('X-File-Name') || 'photo-from-link', { type: blob.type, lastModified: Date.now() });
  fromLink.add(file);
  return file;
}

/** Paste handler for the photo link box: a copied picture (Messenger, Facebook, any inbox → "Copy image") is put in
 *  the box as a data: link, which photoFromUrl reads here in the browser. Plain text pastes are left alone. */
export function onPhotoPaste(e: { clipboardData: DataTransfer; preventDefault(): void }, set: (v: string) => void) {
  const f = Array.from(e.clipboardData?.files ?? []).find((x) => x.type.startsWith('image/'));
  if (!f) return;
  e.preventDefault();
  const r = new FileReader();
  r.onload = () => set(String(r.result));
  r.readAsDataURL(f);
}
