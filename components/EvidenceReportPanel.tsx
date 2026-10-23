'use client';
// Export a Site Evidence report: title page with the full project details, photos in a 2 × 4 or
// 2 × 6 layout, then the summary. Same report in PDF, PowerPoint and Word.
import { useState } from 'react';
import { buildReport, REPORT_KINDS, type ReportAudience, type ReportKind, type ReportLayout, type ReportPhoto, type ReportProject } from '@/lib/evidenceReport';
import type { LoadPhoto, ReportFormat } from '@/lib/evidenceExport';

export default function EvidenceReportPanel({ project, photos, load, audience, preparedBy, datesAre = 'captured' }: {
  project: ReportProject; photos: ReportPhoto[]; load: LoadPhoto; audience: ReportAudience; preparedBy: string; datesAre?: 'captured' | 'uploaded';
}) {
  const [kind, setKind] = useState<ReportKind>('site_evidence');
  const [layout, setLayout] = useState<ReportLayout>('2x4');
  const [format, setFormat] = useState<ReportFormat>('pdf');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async () => {
    setMsg(null);
    try {
      const report = buildReport({ kind, layout, audience, project, photos, preparedBy, generatedAt: new Date(), from: from || undefined, to: to || undefined, datesAre });
      setBusy(`Preparing ${report.photos.length} photo(s)…`);
      const { exportReport, loadImages } = await import('@/lib/evidenceExport');
      const images = await loadImages(report, load, (d, n) => setBusy(`Preparing photos ${d} of ${n}…`));
      const missing = [...images.values()].filter((x) => !x).length;
      setBusy(`Building ${format.toUpperCase()}…`);
      const { saved: res, links } = await exportReport(report, format, images);
      setMsg(res === 'declined'
        ? { ok: false, text: 'Download cancelled.' }
        : { ok: true, text: `${report.title} ${report.reference}: title page, ${report.photos.length} photo(s) on ${report.pages.length} page(s), summary, ${links} clickable map link${links === 1 ? '' : 's'} checked in the file.${missing ? ` ${missing} photo(s) could not be loaded and are marked “Photo not available”.` : ''}` });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message || 'Could not build the report.' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card" id="evidence-report">
      <div className="card-head">
        <h2>Export report</h2>
        <span className="note">Title page with full project details, photos, then summary</span>
      </div>
      <div className="form-grid">
        <label className="field">Report
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as ReportKind)}>
            {REPORT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </label>
        <label className="field">Photo layout
          <select className="input" value={layout} onChange={(e) => setLayout(e.target.value as ReportLayout)}>
            <option value="2x4">2 × 4 (8 per page)</option>
            <option value="2x6">2 × 6 (12 per page)</option>
          </select>
        </label>
        <label className="field">Format
          <select className="input" value={format} onChange={(e) => setFormat(e.target.value as ReportFormat)}>
            <option value="pdf">PDF (.pdf)</option>
            <option value="pptx">PowerPoint (.pptx)</option>
            <option value="docx">Word (.docx)</option>
          </select>
        </label>
        <label className="field">{datesAre === 'uploaded' ? 'Uploaded from' : 'Captured from'}<input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="field">{datesAre === 'uploaded' ? 'Uploaded to' : 'Captured to'}<input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      <div className="form-actions">
        <button className="btn btn-primary" onClick={run} disabled={!!busy || !photos.length}>{busy ?? 'Export report'}</button>
        {!photos.length && <span className="note">No photos to export yet.</span>}
      </div>
      {msg && <p className={msg.ok ? 'ok' : 'bad'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}
    </section>
  );
}
