'use client';
// Project cover / building reference photos: shown in exact 9.21 cm tiles, the same size the
// project report prints. Project managers and Super Admins choose, order and set the primary photo.
import { useState } from 'react';
import PhotoThumb from '@/components/PhotoThumb';
import LocationViewer, { type LocationInfo } from '@/components/LocationViewer';
import { coverPhotos, coverReference, reorderCover, COVER_TILE_CM } from '@/lib/coverPhotos';
import type { Evidence, Project } from '@/lib/types';

export default function CoverPhotos({ project, evidence, canManage, updateEvidence, onAdd, onUpload, syncState }: {
  project: Project; evidence: Evidence[]; canManage: boolean;
  updateEvidence: (id: string, patch: Partial<Evidence>) => void;
  onAdd: () => void;
  /** upload photos straight onto the cover */
  onUpload?: (files: File[], caption: string) => void | Promise<void>;
  /** per-photo sync label, e.g. "Waiting to sync" */
  syncState?: (id: string) => string | null;
}) {
  const [loc, setLoc] = useState<LocationInfo | null>(null);
  const [pick, setPick] = useState('');
  const [upCaption, setUpCaption] = useState('');
  const cover = coverPhotos(evidence);
  const candidates = evidence.filter((e) => !e.isCover).sort((a, b) => Number(b.kind === 'Reference') - Number(a.kind === 'Reference') || b.takenAt.localeCompare(a.takenAt));

  const renumber = (ids: string[]) => ids.forEach((id, k) => updateEvidence(id, { coverOrder: k + 1 }));
  const add = (id: string) => { updateEvidence(id, { isCover: true, coverOrder: cover.length + 1 }); setPick(''); };
  const remove = (e: Evidence) => {
    updateEvidence(e.id, { isCover: false, coverPrimary: false, coverOrder: null });
    renumber(cover.filter((x) => x.id !== e.id).map((x) => x.id));
  };
  const move = (e: Evidence, dir: -1 | 1) => { for (const [id, n] of reorderCover(cover.map((x) => x.id), e.id, dir)) updateEvidence(id, { coverOrder: n }); };
  const primary = (e: Evidence) => {
    // clear the old primary first so the one-primary-per-project rule holds at every step
    for (const x of cover) if (x.coverPrimary && x.id !== e.id) updateEvidence(x.id, { coverPrimary: false });
    updateEvidence(e.id, { coverPrimary: true });
  };

  return (
    <section className="card" id="cover-photos">
      <div className="card-head">
        <h2>Project cover photos ({cover.length})</h2>
        <span className="note">Printed on the project report cover at exactly {COVER_TILE_CM} cm × {COVER_TILE_CM} cm; the first 2 go on page 1</span>
      </div>
      <div className="form-actions" style={{ marginTop: 0, flexWrap: 'wrap' }}>
        {onUpload && canManage ? (
          <label className="btn btn-sm btn-primary" style={{ cursor: 'pointer' }}>
            Upload cover photo(s)
            <input type="file" accept="image/*" multiple hidden onChange={(ev) => { const f = Array.from(ev.target.files ?? []); ev.target.value = ''; if (f.length) { void onUpload(f, upCaption.trim()); setUpCaption(''); } }} />
          </label>
        ) : null}
        {onUpload && canManage && <input className="input" style={{ maxWidth: 280 }} maxLength={200} value={upCaption} onChange={(e) => setUpCaption(e.target.value)} placeholder="Description (e.g. Century Spire, east facade)" aria-label="Cover photo description" />}
        <button className="btn btn-sm" onClick={onAdd}>Upload with full details</button>
        {canManage && candidates.length > 0 && (
          <>
            <select className="input" style={{ width: 'auto', maxWidth: 320 }} value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Photo to put on the cover">
              <option value="">Use an existing photo…</option>
              {candidates.map((e) => <option key={e.id} value={e.id}>{e.ref || e.kind} · {e.kind} · {e.caption || 'no description'}</option>)}
            </select>
            <button className="btn btn-sm btn-primary" disabled={!pick} onClick={() => add(pick)}>Add to cover</button>
          </>
        )}
        {!canManage && <span className="note">The project manager chooses which photos appear on the report cover.</span>}
      </div>
      {cover.length === 0 ? (
        <div className="empty">No cover photos yet. Upload a building or site photo (type “Reference”), then add it to the cover.</div>
      ) : (
        <div className="cover-grid">
          {cover.map((e, i) => {
            const ref = coverReference(e, i + 1, project.name);
            const sync = syncState?.(e.id);
            return (
              <figure key={e.id} className="cover-tile" style={{ width: `calc(${COVER_TILE_CM}cm + 2px)` }}>
                <div className="cover-square"><PhotoThumb id={e.id} storagePath={e.storagePath} alt={ref.title} /></div>
                <figcaption className="cover-ref">
                  <b>{ref.title}</b>{e.coverPrimary && <span className="pill pill-ok" style={{ marginLeft: 6 }}>Primary</span>}
                  <dl>{ref.lines.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
                  <span className="note">{sync ?? 'Saved'}</span>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {e.gps && <button className="btn btn-sm" onClick={() => setLoc({
                      ref: e.ref, projectName: project.name, projectCode: project.code, client: project.client, site: project.site, workArea: e.workArea, location: e.locationDetail,
                      lat: e.gps!.lat, lng: e.gps!.lng, accuracy: e.gps!.accuracy ?? null, source: e.gpsSource ?? null, status: e.gpsStatus, gpsAt: e.gps!.at, capturedAt: e.takenAt,
                    })}>View location</button>}
                    {ref.mapUrl && <a className="btn btn-sm" href={ref.mapUrl} target="_blank" rel="noreferrer">Map</a>}
                    {canManage && <>
                      <button className="btn btn-sm" disabled={i === 0} onClick={() => move(e, -1)} aria-label="Move earlier">←</button>
                      <button className="btn btn-sm" disabled={i === cover.length - 1} onClick={() => move(e, 1)} aria-label="Move later">→</button>
                      {!e.coverPrimary && <button className="btn btn-sm" onClick={() => primary(e)}>Make primary</button>}
                      <button className="btn btn-sm btn-danger" onClick={() => remove(e)}>Remove from cover</button>
                    </>}
                  </div>
                </figcaption>
              </figure>
            );
          })}
        </div>
      )}
      {loc && <LocationViewer info={loc} onClose={() => setLoc(null)} />}
    </section>
  );
}
