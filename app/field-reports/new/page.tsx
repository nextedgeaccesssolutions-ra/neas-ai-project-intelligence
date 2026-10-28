'use client';
// New Field Report: a four-step form for phones (Details → Photos → Work done → Sign & submit).
// Photos are saved to Site evidence as they are taken and the report to Field reports, so everything
// works offline and syncs like the rest of the app. Unfinished text is kept as a draft on this device.
import FieldIcon from '@/components/FieldIcons';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Loading, NoProject } from '@/components/ProjectBar';
import { useProjectData, useStore } from '@/lib/store';
import { actualPct, todayLocal } from '@/lib/calc';
import { fmtDate, fmtPct, uid } from '@/lib/format';
import { askConfirm, notify } from '@/components/Dialogs';
import { compressImage, putPhoto } from '@/lib/photos';
import { locatePhoto, photoRef, gpsSourceOf } from '@/lib/geo';
import PhotoThumb, { fetchFromServer } from '@/components/PhotoThumb';
import { allOps, onOutboxChange } from '@/lib/offline/outbox';
import { CLOUD } from '@/lib/cloud/env';
import { getPhoto } from '@/lib/photos';
import { saveFile } from '@/lib/fileio';
import { fieldReportPdf, reportNo } from '@/lib/fieldReportPdf';
import type { Evidence, FieldReport, ReportDetails } from '@/lib/types';

const STEPS = ['Details', 'Photos', 'Work done', 'Sign & submit'] as const;
const TYPES = ['Progress', 'Inspection', 'Issue', 'Other'] as const;
const WEATHER = [['Sunny', '☀'], ['Cloudy', '☁'], ['Rainy', '☂'], ['Windy', '≋'], ['Other', '…']] as const;
const UNITS = ['pcs', 'L', 'kg', 'm', 'm²', 'sets', 'set', 'roll', 'lot'];
// optional remark sections, written into the remarks under their own headings
const EXTRA = ['Outstanding work', 'Defects and observations', 'Corrective actions', 'Safety concerns', 'Recommendations', 'Client instructions'] as const;
const CATEGORIES = ['Before', 'After', 'During', 'Defect', 'Safety'] as const;
type Cat = (typeof CATEGORIES)[number];
const DEFAULT_TASKS = ['Glass cleaning', 'Frame cleaning', 'Removed water marks', 'Applied sealant (if any)', 'Inspection and final check'];

interface Material { name: string; qty: string; unit: string }
interface Draft {
  activityId: string; date: string; type: string; location: string; area: string; floor: string; weather: string; description: string; pct: string; techName: string; clientName: string; weatherNote?: string; extra?: Record<string, string>;
  tasks: { label: string; done: boolean; note?: string }[]; materials: Material[]; remarks: string; photoIds: string[];
}
const blank = (): Draft => ({
  activityId: '', date: todayLocal(), type: 'Progress', location: '', techName: '', clientName: '', area: '', floor: '', weather: 'Sunny', description: '', pct: '',
  tasks: DEFAULT_TASKS.map((label) => ({ label, done: false })), materials: [], remarks: '', photoIds: [],
});

export default function NewFieldReport() {
  const { ready, project, state, setActiveProject, addReport, addEvidence, updateEvidence, deleteEvidence } = useStore();
  const galleryRef = useRef<HTMLInputElement>(null);
  const dragFrom = useRef<number | null>(null);
  const { pid, activities, reports, evidence } = useProjectData();
  const key = `neas-fr-draft:${pid}`;
  const [step, setStep] = useState(0);
  const [d, setD] = useState<Draft>(blank);
  const [loaded, setLoaded] = useState('');
  const [tab, setTab] = useState<Cat>('Before');
  // the report just submitted: shown until the server confirms it (or kept on this device while offline)
  const [online, setOnline] = useState(true);
  useEffect(() => { const u = () => setOnline(navigator.onLine); u(); window.addEventListener('online', u); window.addEventListener('offline', u); return () => { window.removeEventListener('online', u); window.removeEventListener('offline', u); }; }, []);
  const [fieldErr, setFieldErr] = useState<[string, string] | null>(null);
  const errFor = (f: string) => (fieldErr && fieldErr[0] === f ? <span className="bad fr-err" role="alert">{fieldErr[1]}</span> : null);
  const [sent, setSent] = useState<{ report: FieldReport; confirmed: boolean; refused?: string } | null>(null);
  // confirmation needs the report to have been queued first: it is queued a moment after it is saved
  const queued = useRef(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [signer, setSigner] = useState<'tech' | 'client'>('tech');
  const [signed, setSigned] = useState<{ tech: boolean; client: boolean }>({ tech: false, client: false });
  const canvas = useRef<{ tech: HTMLCanvasElement | null; client: HTMLCanvasElement | null }>({ tech: null, client: null });
  const fileRef = useRef<HTMLInputElement>(null);
  // kept outside render: the pad redraws while signing, and a stroke must survive that
  const drawing = useRef(false);

  // the draft of this project, kept on this device until the report is submitted
  useEffect(() => {
    if (!pid || loaded === pid) return;
    try { const v = localStorage.getItem(key); setD(v ? { ...blank(), ...(JSON.parse(v) as Draft) } : blank()); } catch { setD(blank()); }
    setLoaded(pid);
  }, [pid, key, loaded]);
  useEffect(() => { if (loaded === pid) try { localStorage.setItem(key, JSON.stringify(d)); } catch { /* storage full */ } }, [d, key, loaded, pid]);

  // a signature belongs to the report of one project: switching project clears it
  useEffect(() => { setSigned({ tech: false, client: false }); for (const c of [canvas.current.tech, canvas.current.client]) c?.getContext('2d')?.clearRect(0, 0, c.width, c.height); }, [pid]);
  // a submitted report is confirmed once nothing for it (report or its photos) waits in the offline queue
  useEffect(() => {
    if (!sent || sent.confirmed || !CLOUD) return;
    const ids = new Set([sent.report.id, ...(sent.report.details?.photos ?? []).map((p) => p.id), ...(sent.report.details?.signers ?? []).map((x) => x.photoId)]);
    const check = async () => {
      const mine = (await allOps()).filter((o) => ids.has(o.record_id));
      if (mine.length) queued.current = true;
      const bad = mine.find((o) => o.status === 'conflict' || o.status === 'rejected');
      if (bad) { setSent((x) => (x ? { ...x, refused: bad.error ?? 'The server did not accept it.' } : x)); return; }
      if (queued.current && !mine.length && navigator.onLine) setSent((x) => (x ? { ...x, confirmed: true, refused: undefined } : x));
    };
    void check();
    const off = onOutboxChange(() => void check());
    const t = setInterval(() => void check(), 3000);
    return () => { off?.(); clearInterval(t); };
  }, [sent]);

  if (!ready) return <Loading />;
  if (!project) return <NoProject />;

  const set = (p: Partial<Draft>) => { setD((x) => ({ ...x, ...p })); setFieldErr(null); };
  const act = activities.find((a) => a.id === d.activityId);
  const prev = d.activityId ? actualPct(d.activityId, reports, d.date, act) : 0;
  const photos = d.photoIds.map((id) => evidence.find((e) => e.id === id)).filter((e): e is Evidence => !!e);
  const before = photos.filter((p) => p.kind === 'Before'), after = photos.filter((p) => p.kind === 'After');
  const inTab = photos.filter((p) => p.kind === tab);
  const location = [d.area.trim(), d.floor.trim()].filter(Boolean).join(' - ');

  const addPhotos = async (files: File[]) => {
    if (!d.activityId) return notify('Choose the activity in step 1 first.');
    setBusy('Saving photos…');
    const ids: string[] = [];
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      try {
        const gps = await locatePhoto(file, { enabled: true });
        const blob = await compressImage(file);
        const id = uid('ev');
        const takenAt = new Date(file.lastModified || Date.now()).toISOString();
        await putPhoto(id, blob);
        addEvidence({ id, projectId: pid, activityId: d.activityId, kind: tab, caption: `${tab.toUpperCase()} ${d.floor || ''} ${file.name.replace(/\.[^.]+$/, '')}`.replace(/\s+/g, ' ').trim(), takenAt, bytes: blob.size,
          gps: gps.fix, gpsStatus: gps.status, gpsSource: gpsSourceOf(gps), workArea: d.area.trim(), locationDetail: d.floor.trim(), pairId: null, ref: photoRef(tab, takenAt, id) });
        ids.push(id);
      } catch { /* skipped: not readable */ }
    }
    setD((x) => ({ ...x, photoIds: [...x.photoIds, ...ids] }));
    setBusy(null);
    if (fileRef.current) fileRef.current.value = '';
    if (ids.length) notify(`${ids.length} ${tab} photo(s) saved to Site evidence.`);
  };
  const removePhoto = async (e: Evidence) => {
    if (!(await askConfirm('Remove this photo from the report and from Site evidence?'))) return;
    deleteEvidence(e.id);
    setD((x) => ({ ...x, photoIds: x.photoIds.filter((i) => i !== e.id) }));
  };

  const movePhoto = (e: Evidence, dir: -1 | 1) => setD((x) => {
    const same = x.photoIds.filter((id) => evidence.find((v) => v.id === id)?.kind === e.kind);
    const j = same.indexOf(e.id) + dir;
    if (j < 0 || j >= same.length) return x;
    const ids = [...x.photoIds], a = ids.indexOf(e.id), b = ids.indexOf(same[j]);
    [ids[a], ids[b]] = [ids[b], ids[a]];
    return { ...x, photoIds: ids };
  });
  const problem = (s: number): [string, string] | null => {
    if (s === 0) {
      if (!d.activityId) return ['activity', 'Choose the activity this report is for.'];
      if (!d.date) return ['date', 'Report date is required.'];
      if (!d.location.trim()) return ['location', 'Location is required.'];
      if (d.type === 'Progress') { const v = Number(d.pct); if (d.pct.trim() === '' || !Number.isFinite(v) || v < 0 || v > 100) return ['pct', 'Enter the cumulative % complete (0 to 100).']; }
      if (!d.description.trim()) return ['description', 'Describe the work.'];
    }
    return null;
  };
  // the message also shows beside the field it is about
  const check = (s: number): string | null => { const p = problem(s); setFieldErr(p); return p ? p[1] : null; };
  const go = (s: number) => {
    for (let k = 0; k < s; k++) { const e = check(k); if (e) { setStep(k); return notify(e); } }
    setStep(s);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // signature pad: pointer drawing on a canvas
  const pad = (who: 'tech' | 'client') => {
    const pos = (c: HTMLCanvasElement, e: React.PointerEvent) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * (c.width / r.width), (e.clientY - r.top) * (c.height / r.height)]; };
    return {
      ref: (c: HTMLCanvasElement | null) => { canvas.current[who] = c; },
      onPointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => { const c = e.currentTarget, g = c.getContext('2d')!; if (!signed[who]) { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); } drawing.current = true; c.setPointerCapture(e.pointerId); const [x, y] = pos(c, e); g.lineWidth = 3; g.lineCap = 'round'; g.strokeStyle = '#0b1c30'; g.beginPath(); g.moveTo(x, y); },
      onPointerMove: (e: React.PointerEvent<HTMLCanvasElement>) => { if (!drawing.current) return; const c = e.currentTarget, g = c.getContext('2d')!; const [x, y] = pos(c, e); g.lineTo(x, y); g.stroke(); setSigned((s) => (s[who] ? s : { ...s, [who]: true })); },
      onPointerUp: () => { drawing.current = false; },
    };
  };
  const clearPad = (who: 'tech' | 'client') => { const c = canvas.current[who]; c?.getContext('2d')?.clearRect(0, 0, c.width, c.height); setSigned((s) => ({ ...s, [who]: false })); };

  const submit = async () => {
    for (let k = 0; k < 3; k++) { const e = check(k); if (e) { setStep(k); return notify(e); } }
    if (!signed.tech) return notify('The technician / inspector signs before submitting.');
    if (!d.techName.trim()) return notify('Type the technician / inspector name under the signature.');
    if (d.materials.some((m) => m.name.trim() && !(m.qty.trim() !== '' && Number.isFinite(Number(m.qty)) && Number(m.qty) >= 0))) { setStep(2); return notify('Each material needs a quantity of 0 or more.'); }
    if (!(await askConfirm(`Submit this report with ${photos.length} photo(s)? It cannot be changed here after submitting.`, { danger: false }))) return;
    const v = d.type === 'Progress' ? Number(d.pct) : prev;
    if (d.type === 'Progress' && v < prev && !(await askConfirm(`This is lower than the previous report (${fmtPct(prev)}). Submit anyway?`, { danger: false }))) return;
    setBusy('Submitting…');
    try {
    // signatures are kept with the photos as inspection records
    const signers: ReportDetails['signers'] = [];
    for (const who of ['tech', 'client'] as const) {
      const c = canvas.current[who];
      if (!c || !signed[who]) continue;
      const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.9));
      if (!blob) continue;
      const id = uid('ev');
      const takenAt = new Date().toISOString();
      await putPhoto(id, blob);
      addEvidence({ id, projectId: pid, activityId: d.activityId, kind: 'Inspection', caption: `Signature - ${who === 'tech' ? 'Technician / Inspector' : 'Client'} - ${fmtDate(d.date)}`, takenAt, bytes: blob.size,
        gps: null, gpsStatus: 'unavailable', gpsSource: null, workArea: d.area.trim(), locationDetail: d.floor.trim(), pairId: null, ref: photoRef('Inspection', takenAt, id) });
      signers.push({ role: who === 'tech' ? 'Technician / Inspector' : 'Client', name: (who === 'tech' ? d.techName : d.clientName).trim(), photoId: id, at: takenAt });
    }
    // the photos follow the final activity, work area and floor chosen in step 1
    for (const p of photos) updateEvidence(p.id, { activityId: d.activityId, workArea: d.area.trim(), locationDetail: d.floor.trim() });
    // BEFORE and AFTER photos of this report are paired in the order they were taken
    for (let i = 0; i < Math.min(before.length, after.length); i++) { const pairId = uid('pair'); updateEvidence(before[i].id, { pairId }); updateEvidence(after[i].id, { pairId }); }
    const weatherText = d.weather === 'Other' && d.weatherNote?.trim() ? `Other: ${d.weatherNote.trim()}` : d.weather;
    const allRemarks = [d.remarks.trim(), ...EXTRA.filter((x) => d.extra?.[x]?.trim()).map((x) => `${x}: ${d.extra![x].trim()}`)].filter(Boolean).join('\n\n');
    const notes = [
      `[${d.type}] ${location || ''}${weatherText ? ` · Weather: ${weatherText}` : ''}`.trim(),
      d.description.trim(),
      d.tasks.some((t) => t.done) ? `Work done: ${d.tasks.filter((t) => t.done).map((t) => t.label).join('; ')}` : '',
      d.materials.filter((m) => m.name.trim()).length ? `Materials: ${d.materials.filter((m) => m.name.trim()).map((m) => `${m.name.trim()} ${m.qty} ${m.unit}`.trim()).join('; ')}` : '',
      allRemarks ? `Remarks: ${allRemarks}` : '',
      `Photos: ${before.length} before, ${after.length} after. Signed by technician${signed.client ? ' and client' : ''}.`,
    ].filter(Boolean).join('\n');
    const details: ReportDetails = {
      type: d.type as ReportDetails['type'], location: d.location.trim(), area: d.area.trim(), floor: d.floor.trim(), weather: weatherText, description: d.description.trim(),
      tasks: d.tasks.filter((t) => t.label.trim()).map((t) => ({ label: t.label.trim(), done: t.done, ...(t.note?.trim() ? { note: t.note.trim() } : {}) })), materials: d.materials.filter((m) => m.name.trim()).map((m) => ({ name: m.name.trim(), qty: Number(m.qty), unit: m.unit })),
      remarks: allRemarks, signers, photos: photos.map((p) => ({ id: p.id, kind: p.kind })),
    };
    const report: FieldReport = { id: uid('rep'), projectId: pid, activityId: d.activityId, date: d.date, actualPct: v, completedQty: null, notes, createdAt: new Date().toISOString(), details };
    addReport(report);
    try { localStorage.removeItem(key); } catch { /* storage blocked */ }
    setD(blank()); setStep(0); setSigned({ tech: false, client: false });
    queued.current = false;
    setSent({ report, confirmed: !CLOUD });
    } catch (e) { notify(`Not submitted: ${(e as Error).message}. Your entries are kept; try again.`); } finally { setBusy(null); }
  };

  const exportPdf = async (r: FieldReport) => {
    setBusy('Building PDF…');
    try {
      const { toImage } = await import('@/lib/evidenceExport');
      const { loadLogo } = await import('@/lib/projectReportPdf');
      const ids = [...(r.details?.photos ?? []).map((p) => p.id), ...(r.details?.signers ?? []).map((x) => x.photoId)];
      const list = ids.map((id) => evidence.find((e) => e.id === id)).filter((e): e is Evidence => !!e);
      const blob = await fieldReportPdf(r, {
        projectName: project.name, projectCode: project.code ?? '', client: project.client, activity: activities.find((a) => a.id === r.activityId)?.name ?? '—',
        photos: list, logo: await loadLogo().catch(() => null),
        image: async (e) => { const b = (await getPhoto(e.id).catch(() => undefined)) ?? (CLOUD && navigator.onLine ? await fetchFromServer(e.id, e.storagePath ?? `${pid}/${e.id}.jpg`) : null); return b ? toImage(b) : null; },
      });
      await saveFile(`${reportNo(r)}.pdf`, blob);
    } catch (e) { notify(`PDF not created: ${(e as Error).message}`); }
    setBusy(null);
  };
  const chip = (on: boolean) => `fr-chip${on ? ' on' : ''}`;
  return (
    <div className="fr-wizard">
      <div className="fr-top">
        <Link href="/field-reports" className="fr-back" aria-label="Back to field reports">‹</Link>
        <div><b>NEW REPORT</b><span>FIELD ACCESS TASK</span></div>
        <span className={`fr-online ${online ? '' : 'off'}`}>{online ? 'Online' : 'Offline'}</span>
      </div>
      {sent && (
        <section className={`card fr-card fr-sent ${sent.confirmed ? 'ok' : 'wait'}`} role="status">
          <h2>{sent.confirmed ? (CLOUD ? 'Submitted to the server' : 'Saved on this device') : sent.refused ? 'Not accepted by the server' : 'Pending sync'}</h2>
          {sent.refused && <p className="bad" style={{ margin: 0 }}>{sent.refused} Open the Offline queue to retry or discard it; the report is still saved on this device.</p>}
          <p style={{ margin: 0 }}>
            Report <b>{reportNo(sent.report)}</b> · {fmtDate(sent.report.date)}.{' '}
            {sent.confirmed ? (CLOUD ? 'The server has the report and its photos.' : 'This copy of the app keeps data on the device.')
              : navigator.onLine ? 'Sending the report and its photos…' : 'Saved on this device. It is sent automatically when the phone is back online.'}
          </p>
          <div className="form-actions" style={{ marginTop: 0 }}>
            <button type="button" className="btn btn-primary" onClick={() => void exportPdf(sent.report)}>Download PDF</button>
            <Link className="btn" href="/field-reports">Open Field reports</Link>
            <button type="button" className="btn" onClick={() => setSent(null)}>Start another report</button>
          </div>
        </section>
      )}
      <ol className="fr-steps" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? 'on' : i < step ? 'done' : ''}>
            <button type="button" onClick={() => go(i)} aria-current={i === step ? 'step' : undefined}><span>{i + 1}</span>{s}</button>
          </li>
        ))}
      </ol>
      {busy && <div className="banner" role="status">{busy}</div>}

      {step === 0 && (
        <section className="card fr-card">
          <h2>Project information</h2>
          <div className="form-grid">
            <label className="field">Project *<select className="input" value={pid} disabled={!!busy} onChange={(e) => e.target.value && setActiveProject(e.target.value)}>{state.projects.map((p) => <option key={p.id} value={p.id}>{p.code ? `${p.code} · ` : ''}{p.name}</option>)}</select></label>
            <label className="field">Activity *<select className="input" value={d.activityId} onChange={(e) => set({ activityId: e.target.value })}><option value="">Choose…</option>{activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>{errFor('activity')}</label>
            <label className="field">Report date *<input className="input" type="date" value={d.date} onChange={(e) => set({ date: e.target.value })} />{errFor('date')}</label>
          </div>
          <label className="field">Location *
            <span style={{ display: 'flex', gap: 8 }}>
              <input className="input" value={d.location} onChange={(e) => set({ location: e.target.value })} placeholder={project.site || 'e.g. Makati City'} />
              <button type="button" className="btn" onClick={() => navigator.geolocation?.getCurrentPosition((p) => set({ location: `${d.location || project.site || ''}${d.location || project.site ? ' · ' : ''}${p.coords.latitude.toFixed(5)}, ${p.coords.longitude.toFixed(5)}` }), () => notify('Location is not available on this device.'), { enableHighAccuracy: true, timeout: 15000 })}>GPS</button>
            </span>
          {errFor('location')}</label>
          <h3>Report type *</h3>
          <div className="fr-chips">{TYPES.map((t) => <button key={t} type="button" className={`${chip(d.type === t)} fr-ico`} onClick={() => set({ type: t })}><FieldIcon name={t.toLowerCase()} />{t}</button>)}</div>
          {d.type === 'Progress' && <label className="field">Cumulative % complete *{d.activityId ? <span className="note"> (last: {fmtPct(prev)})</span> : null}<input className="input" inputMode="decimal" value={d.pct} onChange={(e) => set({ pct: e.target.value })} placeholder="e.g. 60" />{errFor('pct')}</label>}
          <h3>Work area / floor</h3>
          <div className="form-grid">
            <label className="field">Work area<input className="input" list="fr-areas" value={d.area} onChange={(e) => set({ area: e.target.value })} placeholder="e.g. Gamboa Side" /></label>
            <label className="field">Floor / location<input className="input" list="fr-locs" value={d.floor} onChange={(e) => set({ floor: e.target.value })} placeholder="e.g. Floor 40" /></label>
          </div>
          <datalist id="fr-areas">{[...new Set(evidence.map((e) => e.workArea?.trim()).filter(Boolean))].map((v) => <option key={v} value={v} />)}</datalist>
          <datalist id="fr-locs">{[...new Set(evidence.map((e) => e.locationDetail?.trim()).filter(Boolean))].map((v) => <option key={v} value={v} />)}</datalist>
          <h3>Weather</h3>
          <div className="fr-chips">{WEATHER.map(([w]) => <button key={w} type="button" className={`${chip(d.weather === w)} fr-ico`} onClick={() => set({ weather: w })}><FieldIcon name={w.toLowerCase()} />{w}</button>)}</div>
          {d.weather === 'Other' && <label className="field">Weather note<input className="input" maxLength={120} value={d.weatherNote ?? ''} onChange={(e) => set({ weatherNote: e.target.value })} placeholder="e.g. Hazy, light drizzle in the afternoon" /></label>}
          <label className="field">Description *<textarea className="input" rows={4} maxLength={500} value={d.description} onChange={(e) => set({ description: e.target.value })} placeholder="What was done, where, and the result" /><span className="note">{d.description.length}/500</span>{errFor('description')}</label>
        </section>
      )}

      {step === 1 && (
        <section className="card fr-card">
          <h2>Photos (before &amp; after)</h2>
          <div className="fr-tabs">
            {CATEGORIES.map((t) => <button key={t} type="button" className={chip(tab === t)} onClick={() => setTab(t)}>{t} ({photos.filter((p) => p.kind === t).length})</button>)}
          </div>
          <div className="fr-grid">
            {inTab.map((p, i) => (
              <figure key={p.id} className="fr-photo">
                <PhotoThumb id={p.id} storagePath={p.storagePath} alt={`${tab} ${i + 1}`} />
                <button type="button" className="fr-x" aria-label={`Remove ${tab} ${i + 1}`} onClick={() => void removePhoto(p)}>✕</button>
                <figcaption>
                  <b>{tab} {i + 1}</b><span className="note">{[p.workArea, p.locationDetail].filter(Boolean).join(' - ')}</span>
                  <input className="input input-sm" maxLength={300} value={p.caption} onChange={(e) => updateEvidence(p.id, { caption: e.target.value })} aria-label={`Caption for ${tab} ${i + 1}`} placeholder="Caption" />
                  <span style={{ display: 'flex', gap: 4 }}>
                    <button type="button" className="btn btn-sm" disabled={i === 0} onClick={() => movePhoto(p, -1)} aria-label="Move earlier">↑</button>
                    <button type="button" className="btn btn-sm" disabled={i === inTab.length - 1} onClick={() => movePhoto(p, 1)} aria-label="Move later">↓</button>
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
          <div className="form-actions" style={{ marginTop: 0, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-sm" onClick={() => galleryRef.current?.click()}>Add multiple</button>
            <input ref={galleryRef} type="file" accept="image/*" multiple hidden onChange={(e) => { void addPhotos(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
          </div>
          <label className="fr-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void addPhotos(Array.from(e.dataTransfer.files)); }}>
            <FieldIcon name="camera" size={30} />
            <span><b>Tap to take or add {tab.toLowerCase()} photos, or drop them here</b><br /><span className="note">Saved to Site evidence with the work area and floor from step 1</span></span>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => void addPhotos(Array.from(e.target.files ?? []))} />
          </label>
          <p className="note">Before and after photos are paired in the order they were taken when you submit.</p>
        </section>
      )}

      {step === 2 && (
        <section className="card fr-card">
          <div className="card-head"><h2>Work done / activities</h2><button type="button" className="btn btn-sm" onClick={() => set({ tasks: [...d.tasks, { label: '', done: true }] })}>Add item</button></div>
          <ul className="fr-checks">
            {d.tasks.map((t, i) => (
              <li key={i}
                onDragOver={(e) => { if (dragFrom.current != null) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
                onDrop={(e) => { const from = dragFrom.current; dragFrom.current = null; if (from == null) return; e.preventDefault(); if (from === i) return; const t2 = [...d.tasks]; const [m] = t2.splice(from, 1); t2.splice(i, 0, m); set({ tasks: t2 }); }}>
                <input type="checkbox" checked={t.done} onChange={(e) => set({ tasks: d.tasks.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)) })} aria-label={`Done: ${t.label || 'item'}`} />
                <input className="input" value={t.label} placeholder="Activity done" onChange={(e) => set({ tasks: d.tasks.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <span className="fr-handle" title="Drag to reorder (or use the arrows)" aria-hidden="true" draggable
                    onDragStart={(e) => { dragFrom.current = i; e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'move'; }}
                    onDragEnd={() => { dragFrom.current = null; }}><FieldIcon name="drag" size={18} /></span>
                  <button type="button" className="btn btn-sm" disabled={i === 0} aria-label="Move up" onClick={() => set({ tasks: d.tasks.map((x, j) => (j === i - 1 ? d.tasks[i] : j === i ? d.tasks[i - 1] : x)) })}>↑</button>
                  <button type="button" className="btn btn-sm" disabled={i === d.tasks.length - 1} aria-label="Move down" onClick={() => set({ tasks: d.tasks.map((x, j) => (j === i + 1 ? d.tasks[i] : j === i ? d.tasks[i + 1] : x)) })}>↓</button>
                  <button type="button" className="btn btn-sm" aria-label="Remove item" onClick={() => set({ tasks: d.tasks.filter((_, j) => j !== i) })}>✕</button>
                </span>
                <input className="input input-sm fr-note" value={t.note ?? ''} maxLength={300} placeholder="Note (optional)" onChange={(e) => set({ tasks: d.tasks.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)) })} aria-label={`Note for ${t.label || 'item'}`} />
              </li>
            ))}
          </ul>
          <div className="card-head"><h2>Materials used</h2><button type="button" className="btn btn-sm" onClick={() => set({ materials: [...d.materials, { name: '', qty: '', unit: 'pcs' }] })}>Add material</button></div>
          {d.materials.map((m, i) => (
            <div key={i} className="fr-mat">
              <input className="input" value={m.name} placeholder="Material" onChange={(e) => set({ materials: d.materials.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <input className="input" inputMode="decimal" value={m.qty} placeholder="Qty" onChange={(e) => set({ materials: d.materials.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)) })} />
              <select className="input" value={UNITS.includes(m.unit) ? m.unit : 'Other'} onChange={(e) => set({ materials: d.materials.map((x, j) => (j === i ? { ...x, unit: e.target.value === 'Other' ? '' : e.target.value } : x)) })}>{UNITS.map((u) => <option key={u}>{u}</option>)}<option>Other</option></select>
              {!UNITS.includes(m.unit) && <input className="input" maxLength={20} value={m.unit} placeholder="Unit" aria-label="Other unit" onChange={(e) => set({ materials: d.materials.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)) })} />}
              <button type="button" className="btn btn-sm" aria-label="Remove material" onClick={() => set({ materials: d.materials.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          <label className="field">Remarks<textarea className="input" rows={3} maxLength={500} value={d.remarks} onChange={(e) => set({ remarks: e.target.value })} placeholder="e.g. All works completed as per method statement." /><span className="note">{d.remarks.length}/500</span></label>
          <details className="fr-more">
            <summary>More remarks (outstanding work, defects, safety, recommendations…)</summary>
            {EXTRA.map((k) => <label key={k} className="field">{k}<textarea className="input" rows={2} maxLength={500} value={d.extra?.[k] ?? ''} onChange={(e) => set({ extra: { ...(d.extra ?? {}), [k]: e.target.value } })} /></label>)}
          </details>
        </section>
      )}

      {step === 3 && (
        <section className="card fr-card">
          <div className="card-head"><h2>Summary</h2><button type="button" className="btn btn-sm" onClick={() => go(0)}>Edit</button></div>
          <dl className="fr-sum">
            <dt>Project</dt><dd>{project.name}</dd>
            <dt>Activity</dt><dd>{act?.name ?? '—'}</dd>
            <dt>Date</dt><dd>{fmtDate(d.date)}</dd>
            <dt>Report type</dt><dd>{d.type}{d.type === 'Progress' && d.pct ? ` · ${fmtPct(Number(d.pct))}` : ''}</dd>
            <dt>Location</dt><dd>{d.location || '—'}</dd>
            <dt>Work area</dt><dd>{location || '—'}</dd>
            <dt>Weather</dt><dd>{d.weather === 'Other' && d.weatherNote?.trim() ? `Other: ${d.weatherNote.trim()}` : d.weather}</dd>
          </dl>
          <div className="card-head"><h3>Photos <span className="note">{before.length} before · {after.length} after · {photos.length} in all</span></h3><button type="button" className="btn btn-sm" onClick={() => go(1)}>Edit</button></div>
          <div className="fr-strip">{photos.slice(0, 4).map((p) => <PhotoThumb key={p.id} id={p.id} storagePath={p.storagePath} alt={p.kind} />)}{photos.length > 4 && <span className="fr-more">+{photos.length - 4}</span>}</div>
          <div className="card-head"><h3>Work done</h3><button type="button" className="btn btn-sm" onClick={() => go(2)}>Edit</button></div>
          <ul>{d.tasks.filter((t) => t.done && t.label.trim()).map((t, i) => <li key={i}>✔ {t.label}{t.note?.trim() ? <span className="note"> · {t.note}</span> : null}</li>)}</ul>
          {d.materials.some((m) => m.name.trim()) && <><h3>Materials used</h3><ul>{d.materials.filter((m) => m.name.trim()).map((m, i) => <li key={i}>{m.name} · {m.qty} {m.unit}</li>)}</ul></>}
          {d.remarks.trim() && <><h3>Remarks</h3><p style={{ margin: 0 }}>{d.remarks}</p></>}
          <h3>Sign &amp; submit</h3>
          <div className="fr-tabs">
            <button type="button" className={chip(signer === 'tech')} onClick={() => setSigner('tech')}>Technician / Inspector{signed.tech ? ' ✔' : ''}</button>
            <button type="button" className={chip(signer === 'client')} onClick={() => setSigner('client')}>Client (optional){signed.client ? ' ✔' : ''}</button>
          </div>
          {(['tech', 'client'] as const).map((who) => (
            <div key={who} className="fr-sign" hidden={signer !== who}>
              <canvas width={900} height={300} aria-label={`Signature: ${who === 'tech' ? 'technician or inspector' : 'client'}`} {...pad(who)} />
              <button type="button" className="btn btn-sm" onClick={() => clearPad(who)}>Clear</button>
            </div>
          ))}
          <div className="form-grid">
            <label className="field">{signer === 'tech' ? 'Technician / inspector name *' : 'Client representative name'}
              <input className="input" value={signer === 'tech' ? d.techName : d.clientName} onChange={(e) => set(signer === 'tech' ? { techName: e.target.value } : { clientName: e.target.value })} />
            </label>
          </div>
          <p className="note">By signing you confirm the report is accurate. The signature is drawn on this device; it is not independently verified.</p>
        </section>
      )}

      <div className="fr-actions">
        {step === 0 ? <button type="button" className="btn" onClick={() => notify('Draft kept on this device.')}>Save draft</button> : <button type="button" className="btn" onClick={() => go(step - 1)}>← Back</button>}
        {step < 3 ? <button type="button" className="btn btn-primary" onClick={() => go(step + 1)}>Next: {STEPS[step + 1]} →</button>
          : <button type="button" className="btn btn-primary fr-submit" disabled={!!busy} onClick={() => void submit()}>Submit report</button>}
      </div>
    </div>
  );
}
