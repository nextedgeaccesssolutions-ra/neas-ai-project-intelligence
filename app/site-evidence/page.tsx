'use client';
import { noteServerVersions } from '@/lib/cloud/cloudSync';
import OrgToolbar, { dragSource, GroupHeader, MoveToMenu, UngroupZone } from '@/components/OrgToolbar';
import { itemKey, useCollapsed, useViewOrg, type ViewGroup } from '@/lib/viewOrg';
import { isClientAccount, useCloudStatus } from '@/lib/cloud/cloudSync';
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
import { allOps, onOutboxChange } from '@/lib/offline/outbox';
import { useCanManage } from '@/components/RoleGate';
import { supabaseBrowser } from '@/lib/cloud/browser';
import type { Evidence, EvidenceKind } from '@/lib/types';
import PhotoThumb, { fetchFromServer } from '@/components/PhotoThumb';
import LocationViewer, { type LocationInfo } from '@/components/LocationViewer';
import CoverPhotos from '@/components/CoverPhotos';
import LocationRequests, { REQUEST_LABEL, RequestLocationForm, useLocationRequests } from '@/components/LocationRequests';
import { COVER_CATEGORIES, type CoverCategory } from '@/lib/types';
import EvidenceReportPanel from '@/components/EvidenceReportPanel';
import { accuracyWarning, GPS_TARGET_M, gpsLabel, locatePhoto, parseManualCoords, photoRef, startGpsTracking, stopGpsTracking, subscribeGps, type GpsResult, type GpsTrack, gpsSourceOf, gpsSourceLabel, mapUrl } from '@/lib/geo';

const MAX_BYTES = 5 * 1024 * 1024;
const KINDS: EvidenceKind[] = ['Before', 'After', 'During', 'Inspection', 'Safety', 'Defect', 'Reference'];
const KIND_TONE: Record<EvidenceKind, string> = { Before: '', After: 'pill-ok', During: 'pill-warn', Inspection: '', Safety: 'pill-warn', Defect: 'pill-bad', Reference: '' };
const pairable = (k: EvidenceKind) => k === 'Before' || k === 'After';

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
  // client accounts see shared photos only and change nothing: no edit, pair, move or delete
  const client = CLOUD && isClientAccount();
  const [activityId, setActivityId] = useState('');
  const [kind, setKind] = useState<EvidenceKind>('Before');
  // capture form in Cover photo mode: saved photos go straight onto the report cover
  const [coverMode, setCoverMode] = useState(false);
  const [caption, setCaption] = useState('');
  const [workArea, setWorkArea] = useState('');
  const [coverCategory, setCoverCategory] = useState<CoverCategory>('main_building');
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
  const [layout, setLayoutState] = useState<'2x4' | '2x6'>(() => { try { return localStorage.getItem('neas-evidence-layout') === '2x6' ? '2x6' : '2x4'; } catch { return '2x4'; } });
  const setLayout = (l: '2x4' | '2x6') => { setLayoutState(l); setPage(0); try { localStorage.setItem('neas-evidence-layout', l); } catch { /* per-device convenience only */ } };
  const [page, setPage] = useState(0);
  const cloud = useCloudStatus();
  const org = useViewOrg('evidence', cloud.profile?.id ?? null);
  const sectionsOpen = useCollapsed('neas-evidence-groups-open');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [showHidden, setShowHidden] = useState(false);
  const [renaming, setRenamingState] = useState<ViewGroup | null>(null);
  const [renameTo, setRenameTo] = useState('');
  const setRenaming = (g: ViewGroup | null) => { setRenamingState(g); setRenameTo(g?.name ?? ''); };
  const [viewLoc, setViewLoc] = useState<LocationInfo | null>(null);
  const [requestFor, setRequestFor] = useState<Evidence | null>(null);
  const locReq = useLocationRequests(CLOUD ? pid : '');
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!CLOUD) return;
    const load = () => allOps().then((ops) => setPendingIds(new Set(ops.map((o) => o.record_id)))).catch(() => undefined);
    load();
    return onOutboxChange(load);
  }, []);
  const [clientVisible, setClientVisible] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [moveArea, setMoveArea] = useState('');
  const [moveLoc, setMoveLoc] = useState('');
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
    const { data, error: err } = await supabaseBrowser()!.from('report_attachments').update({ client_visible: val }).eq('id', id).select('id, version');
    if (err) return setError(`Could not update: ${err.message}`);
    await noteServerVersions('report_attachments', data ?? []);
    setClientVisible((prev) => ({ ...prev, [id]: val }));
    notify(val ? 'Shared with client.' : 'Hidden from client.');
  };

  const name = (id: string) => activities.find((a) => a.id === id)?.name ?? '(deleted activity)';
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const partnerOf = (e: Evidence) => (e.pairId ? evidence.find((x) => x.pairId === e.pairId && x.id !== e.id) : undefined);

  /** Compress and store photos with capture time, GPS (when allowed) and work-area location. */
  const addPhotos = async (files: File[], opts?: { cover?: boolean; caption?: string }) => {
    const asCover = !!opts?.cover || coverMode;
    // continue after the highest existing cover position, so a removed photo never leaves a duplicate number
    let coverNext = Math.max(0, ...evidence.filter((x) => x.isCover).map((x) => x.coverOrder ?? 0));
    const actId = activityId || (asCover ? activities[0]?.id ?? '' : '');
    if (!actId) return setError('Choose an activity first.');
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
          id, projectId: pid, activityId: actId, kind, caption: (opts?.caption || caption).trim() || file.name.replace(/\.[^.]+$/, ''), takenAt, bytes: blob.size,
          gps: gps.fix, gpsStatus: gps.status, gpsSource: gpsSourceOf(gps), coverCategory: kind === 'Reference' ? coverCategory : null, workArea: workArea.trim(), locationDetail: locationDetail.trim(), pairId: null, ref: photoRef(kind, takenAt, id),
          // a cover upload is a building / site reference photo placed straight on the report cover
          ...(asCover ? { kind: 'Reference' as const, coverCategory: coverCategory, isCover: true, coverOrder: ++coverNext, ref: photoRef('Reference', takenAt, id) } : {}),
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

  // client visibility for many photos at once: the selected ones, or every photo in the current view
  const setClientVisibleMany = async (ids: string[], val: boolean) => {
    if (!ids.length) return;
    if (!(await askConfirm(`${val ? 'Show' : 'Hide'} ${ids.length} photo(s) ${val ? 'to' : 'from'} the client?`, { danger: false }))) return;
    const { data, error: err } = await supabaseBrowser()!.from('report_attachments').update({ client_visible: val }).in('id', ids).select('id, version');
    if (err) return setError(`Could not update: ${err.message}`);
    await noteServerVersions('report_attachments', data ?? []);
    setClientVisible((prev) => ({ ...prev, ...Object.fromEntries(ids.map((id) => [id, val])) }));
    notify(`${ids.length} photo(s) ${val ? 'shared with' : 'hidden from'} the client.`);
  };

  // pair unpaired BEFORE and AFTER photos that share activity, work area and location (in capture order)
  const detailKey = (e: Evidence) => [e.activityId, (e.workArea ?? '').trim().toLowerCase(), (e.locationDetail ?? '').trim().toLowerCase()].join('|');
  const autoPairs = (() => {
    const open = evidence.filter((e) => pairable(e.kind) && !partnerOf(e) && (e.workArea ?? '').trim());
    const out: [Evidence, Evidence][] = [];
    const groups = new Map<string, Evidence[]>();
    for (const e of open) groups.set(detailKey(e), [...(groups.get(detailKey(e)) ?? []), e]);
    for (const list of groups.values()) {
      const bs = list.filter((e) => e.kind === 'Before').sort((a, b) => a.takenAt.localeCompare(b.takenAt));
      const as = list.filter((e) => e.kind === 'After').sort((a, b) => a.takenAt.localeCompare(b.takenAt));
      for (let i = 0; i < Math.min(bs.length, as.length); i++) out.push([bs[i], as[i]]);
    }
    return out;
  })();
  const runAutoPair = async () => {
    if (!(await askConfirm(`Pair ${autoPairs.length} BEFORE/AFTER set(s) that share the same activity, work area and location? You can re-pair or unpair any of them afterwards.`, { danger: false }))) return;
    for (const [b, a] of autoPairs) { const pairId = uid('pair'); updateEvidence(b.id, { pairId }); updateEvidence(a.id, { pairId }); }
    notify(`Paired ${autoPairs.length} set(s) by details.`);
  };

  const ql = q.trim().toLowerCase();
  const shown = evidence.filter((e) =>
    (!fActivity || e.activityId === fActivity) &&
    (fKind ? e.kind === fKind : e.kind !== 'Reference') &&
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

  // personal hide and saved groups: view only, the photos themselves never change
  const listed = shown.filter((e) => (showHidden ? org.hiddenSet.has(itemKey('attachment', e.id)) : !org.hiddenSet.has(itemKey('attachment', e.id))));
  const projGroups = org.groups.filter((g) => g.project_id === pid);
  const sections = showHidden ? [] : projGroups.map((g) => ({ g, items: listed.filter((e) => org.groupOf.get(itemKey('attachment', e.id))?.id === g.id) })).filter((x) => x.items.length);
  const ungrouped = showHidden ? listed : listed.filter((e) => !org.groupOf.get(itemKey('attachment', e.id)) || !projGroups.some((g) => g.id === org.groupOf.get(itemKey('attachment', e.id))!.id));
  // drag-and-drop and "Move to": into a group of this project, or back to the main list
  const movePhotos = async (ids: string[], gid: string | null) => {
    // only photos shown here, and only out of groups this person may change
    const canChange = (i: string) => { const cur = org.groupOf.get(itemKey('attachment', i)); return !cur || cur.scope === 'personal' || reviewer; };
    const keep = ids.filter((i) => listed.some((e) => e.id === i)).filter(canChange);
    if (keep.length < ids.length) notify(`${ids.length - keep.length} photo(s) are in a shared group only a project manager can change, and were left where they are.`);
    if (!keep.length) return;
    if (gid === null) { done(await org.ungroup('attachment', keep), 'Moved back to the main list.'); return; }
    const g = projGroups.find((x) => x.id === gid);
    if (!g || !(g.scope === 'personal' || reviewer)) { notify('You cannot add photos to that group.'); return; }
    done(!!(await org.group(pid, 'attachment', keep, { id: g.id })), `Moved ${keep.length} photo(s) to “${g.name}”. The photos themselves did not change.`);
  };
  // change the work area / location of the selected photos (e.g. a photo filed under the wrong floor); a blank field keeps each photo's own value
  const moveLocation = async () => {
    const area = moveArea.trim(), loc = moveLoc.trim();
    if (!area && !loc) return notify('Type the new work area or location.');
    if (!(await askConfirm(`Move ${pickedIds.length} photo(s) to ${[area, loc].filter(Boolean).join(' · ')}? A BEFORE/AFTER pair stays paired.`, { danger: false }))) return;
    for (const id of pickedIds) {
      const e = byId.get(id);
      if (e) updateEvidence(id, { ...(area ? { workArea: area } : {}), ...(loc ? { locationDetail: loc } : {}) });
    }
    done(true, `Moved ${pickedIds.length} photo(s) to ${[area, loc].filter(Boolean).join(' · ')}.`);
    setMoveArea(''); setMoveLoc('');
  };
  const photoNo = new Map(listed.map((e, i) => [e.id, i]));
  const togglePick = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const pickedIds = [...picked].filter((id) => listed.some((e) => e.id === id));
  const done = (ok: boolean, msg: string) => { if (ok) { notify(msg); setPicked(new Set()); } };
  const filtersOn = fActivity || fKind || fGps || fPair || ql;
  const perPage = layout === '2x6' ? 12 : 8;
  // required evidence: shown only for the activity being filtered, never filled with other photos
  const reqAct = fActivity ? activities.find((a) => a.id === fActivity) : undefined;
  const reqHave = reqAct ? evidence.filter((e) => e.activityId === reqAct.id).length : 0;
  const reqMissing = reqAct?.requiredPhotos && !showHidden && !fKind && !fGps && !fPair && !ql ? Math.max(0, reqAct.requiredPhotos - reqHave) : 0;
  const slots = ungrouped.length + reqMissing;
  const pages = Math.max(1, Math.ceil(slots / perPage));
  const pg = Math.min(page, pages - 1);
  const pageItems = ungrouped.slice(pg * perPage, (pg + 1) * perPage);
  const pageMissing = Math.max(0, Math.min(perPage - pageItems.length, slots - pg * perPage - pageItems.length));
  const withReq = activities.filter((a) => a.requiredPhotos);
  const locationOf = (e: Evidence): LocationInfo => ({
    ref: e.ref, projectName: project?.name ?? '', projectCode: project?.code, client: project?.client, site: project?.site,
    workArea: e.workArea, location: e.locationDetail, lat: e.gps?.lat ?? null, lng: e.gps?.lng ?? null, accuracy: e.gps?.accuracy ?? null,
    source: e.gpsSource ?? (e.gpsStatus === 'manual' ? 'manual' : null), status: e.gpsStatus, gpsAt: e.gps?.at ?? null, capturedAt: e.takenAt,
  });
  const addFor = (actId: string) => { setActivityId(actId); document.getElementById('capture-card')?.scrollIntoView({ behavior: 'smooth' }); };
  const pager = pages > 1 && (
    <div className="grid-pager" role="navigation" aria-label="Gallery pages">
      <button className="btn btn-sm" disabled={pg === 0} onClick={() => setPage(pg - 1)}>‹ Previous</button>
      <span className="note">Page {pg + 1} of {pages}</span>
      <button className="btn btn-sm" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}>Next ›</button>
    </div>
  );

  const card = (e: Evidence) => {
    const isEditing = editing === e.id;
    const edits = e.editCount ?? 0;
    const canEdit = !client && (!CLOUD || reviewer || edits < 1);
    const needsApproval = !client && CLOUD && !reviewer && edits >= 1;
    const partner = partnerOf(e);
    const from = pairFrom ? byId.get(pairFrom) : undefined;
    const canPairHere = !!from && from.id !== e.id && pairable(e.kind) && from.kind !== e.kind;
    return (
      <figure key={e.id} className={`photo ${picked.has(e.id) ? 'picked' : ''}`} style={{ margin: 0, outline: pairFrom === e.id ? '3px solid var(--gold)' : undefined }} {...(showHidden || pairFrom || isEditing ? {} : dragSource(e.id, picked))}>
      <input type="checkbox" className="pick" checked={picked.has(e.id)} onChange={() => togglePick(e.id)} aria-label={`Select ${e.ref || e.kind} ${e.caption}`} />
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
              <input className="input" list="ev-areas" value={editArea} onChange={(ev) => setEditArea(ev.target.value)} maxLength={200} placeholder="Work area" />
              <input className="input" list="ev-locs" value={editLoc} onChange={(ev) => setEditLoc(ev.target.value)} maxLength={300} placeholder="Building / floor / elevation / grid" />
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
              {/* same three lines as the photo captions in reports: Photo n · ref · kind / description / date · activity · area · location */}
              <span><b>{[`Photo ${(photoNo.get(e.id) ?? 0) + 1}`, e.ref].filter(Boolean).join(' · ')} · </b><span className={`pill ${KIND_TONE[e.kind]}`}>{e.kind}</span></span>
              <span>{e.caption || <span className="note">No description</span>}</span>
              <span>{[new Date(e.takenAt).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }), name(e.activityId), e.workArea, e.locationDetail].filter(Boolean).join(' · ')}</span>
              <span className="note">{(e.bytes / 1024).toFixed(0)} KB{edits > 0 && ` · edited ${edits}×`}</span>
              <span className="note" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                📍 {gpsLabel(e)}
                {accuracyWarning(e) && <span className="pill pill-warn">Low accuracy</span>}
                {e.gps && <button className="btn btn-sm" style={{ padding: '0 6px' }} onClick={() => setViewLoc(locationOf(e))}>View location</button>}
                {(() => { const r = locReq.list.find((x) => x.attachment_id === e.id && (x.status === 'pending' || x.status === 'clarification')); return r ? <span className="pill pill-warn">{REQUEST_LABEL[r.status]}</span> : null; })()}
                {CLOUD && !locReq.list.some((x) => x.attachment_id === e.id && x.status === 'pending') && <button className="btn btn-sm" style={{ padding: '0 6px' }} onClick={() => setRequestFor(e)}>Request manual location</button>}
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
                {reviewer && !pairFrom && !e.isCover && <button className="btn btn-sm" onClick={() => { updateEvidence(e.id, { isCover: true, coverOrder: Math.max(0, ...evidence.filter((x) => x.isCover).map((x) => x.coverOrder ?? 0)) + 1 }); notify('Added to the report cover photos.'); }}>Set as cover</button>}
                {!client && !showHidden && !pairFrom && <MoveToMenu groups={projGroups.filter((g) => g.scope === 'personal' || reviewer)} current={org.groupOf.get(itemKey('attachment', e.id))?.id ?? null} currentEditable={(() => { const cur = org.groupOf.get(itemKey('attachment', e.id)); return !cur || cur.scope === 'personal' || reviewer; })()} onMove={(gid) => void movePhotos([e.id], gid)} />}
                {canEdit && !pairFrom && <button className="btn btn-sm" onClick={() => { setEditing(e.id); setEditKind(e.kind); setEditCaption(e.caption); setEditActivity(e.activityId); setEditArea(e.workArea ?? ''); setEditLoc(e.locationDetail ?? ''); }}>Edit</button>}
                {needsApproval && <span className="note pill pill-warn">Needs admin approval to edit again</span>}
                {canEdit && !pairFrom && <button className="btn btn-sm btn-danger" onClick={() => askConfirm('Delete this photo? If it has not synced yet, it is lost.', { danger: true }).then((ok) => { if (!ok) return; if (partner) updateEvidence(partner.id, { pairId: null }); deleteEvidence(e.id); })}>Delete</button>}
              </div>
            </>
          )}
        </figcaption>
      </figure>
    );
  };

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
          <Link className="btn btn-sm btn-primary" href="/reports">Preview reports</Link>
        </div>
      </div>
      <ProjectBar />
      <EvidenceReportPanel
        audience="internal"
        preparedBy={state.userName || 'NEAS'}
        project={{ code: project.code ?? project.id, name: project.name, client: project.client, site: project.site, referenceNo: project.referenceNo, status: project.status, startDate: project.startDate, endDate: project.endDate }}
        photos={evidence.map((e) => ({
          id: e.id, kind: e.kind, caption: e.caption, takenAt: e.takenAt, ref: e.ref, activity: activities.find((a) => a.id === e.activityId)?.name,
          workArea: e.workArea, location: e.locationDetail, pairId: e.pairId, gps: e.gps ? gpsLabel(e) : undefined, gpsSource: e.gps ? gpsSourceLabel(e.gpsSource, e.gpsStatus) : undefined, mapUrl: mapUrl(e.gps?.lat, e.gps?.lng),
        }))}
        load={async (p) => (await getPhoto(p.id).catch(() => undefined)) ?? (CLOUD ? await fetchFromServer(p.id, evidence.find((e) => e.id === p.id)?.storagePath ?? `${pid}/${p.id}.jpg`) : null)}
      />

      <div className="user-stats">
        <div className="user-stat"><div className="user-stat-val">{stats.before} / {stats.after}</div><div className="user-stat-label">Before / After photos</div></div>
        <div className="user-stat"><div className="user-stat-val">{stats.pairs}</div><div className="user-stat-label">Before/after pairs</div></div>
        <div className="user-stat"><div className="user-stat-val">{stats.unpaired}</div><div className="user-stat-label">Missing a match</div></div>
        <div className="user-stat"><div className="user-stat-val">{stats.geotagged}</div><div className="user-stat-label">GPS-tagged</div></div>
        <div className="user-stat"><div className="user-stat-val">{stats.noGps}</div><div className="user-stat-label">Without GPS</div></div>
      </div>

      <section className="card" id="capture-card">
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
                <select className="input" value={coverMode ? '__cover' : kind} onChange={(e) => { const v = e.target.value; setCoverMode(v === '__cover'); setKind(v === '__cover' ? 'Reference' : v as EvidenceKind); }}>
                  {KINDS.map((k) => <option key={k} value={k}>{k === 'Reference' ? 'Reference (building / site, for the report cover)' : k}</option>)}
                  {reviewer && <option value="__cover">Cover photo (goes straight on the report cover)</option>}
                </select>
              </label>
              {kind === 'Reference' && (
                <label className="field">Cover photo category
                  <select className="input" value={coverCategory} onChange={(e) => setCoverCategory(e.target.value as CoverCategory)}>
                    {COVER_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </label>
              )}
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
              {!CLOUD && (
                <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="checkbox" checked={manualLoc} onChange={(e) => setManualLoc(e.target.checked)} /> Enter location manually
                </label>
              )}
              {manualLoc && (
                <>
                  <input className="input" style={{ maxWidth: 150 }} inputMode="decimal" value={manualLat} onChange={(e) => setManualLat(e.target.value)} placeholder="Latitude" aria-label="Latitude" />
                  <input className="input" style={{ maxWidth: 150 }} inputMode="decimal" value={manualLng} onChange={(e) => setManualLng(e.target.value)} placeholder="Longitude" aria-label="Longitude" />
                </>
              )}
            </div>
            {recordGps && !manualLoc && (
              <ul className="note" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                <li>Allow precise location for this app and turn on the phone's location services.</li>
                <li>Turn on the camera's location tag so photos keep their own GPS.</li>
                <li>When practical, take photos outdoors with a clear view of the sky, and wait for the fix (target {GPS_TARGET_M} m) before capturing.</li>
                {CLOUD && <li>No GPS? Save the photo anyway, then use “Request manual location” on it; an admin approves the coordinates.</li>}
              </ul>
            )}
            <p className="note">
              {manualLoc ? 'Device mode: manual coordinates are saved as a manual location, never as device GPS.'
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

      {CLOUD && <LocationRequests evidence={evidence} canDecide={reviewer} list={locReq.list} reload={locReq.reload} />}

      {project && (
        <CoverPhotos
          project={project}
          evidence={evidence}
          canManage={reviewer}
          updateEvidence={updateEvidence}
          syncState={(id) => (!CLOUD ? 'Saved on this device' : pendingIds.has(id) ? 'Waiting to sync' : 'Synced')}
          onAdd={() => { setKind('Reference'); document.getElementById('capture-card')?.scrollIntoView({ behavior: 'smooth' }); }}
          onUpload={(files, cap) => addPhotos(files, { cover: true, caption: cap })}
        />
      )}

      <section className="card" id="evidence-card">
        <div className="card-head">
          <h2>Evidence gallery ({listed.length}{filtersOn || showHidden ? ` of ${evidence.length}` : ''})</h2>
          <label className="note" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>Layout
            <select className="input" style={{ width: 'auto' }} value={layout} onChange={(e) => setLayout(e.target.value as '2x4' | '2x6')}>
              <option value="2x4">2 × 4 (8 per page)</option>
              <option value="2x6">2 × 6 (12 per page)</option>
            </select>
          </label>
        </div>
        {withReq.length > 0 && (
          <div className="banner" style={{ marginBottom: 10, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <b>Required evidence</b>
            {withReq.map((a) => {
              const have = evidence.filter((e) => e.activityId === a.id).length;
              const done = have >= (a.requiredPhotos ?? 0);
              return (
                <span key={a.id} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <button className="btn btn-sm" onClick={() => { setFActivity(a.id); setPage(0); }} title="Show this scope's photos and missing slots">{a.name}</button>
                  <span className={`pill ${done ? 'pill-ok' : 'pill-warn'}`}>{have} of {a.requiredPhotos}{done ? '' : ` · ${a.requiredPhotos! - have} missing`}</span>
                </span>
              );
            })}
          </div>
        )}
        <div className="form-grid" style={{ marginBottom: 12 }}>
          <label className="field">Search<input className="input" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Reference, description, work area" /></label>
          <label className="field">Activity<select className="input" value={fActivity} onChange={(e) => { setFActivity(e.target.value); setPage(0); }}><option value="">All activities</option>{activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label className="field">Type<select className="input" value={fKind} onChange={(e) => { setFKind(e.target.value); setPage(0); }}><option value="">All types</option>{KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
          <label className="field">GPS<select className="input" value={fGps} onChange={(e) => { setFGps(e.target.value); setPage(0); }}><option value="">Any</option><option value="with">With location</option><option value="without">Without GPS</option><option value="manual">Manually entered</option><option value="warning">Accuracy warning</option></select></label>
          <label className="field">Pairing<select className="input" value={fPair} onChange={(e) => { setFPair(e.target.value); setPage(0); }}><option value="">Any</option><option value="paired">Paired</option><option value="unpaired">Missing a match</option></select></label>
        </div>
        {(!CLOUD || reviewer) && !showHidden && listed.length > 0 && (
          <div className="form-actions" style={{ marginTop: 0, marginBottom: 10 }}>
            {CLOUD && <>
              <button className="btn btn-sm" onClick={() => setClientVisibleMany(pickedIds.length ? pickedIds : listed.map((e) => e.id), true)}>Show {pickedIds.length ? `${pickedIds.length} selected` : `all ${listed.length}`} to client</button>
              <button className="btn btn-sm" onClick={() => setClientVisibleMany(pickedIds.length ? pickedIds : listed.map((e) => e.id), false)}>Hide {pickedIds.length ? `${pickedIds.length} selected` : `all ${listed.length}`} from client</button>
            </>}
            <button className="btn btn-sm btn-primary" disabled={!autoPairs.length} onClick={runAutoPair} title="Matches unpaired BEFORE and AFTER photos with the same activity, work area and location">Auto-pair by details ({autoPairs.length})</button>
          </div>
        )}
        {(!CLOUD || reviewer) && pickedIds.length > 0 && (
          <div className="form-actions" style={{ marginTop: 0, marginBottom: 10, alignItems: 'center' }}>
            <span className="note">Move {pickedIds.length} selected photo(s) to another location:</span>
            <input className="input" style={{ width: 160 }} list="ev-areas" value={moveArea} onChange={(ev) => setMoveArea(ev.target.value)} maxLength={200} placeholder="Work area" />
            <input className="input" style={{ width: 220 }} list="ev-locs" value={moveLoc} onChange={(ev) => setMoveLoc(ev.target.value)} maxLength={300} placeholder="Building / floor / elevation / grid" />
            <button className="btn btn-sm btn-primary" onClick={() => void moveLocation()}>Move</button>
          </div>
        )}
        <datalist id="ev-areas">{[...new Set(evidence.map((e) => (e.workArea ?? '').trim()).filter(Boolean))].sort().map((v) => <option key={v} value={v} />)}</datalist>
        <datalist id="ev-locs">{[...new Set(evidence.map((e) => (e.locationDetail ?? '').trim()).filter(Boolean))].sort().map((v) => <option key={v} value={v} />)}</datalist>
        {pairFrom && byId.get(pairFrom) && (
          <div className="banner" style={{ marginBottom: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            Pairing {byId.get(pairFrom)!.ref || byId.get(pairFrom)!.kind}: choose the matching {byId.get(pairFrom)!.kind === 'Before' ? 'AFTER' : 'BEFORE'} photo.
            <button className="btn btn-sm" onClick={() => setPairFrom(null)}>Cancel</button>
          </div>
        )}
        <OrgToolbar
          selected={pickedIds.length}
          groups={projGroups.filter((g) => g.scope === 'personal' || reviewer)}
          canShare={CLOUD && reviewer}
          showHidden={showHidden}
          hiddenCount={evidence.filter((e) => org.hiddenSet.has(itemKey('attachment', e.id))).length}
          anyGrouped={pickedIds.some((id) => org.groupOf.has(itemKey('attachment', id)))}
          onGroup={async (t) => { const ok = !!(await org.group(pid, 'attachment', pickedIds, t)); done(ok, `Grouped ${pickedIds.length} photo(s). The photos themselves did not change.`); return ok; }}
          onUngroup={async () => done(await org.ungroup('attachment', pickedIds), 'Ungrouped. The photos are back in the main list.')}
          onHide={async () => done(await org.hide(() => pid, 'attachment', pickedIds), `Hidden from your view: ${pickedIds.length} photo(s). Find them under Hidden items.`)}
          onUnhide={async () => done(await org.unhide(() => pid, 'attachment', pickedIds), 'Back in your list.')}
          onToggleHidden={() => { setShowHidden((v) => !v); setPicked(new Set()); setPage(0); }}
          onClear={() => setPicked(new Set())}
          onSelectAll={() => setPicked(new Set(listed.map((e) => e.id)))}
          allSelected={listed.length > 0 && listed.every((e) => picked.has(e.id))}
          total={listed.length}
          onDelete={async () => {
            // same rule as each photo's own Delete button
            const ok = client ? [] : pickedIds.map((id) => byId.get(id)).filter((e): e is Evidence => !!e && (!CLOUD || reviewer || (e.editCount ?? 0) < 1));
            if (!ok.length) return notify('You cannot delete these photos. Ask a project manager.');
            if (!(await askConfirm(`Delete ${ok.length} photo(s)?${ok.length < pickedIds.length ? ` ${pickedIds.length - ok.length} you may not delete are skipped.` : ''} Photos that have not synced yet are lost.`, { danger: true }))) return;
            for (const e of ok) { const p = partnerOf(e); if (p && !ok.includes(p)) updateEvidence(p.id, { pairId: null }); deleteEvidence(e.id); }
            done(true, `Deleted ${ok.length} photo(s).`);
          }}
        />
        {org.error && <p className="bad" role="alert">{org.error} <button className="linklike" onClick={org.clearError}>Dismiss</button></p>}
        {showHidden && <p className="note">Hidden only from your own view. Hiding never deletes a photo or changes who can see it; other people and reports still include it.</p>}
        {sections.length > 0 && (
          <div className="form-actions" style={{ marginTop: 0 }}>
            <button className="btn btn-sm" onClick={() => sectionsOpen.setAll(sections.map((x) => x.g.id))}>Expand all groups</button>
            <button className="btn btn-sm" onClick={() => sectionsOpen.setAll([])}>Collapse all groups</button>
          </div>
        )}
        {sections.map(({ g, items }) => {
          const editable = g.scope === 'personal' || reviewer;
          return (
            <div key={g.id}>
              <GroupHeader label={g.name} count={items.length} open={sectionsOpen.isOpen(g.id)} onToggle={() => sectionsOpen.toggle(g.id)} badge={g.scope === 'project' ? 'Shared with project' : 'Only you'}
                onDropItems={editable ? (ids) => void movePhotos(ids, g.id) : undefined}
                onRename={editable ? () => setRenaming(g) : undefined}
                onRemove={editable ? () => askConfirm(`Remove the group "${g.name}"? Its ${items.length} photo(s) go back to the main list. No photo is deleted.`, { danger: false }).then(async (ok) => { if (ok && await org.remove(g)) notify('Group removed. The photos are back in the main list.'); }) : undefined} />
              {sectionsOpen.isOpen(g.id) && <div className={`evidence-grid layout-${layout}`}>{items.map(card)}</div>}
            </div>
          );
        })}
        {renaming && (
          <form className="org-form" onSubmit={async (ev) => { ev.preventDefault(); if (await org.rename(renaming, renameTo)) { notify('Group renamed.'); setRenaming(null); } }}>
            <label className="field">New name for “{renaming.name}”<input className="input" autoFocus maxLength={80} required value={renameTo} onChange={(ev) => setRenameTo(ev.target.value)} /></label>
            <div className="form-actions"><button className="btn btn-sm btn-primary">Rename</button><button type="button" className="btn btn-sm" onClick={() => setRenaming(null)}>Cancel</button></div>
          </form>
        )}
        {sections.length > 0 && slots > 0 && <h3 className="share-sub">Not in a group ({ungrouped.length})</h3>}
        {sections.length > 0 && !showHidden && <UngroupZone label="Drag photos here to take them out of their group · or drag them onto a group name above" onDrop={(ids) => void movePhotos(ids, null)} />}
        {slots === 0 ? (sections.length ? null : <div className="empty">{showHidden ? 'You have not hidden any photos.' : evidence.length ? 'No photos match these filters.' : 'No field evidence captured yet.'}</div>) : (
          <>{pager}
          <div className={`evidence-grid layout-${layout}`}>
            {pageItems.map(card)}
            {Array.from({ length: pageMissing }, (_, i) => (
              <div key={`missing-${i}`} className="slot-empty">
                <div className="slot-box">
                  <b>Photo not provided</b>
                  <span>Required evidence for {reqAct?.name} ({reqHave} of {reqAct?.requiredPhotos})</span>
                  {reqAct && <button className="btn btn-sm btn-primary" onClick={() => addFor(reqAct.id)}>Add photo</button>}
                </div>
              </div>
            ))}
          </div>
          {pager}</>
        )}
      </section>
      {viewLoc && <LocationViewer info={viewLoc} onClose={() => setViewLoc(null)} />}
      {requestFor && <RequestLocationForm pid={pid} photo={requestFor} onCancel={() => setRequestFor(null)} onDone={() => { setRequestFor(null); notify('Sent for approval. The photo keeps its current location until an admin approves.'); void locReq.reload(); }} />}
    </>
  );
}
