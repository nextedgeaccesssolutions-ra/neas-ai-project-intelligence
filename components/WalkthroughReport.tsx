'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { locatePhoto, photoRef, startGpsTracking, stopGpsTracking } from '@/lib/geo';
import PhotoThumb from '@/components/PhotoThumb';
import { notify } from '@/components/Dialogs';
import { todayLocal } from '@/lib/calc';
import { activityStatus } from '@/lib/fieldStatus';
import { fmtDate, fmtPct, uid } from '@/lib/format';
import { compressImage, putPhoto } from '@/lib/photos';
import type { Activity, Evidence, FieldReport } from '@/lib/types';

const MAX_BYTES = 5 * 1024 * 1024;

const latestPhoto = (activityId: string, evidence: Evidence[]) =>
  evidence.filter((e) => e.activityId === activityId).sort((x, y) => y.takenAt.localeCompare(x.takenAt))[0];

/**
 * Walkthrough → report: site photos on the left, the draft progress report they feed on the right.
 */
export default function WalkthroughReport({
  pid, projectName, activities, reports, evidence, addEvidence, onPick,
}: {
  pid: string;
  projectName: string;
  activities: Activity[];
  reports: FieldReport[];
  evidence: Evidence[];
  addEvidence: (e: Evidence) => void;
  onPick: (activityId: string) => void;
}) {
  const day = todayLocal();
  const fileRef = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState(activities[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  // Keep a GPS fix ready (works offline) so walkthrough photos are geotagged automatically.
  useEffect(() => { startGpsTracking(); return () => stopGpsTracking(); }, []);
  const withStatus = activities.map((a) => ({ a, s: activityStatus(a, reports, day), photo: latestPhoto(a.id, evidence) }));
  const issues = withStatus.filter((x) => x.s.tone === 'warn' || x.s.tone === 'bad').length;

  const takePhoto = (activityId: string) => {
    setTarget(activityId);
    fileRef.current?.click();
  };
  const savePhotos = async (files: File[]) => {
    const activityId = target || activities[0]?.id;
    if (!activityId || !files.length) return;
    setBusy(true);
    let ok = 0;
    const problems: string[] = [];
    for (const file of files) {
      if (!file.type.startsWith('image/')) { problems.push(`${file.name}: not an image`); continue; }
      try {
        const gps = await locatePhoto(file, { enabled: true });
        const blob = await compressImage(file);
        if (blob.size > MAX_BYTES) throw new Error('over 5 MB after compression');
        const id = uid('ev');
        const takenAt = new Date(file.lastModified || Date.now()).toISOString();
        await putPhoto(id, blob);
        addEvidence({ id, projectId: pid, activityId, kind: 'During', caption: file.name.replace(/\.[^.]+$/, ''), takenAt, bytes: blob.size, gps: gps.fix, gpsStatus: gps.status, pairId: null, ref: photoRef('During', takenAt, id) });
        ok++;
      } catch (e) {
        problems.push(`${file.name}: ${e instanceof Error ? e.message : 'could not be saved'}`);
      }
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
    const name = activities.find((a) => a.id === activityId)?.name ?? 'activity';
    notify(problems.length ? `${ok} photo(s) added to ${name}. ${problems.join('; ')}` : `${ok} photo(s) added to ${name}.`);
  };

  if (!activities.length) return null;

  return (
    <section className="wt">
      <div className="wt-hero">
        <div>
          <div className="wt-kicker">Walkthrough → report</div>
          <h2 className="wt-title">Your site photos become a <span>progress report</span></h2>
          <p className="wt-sub">From site walkthrough to draft report, in one place. Works offline; syncs when you are back online.</p>
        </div>
      </div>

      <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => savePhotos(Array.from(e.target.files ?? []))} />

      <div className="wt-split">
        <div className="wt-phone" aria-label="Walkthrough photos">
          <div className="wt-phone-head">
            <span>Walkthrough in progress</span>
            <span className="note">{fmtDate(day)}</span>
          </div>
          <div className="wt-shots">
            {withStatus.map(({ a, photo }) => (
              <figure className="wt-shot" key={a.id}>
                <figcaption className="wt-tag"><span aria-hidden>📷</span> {a.name}</figcaption>
                {photo ? (
                  <PhotoThumb id={photo.id} storagePath={photo.storagePath} alt={`${a.name}: ${photo.caption}`} className="wt-img" />
                ) : (
                  <button type="button" className="wt-img wt-empty" onClick={() => takePhoto(a.id)}>No photo yet · tap to add</button>
                )}
                <button type="button" className="wt-addsmall" onClick={() => takePhoto(a.id)} disabled={busy} aria-label={`Add photo for ${a.name}`}>＋</button>
              </figure>
            ))}
          </div>
          <div className="wt-phone-foot">
            <button type="button" className="wt-cam" onClick={() => takePhoto(target || activities[0].id)} disabled={busy} aria-label="Add photo">
              <span aria-hidden>📷</span>
            </button>
            <span>{busy ? 'Saving…' : 'Add photo'}</span>
          </div>
        </div>

        <div className="wt-arrows" aria-hidden><span>➜</span><span>➜</span><span>➜</span></div>

        <div className="wt-report" id="draft-report">
          <div className="wt-badge"><span aria-hidden>📄</span> Draft report<br />in seconds</div>
          <div className="wt-report-head">
            <div className="eyebrow">{projectName}</div>
            <h3>Field Progress Report</h3>
            <span className="pill">Draft for review</span>
            {issues > 0 && <span className="pill pill-warn" style={{ marginLeft: 6 }}>{issues} need attention</span>}
          </div>
          <ul className="wt-items">
            {withStatus.map(({ a, s, photo }) => (
              <li key={a.id}>
                <button type="button" className="wt-item" onClick={() => onPick(a.id)} title="Record progress for this activity">
                  {photo ? <PhotoThumb id={photo.id} storagePath={photo.storagePath} alt="" className="wt-mini" /> : <span className="wt-mini wt-mini-empty" aria-hidden>📷</span>}
                  <span className="wt-item-body">
                    <strong>{a.name}</strong>
                    <span className={`chip chip-${s.tone}`}><span aria-hidden>{s.icon}</span> {s.label}</span>
                    <span className="note">{s.detail}</span>
                  </span>
                  <span className="wt-chev" aria-hidden>›</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="wt-features">
        <div><span className="wt-ic" aria-hidden>📷</span><span>Photo →<br />Report</span></div>
        <div><span className="wt-ic" aria-hidden>📄</span><span>Exports to PDF,<br />Word &amp; Excel</span></div>
        <div><span className="wt-ic" aria-hidden>🏢</span><span>Organized<br />by project</span></div>
        <Link className="wt-cta" href="#new-report">Record progress <span aria-hidden>›</span></Link>
      </div>
    </section>
  );
}
