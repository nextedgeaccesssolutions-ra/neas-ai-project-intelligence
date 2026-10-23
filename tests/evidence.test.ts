import { describe, expect, it } from 'vitest';
import { accuracyWarning, gpsLabel, parseManualCoords, photoRef } from '../lib/geo';
import { evidenceFromDb, evidenceToDb, type DbAttachment } from '../lib/cloud/mapping';
import type { Evidence } from '../lib/types';

const base: Evidence = { id: '0f3a9c2e-1111-4222-8333-944455556666', projectId: 'p1', activityId: 'a1', kind: 'Before', caption: 'Glass panel', takenAt: '2026-10-23T02:00:00.000Z', bytes: 1200 };

describe('GPS helpers', () => {
  it('flags low accuracy against the 10 m target', () => {
    expect(accuracyWarning({ gpsStatus: 'captured', gps: { lat: 1, lng: 2, accuracy: 6, at: '' } })).toBe(false);
    expect(accuracyWarning({ gpsStatus: 'captured', gps: { lat: 1, lng: 2, accuracy: 25, at: '' } })).toBe(true);
    expect(accuracyWarning({ gpsStatus: 'captured', gps: { lat: 1, lng: 2, accuracy: null, at: '' } })).toBe(true);
    expect(accuracyWarning({ gpsStatus: 'manual', gps: { lat: 1, lng: 2, accuracy: null, at: '' } })).toBe(false);
  });
  it('labels every status honestly', () => {
    expect(gpsLabel({ gpsStatus: 'captured', gps: { lat: 14.554729, lng: 121.024445, accuracy: 6.4, at: '' } })).toBe('14.554729, 121.024445 ±6 m');
    expect(gpsLabel({ gpsStatus: 'manual', gps: { lat: 1, lng: 2, accuracy: null, at: '' } })).toContain('admin approved');
    expect(gpsLabel({ gpsStatus: 'denied', gps: null })).toContain('permission denied');
    expect(gpsLabel({ gpsStatus: 'unavailable', gps: null })).toBe('GPS unavailable');
  });
  it('accepts only valid manual coordinates', () => {
    expect(parseManualCoords('14.5547', '121.0244')).toMatchObject({ lat: 14.5547, lng: 121.0244, accuracy: null });
    expect(parseManualCoords('95', '10')).toBeNull();
    expect(parseManualCoords('', '10')).toBeNull();
    expect(parseManualCoords('abc', '10')).toBeNull();
  });
  it('builds a readable photo reference', () => {
    expect(photoRef('Before', '2026-10-23T12:00:00', '0f3a9c2e-1111')).toBe('BEF-20261023-0F3A');
    expect(photoRef('Safety', '2026-10-23T12:00:00', 'ab-cd')).toBe('SAF-20261023-ABCD');
  });
});

describe('evidence ⇄ database', () => {
  it('sends GPS only when it was really captured or entered', () => {
    const withGps = evidenceToDb({ ...base, gpsStatus: 'captured', gps: { lat: 14.5, lng: 121, accuracy: 7, heading: 90, at: '2026-10-23T02:00:01Z' }, workArea: 'North facade', pairId: 'pair-1', ref: 'BEF-1' });
    expect(withGps).toMatchObject({ kind: 'before', gps_status: 'captured', gps_lat: 14.5, gps_lng: 121, gps_accuracy_m: 7, gps_heading: 90, work_area: 'North facade', pair_id: 'pair-1', photo_ref: 'BEF-1', captured_at: base.takenAt });
    const none = evidenceToDb({ ...base, gpsStatus: 'denied', gps: null });
    expect(none).toMatchObject({ gps_status: 'denied', gps_lat: null, gps_lng: null });
    const inconsistent = evidenceToDb({ ...base, gpsStatus: 'captured', gps: null });
    expect(inconsistent).toMatchObject({ gps_status: 'unavailable', gps_lat: null });
    expect(evidenceToDb(base)).toMatchObject({ gps_status: 'not_requested', work_area: '', pair_id: null });
  });
  it('reads new photo types, GPS and capture time back', () => {
    const row: DbAttachment = {
      id: base.id, project_id: 'p1', report_id: null, activity_id: 'a1', kind: 'defect', storage_path: 'p1/x.jpg', caption: 'Crack', mime_type: 'image/jpeg', bytes: 10,
      client_visible: false, created_at: '2026-10-23T05:00:00Z', version: 1, deleted_at: null,
      captured_at: '2026-10-23T02:00:00Z', gps_lat: '14.554729', gps_lng: '121.024445', gps_accuracy_m: '6.5', gps_status: 'captured', work_area: 'Podium', pair_id: null, photo_ref: 'DEF-1',
    };
    const e = evidenceFromDb(row);
    expect(e).toMatchObject({ kind: 'Defect', takenAt: '2026-10-23T02:00:00Z', gpsStatus: 'captured', workArea: 'Podium', ref: 'DEF-1' });
    expect(e.gps).toMatchObject({ lat: 14.554729, lng: 121.024445, accuracy: 6.5 });
    const old = evidenceFromDb({ ...row, kind: 'after', captured_at: null, gps_lat: null, gps_lng: null, gps_status: undefined });
    expect(old).toMatchObject({ kind: 'After', takenAt: row.created_at, gps: null, gpsStatus: 'not_requested' });
  });
});
