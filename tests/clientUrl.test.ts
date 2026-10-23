import { describe, expect, it } from 'vitest';
import { clientPath, titleSlug } from '../lib/clientUrl';

describe('client URL from project title', () => {
  it('builds a readable slug after the project code', () => {
    expect(clientPath({ code: 'NEAS-0011-26', name: 'Provision of Skilled Manpower for Support' })).toBe('/client/NEAS-0011-26/provision-of-skilled-manpower-for-support');
  });
  it('drops accents and symbols and cuts long titles on a word boundary', () => {
    expect(titleSlug('Façade Cleaning & Repairs — Tower B (Phase 2)')).toBe('facade-cleaning-and-repairs-tower-b-phase-2');
    const long = titleSlug('Rope access facade cleaning and sealant replacement for the north and south elevations of tower one');
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.endsWith('-')).toBe(false);
  });
  it('falls back to the code alone when the title has no usable characters', () => {
    expect(clientPath({ code: 'PRJ-2026-001', name: '' })).toBe('/client/PRJ-2026-001');
  });
});
