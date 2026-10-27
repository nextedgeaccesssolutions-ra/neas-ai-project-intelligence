import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { templateFromDocx } from '../lib/templateImport';

const SAMPLE = 'C:/Users/nexte/Downloads/NEAS_TRICONTI Q2 2025 INSPECTION REPORT_Reports.docx';

describe.skipIf(!existsSync(SAMPLE))('Word report import (Triconti sample)', () => {
  it('rebuilds the sections, tables and photo annex', async () => {
    const t = await templateFromDocx(new Blob([readFileSync(SAMPLE)]));
    const titles = t.sections.map((s) => `${s.kind}:${s.title}`);
    expect(titles.some((x) => x.startsWith('table:Inspection Findings'))).toBe(true);
    expect(titles.some((x) => x.startsWith('photos:Annex A'))).toBe(true);
    expect(titles.some((x) => x.startsWith('status:'))).toBe(true);
    const findings = t.sections.find((s) => s.kind === 'table' && /findings/i.test(s.title))!;
    expect(findings.columns).toEqual(['Inspection Element', 'Evidence / Check', 'Action / Result', 'Status']);
    expect(findings.rows!.length).toBe(11);
    console.log(t.title, '|', t.cover.map((c) => c.label).join(', '), '\n', titles.join('\n'));
  });
});
