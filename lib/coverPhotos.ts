// Report cover photos: which evidence records are on the cover, in what order, and the location
// reference printed under each one. Pure functions shared by the web preview and the PDF.
import { COVER_CATEGORIES, type Evidence, type GpsSource, type GpsStatus } from './types';
import { mapUrl } from './geo';

/** Physical tile size required for cover photos (exactly 9.21 cm square). */
export const COVER_TILE_CM = 9.21;
export const COVER_TILE_PT = (COVER_TILE_CM / 2.54) * 72; // 261.07 pt in the PDF

/** Standard location-source labels used on the cover and in the location register. */
export function gpsSourceShort(source: GpsSource | null | undefined, status?: GpsStatus | string | null, hasCoords = true): string {
  if (!hasCoords) return status === 'no_photo_gps' ? 'GPS Unavailable — Original Photo Has No GPS' : 'GPS Unavailable';
  if (source === 'exif') return 'EXIF GPS';
  if (source === 'device') return 'Device GPS';
  if (source === 'manual' || status === 'manual') return 'Manual Location — Admin Approved';
  return 'GPS (source not recorded)';
}

export const coverCategoryLabel = (c?: string | null) => COVER_CATEGORIES.find((x) => x.value === c)?.label ?? '';

/** Cover photos in display order: the primary photo first, then the chosen order, then capture time. */
export function coverPhotos<T extends Pick<Evidence, 'isCover' | 'coverPrimary' | 'coverOrder' | 'takenAt'>>(all: T[]): T[] {
  return all
    .filter((e) => e.isCover)
    .slice()
    .sort((a, b) => Number(!!b.coverPrimary) - Number(!!a.coverPrimary) || (a.coverOrder ?? 999) - (b.coverOrder ?? 999) || a.takenAt.localeCompare(b.takenAt));
}

/** New order values after moving one cover photo up or down (others keep their relative order). */
export function reorderCover(ids: string[], id: string, dir: -1 | 1): Map<string, number> {
  const list = ids.slice();
  const i = list.indexOf(id), j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return new Map(list.map((x, k) => [x, k + 1]));
  [list[i], list[j]] = [list[j], list[i]];
  return new Map(list.map((x, k) => [x, k + 1]));
}

export interface CoverRef {
  title: string;
  lines: [string, string][];
  mapUrl: string | null;
}

/** Location reference for one cover photo; every value comes from the photo record. */
export function coverReference(
  e: Pick<Evidence, 'caption' | 'coverCategory' | 'workArea' | 'locationDetail' | 'gps' | 'gpsSource' | 'gpsStatus' | 'takenAt' | 'ref'>,
  n: number, projectName: string, tz = 'Asia/Manila',
): CoverRef {
  const has = !!e.gps && Number.isFinite(e.gps.lat) && Number.isFinite(e.gps.lng);
  const label = coverCategoryLabel(e.coverCategory) || e.caption || 'Site photo';
  const when = new Intl.DateTimeFormat('en-PH', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(e.takenAt));
  const lines: [string, string][] = [
    ['Project', projectName],
    ['Site reference', [e.workArea, e.locationDetail].filter(Boolean).join(' · ') || e.caption || 'Not provided'],
    ['Latitude', has ? e.gps!.lat.toFixed(6) : 'GPS Unavailable'],
    ['Longitude', has ? e.gps!.lng.toFixed(6) : 'GPS Unavailable'],
  ];
  if (has && e.gps!.accuracy != null) lines.push(['Accuracy', `±${Math.round(e.gps!.accuracy)} m (reported by the device)`]);
  lines.push(['Location source', gpsSourceShort(e.gpsSource, e.gpsStatus, has)]);
  lines.push(['Captured', when]);
  return {
    title: `Photo ${String(n).padStart(2, '0')} — ${label}${e.caption && e.caption !== label ? ` · ${e.caption}` : ''}`,
    lines,
    mapUrl: has ? mapUrl(e.gps!.lat, e.gps!.lng) : null,
  };
}
