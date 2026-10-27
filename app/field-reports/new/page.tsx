'use client';
// New Field Report: a four-step form for phones (Details → Photos → Work done → Sign & submit).
// Photos are saved to Site evidence as they are taken and the report to Field reports, so everything
// works offline and syncs like the rest of the app. Unfinished text is kept as a draft on this device.
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import ProjectBar, { Loading, NoProject } from '@/components/ProjectBar';
import { useProjectData, useStore } from '@/lib/store';
import { actualPct, todayLocal } from '@/lib/calc';
import { fmtDate, fmtPct, uid } from '@/lib/format';
import { askConfirm, notify } from '@/components/Dialogs';
import { compressImage, putPhoto } from '@/lib/photos';
import { locatePhoto, photoRef, gpsSourceOf } from '@/lib/geo';
import PhotoThumb from '@/components/PhotoThumb';
import type { Evidence } from '@/lib/types';

const STEPS = ['Details', 'Photos', 'Work done', 'Sign & submit'] as const;
const TYPES = ['Progress', 'Inspection', 'Issue', 'Other'] as const;
const WEATHER = [['Sunny', '☀'], ['Cloudy', '☁'], ['Rainy', '☂'], ['Windy', '≋']] as const;
const DEFAULT_TASKS = ['Glass cleaning', 'Frame cleaning', 'Removed water marks', 'Applied sealant (if any)', 'Inspection and final check'];

interface Material { name: string; qty: string; unit: string }
interface Draft {
  activityId: string; date: string; type: string; area: string; floor: string; weather: string; description: string; pct: string;
  tasks: { label: string; done: boolean }[]; materials: Material[]; remarks: string; photoIds: string[];
}
const blank = (): Draft => ({
  activityId: '', date: todayLocal(), type: 'Progress', area: '', floor: '', weather: 'Sunny', description: '', pct: '',
  tasks: DEFAULT_TASKS.map((label) => ({ label, done: false })), materials: [], remarks: '', photoIds: [],
});

export default function NewFieldReport() {
  const { ready, project, addReport, addEvidence, updateEvidence, deleteEvidence } = useStore();
  const { pid, activities, reports, evidence } = useProjectData();
  const key = `neas-fr-draft:${pid}`;
  const [step, setStep] = useState(0);
  const [d, setD] = useState<Draft>(blank);
  const [loaded, setLoaded] = useState('');
  const [tab, setTab] = useState<'Before' | 'After'>('Before');
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

  if (!ready) return <Loading />;
  if (!project) return <NoProject />;

  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const act = activities.find((a) => a.id === d.activityId);
  const prev = d.activityId ? actualPct(d.activityId, reports, d.date, act) : 0;
  const photos = d.photoIds.map((id) => evidence.find((e) => e.id === id)).filter((e): e is Evidence => !!e);
  const before = photos.filter((p) => p.kind === 'Before'), after = photos.filter((p) => p.kind === 'After');
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

  const check = (s: number): string | null => {
    if (s === 0) {
      if (!d.activityId) return 'Choose the activity this report is for.';
      if (!d.date) return 'Report date is required.';
      if (!d.description.trim()) return 'Describe the work.';
      if (d.type === 'Progress') { const v = Number(d.pct); if (d.pct.trim() === '' || !Number.isFinite(v) || v < 0 || v > 100) return 'Enter the cumulative % complete (0 to 100).'; }
    }
    return null;
  };
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
    const v = d.type === 'Progress' ? Number(d.pct) : prev;
    if (d.type === 'Progress' && v < prev && !(await askConfirm(`This is lower than the previous report (${fmtPct(prev)}). Submit anyway?`, { danger: false }))) return;
    setBusy('Submitting…');
    try {
    // signatures are kept with the photos as inspection records
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
    }
    // the photos follow the final activity, work area and floor chosen in step 1
    for (const p of photos) updateEvidence(p.id, { activityId: d.activityId, workArea: d.area.trim(), locationDetail: d.floor.trim() });
    // BEFORE and AFTER photos of this report are paired in the order they were taken
    for (let i = 0; i < Math.min(before.length, after.length); i++) { const pairId = uid('pair'); updateEvidence(before[i].id, { pairId }); updateEvidence(after[i].id, { pairId }); }
    const notes = [
      `[${d.type}] ${location || ''}${d.weather ? ` · Weather: ${d.weather}` : ''}`.trim(),
      d.description.trim(),
      d.tasks.some((t) => t.done) ? `Work done: ${d.tasks.filter((t) => t.done).map((t) => t.label).join('; ')}` : '',
      d.materials.filter((m) => m.name.trim()).length ? `Materials: ${d.materials.filter((m) => m.name.trim()).map((m) => `${m.name.trim()} ${m.qty} ${m.unit}`.trim()).join('; ')}` : '',
      d.remarks.trim() ? `Remarks: ${d.remarks.trim()}` : '',
      `Photos: ${before.length} before, ${after.length} after. Signed by technician${signed.client ? ' and client' : ''}.`,
    ].filter(Boolean).join('\n');
    addReport({ id: uid('rep'), projectId: pid, activityId: d.activityId, date: d.date, actualPct: v, completedQty: null, notes, createdAt: new Date().toISOString() });
    try { localStorage.removeItem(key); } catch { /* storage blocked */ }
    setD(blank()); setStep(0); setSigned({ tech: false, client: false });
    notify('Report submitted. It is in Field reports and syncs when you are online.');
    } catch (e) { notify(`Not submitted: ${(e as Error).message}. Your entries are kept; try again.`); } finally { setBusy(null); }
  };

  const chip = (on: boolean) => `fr-chip${on ? ' on' : ''}`;
  return (
    <div className="fr-wizard">
      <div className="page-head">
        <div>
          <div className="eyebrow">Field operations</div>
          <h1>New field report</h1>
        </div>
        <Link className="btn btn-sm" href="/field-reports">All field reports</Link>
      </div>
      <ProjectBar />
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
            <label className="field">Activity *<select className="input" value={d.activityId} onChange={(e) => set({ activityId: e.target.value })}><option value="">Choose…</option>{activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
            <label className="field">Report date *<input className="input" type="date" value={d.date} onChange={(e) => set({ date: e.target.value })} /></label>
          </div>
          <h3>Report type *</h3>
          <div className="fr-chips">{TYPES.map((t) => <button key={t} type="button" className={chip(d.type === t)} onClick={() => set({ type: t })}>{t}</button>)}</div>
          {d.type === 'Progress' && <label className="field">Cumulative % complete *{d.activityId ? <span className="note"> (last: {fmtPct(prev)})</span> : null}<input className="input" inputMode="decimal" value={d.pct} onChange={(e) => set({ pct: e.target.value })} placeholder="e.g. 60" /></label>}
          <h3>Work area / floor</h3>
          <div className="form-grid">
            <label className="field">Work area<input className="input" list="fr-areas" value={d.area} onChange={(e) => set({ area: e.target.value })} placeholder="e.g. Gamboa Side" /></label>
            <label className="field">Floor / location<input className="input" list="fr-locs" value={d.floor} onChange={(e) => set({ floor: e.target.value })} placeholder="e.g. Floor 40" /></label>
          </div>
          <datalist id="fr-areas">{[...new Set(evidence.map((e) => e.workArea?.trim()).filter(Boolean))].map((v) => <option key={v} value={v} />)}</datalist>
          <datalist id="fr-locs">{[...new Set(evidence.map((e) => e.locationDetail?.trim()).filter(Boolean))].map((v) => <option key={v} value={v} />)}</datalist>
          <h3>Weather</h3>
          <div className="fr-chips">{WEATHER.map(([w, icon]) => <button key={w} type="button" className={chip(d.weather === w)} onClick={() => set({ weather: w })}><span aria-hidden="true">{icon}</span> {w}</button>)}</div>
          <label className="field">Description *<textarea className="input" rows={4} maxLength={500} value={d.description} onChange={(e) => set({ description: e.target.value })} placeholder="What was done, where, and the result" /><span className="note">{d.description.length}/500</span></label>
        </section>
      )}

      {step === 1 && (
        <section className="card fr-card">
          <h2>Photos (before &amp; after)</h2>
          <div className="fr-tabs">
            {(['Before', 'After'] as const).map((t) => <button key={t} type="button" className={chip(tab === t)} onClick={() => setTab(t)}>{t} photos ({(t === 'Before' ? before : after).length})</button>)}
          </div>
          <div className="fr-grid">
            {(tab === 'Before' ? before : after).map((p, i) => (
              <figure key={p.id} className="fr-photo">
                <PhotoThumb id={p.id} storagePath={p.storagePath} alt={`${tab} ${i + 1}`} />
                <button type="button" className="fr-x" aria-label={`Remove ${tab} ${i + 1}`} onClick={() => void removePhoto(p)}>✕</button>
                <figcaption><b>{tab} {i + 1}</b><span className="note">{[p.workArea, p.locationDetail].filter(Boolean).join(' - ')}</span></figcaption>
              </figure>
            ))}
          </div>
          <label className="fr-drop">
            <span aria-hidden="true">📷</span>
            <span><b>Tap to take or add {tab.toLowerCase()} photos</b><br /><span className="note">Saved to Site evidence with the work area and floor from step 1</span></span>
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
              <li key={i}>
                <input type="checkbox" checked={t.done} onChange={(e) => set({ tasks: d.tasks.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)) })} aria-label={`Done: ${t.label || 'item'}`} />
                <input className="input" value={t.label} placeholder="Activity done" onChange={(e) => set({ tasks: d.tasks.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                <button type="button" className="btn btn-sm" aria-label="Remove item" onClick={() => set({ tasks: d.tasks.filter((_, j) => j !== i) })}>✕</button>
              </li>
            ))}
          </ul>
          <div className="card-head"><h2>Materials used</h2><button type="button" className="btn btn-sm" onClick={() => set({ materials: [...d.materials, { name: '', qty: '', unit: 'pcs' }] })}>Add material</button></div>
          {d.materials.map((m, i) => (
            <div key={i} className="fr-mat">
              <input className="input" value={m.name} placeholder="Material" onChange={(e) => set({ materials: d.materials.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <input className="input" inputMode="decimal" value={m.qty} placeholder="Qty" onChange={(e) => set({ materials: d.materials.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)) })} />
              <select className="input" value={m.unit} onChange={(e) => set({ materials: d.materials.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)) })}>{['pcs', 'L', 'kg', 'm', 'm²', 'roll', 'set', 'lot'].map((u) => <option key={u}>{u}</option>)}</select>
              <button type="button" className="btn btn-sm" aria-label="Remove material" onClick={() => set({ materials: d.materials.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          <label className="field">Remarks<textarea className="input" rows={3} maxLength={500} value={d.remarks} onChange={(e) => set({ remarks: e.target.value })} placeholder="e.g. All works completed as per method statement." /><span className="note">{d.remarks.length}/500</span></label>
        </section>
      )}

      {step === 3 && (
        <section className="card fr-card">
          <h2>Summary</h2>
          <dl className="fr-sum">
            <dt>Project</dt><dd>{project.name}</dd>
            <dt>Activity</dt><dd>{act?.name ?? '—'}</dd>
            <dt>Date</dt><dd>{fmtDate(d.date)}</dd>
            <dt>Report type</dt><dd>{d.type}{d.type === 'Progress' && d.pct ? ` · ${fmtPct(Number(d.pct))}` : ''}</dd>
            <dt>Work area</dt><dd>{location || '—'}</dd>
            <dt>Weather</dt><dd>{d.weather}</dd>
          </dl>
          <h3>Photos <span className="note">{before.length} before · {after.length} after</span></h3>
          <div className="fr-strip">{photos.slice(0, 4).map((p) => <PhotoThumb key={p.id} id={p.id} storagePath={p.storagePath} alt={p.kind} />)}{photos.length > 4 && <span className="fr-more">+{photos.length - 4}</span>}</div>
          <h3>Work done</h3>
          <ul>{d.tasks.filter((t) => t.done && t.label.trim()).map((t, i) => <li key={i}>✔ {t.label}</li>)}</ul>
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
