import { describe, expect, it } from 'vitest';
import { blankReport, chartCounts, normaliseTemplate, SEED_TEMPLATE } from '../lib/reportTemplates';

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
  it('a chart counts the values of a table column, most frequent first', () => {
    const t = normaliseTemplate({ ...SEED_TEMPLATE, sections: [...SEED_TEMPLATE.sections, { id: 'c1', title: 'Compliance', kind: 'chart', source: 'findings', column: 'Status' }] });
    const d = blankReport(t);
    d.sections.findings.rows = d.sections.findings.rows!.map((r, i) => [r[0], '', '', i < 8 ? 'Compliant' : i < 10 ? 'Monitor' : ''] as string[]);
    expect(chartCounts(t, d, t.sections.find((s) => s.id === 'c1')!)).toEqual([{ label: 'Compliant', count: 8 }, { label: 'Monitor', count: 2 }]);
  });
  it('a chart without a valid source is empty', () => {
    const t = normaliseTemplate({ ...SEED_TEMPLATE, sections: [{ id: 'c1', title: 'C', kind: 'chart', source: 'nope', column: 'Status' }] });
    expect(chartCounts(t, blankReport(t), t.sections[0])).toEqual([]);
  });
});
