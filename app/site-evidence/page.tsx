'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import ProjectBar, { Loading, NoProject } from '@/components/ProjectBar';
import { useProjectData, useStore } from '@/lib/store';
import { useQueryParam } from '@/lib/useQuery';
import { compressImage, getPhoto, putPhoto } from '@/lib/photos';
import DataIO from '@/components/DataIO';
import * as IO from '@/lib/moduleIO';
import { uid } from '@/lib/format';
import { askConfirm, notify } from '@/components/Dialogs';
import type { Evidence } from '@/lib/types';
import PhotoThumb from '@/components/PhotoThumb';

const MAX_BYTES = 5 * 1024 * 1024;

const Thumb = ({ id, alt }: { id: string; alt: string }) => <PhotoThumb id={id} alt={alt} />;

export default function SiteEvidence() {
  const { ready, project, addEvidence, deleteEvidence, state } = useStore();
  const { pid, activities, evidence } = useProjectData();
  const actParam = useQueryParam('activity');
  const [activityId, setActivityId] = useState('');
  const [kind, setKind] = useState<Evidence['kind']>('Before');
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!ready) return;
    if (actParam && activities.some((a) => a.id === actParam)) setActivityId(actParam);
    else if (!activities.some((a) => a.id === activityId)) setActivityId(activities[0]?.id ?? '');
  }, [ready, actParam, pid]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) return <Loading />;
  if (!project) return <NoProject />;

  const name = (id: string) => activities.find((a) => a.id === id)?.name ?? '(deleted activity)';

  /** Compress and store photos for the chosen activity (form or Import). */
  const addPhotos = async (files: File[]) => {
    if (!activityId) return setError('Choose an activity first.');
    if (!files.length) return setError('Choose or capture a photo.');
    setBusy(true);
    let ok = 0;
    const problems: string[] = [];
    for (const file of files) {
      if (!file.type.startsWith('image/')) { problems.push(`${file.name}: not an image`); continue; }
      if (file.size > MAX_BYTES * 4) { problems.push(`${file.name}: over 20 MB`); continue; }
      try {
        const blob = await compressImage(file);
        if (blob.size > MAX_BYTES) throw new Error('still over 5 MB after compression');
        const id = uid('ev');
        await putPhoto(id, blob);
        addEvidence({ id, projectId: pid, activityId, kind, caption: caption.trim() || file.name.replace(/\.[^.]+$/, ''), takenAt: new Date(file.lastModified || Date.now()).toISOString(), bytes: blob.size });
        ok++;
      } catch (e) {
        problems.push(`${file.name}: ${e instanceof Error ? e.message : 'could not be saved'}`);
      }
    }
    setBusy(false);
    setCaption('');
    if (fileRef.current) fileRef.current.value = '';
    setError(problems.length ? `${ok} photo(s) added. ${problems.join('; ')}` : null);
    if (ok) notify(`${ok} photo(s) added to ${name(activityId)}.`);
  };
  const attach = () => addPhotos(Array.from(fileRef.current?.files ?? []));

  const evidenceDoc = async () => {
    const images: { caption: string; blob: Blob }[] = [];
    for (const e of shown) {
      const b = await getPhoto(e.id).catch(() => undefined);
      if (b) images.push({ caption: `${e.kind} · ${name(e.activityId)}${e.caption ? ' · ' + e.caption : ''} · ${new Date(e.takenAt).toLocaleString()}`, blob: b });
    }
    return IO.evidenceDoc(state, images);
  };

  const shown = filter ? evidence.filter((e) => e.activityId === filter) : evidence;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Field operations</div>
          <h1>Site evidence</h1>
          <p className="lead">Before, during and after photos per activity. Photos are compressed and kept on this device.</p>
        </div>
        <div className="form-actions" style={{ marginTop: 0 }}>
          <DataIO doc={evidenceDoc} capture={() => document.getElementById('evidence-card')} extraAccept="image/jpeg,image/png,image/webp,image/heic" onExtraFiles={addPhotos} label="photos" />
          <Link className="btn btn-sm" href="/field-reports">Field reports</Link>
        </div>
      </div>
      <ProjectBar />

      <section className="card">
        <div className="card-head"><h2>Attach photo</h2><span className="note">Up to 5 MB after compression · stored in this browser</span></div>
        {activities.length === 0 ? <div className="empty">Add activities in <Link href="/project-management">Project management</Link> first.</div> : (
          <>
            <div className="form-grid">
              <label className="field">Activity
                <select className="input" value={activityId} onChange={(e) => setActivityId(e.target.value)}>
                  {activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
              <label className="field">Photo type
                <select className="input" value={kind} onChange={(e) => setKind(e.target.value as Evidence['kind'])}>
                  <option>Before</option><option>During</option><option>After</option>
                </select>
              </label>
              <label className="field">Capture photo
                <input ref={fileRef} id="photo-file" className="input" type="file" accept="image/*" multiple />
              </label>
              <label className="field">Caption
                <input className="input" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Location and observation" />
              </label>
            </div>
            {error && <p className="bad" role="alert">{error}</p>}
            <div className="form-actions">
              <button className="btn btn-primary" onClick={attach} disabled={busy}>{busy ? 'Saving…' : 'Attach photo'}</button>
            </div>
          </>
        )}
      </section>

      <section className="card" id="evidence-card">
        <div className="card-head">
          <h2>Evidence ({shown.length})</h2>
          <select className="input" style={{ maxWidth: 280 }} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by activity">
            <option value="">All activities</option>
            {activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        {shown.length === 0 ? <div className="empty">No field evidence captured yet.</div> : (
          <div className="photo-grid">
            {shown.map((e) => (
              <figure key={e.id} className="photo" style={{ margin: 0 }}>
                <Thumb id={e.id} alt={`${e.kind}: ${e.caption || name(e.activityId)}`} />
                <figcaption className="meta">
                  <span><span className={`pill ${e.kind === 'After' ? 'pill-ok' : e.kind === 'Before' ? '' : 'pill-warn'}`}>{e.kind}</span> {name(e.activityId)}</span>
                  <span>{e.caption || <span className="note">No caption</span>}</span>
                  <span className="note">{new Date(e.takenAt).toLocaleString()} · {(e.bytes / 1024).toFixed(0)} KB</span>
                  <button className="btn btn-sm btn-danger" onClick={() => askConfirm('Delete this photo from this device?').then((ok) => ok && deleteEvidence(e.id))}>Delete</button>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
