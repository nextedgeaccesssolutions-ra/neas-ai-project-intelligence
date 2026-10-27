import { describe, expect, it } from 'vitest';
import { blankReport, normaliseTemplate, SEED_TEMPLATE } from '../lib/reportTemplates';

describe('report templates', () => {
  it('the Triconti seed has the report sections in order', () => {
    const t = normaliseTemplate(SEED_TEMPLATE);
    expect(t.sections.map((s) => s.id)).toEqual(['summary', 'status', 'highlights', 'findings', 'activities', 'charts', 'recommendations', 'conclusion', 'approval', 'photos', 'traceability']);
    expect(t.sections.find((s) => s.id === 'findings')!.rows!.length).toBe(11);
  });
  it('a new report starts with the standard rows and default cover values', () => {
    const d = blankReport(normaliseTemplate(SEED_TEMPLATE));
    expect(d.cover.prepared_by).toBe('NextEdge Access Solutions (NEAS)');
    expect(d.sections.findings.rows![0]).toEqual(['Vertical alignment of mast/sensors', '', '', '']);
    expect(Object.keys(d.sections.status.status!)).toEqual(['Overall condition', 'Maintenance required', 'Guy-wire adjustment', 'Sensor status']);
  });
  it('ignores a damaged template instead of failing', () => {
    const t = normaliseTemplate({ title: 5, cover: 'x', sections: [{ id: 'a', kind: 'nope' }, { id: 'b', title: 'Ok', kind: 'text' }] });
    expect(t.title).toBe('Report');
    expect(t.cover).toEqual([]);
    expect(t.sections.map((s) => s.id)).toEqual(['b']);
  });
});
