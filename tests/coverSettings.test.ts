import { describe, expect, it } from 'vitest';
import { applyCoverSettings } from '../lib/projectReport';

const base: [string, string][] = [['Project title', 'Window cleaning'], ['Client', 'JANGHO'], ['Site', 'Century Spire'], ['Report reference', 'R-1'], ['Generated', 'today']];

describe('cover page settings', () => {
  it('leaves the cover unchanged without settings', () => expect(applyCoverSettings(base, null)).toEqual(base));
  it('replaces values but never the generated reference or time', () => {
    const out = new Map(applyCoverSettings(base, { values: { Client: 'Jangho Curtainwall Phils.', 'Report reference': 'FAKE', Generated: 'yesterday' } }));
    expect(out.get('Client')).toBe('Jangho Curtainwall Phils.');
    expect(out.get('Report reference')).toBe('R-1');
    expect(out.get('Generated')).toBe('today');
  });
  it('renames, hides and reorders lines, and adds extra lines', () => {
    const out = applyCoverSettings(base, {
      values: { 'custom:1': 'Tower 2, 8F' },
      layout: { rows: [{ key: 'Site', label: 'Site address' }, { key: 'Client' }, { key: 'Generated', show: false }, { key: 'Project title', label: 'Ignored' }], extra: [{ key: 'custom:1', label: 'Work area' }] },
    });
    expect(out.map(([k]) => k)).toEqual(['Site address', 'Client', 'Project title', 'Report reference', 'Work area']);
  });
  it('drops an extra line that has no value', () => {
    expect(applyCoverSettings(base, { layout: { extra: [{ key: 'custom:1', label: 'Work area' }] } }).length).toBe(base.length);
  });
});
