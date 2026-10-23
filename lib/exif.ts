// Reads the GPS position a camera wrote into a JPEG (EXIF GPS IFD). Works fully offline.
export interface ExifGps { lat: number; lng: number; altitude: number | null; accuracy: number | null }

export function parseExifGps(buf: ArrayBuffer): ExifGps | null {
  const v = new DataView(buf);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;
  let off = 2;
  while (off + 4 <= v.byteLength) {
    if (v.getUint8(off) !== 0xff) return null;
    const marker = v.getUint8(off + 1);
    const size = v.getUint16(off + 2);
    if (marker === 0xe1 && off + 10 <= v.byteLength && v.getUint32(off + 4) === 0x45786966 && v.getUint16(off + 8) === 0) {
      return readTiff(v, off + 10, off + 2 + size);
    }
    if (marker === 0xda || marker === 0xd9) return null;
    off += 2 + size;
  }
  return null;
}

function readTiff(v: DataView, start: number, end: number): ExifGps | null {
  if (start + 8 > end || end > v.byteLength) return null;
  const le = v.getUint16(start) === 0x4949;
  const u16 = (o: number) => v.getUint16(start + o, le);
  const u32 = (o: number) => v.getUint32(start + o, le);
  const inRange = (o: number, n: number) => start + o >= start && start + o + n <= end;
  const entries = (ifd: number) => {
    if (!inRange(ifd, 2)) return [];
    const n = u16(ifd);
    const out: { tag: number; type: number; count: number; valOff: number }[] = [];
    for (let i = 0; i < n && i < 200; i++) {
      const e = ifd + 2 + i * 12;
      if (!inRange(e, 12)) break;
      out.push({ tag: u16(e), type: u16(e + 2), count: u32(e + 4), valOff: e + 8 });
    }
    return out;
  };
  const gpsPtr = entries(u32(4)).find((e) => e.tag === 0x8825);
  if (!gpsPtr) return null;
  const gps = new Map(entries(u32(gpsPtr.valOff)).map((e) => [e.tag, e]));
  const rational = (e: { valOff: number }, i: number) => {
    const p = u32(e.valOff) + i * 8;
    if (!inRange(p, 8)) return NaN;
    const den = u32(p + 4);
    return den ? u32(p) / den : NaN;
  };
  const ascii = (tag: number) => {
    const e = gps.get(tag);
    return e ? String.fromCharCode(v.getUint8(start + e.valOff)) : '';
  };
  const dms = (tag: number) => {
    const e = gps.get(tag);
    if (!e || e.type !== 5 || e.count < 3) return NaN;
    return rational(e, 0) + rational(e, 1) / 60 + rational(e, 2) / 3600;
  };
  let lat = dms(2), lng = dms(4);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (ascii(1) === 'S') lat = -lat;
  if (ascii(3) === 'W') lng = -lng;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  const altE = gps.get(6);
  let altitude = altE && altE.type === 5 ? rational(altE, 0) : NaN;
  if (Number.isFinite(altitude) && gps.get(5) && v.getUint8(start + gps.get(5)!.valOff) === 1) altitude = -altitude;
  const errE = gps.get(31);
  const accuracy = errE && errE.type === 5 ? rational(errE, 0) : NaN;
  const r = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
  return {
    lat: r(lat, 6), lng: r(lng, 6),
    altitude: Number.isFinite(altitude) ? r(altitude, 2) : null,
    accuracy: Number.isFinite(accuracy) ? r(accuracy, 2) : null,
  };
}

/** GPS embedded in a photo file, or null (not a JPEG, no GPS, or the browser stripped it). */
export async function readExifGps(file: Blob): Promise<ExifGps | null> {
  if (file.type && !/jpe?g/i.test(file.type)) return null;
  try {
    return parseExifGps(await file.slice(0, 256 * 1024).arrayBuffer());
  } catch {
    return null;
  }
}
