'use client';
// Generate the project report PDF: preview it in the page or download it.
import { useEffect, useState } from 'react';
import { buildProjectReport, type ProjectReport, type ProjectReportInput } from '@/lib/projectReport';
import type { LoadImage } from '@/lib/projectReportPdf';
import { saveFile } from '@/lib/fileio';

export default function ProjectReportPanel({ input, load, onGenerated, onSend, note }: {
  /** builds the report input at generation time (reporting cut-off, current records) */
  input: (asOf: string, from: string | null) => ProjectReportInput;
  load: LoadImage;
  onGenerated?: (r: ProjectReport) => void | Promise<void>;
  /** send exactly the previewed file to the project's clients for review */
  onSend?: (blob: Blob, r: ProjectReport) => Promise<string>;
  note?: string;
}) {
  const today = new Date().toLocaleDateString('en-CA');
  const [asOf, setAsOf] = useState(today);
  const [from, setFrom] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<{ url: string; blob: Blob; name: string; report: ProjectReport } | null>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  const make = async (): Promise<{ blob: Blob; report: ProjectReport } | null> => {
    setMsg(null);
    try {
      const report = buildProjectReport(input(asOf || today, from || null));
      setBusy('Loading logo and photos…');
      const { loadLogo, loadReportImages, projectReportPdf } = await import('@/lib/projectReportPdf');
      const [logo, images] = await Promise.all([loadLogo(), loadReportImages(report, load, (d, n) => setBusy(`Preparing photos ${d} of ${n}…`))]);
      if (!logo) throw new Error('The official NEAS logo could not be loaded, so the report was not generated.');
      setBusy('Building PDF…');
      const blob = await projectReportPdf(report, images, logo);
      const { validateMapLinks } = await import('@/lib/evidenceExport');
      const expected = [...report.cover.map((c) => c.mapUrl), ...report.evidence.map((e) => e.mapUrl)].filter((u): u is string => !!u);
      const check = await validateMapLinks('pdf', blob, expected);
      if (!check.ok) throw new Error(`Report check failed: ${check.missing.length} of ${expected.length} map link(s) are missing from the PDF, so it was not offered.`);
      const missing = [...images.values()].filter((x) => !x).length;
      await onGenerated?.(report);
      setMsg({ ok: true, text: `${report.reference}: cover with ${Math.min(2, report.cover.length)} of ${report.cover.length} cover photo(s), location register, schedule, ${report.evidence.length} evidence photo(s), observations and summary; ${check.found} clickable map link(s) checked.${missing ? ` ${missing} photo(s) could not be loaded and are marked “Photo not available”.` : ''}` });
      return { blob, report };
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message || 'Could not build the report.' });
      return null;
    } finally {
      setBusy(null);
    }
  };

  const doPreview = async () => {
    const r = await make();
    if (r) setPreview({ url: URL.createObjectURL(r.blob), blob: r.blob, name: `${r.report.fileName}.pdf`, report: r.report });
  };
  const doSend = async () => {
    if (!preview || !onSend) return;
    setBusy('Sending to client…');
    try { setMsg({ ok: true, text: await onSend(preview.blob, preview.report) }); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(null); }
  };
  const doDownload = async () => {
    const r = preview ?? await make().then((x) => (x ? { blob: x.blob, name: `${x.report.fileName}.pdf`, url: '' } : null));
    if (!r) return;
    const res = await saveFile(r.name, r.blob);
    if (res === 'declined') setMsg({ ok: false, text: 'Download cancelled.' });
  };

  return (
    <section className="card" id="project-report">
      <div className="card-head">
        <h2>Project report (PDF)</h2>
        <span className="note">Official NEAS logo, cover photos at 9.21 cm, schedule, evidence and summary</span>
      </div>
      <div className="form-grid">
        <label className="field">Reporting cut-off<input className="input" type="date" value={asOf} max={today} onChange={(e) => { setAsOf(e.target.value); setPreview(null); }} /></label>
        <label className="field">Period from (optional)<input className="input" type="date" value={from} max={asOf || today} onChange={(e) => { setFrom(e.target.value); setPreview(null); }} /></label>
      </div>
      <div className="form-actions">
        <button className="btn" onClick={doPreview} disabled={!!busy}>{busy ?? 'Preview'}</button>
        <button className="btn btn-primary" onClick={doDownload} disabled={!!busy}>Download PDF</button>
      </div>
      {note && <p className="note">{note}</p>}
      {msg && <p className={msg.ok ? 'ok' : 'bad'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}
      {preview && (
        <div style={{ marginTop: 12 }}>
          <div className="form-actions" style={{ marginTop: 0 }}>
            <span className="note">Preview of {preview.name}</span>
            {onSend && <button className="btn btn-sm btn-primary" onClick={doSend} disabled={!!busy} title="The client sees exactly this file and can approve it or request changes">Send this report to the client for review</button>}
            <button className="btn btn-sm" onClick={() => setPreview(null)}>Close preview</button>
          </div>
          <iframe title="Project report preview" src={preview.url} style={{ width: '100%', height: '80vh', border: '1px solid var(--line)', borderRadius: 10 }} />
        </div>
      )}
    </section>
  );
}
