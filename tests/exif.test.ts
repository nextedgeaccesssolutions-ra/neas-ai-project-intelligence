import { describe, expect, it } from 'vitest';
import { parseExifGps, readExifGps } from '../lib/exif';
import { locatePhoto } from '../lib/geo';

/** Builds a minimal JPEG whose EXIF holds a GPS IFD (little- or big-endian). */
function jpegWithGps(o: { lat: number; latRef: 'N' | 'S'; lng: number; lngRef: 'E' | 'W'; alt?: number; err?: number; le?: boolean }): ArrayBuffer {
  const le = o.le ?? true;
  const tiff: number[] = [];
  const u16 = (n: number) => (le ? [n & 255, n >> 8] : [n >> 8, n & 255]);
  const u32 = (n: number) => (le ? [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24] : [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
  const dms = (v: number) => { const d = Math.floor(v); const mf = (v - d) * 60; const m = Math.floor(mf); const s = Math.round((mf - m) * 60 * 1000); return [[d, 1], [m, 1], [s, 1000]]; };
  const tags: { tag: number; type: number; count: number; inline?: number[]; data?: number[] }[] = [
    { tag: 1, type: 2, count: 2, inline: [o.latRef.charCodeAt(0), 0, 0, 0] },
    { tag: 2, type: 5, count: 3, data: dms(o.lat).flatMap(([a, b]) => [...u32(a), ...u32(b)]) },
    { tag: 3, type: 2, count: 2, inline: [o.lngRef.charCodeAt(0), 0, 0, 0] },
    { tag: 4, type: 5, count: 3, data: dms(o.lng).flatMap(([a, b]) => [...u32(a), ...u32(b)]) },
  ];
  if (o.alt != null) tags.push({ tag: 5, type: 1, count: 1, inline: [0, 0, 0, 0] }, { tag: 6, type: 5, count: 1, data: [...u32(Math.round(o.alt * 100)), ...u32(100)] });
  if (o.err != null) tags.push({ tag: 31, type: 5, count: 1, data: [...u32(Math.round(o.err * 10)), ...u32(10)] });
  const ifd0 = 8, ifd0Size = 2 + 12 + 4, gpsIfd = ifd0 + ifd0Size, gpsSize = 2 + tags.length * 12 + 4;
  let dataOff = gpsIfd + gpsSize;
  tiff.push(...(le ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(ifd0));
  tiff.push(...u16(1), ...u16(0x8825), ...u16(4), ...u32(1), ...u32(gpsIfd), ...u32(0));
  tiff.push(...u16(tags.length));
  const blobs: number[] = [];
  for (const t of tags) {
    tiff.push(...u16(t.tag), ...u16(t.type), ...u32(t.count));
    if (t.inline) tiff.push(...t.inline);
    else { tiff.push(...u32(dataOff)); blobs.push(...t.data!); dataOff += t.data!.length; }
  }
  tiff.push(...u32(0), ...blobs);
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const bytes = [0xff, 0xd8, 0xff, 0xe1, (app1.length + 2) >> 8, (app1.length + 2) & 255, ...app1, 0xff, 0xd9];
  return new Uint8Array(bytes).buffer;
}

describe('EXIF GPS reader (works offline)', () => {
  it('reads latitude, longitude, altitude and positioning error', () => {
    const g = parseExifGps(jpegWithGps({ lat: 14.554729, latRef: 'N', lng: 121.024445, lngRef: 'E', alt: 35.5, err: 4.8 }));
    expect(g!.lat).toBeCloseTo(14.554729, 5);
    expect(g!.lng).toBeCloseTo(121.024445, 5);
    expect(g!.altitude).toBeCloseTo(35.5, 2);
    expect(g!.accuracy).toBeCloseTo(4.8, 2);
  });
  it('applies S/W hemispheres and big-endian files', () => {
    const g = parseExifGps(jpegWithGps({ lat: 33.8688, latRef: 'S', lng: 151.2093, lngRef: 'W', le: false }));
    expect(g!.lat).toBeCloseTo(-33.8688, 4);
    expect(g!.lng).toBeCloseTo(-151.2093, 4);
    expect(g!.accuracy).toBeNull();
  });
  it('returns null for non-JPEG data or files without GPS', () => {
    expect(parseExifGps(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer)).toBeNull();
    expect(parseExifGps(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer)).toBeNull();
  });
  it('reads from a Blob', async () => {
    const blob = new Blob([jpegWithGps({ lat: 10, latRef: 'N', lng: 20, lngRef: 'E' })], { type: 'image/jpeg' });
    expect((await readExifGps(blob))!.lat).toBeCloseTo(10, 5);
  });
});

describe('locatePhoto', () => {
  it("uses the photo's own GPS first", async () => {
    const f = new File([jpegWithGps({ lat: 14.5, latRef: 'N', lng: 121, lngRef: 'E', err: 3 })], 'p.jpg', { type: 'image/jpeg', lastModified: 0 });
    const r = await locatePhoto(f, { enabled: true });
    expect(r).toMatchObject({ status: 'captured', source: 'photo' });
    expect(r.fix!.accuracy).toBeCloseTo(3, 2);
  });
  it('never stamps an older photo without GPS with today\'s position', async () => {
    const now = Date.parse('2026-10-23T10:00:00Z');
    const f = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'old.jpg', { type: 'image/jpeg', lastModified: now - 24 * 3600_000 });
    expect(await locatePhoto(f, { enabled: true, now })).toMatchObject({ status: 'unavailable', fix: null });
  });
  it('respects GPS being turned off', async () => {
    const f = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'x.jpg', { type: 'image/jpeg' });
    expect(await locatePhoto(f, { enabled: false })).toMatchObject({ status: 'not_requested' });
  });
});
