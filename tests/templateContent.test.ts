import { describe, expect, it } from 'vitest';
import { blankReport, normaliseTemplate, type TemplateDefinition } from '../lib/reportTemplates';

const IMG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';

describe('imported template content', () => {
  const def: TemplateDefinition = {
    title: 'Inspection',
    cover: [{ key: 'client', label: 'Client', default: 'Triconti' }],
    sections: [
      { id: 's1', title: 'Summary', kind: 'text', content: { text: 'First paragraph.\n\nSecond.' } },
      { id: 's2', title: 'Findings', kind: 'bullets', content: { bullets: ['Crack at F-15', 'Sealant failed'] } },
      { id: 's3', title: 'Status', kind: 'status', items: ['Overall'], content: { status: { Overall: 'GOOD' } } },
      { id: 's4', title: 'Items', kind: 'table', columns: ['Item', 'Remarks'], content: { rows: [['1', 'OK'], ['2']] } },
      { id: 's5', title: 'Photos', kind: 'photos', content: { photos: [{ evidenceId: 'imported-1', caption: 'North face', src: IMG }] } },
      { id: 's6', title: 'Blank', kind: 'text' },
    ],
  };

  it('a new report starts with what the imported file contained', () => {
    const d = blankReport(def);
    expect(d.cover.client).toBe('Triconti');
    expect(d.sections.s1.text).toBe('First paragraph.\n\nSecond.');
    expect(d.sections.s2.bullets).toEqual(['Crack at F-15', 'Sealant failed']);
    expect(d.sections.s3.status).toEqual({ Overall: 'GOOD' });
    expect(d.sections.s4.rows).toEqual([['1', 'OK'], ['2', '']]);
    expect(d.sections.s5.photos).toEqual([{ evidenceId: 'imported-1', caption: 'North face', src: 'tpl:imported-1' }]);
    expect(d.sections.s6.text).toBe('');
  });

  it('keeps content through normalising, and drops images that are not JPEG/PNG data', () => {
    const raw = JSON.parse(JSON.stringify(def));
    raw.sections[4].content.photos.push({ evidenceId: 'x', caption: 'bad', src: 'https://example.com/a.jpg' });
    const n = normaliseTemplate(raw);
    expect(n.sections[0].content?.text).toBe('First paragraph.\n\nSecond.');
    expect(n.sections[3].content?.rows).toEqual([['1', 'OK'], ['2']]);
    expect(n.sections[4].content?.photos).toHaveLength(1);
    expect(n.sections[5].content).toBeUndefined();
  });
});
