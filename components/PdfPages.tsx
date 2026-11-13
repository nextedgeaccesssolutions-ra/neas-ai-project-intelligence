'use client';
// A PDF shown as page images. Phone browsers (Chrome on Android, many in-app browsers) cannot show a PDF
// inside a page and show only a file name and an "Open" button, so the pages are drawn here instead.
import { useEffect, useState } from 'react';

/** True when this browser can show a PDF inside the page (desktop browsers with a PDF viewer). */
export const inlinePdfWorks = () =>
  typeof navigator !== 'undefined' && (navigator as Navigator & { pdfViewerEnabled?: boolean }).pdfViewerEnabled !== false
  && !/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);

export default function PdfPages({ blob, title }: { blob: Blob; title: string }) {
  const [pages, setPages] = useState<string[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let stop = false;
    const urls: string[] = [];
    setPages([]); setTotal(null); setErr(null);
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf');
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
        if (stop) return;
        setTotal(doc.numPages);
        for (let n = 1; n <= doc.numPages && !stop; n++) {
          const page = await doc.getPage(n);
          // sharp enough to read on a phone, small enough to stay light
          const vp = page.getViewport({ scale: Math.min(2, 1100 / page.getViewport({ scale: 1 }).width) });
          const c = document.createElement('canvas');
          c.width = vp.width; c.height = vp.height;
          await page.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise;
          const b = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.85));
          if (!b || stop) break;
          const u = URL.createObjectURL(b);
          urls.push(u);
          setPages((p) => [...p, u]);
        }
      } catch (e) { if (!stop) setErr((e as Error).message); }
    })();
    return () => { stop = true; urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, [blob]);
  if (err) return <p className="bad">The preview could not be drawn ({err}). Use Download PDF instead.</p>;
  return (
    <div className="pdf-pages" aria-label={title}>
      {pages.map((u, i) => <img key={u} src={u} alt={`${title}, page ${i + 1}`} />)}
      {(total == null || pages.length < total) && <p className="note">Drawing page {pages.length + 1}{total ? ` of ${total}` : ''}…</p>}
    </div>
  );
}
