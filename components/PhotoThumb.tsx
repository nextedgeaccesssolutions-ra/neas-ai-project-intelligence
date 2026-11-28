'use client';
import { useEffect, useState } from 'react';
import { getPhoto, putPhoto } from '@/lib/photos';
import { CLOUD, FILES_BUCKET } from '@/lib/cloud/env';
import { supabaseBrowser } from '@/lib/cloud/browser';

/** Fetches a synced photo from private storage (short-lived signed URL) and keeps a copy on this device. */
export async function fetchFromServer(id: string, storagePath: string): Promise<Blob | null> {
  const sb = supabaseBrowser();
  if (!sb) return null;
  const { data, error } = await sb.storage.from(FILES_BUCKET).createSignedUrl(storagePath, 300);
  if (error || !data?.signedUrl) return null;
  const r = await fetch(data.signedUrl);
  if (!r.ok) return null;
  const blob = await r.blob();
  await putPhoto(id, blob).catch(() => undefined);
  return blob;
}

/** Shows a photo by evidence id: from this device first, otherwise from the server once it has synced. */
export default function PhotoThumb({ id, alt, className, storagePath }: { id: string; alt: string; className?: string; storagePath?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let u: string | null = null;
    let alive = true;
    setUrl(null);
    setMissing(false);
    (async () => {
      let b = await getPhoto(id).catch(() => undefined);
      if (!b && CLOUD && storagePath) b = (await fetchFromServer(id, storagePath).catch(() => null)) ?? undefined;
      if (!alive) return;
      if (!b) return setMissing(true);
      u = URL.createObjectURL(b);
      setUrl(u);
    })();
    return () => { alive = false; if (u) URL.revokeObjectURL(u); };
  }, [id, storagePath]);
  if (missing) return <div className={`thumb-missing ${className ?? ''}`}>{CLOUD && storagePath ? 'Photo not synced yet' : 'Photo not on this device'}</div>;
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img className={className} src={url} alt={alt} /> : <div className={`thumb-loading ${className ?? ''}`} />;
}
