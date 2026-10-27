// Per-project report templates (neas.report_templates) and the reports filled in from them
// (neas.template_reports). A report keeps its own copy of the template it was started from.
import seed from './reportTemplateSeed.json';

export type SectionKind = 'text' | 'bullets' | 'status' | 'table' | 'photos' | 'chart';
export interface TemplateSection {
  id: string; title: string; kind: SectionKind; items?: string[]; columns?: string[]; rows?: string[][];
  /** chart: counts the values of one column of a table section in the same report */
  source?: string; column?: string;
}
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
  text: 'Paragraphs', bullets: 'Bullet list', status: 'Status tiles', table: 'Table', photos: 'Photo annex', chart: 'Chart (counts from a table)',
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
        source: str(s.source, 60) || undefined, column: str(s.column, 80) || undefined,
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

/** Chart data: how often each value appears in the chosen column of a table section (blank values skipped). */
export function chartCounts(t: TemplateDefinition, d: TemplateReportData, s: TemplateSection): { label: string; count: number }[] {
  const src = t.sections.find((x) => x.id === s.source && x.kind === 'table');
  const col = src?.columns?.indexOf(s.column ?? '') ?? -1;
  if (!src || col < 0) return [];
  const counts = new Map<string, number>();
  for (const r of d.sections[src.id]?.rows ?? []) {
    const v = (r[col] ?? '').trim();
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Horizontal bar chart drawn on a canvas, as a PNG for the PDF and Word exports. */
export function chartPng(data: { label: string; count: number }[], width = 1000): { url: string; w: number; h: number } | null {
  if (!data.length || typeof document === 'undefined') return null;
  const row = 46, top = 20, left = 330, h = top * 2 + data.length * row;
  const c = document.createElement('canvas'); c.width = width; c.height = h;
  const g = c.getContext('2d'); if (!g) return null;
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, width, h);
  const max = Math.max(...data.map((x) => x.count));
  g.font = '22px Helvetica, Arial, sans-serif'; g.textBaseline = 'middle';
  data.forEach((x, i) => {
    const y = top + i * row + row / 2;
    g.fillStyle = '#0b1f2a'; g.textAlign = 'right';
    g.fillText(x.label.length > 28 ? `${x.label.slice(0, 27)}…` : x.label, left - 14, y);
    const bw = Math.max(4, ((width - left - 80) * x.count) / max);
    g.fillStyle = '#b9770e'; g.fillRect(left, y - 14, bw, 28);
    g.fillStyle = '#0b1f2a'; g.textAlign = 'left'; g.fillText(String(x.count), left + bw + 10, y);
  });
  return { url: c.toDataURL('image/png'), w: width, h };
}

/** PDF in the NEAS layout (A4): cover block, numbered sections, tables, charts, photo annex 2 per row. */
export async function templateReportPdf(t: TemplateDefinition, d: TemplateReportData, opts: {
  projectName: string; reportTitle: string; logo?: { data: string; w: number; h: number } | null; photo: (id: string) => Promise<{ data: string; w: number; h: number } | null>;
}): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const { makePdfSafe, fit } = await import('./evidenceExport');
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  makePdfSafe(pdf);
  const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight(), M = 42;
  const NAVY: [number, number, number] = [11, 31, 42], GOLD: [number, number, number] = [185, 119, 14], MUTED: [number, number, number] = [93, 111, 123];
  let y = M;
  const room = (need: number) => { if (y + need > H - M) { pdf.addPage(); y = M; } };
  const para = (text: string, size = 10, color: [number, number, number] = NAVY, bold = false) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(size); pdf.setTextColor(...color);
    for (const line of pdf.splitTextToSize(text, W - M * 2) as string[]) { room(size + 4); pdf.text(line, M, y); y += size + 4; }
  };
  const afterTable = () => { y = ((pdf as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 14; };

  // cover
  if (opts.logo) { const f = fit(opts.logo, 90, 90); pdf.addImage(opts.logo.data, 'PNG', (W - f.w) / 2, y, f.w, f.h); y += f.h + 14; }
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(16); pdf.setTextColor(...NAVY); pdf.text('NEXTEDGE ACCESS SOLUTIONS', W / 2, y, { align: 'center' }); y += 20;
  if (t.division) { pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); pdf.setTextColor(...GOLD); pdf.text(t.division, W / 2, y, { align: 'center' }); y += 18; }
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15); pdf.setTextColor(...NAVY);
  for (const l of pdf.splitTextToSize((opts.reportTitle || t.title).toUpperCase(), W - M * 2) as string[]) { pdf.text(l, W / 2, y, { align: 'center' }); y += 19; }
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); pdf.setTextColor(...MUTED); pdf.text(opts.projectName, W / 2, y, { align: 'center' }); y += 18;
  const coverRows = t.cover.map((c) => [c.label, d.cover[c.key] ?? '']).filter(([, v]) => v.trim());
  if (coverRows.length) {
    autoTable(pdf, { startY: y, margin: { left: M, right: M }, body: coverRows, theme: 'grid', styles: { fontSize: 9, cellPadding: 5 },
      columnStyles: { 0: { fontStyle: 'bold', fillColor: [241, 244, 246], cellWidth: 150 } } });
    afterTable();
  }

  let n = 0;
  for (const s of t.sections) {
    const sd = d.sections[s.id] ?? {};
    const isAnnex = /^annex/i.test(s.title);
    if (!isAnnex) n += 1;
    if (s.kind === 'photos') { pdf.addPage(); y = M; } else room(40);
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12); pdf.setTextColor(...NAVY);
    pdf.text(isAnnex ? s.title.toUpperCase() : `${n}.  ${s.title.toUpperCase()}`, M, y);
    pdf.setDrawColor(...GOLD); pdf.setLineWidth(1.2); pdf.line(M, y + 5, W - M, y + 5); y += 20;
    if (s.kind === 'text') for (const p of (sd.text ?? '').split(/\n{2,}/).filter((x) => x.trim())) { para(p.trim()); y += 4; }
    if (s.kind === 'bullets') for (const b of (sd.bullets ?? []).filter((x) => x.trim())) para(`•  ${b}`);
    if (s.kind === 'status' && (s.items ?? []).length) {
      autoTable(pdf, { startY: y, margin: { left: M, right: M }, theme: 'grid',
        body: [(s.items ?? []).map((i) => (sd.status?.[i] ?? '').toUpperCase() || '—'), (s.items ?? []).map((i) => i.toUpperCase())],
        styles: { halign: 'center', fontSize: 8, fillColor: [241, 244, 246] },
        didParseCell: (h) => { if (h.row.index === 0) { h.cell.styles.fontSize = 12; h.cell.styles.fontStyle = 'bold'; h.cell.styles.textColor = NAVY; } else h.cell.styles.textColor = MUTED; } });
      afterTable();
    }
    if (s.kind === 'table' && (s.columns ?? []).length) {
      autoTable(pdf, { startY: y, margin: { left: M, right: M }, theme: 'grid', head: [s.columns ?? []],
        body: (sd.rows ?? []).filter((r) => r.some((c) => c.trim())).map((r) => (s.columns ?? []).map((_, i) => r[i] ?? '')),
        headStyles: { fillColor: NAVY, textColor: 255, fontSize: 8.5 }, styles: { fontSize: 8.5, cellPadding: 4 } });
      afterTable();
    }
    if (s.kind === 'chart') {
      const png = chartPng(chartCounts(t, d, s));
      if (png) { const f = fit(png as unknown as { data: string; w: number; h: number }, W - M * 2, 260); room(f.h + 10); pdf.addImage(png.url, 'PNG', M, y, f.w, f.h); y += f.h + 12; }
      else para('No values to chart yet.', 9, MUTED);
    }
    if (s.kind === 'photos') {
      const photos = sd.photos ?? [];
      const cw = (W - M * 2 - 14) / 2, ch = 190;
      for (let i = 0; i < photos.length; i += 2) {
        room(ch + 30);
        for (let k = 0; k < 2 && i + k < photos.length; k++) {
          const ph = photos[i + k];
          const x = M + k * (cw + 14);
          const img = await opts.photo(ph.evidenceId).catch(() => null);
          pdf.setFillColor(241, 244, 246); pdf.rect(x, y, cw, ch, 'F');
          if (img && img.w > 0 && img.h > 0) { const f = fit(img, cw, ch); pdf.addImage(img.data, 'JPEG', x + f.dx, y + f.dy, f.w, f.h); }
          else { pdf.setFontSize(9); pdf.setTextColor(...MUTED); pdf.text('Photo not available', x + cw / 2, y + ch / 2, { align: 'center' }); }
          pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(...NAVY);
          pdf.text((pdf.splitTextToSize(`Photo ${i + k + 1} - ${ph.caption}`, cw) as string[]).slice(0, 2), x, y + ch + 12);
        }
        y += ch + 34;
      }
      if (!photos.length) para('No photographs were attached to this report.', 9, MUTED);
    }
  }
  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(...MUTED);
    pdf.text(`${opts.reportTitle || t.title} · ${opts.projectName}`, M, H - 20);
    pdf.text(`Page ${p} of ${pages}`, W - M, H - 20, { align: 'right' });
  }
  return pdf.output('blob');
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
    if (s.kind === 'chart') {
      const png = chartPng(chartCounts(t, d, s));
      if (png) {
        const bytes = Uint8Array.from(atob(png.url.split(',')[1]), (c) => c.charCodeAt(0));
        const k = Math.min(600 / png.w, 320 / png.h);
        body.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: bytes, transformation: { width: Math.round(png.w * k), height: Math.round(png.h * k) } })] }));
      } else body.push(p('No values to chart yet.', { size: 20, color: '5D6F7B' }));
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
