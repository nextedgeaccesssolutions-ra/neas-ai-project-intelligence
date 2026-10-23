import { describe, expect, it } from 'vitest';
import { COVER_TILE_PT, coverPhotos, gpsSourceShort, reorderCover } from '../lib/coverPhotos';
import { buildProjectReport, coverLines, type ProjectReportInput } from '../lib/projectReport';
import type { Activity, FieldReport } from '../lib/types';

const act = (o: Partial<Activity> = {}): Activity => ({ id: 'a1', projectId: 'p1', name: 'Notch 1 Window Cleaning', start: '2026-10-01', end: '2026-10-20', weight: 60, ...o });
const rep = (o: Partial<FieldReport>): FieldReport => ({ id: Math.random().toString(36), projectId: 'p1', activityId: 'a1', date: '2026-10-10', actualPct: 40, notes: '', createdAt: '2026-10-10T08:00:00Z', ...o });
const base = (o: Partial<ProjectReportInput> = {}): ProjectReportInput => ({
  audience: 'internal', generatedAt: new Date('2026-10-23T08:30:00Z'), preparedBy: 'Junrey Granaderos', asOf: '2026-10-15',
  project: { code: 'NEAS-0027-3-26', name: 'Supply of Materials & Manpower for Window Cleaning', client: 'Dalkia Incorporated', site: 'Warehouse 4 RDC', status: 'active' },
  activities: [act(), act({ id: 'a2', name: 'Notch 2 Window Cleaning', weight: 40, start: '2026-10-10', end: '2026-10-30' })],
  reports: [rep({}), rep({ activityId: 'a2', actualPct: 10, date: '2026-10-12' })],
  cover: [{ id: 'c1', caption: 'Tower A', category: 'main_building', takenAt: '2026-10-01T02:00:00Z', lat: 14.585771, lng: 121.029367, accuracy: 9, source: 'exif' }],
  evidence: [], ...o,
});

describe('cover photos', () => {
  it('tiles are exactly 9.21 cm (261.07 pt) in the PDF', () => {
    expect(COVER_TILE_PT).toBeCloseTo((9.21 / 2.54) * 72, 6);
    expect(COVER_TILE_PT).toBeCloseTo(261.07, 2);
  });
  it('orders the primary photo first, then the chosen order', () => {
    const list = coverPhotos([
      { id: 'x', isCover: true, coverOrder: 1, takenAt: '1' }, { id: 'y', isCover: true, coverOrder: 2, coverPrimary: true, takenAt: '2' },
      { id: 'z', isCover: false, takenAt: '0' }, { id: 'w', isCover: true, coverOrder: 3, takenAt: '3' },
    ] as never[]) as { id: string }[];
    expect(list.map((x) => x.id)).toEqual(['y', 'x', 'w']);
    expect([...reorderCover(['y', 'x', 'w'], 'w', -1)]).toEqual([['y', 1], ['w', 2], ['x', 3]]);
  });
  it('labels location sources with the standard names and never claims GPS without coordinates', () => {
    expect(gpsSourceShort('exif')).toBe('EXIF GPS');
    expect(gpsSourceShort('device')).toBe('Device GPS');
    expect(gpsSourceShort('manual')).toBe('Manual Location');
    expect(gpsSourceShort('exif', 'captured', false)).toBe('GPS Unavailable');
    const none = coverLines({ id: 'c', caption: 'Gate', takenAt: '2026-10-01T02:00:00Z' }, 2, 'P');
    expect(Object.fromEntries(none.lines)).toMatchObject({ Latitude: 'GPS Unavailable', Longitude: 'GPS Unavailable', 'Location source': 'GPS Unavailable' });
    expect(none.mapUrl).toBeNull();
    expect(none.title).toBe('Photo 02 — Gate');
  });
});

describe('project report', () => {
  const r = buildProjectReport(base());
  it('uses the full project details and a descriptive file name', () => {
    expect(r.fields[0]).toEqual(['Project title', 'Supply of Materials & Manpower for Window Cleaning']);
    expect(r.fileName).toBe('NEAS_NEAS-0027-3-26_Supply-of-Materials-Manpower-for-Window-Cleaning_Project-Report_2026-10-23');
    expect(r.cover[0].title).toBe('Photo 01 — Main building / structure · Tower A');
    expect(r.cover[0].mapUrl).toBe('https://www.google.com/maps/search/?api=1&query=14.585771,121.029367');
  });
  it('reports planned vs actual from the schedule and records only', () => {
    expect(r.overall!.actual).toBeCloseTo(0.6 * 40 + 0.4 * 10, 6);
    expect(r.rows).toHaveLength(2);
    expect(r.summary[0]).toContain('As of');
  });
  it('never invents approvals', () => {
    expect(Object.fromEntries(r.approval)).toMatchObject({ 'Reviewed by': 'Not recorded', 'Approval status': 'Not recorded' });
  });
  it('client reports use the published progress instead of recomputing', () => {
    const c = buildProjectReport(base({ audience: 'client', overall: { planned: 47.2, actual: 4.1 }, series: [] }));
    expect(c.overall).toMatchObject({ planned: 47.2, actual: 4.1 });
  });
});
