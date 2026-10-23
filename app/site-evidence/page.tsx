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
import { CLOUD } from '@/lib/cloud/env';
import { useCanManage } from '@/components/RoleGate';
import { supabaseBrowser } from '@/lib/cloud/browser';
import type { Evidence, EvidenceKind } from '@/lib/types';
import PhotoThumb from '@/components/PhotoThumb';
import { accuracyWarning, GPS_TARGET_M, gpsLabel, locatePhoto, parseManualCoords, photoRef, startGpsTracking, stopGpsTracking, subscribeGps, type GpsResult, type GpsTrack } from '@/lib/geo';

const MAX_BYTES = 5 * 1024 * 1024;
const KINDS: EvidenceKind[] = ['Before', 'After', 'During', 'Inspection', 'Safety', 'Defect'];
const KIND_TONE: Record<EvidenceKind, string> = { Before: '', After: 'pill-ok', During: 'pill-warn', Inspection: '', Safety: 'pill-warn', Defect: 'pill-bad' };
const pairable = (k: EvidenceKind) => k === 'Before' || k === 'After';
const osm = (lat: number, lng: number) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=19/${lat}/${lng}`;

function summarizeGps(rs: GpsResult[]): string | null {
  if (!rs.length) return null;
  const fromPhoto = rs.filter((r) => r.status === 'captured' && r.source === 'photo').length;
  const fromDevice = rs.filter((r) => r.status === 'captured' && r.source === 'device');
  const manual = rs.filter((r) => r.status === 'manual').length;
  const denied = rs.filter((r) => r.status === 'denied').length;
  const none = rs.filter((r) => r.status === 'unavailable').length;
  const parts: string[] = [];
  if (fromPhoto) parts.push(`${fromPhoto} located from the photo's own GPS`);
  if (fromDevice.length) {
    const weak = fromDevice.filter((r) => accuracyWarning({ gps: r.fix, gpsStatus: 'captured' })).length;
    parts.push(`${fromDevice.length} located by device GPS${fromDevice.length === 1 && fromDevice[0].fix ? ` (${gpsLabel({ gps: fromDevice[0].fix, gpsStatus: 'captured' })})` : ''}${weak ? ` — ${weak} above the ${GPS_TARGET_M} m accuracy target, add the work area` : ''}`);
  }
  if (manual) parts.push(`${manual} saved with manually entered coordinates`);
  if (denied) parts.push(`${denied} without location (permission refused)`);
  if (none) parts.push(`${none} without location (no GPS fix, or an older photo with no saved location)`);
  return parts.join('; ') + '.';
}

export default function SiteEvidence() {
  const { ready, project, addEvidence, updateEvidence, deleteEvidence, state } = useStore();
  const { pid, activities, evidence } = useProjectData();
  const actParam = useQueryParam('activity');
  const reviewer = useCanManage();
  const [activityId, setActivityId] = useState('');
  const [kind, setKind] = useState<EvidenceKind>('Before');
  const [caption, setCaption] = useState('');
  const [workArea, setWorkArea] = useState('');
  const [locationDetail, setLocationDetail] = useState('');
  const [recordGps, setRecordGps] = useState(true);
  const [manualLoc, setManualLoc] = useState(false);
  const [manualLat, setManualLat] = useState('');
  const [manualLng, setManualLng] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gpsNote, setGpsNote] = useState<string | null>(null);
  const [fActivity, setFActivity] = useState('');
  const [fKind, setFKind] = useState('');
  const [fGps, setFGps] = useState('');
  const [fPair, setFPair] = useState('');
  const [q, setQ] = useState('');
  const [pairFrom, setPairFrom] = useState<string | null>(null);
  const [clientVisible, setClientVisible] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [editKind, setEditKind] = useState<EvidenceKind>('Before');
  const [editCaption, setEditCaption] = useState('');
  const [editActivity, setEditActivity] = useState('');
  const [editArea, setEditArea] = useState('');
  const [editLoc, setEditLoc] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [gpsTrack, setGpsTrack] = useState<GpsTrack>({ state: 'off', fix: null });
  const [online, setOnline] = useState(true);

  // GPS stays on while this page is open so a fix (satellite, no internet needed) is ready at capture.
  useEffect(() => subscribeGps(setGpsTrack), []);
  useEffect(() => {
    if (recordGps && !manualLoc) startGpsTracking();
    else stopGpsTracking();
    return () => stopGpsTracking();
  }, [recordGps, manualLoc]);
  useEffect(() => {
    const upd = () => setOnline(navigator.onLine);
    upd();
    window.addEventListener('online', upd);
    window.addEventListener('offline', upd);
    return () => { window.removeEventListener('online', upd); window.removeEventListener('offline', upd); };
  }, []);

  useEffect(() => {
    if (!CLOUD || !pid) return;
    supabaseBrowser()?.from('report_attachments').select('id, client_visible').eq('project_id', pid).then(({ data }) => {
      if (data) setClientVisible(Object.fromEntries(data.map((r) => [r.id, r.client_visible])));
    });
  }, [pid]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ready) return;
    if (actParam && activities.some((a) => a.id === actParam)) setActivityId(actParam);
    else if (!activities.some((a) => a.id === activityId)) setActivityId(activities[0]?.id ?? '');
  }, [ready, actParam, pid]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) return <Loading />;
  if (!project) return <NoProject />;

  const toggleClientVisible = async (id: string, val: boolean) => {
    const { error: err } = await supabaseBrowser()!.from('report_attachments').update({ client_visible: val }).eq('id', id);
    if (err) return setError(`Could not update: ${err.message}`);
    setClientVisible((prev) => ({ ...prev, [id]: val }));
    notify(val ? 'Shared with client.' : 'Hidden from client.');
  };

  const name = (id: string) => activities.find((a) => a.id === id)?.name ?? '(deleted activity)';
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const partnerOf = (e: Evidence) => (e.pairId ? evidence.find((x) => x.pairId === e.pairId && x.id !== e.id) : undefined);

  /** Compress and store photos with capture time, GPS (when allowed) and work-area location. */
  const addPhotos = async (files: File[]) => {
    if (!activityId) return setError('Choose an activity first.');
    if (!files.length) return setError('Choose or capture a photo.');
    let manual = null;
    if (manualLoc) {
      manual = parseManualCoords(manualLat, manualLng);
      if (!manual) return setError('Enter a valid latitude (−90 to 90) and longitude (−180 to 180), or turn off manual location.');
    }
    setError(null);
    setGpsNote(null);
    let ok = 0;
    const problems: string[] = [];
    const results: GpsResult[] = [];
    for (const file of files) {
      if (!file.type.startsWith('image/')) { problems.push(`${file.name}: not an image`); continue; }
      if (file.size > MAX_BYTES * 4) { problems.push(`${file.name}: over 20 MB`); continue; }
      try {
        // Per photo: the camera's own GPS first, else the live fix for a just-taken photo. A slow or refused fix never blocks saving.
        setBusy(manual ? 'Saving…' : 'Reading location…');
        const gps: GpsResult = manual ? { status: 'manual', fix: manual } : await locatePhoto(file, { enabled: recordGps });
        results.push(gps);
        setBusy('Saving…');
        const blob = await compressImage(file);
        if (blob.size > MAX_BYTES) throw new Error('still over 5 MB after compression');
        const id = uid('ev');
        const takenAt = new Date(file.lastModified || Date.now()).toISOString();
        await putPhoto(id, blob);
        addEvidence({
          id, projectId: pid, activityId, kind, caption: caption.trim() || file.name.replace(/\.[^.]+$/, ''), takenAt, bytes: blob.size,
          gps: gps.fix, gpsStatus: gps.status, workArea: workArea.trim(), locationDetail: locationDetail.trim(), pairId: null, ref: photoRef(kind, takenAt, id),
        });
        ok++;
      } catch (e) {
        problems.push(`${file.name}: ${e instanceof Error ? e.message : 'could not be saved'}`);
      }
    }
    setBusy(null);
    setCaption('');
    if (fileRef.current) fileRef.current.value = '';
    setError(problems.length ? `${ok} photo(s) added. ${problems.join('; ')}` : null);
    setGpsNote(summarizeGps(results));
    if (ok) notify(`${ok} photo(s) added to ${name(activityId)}.`);
  };
  const attach = () => addPhotos(Array.from(fileRef.current?.files ?? []));

  const pair = (a: Evidence, b: Evidence) => {
    if (!pairable(a.kind) || !pairable(b.kind) || a.kind === b.kind) return notify('Pair one BEFORE photo with one AFTER photo.');
    for (const old of [partnerOf(a), partnerOf(b)]) if (old && old.id !== a.id && old.id !== b.id) updateEvidence(old.id, { pairId: null });
    const pairId = uid('pair');
    updateEvidence(a.id, { pairId });
    updateEvidence(b.id, { pairId });
    setPairFrom(null);
    notify(`Paired ${a.ref || a.kind} with ${b.ref || b.kind}.`);
  };
  const unpair = (e: Evidence) => {
    const other = partnerOf(e);
    updateEvidence(e.id, { pairId: null });
    if (other) updateEvidence(other.id, { pairId: null });
  };

  const ql = q.trim().toLowerCase();
  const shown = evidence.filter((e) =>
    (!fActivity || e.activityId === fActivity) &&
    (!fKind || e.kind === fKind) &&
    (!fGps || (fGps === 'with' ? e.gpsStatus === 'captured' || e.gpsStatus === 'manual' : fGps === 'without' ? !e.gps : fGps === 'manual' ? e.gpsStatus === 'manual' : !!accuracyWarning(e))) &&
    (!fPair || (fPair === 'paired' ? !!partnerOf(e) : pairable(e.kind) && !partnerOf(e))) &&
    (!ql || `${e.ref ?? ''} ${e.caption} ${e.workArea ?? ''} ${e.locationDetail ?? ''}`.toLowerCase().includes(ql)),
  );
  const stats = {
    before: evidence.filter((e) => e.kind === 'Before').length,
    after: evidence.filter((e) => e.kind === 'After').length,
    pairs: new Set(evidence.filter((e) => partnerOf(e)).map((e) => e.pairId)).size,
    geotagged: evidence.filter((e) => e.gpsStatus === 'captured').length,
    noGps: evidence.filter((e) => !e.gps).length,
    unpaired: evidence.filter((e) => pairable(e.kind) && !partnerOf(e)).length,
  };

  const evidenceDoc = async () => {
    const images: { caption: string; blob: Blob }[] = [];
    for (const e of shown) {
      const b = await getPhoto(e.id).catch(() => undefined);
      if (b) images.push({ caption: [e.ref, e.kind, name(e.activityId), e.workArea, e.locationDetail, e.caption, new Date(e.takenAt).toLocaleString(), gpsLabel(e)].filter(Boolean).join(' · '), blob: b });
    }
    return IO.evidenceDoc(state, images);
  };

  const filtersOn = fActivity || fKind || fGps || fPair || ql;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Field operations</div>
          <h1>Site evidence</h1>
          <p className="lead">Before, after, inspection, safety and defect photos with capture time, device GPS and work-area location. Photos are kept on this device and sync when you are online.</p>
        </div>
        <div className="form-actions" style={{ marginTop: 0 }}>
          <DataIO doc={evidenceDoc} capture={() => document.getElementById('evidence-card')} extraAccept="image/jpeg,image/png,image/webp,image/heic" onExtraFiles={addPhotos} label="photos" />
          <Link className="btn btn-sm" href="/field-reports">Field reports</Link>
        </div>
      </div>
      <ProjectBar />

      <div className="user-stats">
        <div className="user-stat"><div className="user-stat-val">{stats.before} / {stats.after}</div><div className="user-stat-label">Before / After photos</div></div>
        <div className="user-stat"><div className="user-stat-val">{stats.pairs}</div><div className="user-stat-label">Before/after pairs</div></div>
        <div className="user-stat"><div className="user-stat-val">{stats.unpaired}</div><div className="user-stat-label">Missing a match</div></div>
        <div className="user-stat"><div className="user-stat-val">{stats.geotagged}</div><div className="user-stat-label">GPS-tagged</div></div>
        <div className="user-stat"><div className="user-stat-val">{stats.noGps}</div><div className="user-stat-label">Without GPS</div></div>
      </div>

      <section className="card">
        <div className="card-head"><h2>Capture photo</h2><span className="note">Up to 5 MB after compression · saved on this device first</span></div>
        {activities.length === 0 ? <div className="empty">Add activities in <Link href="/project-management">Project management</Link> first.</div> : (
          <>
            <div className="form-grid">
              <label className="field">Activity
                <select className="input" value={activityId} onChange={(e) => setActivityId(e.target.value)}>
                  {activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
              <label className="field">Photo type
                <select className="input" value={kind} onChange={(e) => setKind(e.target.value as EvidenceKind)}>
                  {KINDS.map((k) => <option key={k}>{k}</option>)}
                </select>
              </label>
              <label className="field">Work area
                <input className="input" value={workArea} onChange={(e) => setWorkArea(e.target.value)} maxLength={200} placeholder="e.g. North facade, Turbine 7 blade B" />
              </label>
              <label className="field">Building / floor / elevation / grid
                <input className="input" value={locationDetail} onChange={(e) => setLocationDetail(e.target.value)} maxLength={300} placeholder="e.g. Tower 1 · L12 · Grid C-4" />
              </label>
              <label className="field">Take or choose photo
                <input ref={fileRef} id="photo-file" className="input" type="file" accept="image/*" capture="environment" multiple />
              </label>
              <label className="field">Description
                <input className="input" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="What the photo shows" />
              </label>
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={recordGps && !manualLoc} disabled={manualLoc} onChange={(e) => setRecordGps(e.target.checked)} /> Record GPS location
              </label>
              {recordGps && !manualLoc && (
                <span className={`pill ${gpsTrack.state === 'ready' && !accuracyWarning({ gps: gpsTrack.fix, gpsStatus: 'captured' }) ? 'pill-ok' : gpsTrack.state === 'denied' || gpsTrack.state === 'unavailable' ? 'pill-bad' : 'pill-warn'}`} role="status">
                  {gpsTrack.state === 'ready' && gpsTrack.fix ? `📍 GPS ready${gpsTrack.fix.accuracy != null ? ` ±${Math.round(gpsTrack.fix.accuracy)} m` : ''}`
                    : gpsTrack.state === 'denied' ? 'Location permission refused: allow it in the browser to geotag'
                    : gpsTrack.state === 'unavailable' ? 'No location service on this device'
                    : 'Searching for GPS…'}
                  {!online && ' · offline (satellite GPS still works)'}
                </span>
              )}
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={manualLoc} onChange={(e) => setManualLoc(e.target.checked)} /> Enter location manually
              </label>
              {manualLoc && (
                <>
                  <input className="input" style={{ maxWidth: 150 }} inputMode="decimal" value={manualLat} onChange={(e) => setManualLat(e.target.value)} placeholder="Latitude" aria-label="Latitude" />
                  <input className="input" style={{ maxWidth: 150 }} inputMode="decimal" value={manualLng} onChange={(e) => setManualLng(e.target.value)} placeholder="Longitude" aria-label="Longitude" />
                </>
              )}
            </div>
            <p className="note">
              {manualLoc ? 'Manual coordinates are saved and labelled "Manually entered", never as device GPS.'
                : recordGps ? `Location is on automatically and works without internet (satellite GPS). Each photo uses the GPS saved in the photo by the camera when present, otherwise the phone's current position with its reported accuracy (target ${GPS_TARGET_M} m). It is the phone's position, not necessarily the exact surface. Older gallery photos without saved GPS are not stamped with today's location; if no fix is available the photo is still saved as "GPS unavailable". For best accuracy, turn on the phone's precise location and the camera's location tag.`
                : 'Photos will be saved without a location.'}
            </p>
            {error && <p className="bad" role="alert">{error}</p>}
            {gpsNote && <p className={/accuracy is|unavailable|refused/.test(gpsNote) ? 'bad' : 'note'} role="status">{gpsNote}</p>}
            <div className="form-actions">
              <button className="btn btn-primary" onClick={attach} disabled={!!busy}>{busy ?? 'Save evidence'}</button>
            </div>
          </>
        )}
      </section>

      <section className="card" id="evidence-card">
        <div className="card-head"><h2>Evidence gallery ({shown.length}{filtersOn ? ` of ${evidence.length}` : ''})</h2></div>
        <div className="form-grid" style={{ marginBottom: 12 }}>
          <label className="field">Search<input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Reference, description, work area" /></label>
          <label className="field">Activity<select className="input" value={fActivity} onChange={(e) => setFActivity(e.target.value)}><option value="">All activities</option>{activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label className="field">Type<select className="input" value={fKind} onChange={(e) => setFKind(e.target.value)}><option value="">All types</option>{KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
          <label className="field">GPS<select className="input" value={fGps} onChange={(e) => setFGps(e.target.value)}><option value="">Any</option><option value="with">With location</option><option value="without">Without GPS</option><option value="manual">Manually entered</option><option value="warning">Accuracy warning</option></select></label>
          <label className="field">Pairing<select className="input" value={fPair} onChange={(e) => setFPair(e.target.value)}><option value="">Any</option><option value="paired">Paired</option><option value="unpaired">Missing a match</option></select></label>
        </div>
        {pairFrom && byId.get(pairFrom) && (
          <div className="banner" style={{ marginBottom: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            Pairing {byId.get(pairFrom)!.ref || byId.get(pairFrom)!.kind}: choose the matching {byId.get(pairFrom)!.kind === 'Before' ? 'AFTER' : 'BEFORE'} photo.
            <button className="btn btn-sm" onClick={() => setPairFrom(null)}>Cancel</button>
          </div>
        )}
        {shown.length === 0 ? <div className="empty">{evidence.length ? 'No photos match these filters.' : 'No field evidence captured yet.'}</div> : (
          <div className="photo-grid">
            {shown.map((e) => {
              const isEditing = editing === e.id;
              const edits = e.editCount ?? 0;
              const canEdit = !CLOUD || reviewer || edits < 1;
              const needsApproval = CLOUD && !reviewer && edits >= 1;
              const partner = partnerOf(e);
              const from = pairFrom ? byId.get(pairFrom) : undefined;
              const canPairHere = !!from && from.id !== e.id && pairable(e.kind) && from.kind !== e.kind;
              return (
                <figure key={e.id} className="photo" style={{ margin: 0, outline: pairFrom === e.id ? '3px solid var(--gold)' : undefined }}>
                  <PhotoThumb id={e.id} storagePath={e.storagePath} alt={`${e.kind}: ${e.caption || name(e.activityId)}`} />
                  <figcaption className="meta">
                    {isEditing ? (
                      <>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <select className="input" style={{ width: 'auto' }} value={editKind} onChange={(ev) => setEditKind(ev.target.value as EvidenceKind)}>
                            {KINDS.map((k) => <option key={k}>{k}</option>)}
                          </select>
                          <select className="input" style={{ width: 'auto', flex: 1 }} value={editActivity} onChange={(ev) => setEditActivity(ev.target.value)}>
                            {activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                          </select>
                        </div>
                        <input className="input" value={editCaption} onChange={(ev) => setEditCaption(ev.target.value)} placeholder="Description" />
                        <input className="input" value={editArea} onChange={(ev) => setEditArea(ev.target.value)} maxLength={200} placeholder="Work area" />
                        <input className="input" value={editLoc} onChange={(ev) => setEditLoc(ev.target.value)} maxLength={300} placeholder="Building / floor / elevation / grid" />
                        <p className="note" style={{ margin: 0 }}>Capture time and GPS are kept as recorded.</p>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-sm btn-primary" onClick={() => {
                            const patch: Partial<Evidence> = { kind: editKind, activityId: editActivity, caption: editCaption, workArea: editArea.trim(), locationDetail: editLoc.trim(), editCount: edits + 1 };
                            if (editKind !== e.kind && partner && (!pairable(editKind) || editKind === partner.kind)) { patch.pairId = null; updateEvidence(partner.id, { pairId: null }); }
                            updateEvidence(e.id, patch); setEditing(null); notify('Photo updated.');
                          }}>Save</button>
                          <button className="btn btn-sm" onClick={() => setEditing(null)}>Cancel</button>
                        </div>
                      </>
                    ) : (
                      <>
                        <span><span className={`pill ${KIND_TONE[e.kind]}`}>{e.kind}</span> <b>{e.ref || '—'}</b></span>
                        <span>{name(e.activityId)}{e.workArea ? ` · ${e.workArea}` : ''}</span>
                        {e.locationDetail && <span className="note">{e.locationDetail}</span>}
                        <span>{e.caption || <span className="note">No description</span>}</span>
                        <span className="note">Captured {new Date(e.takenAt).toLocaleString()} · {(e.bytes / 1024).toFixed(0)} KB{edits > 0 && ` · edited ${edits}×`}</span>
                        <span className="note" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                          📍 {gpsLabel(e)}
                          {accuracyWarning(e) && <span className="pill pill-warn">Low accuracy</span>}
                          {e.gps && <a href={osm(e.gps.lat, e.gps.lng)} target="_blank" rel="noreferrer">Map</a>}
                          {e.gps && <button className="btn btn-sm" style={{ padding: '0 6px' }} onClick={() => navigator.clipboard?.writeText(`${e.gps!.lat}, ${e.gps!.lng}`).then(() => notify('Coordinates copied.'), () => notify(`${e.gps!.lat}, ${e.gps!.lng}`))}>Copy</button>}
                        </span>
                        {pairable(e.kind) && (
                          <span className="note">
                            {partner ? <>🔗 Paired with <b>{partner.ref || partner.kind}</b></> : <span className="pill pill-warn">No matching {e.kind === 'Before' ? 'AFTER' : 'BEFORE'} photo</span>}
                          </span>
                        )}
                        {CLOUD && reviewer && (
                          <label className="note" style={{ display: 'inline-flex', gap: 4 }}>
                            <input type="checkbox" checked={!!clientVisible[e.id]} onChange={(ev) => toggleClientVisible(e.id, ev.target.checked)} /> client
                          </label>
                        )}
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {canPairHere && <button className="btn btn-sm btn-primary" onClick={() => pair(from!, e)}>Pair with selected</button>}
                          {!pairFrom && pairable(e.kind) && canEdit && <button className="btn btn-sm" onClick={() => setPairFrom(e.id)}>{partner ? 'Re-pair' : 'Pair'}</button>}
                          {!pairFrom && partner && canEdit && <button className="btn btn-sm" onClick={() => unpair(e)}>Unpair</button>}
                          {canEdit && !pairFrom && <button className="btn btn-sm" onClick={() => { setEditing(e.id); setEditKind(e.kind); setEditCaption(e.caption); setEditActivity(e.activityId); setEditArea(e.workArea ?? ''); setEditLoc(e.locationDetail ?? ''); }}>Edit</button>}
                          {needsApproval && <span className="note pill pill-warn">Needs admin approval to edit again</span>}
                          {canEdit && !pairFrom && <button className="btn btn-sm btn-danger" onClick={() => askConfirm('Delete this photo? If it has not synced yet, it is lost.', { danger: true }).then((ok) => { if (!ok) return; if (partner) updateEvidence(partner.id, { pairId: null }); deleteEvidence(e.id); })}>Delete</button>}
                        </div>
                      </>
                    )}
                  </figcaption>
                </figure>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
