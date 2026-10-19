'use client';
import { useEffect, useState } from 'react';
import { getPhoto } from '@/lib/photos';

/** Shows a photo stored on this device (IndexedDB) by evidence id. */
export default function PhotoThumb({ id, alt, className }: { id: string; alt: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let u: string | null = null;
    setUrl(null);
    setMissing(false);
    getPhoto(id)
      .then((b) => {
        if (!b) return setMissing(true);
        u = URL.createObjectURL(b);
        setUrl(u);
      })
      .catch(() => setMissing(true));
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [id]);
  if (missing) return <div className={`thumb-missing ${className ?? ''}`}>Photo not on this device</div>;
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img className={className} src={url} alt={alt} /> : <div className={`thumb-loading ${className ?? ''}`} />;
}
