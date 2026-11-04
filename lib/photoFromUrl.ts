// Turns a pasted image link into a File for the normal photo path (compression, local save, sync). The app server
// fetches it, because most websites do not let a browser read their images directly.
const fromLink = new WeakSet<File>();

/** A photo that came from a link: only the GPS saved inside the image is used, never this device's position. */
export const isLinkPhoto = (f: File) => fromLink.has(f);

export async function photoFromUrl(url: string): Promise<File> {
  const res = await fetch('/api/photos/from-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) })
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
