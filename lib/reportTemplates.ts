// Per-project report templates (neas.report_templates) and the reports filled in from them
// (neas.template_reports). A report keeps its own copy of the template it was started from.
import seed from './reportTemplateSeed.json';

export type SectionKind = 'text' | 'bullets' | 'status' | 'table' | 'photos';
export interface TemplateSection { id: string; title: string; kind: SectionKind; items?: string[]; columns?: string[]; rows?: string[][] }
export interface TemplateDefinition {
  title: string;
  division?: string;
  cover: { key: string; label: string; default?: string }[];
  sections: TemplateSection[];
}
export interface ReportPhoto { evidenceId: string; caption: string }
export interface SectionData { text?: string; bullets?: string[]; status?: Record<string, string>; rows?: string[][]; photos?: ReportPhoto[] }
export interface TemplateReportData { cover: Record<string, string>; sections: Record<string, SectionData> }

export const KIND_LABEL: Record<SectionKind, string> = {
  text: 'Paragraphs', bullets: 'Bullet list', status: 'Status tiles', table: 'Table', photos: 'Photo annex',
};
export const SEED_TEMPLATE = seed as TemplateDefinition;

const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : '');
const arr = (v: unknown) => (Array.isArray(v) ? v : []);

/** Accept only the expected shape, so a damaged template never breaks the editor or an export. */
export function normaliseTemplate(raw: unknown): TemplateDefinition {
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const kinds = Object.keys(KIND_LABEL) as SectionKind[];
  return {
    title: str(o.title, 200) || 'Report',
    division: str(o.division, 200) || undefined,
    cover: arr(o.cover).map((c) => c as Record<string, unknown>).filter((c) => str(c.key) && str(c.label))
      .map((c) => ({ key: str(c.key, 60), label: str(c.label, 120), default: str(c.default, 300) || undefined })),
    sections: arr(o.sections).map((s) => s as Record<string, unknown>).filter((s) => str(s.id) && kinds.includes(s.kind as SectionKind))
      .map((s) => ({
        id: str(s.id, 60), title: str(s.title, 200) || 'Section', kind: s.kind as SectionKind,
        items: arr(s.items).map((x) => str(x, 120)).filter(Boolean),
        columns: arr(s.columns).map((x) => str(x, 80)).filter(Boolean),
        rows: arr(s.rows).map((r) => arr(r).map((x) => str(x, 2000))),
      })),
  };
}

/** A new report starts with the template's default cover values and table rows. */
export function blankReport(t: TemplateDefinition): TemplateReportData {
  const sections: Record<string, SectionData> = {};
  for (const s of t.sections) {
    if (s.kind === 'table') sections[s.id] = { rows: (s.columns ?? []).length ? (s.rows?.length ? s.rows : [[]]).map((r) => (s.columns ?? []).map((_, i) => r[i] ?? '')) : [] };
    else if (s.kind === 'status') sections[s.id] = { status: Object.fromEntries((s.items ?? []).map((i) => [i, ''])) };
    else if (s.kind === 'bullets') sections[s.id] = { bullets: [''] };
    else if (s.kind === 'photos') sections[s.id] = { photos: [] };
    else sections[s.id] = { text: '' };
  }
  return { cover: Object.fromEntries(t.cover.map((c) => [c.key, c.default ?? ''])), sections };
}

export const newSectionId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** Word (.docx) in the NEAS report layout: cover, numbered sections, tables, photo annex 2 per row. */
export async function templateReportDocx(t: TemplateDefinition, d: TemplateReportData, opts: {
  projectName: string; reportTitle: string; logo?: Uint8Array | null; photo: (id: string) => Promise<{ data: Uint8Array; w: number; h: number } | null>;
}): Promise<Blob> {
  const D = await import('docx');
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ImageRun, AlignmentType, ShadingType, BorderStyle } = D;
  const NAVY = '0B1F2A', GOLD = 'B9770E', GREY = 'F1F4F6';
  const p = (text: string, o: { bold?: boolean; size?: number; color?: string; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}) =>
    new Paragraph({ alignment: o.align, children: [new TextRun({ text, bold: o.bold, size: o.size, color: o.color })] });
  const cell = (text: string, head = false) => new TableCell({
    shading: head ? { type: ShadingType.CLEAR, color: 'auto', fill: NAVY } : undefined,
    children: text.split('\n').map((line) => new Paragraph({ children: [new TextRun({ text: line, bold: head, color: head ? 'FFFFFF' : undefined, size: 19 })] })),
  });
  const table = (head: string[], rows: string[][]) => new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ tableHeader: true, children: head.map((h) => cell(h, true)) }), ...rows.map((r) => new TableRow({ children: head.map((_, i) => cell(r[i] ?? '')) }))],
  });

  const body: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [];
  if (opts.logo) body.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: opts.logo, transformation: { width: 110, height: 110 } })] }));
  body.push(p('NEXTEDGE ACCESS SOLUTIONS', { bold: true, size: 32, color: NAVY, align: AlignmentType.CENTER }));
  if (t.division) body.push(p(t.division, { size: 22, color: GOLD, align: AlignmentType.CENTER }));
  body.push(p(opts.reportTitle || t.title, { bold: true, size: 34, color: NAVY, align: AlignmentType.CENTER }));
  body.push(p(opts.projectName, { size: 22, align: AlignmentType.CENTER }));
  body.push(new Paragraph({ text: '' }));
  const coverRows = t.cover.map((c) => [c.label, d.cover[c.key] ?? '']).filter(([, v]) => v.trim());
  if (coverRows.length) body.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: coverRows.map(([k, v]) => new TableRow({ children: [
      new TableCell({ shading: { type: ShadingType.CLEAR, color: 'auto', fill: GREY }, width: { size: 32, type: WidthType.PERCENTAGE }, children: [p(k, { bold: true, size: 20 })] }),
      new TableCell({ children: v.split('\n').map((l) => p(l, { size: 20 })) }),
    ] })),
  }));

  let n = 0;
  for (const s of t.sections) {
    const sd = d.sections[s.id] ?? {};
    const isAnnex = /^annex/i.test(s.title);
    if (!isAnnex) n += 1;
    body.push(new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: s.kind === 'photos', border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: GOLD, space: 2 } },
      children: [new TextRun({ text: isAnnex ? s.title.toUpperCase() : `${n}.  ${s.title.toUpperCase()}`, bold: true, color: NAVY, size: 26 })] }));
    if (s.kind === 'text') for (const para of (sd.text ?? '').split(/\n{2,}/).filter((x) => x.trim())) body.push(p(para.trim(), { size: 21 }));
    if (s.kind === 'bullets') for (const b of (sd.bullets ?? []).filter((x) => x.trim())) body.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: b, size: 21 })] }));
    if (s.kind === 'status') {
      const items = s.items ?? [];
      if (items.length) body.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ children: items.map((i) => new TableCell({
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: GREY },
        children: [p((sd.status?.[i] ?? '').toUpperCase() || '—', { bold: true, size: 24, color: NAVY, align: AlignmentType.CENTER }), p(i.toUpperCase(), { size: 16, color: '5D6F7B', align: AlignmentType.CENTER })],
      })) })] }));
    }
    if (s.kind === 'table' && (s.columns ?? []).length) body.push(table(s.columns ?? [], (sd.rows ?? []).filter((r) => r.some((c) => c.trim()))));
    if (s.kind === 'photos') {
      const photos = sd.photos ?? [];
      for (let i = 0; i < photos.length; i += 2) {
        const pair = photos.slice(i, i + 2);
        // a photo without a usable size is listed by caption only
        const cells = await Promise.all(pair.map(async (ph, k) => {
          const img = await opts.photo(ph.evidenceId).catch(() => null);
          return new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, children: [
            img && img.w > 0 && img.h > 0 ? new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: img.data, transformation: (() => { const k = Math.min(290 / img.w, 218 / img.h); return { width: Math.round(img.w * k), height: Math.round(img.h * k) }; })() })] }) : p('Photo not available', { size: 18, color: '5D6F7B' }),
            p(`Photo ${i + k + 1} - ${ph.caption}`, { size: 18, align: AlignmentType.CENTER }),
          ] });
        }));
        if (cells.length === 1) cells.push(new TableCell({ children: [new Paragraph({ text: '' })] }));
        body.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ children: cells })] }));
      }
      if (!photos.length) body.push(p('No photographs were attached to this report.', { size: 20, color: '5D6F7B' }));
    }
  }
  const doc = new Document({ creator: 'NEAS', title: opts.reportTitle || t.title, sections: [{ children: body }] });
  return Packer.toBlob(doc);
}
