import type { Evidence, GpsFix, GpsStatus, GpsSource } from './types';
import { readExifGps } from './exif';

/** Default target accuracy for ordinary outdoor site documentation (metres). */
export const GPS_TARGET_M = 10;
/** A live fix this old or newer counts as "now" for a photo just taken. */
const FRESH_FIX_MS = 30_000;
/** A photo file modified within this window is treated as just taken with the camera. */
const FRESH_PHOTO_MS = 5 * 60_000;

export interface GpsResult { status: GpsStatus; fix: GpsFix | null; error?: string; source?: 'photo' | 'device' }

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
const toFix = (p: GeolocationPosition): GpsFix => ({
  lat: round(p.coords.latitude, 6), lng: round(p.coords.longitude, 6),
  accuracy: Number.isFinite(p.coords.accuracy) ? round(p.coords.accuracy, 2) : null,
  altitude: p.coords.altitude == null ? null : round(p.coords.altitude, 2),
  heading: p.coords.heading == null || Number.isNaN(p.coords.heading) ? null : round(p.coords.heading % 360, 2),
  at: new Date(p.timestamp || Date.now()).toISOString(),
});
const better = (a: GpsFix | null, b: GpsFix) => !a || (b.accuracy ?? Infinity) <= (a.accuracy ?? Infinity) || Date.parse(b.at) - Date.parse(a.at) > 10_000;
const hasGeo = () => typeof navigator !== 'undefined' && !!navigator.geolocation;
const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

// ---- Always-on tracking: keeps the newest fix ready so capture is instant. Device GPS needs no internet. ----
export interface GpsTrack { state: 'off' | 'searching' | 'ready' | 'denied' | 'unavailable'; fix: GpsFix | null; error?: string }
let track: GpsTrack = { state: 'off', fix: null };
let watchId: number | null = null;
const listeners = new Set<(t: GpsTrack) => void>();
const emit = (t: GpsTrack) => { track = t; listeners.forEach((l) => l(t)); };

export function startGpsTracking() {
  if (watchId != null) return;
  if (!hasGeo()) return emit({ state: 'unavailable', fix: null, error: 'This device or browser has no location service.' });
  emit({ state: 'searching', fix: track.fix });
  watchId = navigator.geolocation.watchPosition(
    (p) => { const f = toFix(p); emit({ state: 'ready', fix: better(track.fix, f) ? f : track.fix }); },
    (err) => {
      if (err.code === err.PERMISSION_DENIED) { stopGpsTracking(); emit({ state: 'denied', fix: null, error: err.message }); }
      else if (track.state !== 'ready') emit({ state: 'searching', fix: track.fix, error: err.message });
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 60_000 },
  );
}
export function stopGpsTracking() {
  if (watchId != null && hasGeo()) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  if (track.state === 'searching' || track.state === 'ready') emit({ state: 'off', fix: track.fix });
}
export function subscribeGps(l: (t: GpsTrack) => void) { listeners.add(l); l(track); return () => { listeners.delete(l); }; }
const freshTrackedFix = () => (track.fix && Date.now() - Date.parse(track.fix.at) <= FRESH_FIX_MS ? track.fix : null);

/**
 * Best device position now: waits for a fix at or under the target accuracy, or the best one seen
 * before the time limit (longer when offline, where satellite-only fixes take longer). Never throws.
 */
export function readPosition(timeoutMs = offline() ? 45_000 : 20_000, target = GPS_TARGET_M): Promise<GpsResult> {
  if (!hasGeo()) return Promise.resolve({ status: 'unavailable', fix: null, error: 'This device or browser has no location service.' });
  const warm = freshTrackedFix();
  if (warm && warm.accuracy != null && warm.accuracy <= target) return Promise.resolve({ status: 'captured', fix: warm, source: 'device' });
  return new Promise((resolve) => {
    let best: GpsFix | null = warm;
    let done = false;
    const finish = (r: GpsResult) => { if (done) return; done = true; navigator.geolocation.clearWatch(id); clearTimeout(timer); resolve(r); };
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const f = toFix(p);
        if (better(best, f)) best = f;
        if (f.accuracy != null && f.accuracy <= target) finish({ status: 'captured', fix: f, source: 'device' });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) finish({ status: 'denied', fix: null, error: err.message });
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: timeoutMs },
    );
    const timer = setTimeout(() => finish(best ? { status: 'captured', fix: best, source: 'device' } : { status: 'unavailable', fix: null, error: 'No GPS fix in time.' }), timeoutMs);
  });
}

/**
 * Location for one photo, never invented:
 * 1. the GPS the camera wrote into the photo (exactly where it was taken; works offline);
 * 2. otherwise, for a photo just taken, the device's current fix;
 * 3. otherwise (an older photo with no location) "unavailable" — today's position would be wrong.
 */
export async function locatePhoto(file: File, opts: { enabled: boolean; now?: number }): Promise<GpsResult> {
  const exif = await readExifGps(file);
  if (exif) return { status: 'captured', source: 'photo', fix: { lat: exif.lat, lng: exif.lng, accuracy: exif.accuracy, altitude: exif.altitude, at: new Date(file.lastModified || Date.now()).toISOString() } };
  if (!opts.enabled) return { status: 'not_requested', fix: null };
  const age = (opts.now ?? Date.now()) - (file.lastModified || Date.now());
  if (age > FRESH_PHOTO_MS) return { status: 'unavailable', fix: null, error: 'Older photo without a saved location.' };
  return readPosition();
}

/** Parses a typed coordinate pair ("14.5547, 121.0244"); null when it is not a valid pair. */
export function parseManualCoords(lat: string, lng: string): GpsFix | null {
  const a = Number(lat.trim()), b = Number(lng.trim());
  if (!lat.trim() || !lng.trim() || !Number.isFinite(a) || !Number.isFinite(b) || a < -90 || a > 90 || b < -180 || b > 180) return null;
  return { lat: round(a, 6), lng: round(b, 6), accuracy: null, at: new Date().toISOString() };
}

/** The stored source for a capture result: camera EXIF, device position at capture, or typed in. */
export const gpsSourceOf = (g: GpsResult): GpsSource | null => (g.status === 'manual' && g.fix ? 'manual' : g.fix ? (g.source === 'photo' ? 'exif' : 'device') : null);

export function gpsSourceLabel(source: GpsSource | null | undefined, status?: GpsStatus): string {
  if (source === 'exif') return 'Camera GPS saved in the photo';
  if (source === 'device') return 'Device position recorded during capture';
  if (source === 'manual' || status === 'manual') return 'Manually entered (not GPS-verified)';
  return status === 'captured' ? 'GPS (source not recorded)' : 'GPS unavailable';
}

export const accuracyWarning = (e: Pick<Evidence, 'gps' | 'gpsStatus'>, target = GPS_TARGET_M) =>
  e.gpsStatus === 'captured' && e.gps && (e.gps.accuracy == null || e.gps.accuracy > target);

export function gpsLabel(e: Pick<Evidence, 'gps' | 'gpsStatus'>): string {
  switch (e.gpsStatus) {
    case 'captured': return e.gps ? `${e.gps.lat.toFixed(6)}, ${e.gps.lng.toFixed(6)}${e.gps.accuracy != null ? ` ±${Math.round(e.gps.accuracy)} m` : ' (accuracy unknown)'}` : 'GPS unavailable';
    case 'manual': return e.gps ? `${e.gps.lat.toFixed(6)}, ${e.gps.lng.toFixed(6)} (manually entered)` : 'GPS unavailable';
    case 'denied': return 'GPS unavailable (location permission denied)';
    case 'unavailable': return 'GPS unavailable';
    default: return 'No GPS recorded';
  }
}

const KIND_CODE: Record<Evidence['kind'], string> = { Before: 'BEF', After: 'AFT', During: 'DUR', Inspection: 'INS', Safety: 'SAF', Defect: 'DEF' };
/** Photo reference such as BEF-20261023-1A2B (local capture date, suffix from the record id). */
export function photoRef(kind: Evidence['kind'], takenAt: string, id: string) {
  const d = new Date(takenAt);
  const ymd = Number.isNaN(d.getTime()) ? takenAt.slice(0, 10).replace(/-/g, '')
    : `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `${KIND_CODE[kind]}-${ymd}-${id.replace(/-/g, '').slice(0, 4).toUpperCase()}`;
}
