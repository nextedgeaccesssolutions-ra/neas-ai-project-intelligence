import { describe, expect, it } from 'vitest';
import { accuracyStatus, mapUrl } from '../lib/geo';
import { buildReport, type ReportPhoto } from '../lib/evidenceReport';
import { buildReportFile, validateMapLinks } from '../lib/evidenceExport';

describe('map links', () => {
  it('builds Google Maps links only from valid coordinates', () => {
    expect(mapUrl(14.585771, 121.029367)).toBe('https://www.google.com/maps?q=14.585771,121.029367');
    expect(mapUrl(null, 121)).toBeNull();
    expect(mapUrl(91, 0)).toBeNull();
    expect(mapUrl(0, -181)).toBeNull();
    expect(mapUrl(Number.NaN, 1)).toBeNull();
  });
  it('reports accuracy against the 10 m target without improving it', () => {
    expect(accuracyStatus(9.9)).toBe('Target Accuracy Met');
    expect(accuracyStatus(10)).toBe('Target Accuracy Met');
    expect(accuracyStatus(10.1)).toBe('Accuracy Above Target');
    expect(accuracyStatus(null)).toBe('Accuracy Not Reported');
    expect(accuracyStatus(5, false)).toBe('GPS Unavailable');
  });
});

describe('export files carry a real hyperlink per located photo', () => {
  const photos: ReportPhoto[] = [
    { id: 'a', kind: 'Before', caption: 'North', takenAt: '2026-10-20T02:00:00Z', gps: '14.585771, 121.029367 ±6 m', mapUrl: mapUrl(14.585771, 121.029367) },
    { id: 'b', kind: 'After', caption: 'South', takenAt: '2026-10-21T02:00:00Z', gps: '14.585900, 121.029500 ±12 m', mapUrl: mapUrl(14.5859, 121.0295) },
    { id: 'c', kind: 'After', caption: 'No GPS', takenAt: '2026-10-22T02:00:00Z' },
  ];
  const report = buildReport({ kind: 'site_evidence', layout: '2x4', audience: 'internal', project: { code: 'P-1', name: 'Facade' }, photos, preparedBy: 'QA', generatedAt: new Date('2026-10-23T08:00:00Z') });
  const expected = photos.map((p) => p.mapUrl).filter((u): u is string => !!u);
  for (const format of ['pdf', 'docx', 'pptx'] as const) {
    it(`${format}: each located photo links to its own coordinates, none for the photo without GPS`, async () => {
      const blob = await buildReportFile(report, format, new Map());
      const check = await validateMapLinks(format, blob, expected);
      expect(check).toMatchObject({ ok: true, found: 2, missing: [] });
      const wrong = await validateMapLinks(format, blob, ['https://www.google.com/maps?q=1.000000,1.000000']);
      expect(wrong.ok).toBe(false);
    }, 30000);
  }
});

import { safeCell } from '../lib/sheetSchema';
describe('Google Sheet cells', () => {
  it('keeps the app map link as a formula and neutralises formulas typed by users', () => {
    expect(safeCell('=HYPERLINK("https://www.google.com/maps?q=14.585771,121.029367","VIEW LOCATION ON MAP")')).toMatch(/^=HYPERLINK/);
    expect(safeCell('=IMPORTXML("https://evil","//a")')).toBe(`'=IMPORTXML("https://evil","//a")`);
    expect(safeCell('+1 floor')).toBe("'+1 floor");
    expect(safeCell(-5)).toBe(-5);
    expect(safeCell('North facade')).toBe('North facade');
  });
});
