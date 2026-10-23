'use client';
// Recorded photo location: details always (also offline), map when online. Never shows a pin
// without real coordinates, and says plainly that GPS is the phone's position, not the object's.
import { useEffect, useState } from 'react';
import type { GpsSource, GpsStatus } from '@/lib/types';
import { accuracyStatus, gpsSourceLabel, GPS_TARGET_M, mapUrl } from '@/lib/geo';

export interface LocationInfo {
  ref?: string;
  projectName: string;
  projectCode?: string;
  client?: string;
  site?: string;
  workArea?: string;
  location?: string;
  lat: number | null;
  lng: number | null;
  accuracy?: number | null;
  source?: GpsSource | null;
  status?: GpsStatus;
  gpsAt?: string | null;
  capturedAt?: string | null;
  uploadedAt?: string | null;
}

const when = (s?: string | null) => (s ? new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Not recorded');

export function verificationLabel(i: Pick<LocationInfo, 'lat' | 'source' | 'status' | 'accuracy'>): string {
  if (i.lat == null) return 'No usable location';
  if (i.source === 'manual' || i.status === 'manual') return 'Manually entered: not verified by GPS';
  if (i.accuracy == null) return 'GPS fix, accuracy not reported';
  return i.accuracy <= GPS_TARGET_M ? `GPS fix within the ${GPS_TARGET_M} m target` : `GPS fix above the ${GPS_TARGET_M} m target: treat as approximate`;
}

export default function LocationViewer({ info, onClose }: { info: LocationInfo; onClose: () => void }) {
  const [online, setOnline] = useState(true);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const upd = () => setOnline(navigator.onLine);
    upd();
    window.addEventListener('online', upd); window.addEventListener('offline', upd);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('online', upd); window.removeEventListener('offline', upd); window.removeEventListener('keydown', esc); };
  }, [onClose]);
  const has = info.lat != null && info.lng != null;
  const coords = has ? `${info.lat!.toFixed(6)}, ${info.lng!.toFixed(6)}` : '';
  const rows: [string, string][] = [
    ['Photo reference', info.ref || 'Not recorded'],
    ['Project', [info.projectCode, info.projectName].filter(Boolean).join(' · ')],
    ...(info.client ? [['Client', info.client] as [string, string]] : []),
    ...(info.site ? [['Site', info.site] as [string, string]] : []),
    ['Work area', [info.workArea, info.location].filter(Boolean).join(' · ') || 'Not provided'],
    ['Latitude, longitude', has ? coords : 'GPS unavailable'],
    ['Reported accuracy', has ? `${info.accuracy != null ? `±${Math.round(info.accuracy)} m · ` : ''}${accuracyStatus(info.accuracy, true)}` : '—'],
    ['Location source', has ? gpsSourceLabel(info.source, info.status) : 'GPS unavailable'],
    ['Location time', has ? when(info.gpsAt) : '—'],
    ['Photo captured', when(info.capturedAt)],
    ...(info.uploadedAt ? [['Uploaded', when(info.uploadedAt)] as [string, string]] : []),
    ['Verification', verificationLabel(info)],
  ];
  const copy = () => {
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1500); };
    navigator.clipboard?.writeText(coords).then(done, () => window.prompt?.('Coordinates', coords));
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Photo location" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <h2>Photo location{info.ref ? ` · ${info.ref}` : ''}</h2>
          <button className="btn btn-sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {has && (online
          ? <TileMap lat={info.lat!} lng={info.lng!} accuracy={info.accuracy ?? null} />
          : <div className="location-map location-offline">Offline: the map cannot load, but the saved coordinates below are complete.</div>)}
        <dl className="location-list">
          {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
        {has && (
          <div className="form-actions" style={{ marginTop: 8 }}>
            <a className="btn btn-sm" href={`https://www.openstreetmap.org/?mlat=${info.lat}&mlon=${info.lng}#map=19/${info.lat}/${info.lng}`} target="_blank" rel="noreferrer">Open in OpenStreetMap</a>
            <a className="btn btn-sm" href={mapUrl(info.lat, info.lng) ?? undefined} target="_blank" rel="noreferrer">View location on map</a>
            <button className="btn btn-sm" onClick={copy}>{copied ? 'Copied' : 'Copy coordinates'}</button>
          </div>
        )}
        <p className="note" style={{ marginBottom: 0 }}>
          GPS records where the phone was, within the reported accuracy. It does not identify the exact surface, window, panel or component photographed; the work area says that.
        </p>
      </div>
    </div>
  );
}

/** OpenStreetMap tiles around the point, with a pin and the reported accuracy circle (no iframe, no API key). */
function TileMap({ lat, lng, accuracy }: { lat: number; lng: number; accuracy: number | null }) {
  const [failed, setFailed] = useState(false);
  const z = 18, T = 256, W = 3 * T, H = 2 * T;
  const n = 2 ** z;
  const fx = ((lng + 180) / 360) * n;
  const r = (lat * Math.PI) / 180;
  const fy = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  // top-left tile so the point sits in the middle of a 3 × 2 tile view
  const x0 = Math.floor(fx - 1.5), y0 = Math.floor(fy - 1);
  const px = (fx - x0) * T, py = (fy - y0) * T;
  const mPerPx = (156543.03392 * Math.cos(r)) / n;
  const rad = accuracy != null ? Math.max(4, accuracy / mPerPx) : 0;
  if (failed) return <div className="location-map location-offline">The map could not load. The saved coordinates below are complete.</div>;
  return (
    <div className="location-map" style={{ position: 'relative', overflow: 'hidden', padding: 0 }}>
      <svg viewBox={`${px - W / 2} ${py - H / 2} ${W} ${H}`} preserveAspectRatio="xMidYMid slice" style={{ width: '100%', height: '100%', display: 'block' }} role="img" aria-label="Map of the recorded photo location">
        {[0, 1, 2, 3].map((i) => [0, 1, 2].map((j) => (
          <image key={`${i}-${j}`} href={`https://tile.openstreetmap.org/${z}/${x0 + i}/${y0 + j}.png`} x={i * T} y={j * T} width={T} height={T} onError={() => setFailed(true)} />
        )))}
        {rad > 0 && <circle cx={px} cy={py} r={rad} fill="rgba(202,147,50,.18)" stroke="#9a6c1c" strokeWidth={1.5} />}
        <path d={`M ${px} ${py} l -9 -22 a 10 10 0 1 1 18 0 z`} fill="#c0392b" stroke="#fff" strokeWidth={2} />
        <circle cx={px} cy={py - 26} r={3.5} fill="#fff" />
      </svg>
      <span style={{ position: 'absolute', right: 4, bottom: 2, fontSize: 10, background: 'rgba(255,255,255,.8)', padding: '0 4px' }}>© OpenStreetMap contributors</span>
    </div>
  );
}
