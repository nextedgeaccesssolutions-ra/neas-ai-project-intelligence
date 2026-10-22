import type { Evidence, GpsFix, GpsStatus } from './types';

/** Default target accuracy for ordinary outdoor site documentation (metres). */
export const GPS_TARGET_M = 10;

export interface GpsResult { status: GpsStatus; fix: GpsFix | null; error?: string }

/** One device position, as close to capture time as possible. Never throws, never blocks forever. */
export function readPosition(timeoutMs = 15000): Promise<GpsResult> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve({ status: 'unavailable', fix: null, error: 'This device or browser has no location service.' });
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({
        status: 'captured',
        fix: {
          lat: round(p.coords.latitude, 6), lng: round(p.coords.longitude, 6),
          accuracy: Number.isFinite(p.coords.accuracy) ? round(p.coords.accuracy, 2) : null,
          altitude: p.coords.altitude == null ? null : round(p.coords.altitude, 2),
          heading: p.coords.heading == null || Number.isNaN(p.coords.heading) ? null : round(p.coords.heading % 360, 2),
          at: new Date(p.timestamp || Date.now()).toISOString(),
        },
      }),
      (err) => resolve({ status: err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable', fix: null, error: err.message }),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

/** Parses a typed coordinate pair ("14.5547, 121.0244"); null when it is not a valid pair. */
export function parseManualCoords(lat: string, lng: string): GpsFix | null {
  const a = Number(lat.trim()), b = Number(lng.trim());
  if (!lat.trim() || !lng.trim() || !Number.isFinite(a) || !Number.isFinite(b) || a < -90 || a > 90 || b < -180 || b > 180) return null;
  return { lat: round(a, 6), lng: round(b, 6), accuracy: null, at: new Date().toISOString() };
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
