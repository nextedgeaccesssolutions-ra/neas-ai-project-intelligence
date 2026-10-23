import { describe, expect, it } from 'vitest';
import { buildReport, NOT_PROVIDED, photoCaption, type ReportInput, type ReportPhoto } from '../lib/evidenceReport';

const photo = (i: number, o: Partial<ReportPhoto> = {}): ReportPhoto => ({
  id: `p${i}`, kind: i % 2 ? 'Before' : 'After', caption: `Photo ${i}`, takenAt: `2026-10-${String(10 + (i % 10)).padStart(2, '0')}T02:00:00Z`,
  ref: `DUR-${i}`, activity: 'Notch 1 Window Cleaning', workArea: 'Notch F-1', gps: '14.585771, 121.029367 ±10 m', ...o,
});
const base = (o: Partial<ReportInput> = {}): ReportInput => ({
  kind: 'site_evidence', layout: '2x4', audience: 'internal', preparedBy: 'Junrey Granaderos', generatedAt: new Date('2026-10-23T08:30:00Z'),
  project: { code: 'NEAS-0027-3-26', name: 'Supply of Materials & Manpower for Window Cleaning', client: 'Dalkia Incorporated', site: 'Warehouse 4 RDC Business Complex, Mercedes Ave., Cainta', status: 'active', referenceNo: '', startDate: '2026-09-15', endDate: null },
  photos: Array.from({ length: 19 }, (_, i) => photo(i)), ...o,
});

describe('site evidence report', () => {
  it('opens with a title page carrying the full project title and real project details', () => {
    const r = buildReport(base());
    const f = Object.fromEntries(r.fields);
    expect(f['Project title']).toBe('Supply of Materials & Manpower for Window Cleaning');
    expect(f['Project ID']).toBe('NEAS-0027-3-26');
    expect(f.Client).toBe('Dalkia Incorporated');
    expect(f.Site).toContain('Cainta');
    expect(f['Project start']).toBeTruthy();
    expect(f['Scope of work']).toBe('Notch 1 Window Cleaning');
    expect(f['Report reference']).toBe('NEAS-0027-3-26-SER-20261023-1630');
    expect(f['Prepared by']).toBe('Junrey Granaderos');
  });
  it('omits or labels missing fields instead of inventing them', () => {
    const r = buildReport(base({ project: { code: 'X-1', name: 'Facade', client: '', site: null } }));
    const f = Object.fromEntries(r.fields);
    expect(f.Client).toBe(NOT_PROVIDED);
    expect(f.Site).toBe(NOT_PROVIDED);
    expect(f).not.toHaveProperty('Planned completion');
    expect(f).not.toHaveProperty('Client reference');
  });
  it('keeps the 2 × 4 and 2 × 6 layouts after the title page', () => {
    expect(buildReport(base()).pages.map((p) => p.length)).toEqual([8, 8, 3]);
    const six = buildReport(base({ layout: '2x6' }));
    expect(six.pages.map((p) => p.length)).toEqual([12, 7]);
    expect(six.rows).toBe(6);
  });
  it('filters by report type and capture dates (Manila days), and refuses an empty report', () => {
    expect(buildReport(base({ kind: 'before_after' })).photos).toHaveLength(19);
    expect(() => buildReport(base({ kind: 'defect' }))).toThrow(/No defect photos/);
    const r = buildReport(base({ from: '2026-10-12', to: '2026-10-13' }));
    expect(r.photos.every((p) => p.takenAt.startsWith('2026-10-12') || p.takenAt.startsWith('2026-10-13'))).toBe(true);
  });
  it('never puts GPS in a client report', () => {
    const r = buildReport(base({ audience: 'client' }));
    expect(r.summary.some((s) => s.label === 'GPS-tagged')).toBe(false);
    expect(photoCaption(r.photos[0], 'client').join(' ')).not.toContain('GPS');
    expect(photoCaption(r.photos[0], 'internal').join(' ')).toContain('GPS');
  });
  it('a large collection still gets exactly one title page and all photos', () => {
    const r = buildReport(base({ photos: Array.from({ length: 250 }, (_, i) => photo(i)) }));
    expect(r.pages.flat()).toHaveLength(250);
    expect(r.fields[0][0]).toBe('Project title');
  });
});

describe('client portal dates', () => {
  it('labels upload times as upload dates, not capture dates', () => {
    const r = buildReport(base({ audience: 'client', datesAre: 'uploaded' }));
    expect(r.fields.some(([k]) => k === 'Reporting period (upload dates)')).toBe(true);
    expect(r.summary.some((s) => s.label === 'Upload period')).toBe(true);
    expect(photoCaption(r.photos[0], 'client', undefined, 'uploaded')[2]).toMatch(/^Uploaded /);
  });
});

import { pdfSafe } from '../lib/evidenceExport';
describe('PDF text', () => {
  it('keeps WinAnsi text and replaces characters the PDF fonts cannot draw', () => {
    expect(pdfSafe('Warehouse 4​ RDC – Cainta ñ “ok”')).toBe('Warehouse 4 RDC – Cainta ñ “ok”');
    expect(pdfSafe('Façade ‐ Tower Ⅱ 東')).toBe('Façade - Tower II ?');
  });
});
