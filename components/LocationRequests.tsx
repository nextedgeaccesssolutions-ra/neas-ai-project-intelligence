'use client';
// Manual photo locations: members propose coordinates for a photo; the project manager or a Super
// Admin approves, rejects or asks for clarification (never their own request). Only an approved
// request changes the photo's location; pending ones are never shown as a location.
import { useCallback, useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/cloud/browser';
import { pullAll, useCloudStatus } from '@/lib/cloud/cloudSync';
import { gpsLabel, mapUrl, parseManualCoords } from '@/lib/geo';
import type { Evidence } from '@/lib/types';

export interface LocationRequest {
  id: string; attachment_id: string; lat: number; lng: number; site_ref: string; reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'clarification'; requested_by: string; requested_at: string;
  decided_by: string | null; decided_at: string | null; decision_note: string;
}
const when = (s: string) => new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
export const REQUEST_LABEL: Record<LocationRequest['status'], string> = {
  pending: 'Manual Location — Pending Approval', approved: 'Manual Location — Admin Approved', rejected: 'Rejected', clarification: 'Clarification requested',
};

/** Loads the project's location requests and keeps them fresh. */
export function useLocationRequests(pid: string) {
  const [list, setList] = useState<LocationRequest[]>([]);
  const load = useCallback(async () => {
    const sb = supabaseBrowser();
    if (!sb || !pid) return;
    const { data } = await sb.from('location_requests').select('*').eq('project_id', pid).order('requested_at', { ascending: false }).limit(200);
    setList(((data ?? []) as LocationRequest[]).map((r) => ({ ...r, lat: Number(r.lat), lng: Number(r.lng) })));
  }, [pid]);
  useEffect(() => { void load(); }, [load]);
  return { list, reload: load };
}

/** "Request manual location" form for one photo. */
export function RequestLocationForm({ pid, photo, onDone, onCancel }: { pid: string; photo: Evidence; onDone: () => void; onCancel: () => void }) {
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [site, setSite] = useState(photo.locationDetail ?? '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    const fix = parseManualCoords(lat, lng);
    if (!fix) return setErr('Enter a valid latitude (−90 to 90) and longitude (−180 to 180).');
    if (reason.trim().length < 3) return setErr('Give the reason for the manual location.');
    if (!navigator.onLine) return setErr('You are offline. Requests are sent to an admin, so connect and try again.');
    setBusy(true); setErr(null);
    const { data: u } = await supabaseBrowser()!.auth.getUser();
    const { error } = await supabaseBrowser()!.from('location_requests').insert({ project_id: pid, attachment_id: photo.id, lat: fix.lat, lng: fix.lng, site_ref: site.trim(), reason: reason.trim(), requested_by: u.user?.id });
    setBusy(false);
    if (error) return setErr(error.code === '23505' ? 'This photo already has a request waiting for approval.' : error.code === '23503' || /belong/.test(error.message) ? 'This photo has not reached the server yet. Wait for it to sync, then try again.' : error.message);
    onDone();
  };
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Request manual location" onClick={onCancel}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="card-head"><h2>Request manual location · {photo.ref || photo.kind}</h2><button className="btn btn-sm" onClick={onCancel} aria-label="Close">✕</button></div>
        <p className="note" style={{ marginTop: 0 }}>Current location: {gpsLabel(photo)}. Your coordinates go to the project manager or a Super Admin for approval. Until then nothing changes on the photo, and once approved they are labelled “Manual Location — Admin Approved”, never GPS.</p>
        <div className="form-grid">
          <label className="field">Latitude<input className="input" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="14.585771" /></label>
          <label className="field">Longitude<input className="input" inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="121.029367" /></label>
          <label className="field" style={{ gridColumn: 'span 2' }}>Site / building reference<input className="input" maxLength={200} value={site} onChange={(e) => setSite(e.target.value)} placeholder="Tower A · north facade · L12" /></label>
          <label className="field" style={{ gridColumn: 'span 2' }}>Reason<input className="input" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. GPS unavailable inside the gondola; position from the site plan" /></label>
        </div>
        {err && <p className="bad" role="alert">{err}</p>}
        <div className="form-actions"><button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? 'Sending…' : 'Send for approval'}</button><button className="btn" onClick={onCancel}>Cancel</button></div>
      </div>
    </div>
  );
}

/** Approval queue and history for the project. */
export default function LocationRequests({ evidence, canDecide, list, reload }: { evidence: Evidence[]; canDecide: boolean; list: LocationRequest[]; reload: () => Promise<void> }) {
  const me = useCloudStatus().profile;
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const open = list.filter((r) => r.status === 'pending' || r.status === 'clarification');
  const shown = showAll ? list : open;
  const photo = (id: string) => evidence.find((e) => e.id === id);
  const decide = async (r: LocationRequest, decision: 'approved' | 'rejected' | 'clarification') => {
    setMsg(null);
    const { error } = await supabaseBrowser()!.rpc('decide_location_request', { p_id: r.id, p_decision: decision, p_note: notes[r.id] ?? '' });
    if (error) return setMsg({ ok: false, text: error.message });
    setMsg({ ok: true, text: decision === 'approved' ? 'Approved: the photo now shows this manual location.' : decision === 'rejected' ? 'Rejected: the photo keeps its original location status.' : 'Clarification requested.' });
    await reload();
    if (decision === 'approved') await pullAll().catch(() => undefined);
  };
  if (!list.length) return null;
  return (
    <section className="card" id="location-requests">
      <div className="card-head">
        <h2>Manual location requests ({open.length} open)</h2>
        <button className="btn btn-sm" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show open only' : `Show all (${list.length})`}</button>
      </div>
      {msg && <p className={msg.ok ? 'ok' : 'bad'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}
      {!shown.length ? <div className="empty">No open requests.</div> : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Photo</th><th>Proposed location</th><th>Site reference</th><th>Reason</th><th>Requested</th><th>Status</th>{canDecide && <th>Decision</th>}</tr></thead>
            <tbody>
              {shown.map((r) => {
                const p = photo(r.attachment_id);
                const own = r.requested_by === me?.id;
                const canAct = canDecide && (r.status === 'pending' || r.status === 'clarification');
                return (
                  <tr key={r.id}>
                    <td>{p?.ref || p?.kind || r.attachment_id.slice(0, 8)}<div className="note">{p?.caption}</div></td>
                    <td>{r.lat.toFixed(6)}, {r.lng.toFixed(6)}{mapUrl(r.lat, r.lng) && <div><a href={mapUrl(r.lat, r.lng)!} target="_blank" rel="noreferrer">Check on map</a></div>}</td>
                    <td>{r.site_ref || '—'}</td>
                    <td className="note">{r.reason}</td>
                    <td className="note">{when(r.requested_at)}{own ? ' · you' : ''}</td>
                    <td><span className={`pill ${r.status === 'approved' ? 'pill-ok' : r.status === 'rejected' ? 'pill-bad' : 'pill-warn'}`}>{REQUEST_LABEL[r.status]}</span>{r.decision_note && <div className="note">{r.decision_note}</div>}{r.decided_at && <div className="note">{when(r.decided_at)}</div>}</td>
                    {canDecide && (
                      <td style={{ minWidth: 220 }}>
                        {canAct ? (own && me?.global_role !== 'super_admin' ? <span className="note">Another admin must decide your own request.</span> : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <input className="input" placeholder="Note (required to reject or clarify)" value={notes[r.id] ?? ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              <button className="btn btn-sm btn-primary" onClick={() => decide(r, 'approved')}>Approve</button>
                              <button className="btn btn-sm btn-danger" onClick={() => decide(r, 'rejected')}>Reject</button>
                              <button className="btn btn-sm" onClick={() => decide(r, 'clarification')}>Ask to clarify</button>
                            </div>
                          </div>
                        )) : <span className="note">—</span>}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
