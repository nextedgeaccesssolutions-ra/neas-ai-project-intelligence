'use client';
// Scan a QR code with the phone camera (where the browser can read QR codes) or type the code.
// A project code, or a link that contains one, opens that project; other links are shown, not followed.
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/lib/store';
import { notify } from '@/components/Dialogs';

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };

export default function Scan() {
  const { state, setActiveProject } = useStore();
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [running, setRunning] = useState(false);
  const [typed, setTyped] = useState('');
  const [found, setFound] = useState<string | null>(null);

  useEffect(() => { setSupported('BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia); }, []);

  const open = (text: string) => {
    const t = text.trim().toUpperCase();
    // whole codes only: the text itself, or one part of a link (…/client/CODE, ?project=CODE)
    const tokens = new Set([t, ...t.split(/[\/?&=#\s]+/).filter(Boolean)]);
    const p = state.projects.find((x) => [x.code, x.referenceNo, x.id].filter(Boolean).some((c) => tokens.has(String(c).toUpperCase())));
    if (p) { setActiveProject(p.id); notify(`Opened ${p.code ?? p.name}.`); router.push('/'); return; }
    setFound(t);
  };

  useEffect(() => {
    if (!running) return;
    let stream: MediaStream | null = null, stop = false;
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        // stopped or left while the camera permission was being asked: release the camera
        if (stop || !video.current) { stream.getTracks().forEach((t) => t.stop()); return; }
        video.current.srcObject = stream;
        await video.current.play();
        const det = new (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => Detector }).BarcodeDetector({ formats: ['qr_code'] });
        while (!stop) {
          const codes = await det.detect(video.current).catch(() => []);
          if (codes[0]?.rawValue) { stop = true; setRunning(false); open(codes[0].rawValue); break; }
          await new Promise((r) => setTimeout(r, 300));
        }
      } catch { notify('The camera could not be opened. Allow camera access, or type the code.'); setRunning(false); }
    })();
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="page-head"><div><div className="eyebrow">Field operations</div><h1>Scan QR code</h1><p className="lead">Scan a project QR code to open that project.</p></div></div>
      <section className="card fr-card">
        {supported === false && <p className="note">This browser cannot read QR codes from the camera. Use the phone&apos;s camera app to scan, or type the project code below.</p>}
        {supported && (running
          ? <><video ref={video} playsInline muted className="scan-video" /><button className="btn" onClick={() => setRunning(false)}>Stop</button></>
          : <button className="btn btn-primary" onClick={() => setRunning(true)}>Start camera</button>)}
        <form className="form-actions" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) open(typed); }}>
          <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Project code, e.g. NEAS-0027-3-26" aria-label="Project code" />
          <button className="btn">Open</button>
        </form>
        {found && <p className="note">No project of yours matches “{found}”. If it is a link, check it before opening it.</p>}
      </section>
    </>
  );
}
