// Turn an existing Word (.docx) or PowerPoint (.pptx) report into an editable report template.
// The file's own structure is read (headings, tables, bullet lists, photos, the cover table) and arranged
// into template sections; nothing is sent anywhere. The result opens in the template editor for review.
import JSZip from 'jszip';
import { newSectionId, type SectionKind, type TemplateDefinition, type TemplateSection } from './reportTemplates';

const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const texts = (xml: string, tag: string) => (xml.match(new RegExp(`<${tag}(?: [^>]*)?>([^<]*)</${tag}>`, 'g')) ?? []).map((m) => decode(m.replace(/<[^>]+>/g, '')));
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const titleCase = (s: string) => (s === s.toUpperCase() && /[A-Z]/.test(s) ? s.toLowerCase().replace(/(^|[\s/(-])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase()).replace(/\b(And|Of|The|To|For|In|On|By)\b/g, (w) => w.toLowerCase()).replace(/^./, (c) => c.toUpperCase()) : s);

interface Block { kind: 'p' | 'tbl'; text: string; style: string; bullet: boolean; rows: string[][]; images: number }

/** Top-level paragraphs and tables in order; a table is taken whole even when it contains tables. */
function topLevel(body: string): string[] {
  const out: string[] = [];
  const tag = /<w:tbl>|<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>/g;
  let depth = 0, start = -1;
  for (let m = tag.exec(body); m; m = tag.exec(body)) {
    if (m[0] === '<w:tbl>') { if (depth++ === 0) start = m.index; }
    else if (m[0] === '</w:tbl>') { if (--depth === 0) out.push(body.slice(start, m.index + m[0].length)); }
    else if (depth === 0) out.push(m[0]);
  }
  return out;
}

function docxBlocks(xml: string): Block[] {
  const body = xml.match(/<w:body>([\s\S]*)<\/w:body>/)?.[1] ?? '';
  const out: Block[] = [];
  for (const b of topLevel(body)) {
    if (b.startsWith('<w:tbl>')) {
      const rows = [...b.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((r) => [...r[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((c) =>
        [...c[0].matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((p) => clean(texts(p[0], 'w:t').join(''))).filter(Boolean).join('\n')));
      out.push({ kind: 'tbl', text: '', style: '', bullet: false, rows, images: (b.match(/<w:drawing>/g) ?? []).length });
    } else {
      const text = clean(texts(b, 'w:t').join(''));
      // bullets: Word list paragraphs, or lines typed with a bullet character
      const typed = /^[•▪●◦‣\-–]\s*/.test(text);
      out.push({ kind: 'p', text: typed ? text.replace(/^[•▪●◦‣\-–]\s*/, '') : text, style: b.match(/<w:pStyle w:val="([^"]+)"/)?.[1] ?? '', bullet: typed || /<w:numPr>/.test(b), rows: [], images: (b.match(/<w:drawing>/g) ?? []).length });
    }
  }
  return out;
}

const isHeading = (b: Block) => b.kind === 'p' && b.text.length > 2 && b.text.length < 90 &&
  (/^heading\s?1|^title$/i.test(b.style) || /^\d{1,2}\.\s+\S/.test(b.text) || /^annex\b/i.test(b.text));
const headingTitle = (t: string) => {
  const s = t.replace(/^\d{1,2}\.\s+/, '').trim();
  const annex = s.match(/^annex\s+([a-z])\s*[^a-z0-9]*\s*(.*)$/i);
  return annex ? `Annex ${annex[1].toUpperCase()} - ${titleCase(annex[2])}` : titleCase(s);
};

/** Word report → template. */
export async function templateFromDocx(file: Blob): Promise<TemplateDefinition> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) throw new Error('This is not a Word (.docx) file.');
  const blocks = docxBlocks(xml);
  const firstHeading = blocks.findIndex((b) => isHeading(b) && !/table of contents/i.test(b.text));
  // the heading list of the table of contents repeats later in the body: sections start at the last run of headings
  const bodyStart = (() => {
    const seen = new Map<string, number>();
    blocks.forEach((b, i) => { if (isHeading(b)) seen.set(headingTitle(b.text).toLowerCase(), i); });
    const firsts = [...seen.values()];
    return firsts.length ? Math.min(...firsts) : blocks.length;
  })();
  const intro = blocks.slice(0, Math.max(0, firstHeading));
  const caps = intro.filter((b) => b.kind === 'p' && b.text && b.text === b.text.toUpperCase() && b.text.length > 12);
  const title = titleCase(caps.slice(1, 3).map((b) => b.text).join(' ') || caps[0]?.text || 'Report');
  const division = intro.find((b) => b.kind === 'p' && /\|/.test(b.text))?.text;
  // cover fields: label/value cells of the first table(s) before the body, or "Label: value" lines
  const cover: TemplateDefinition['cover'] = [];
  for (const b of intro) {
    if (b.kind === 'tbl') for (const r of b.rows) for (const c of r) { const [label] = c.split('\n'); if (label && label.length < 40) cover.push({ key: newSectionId(), label: titleCase(label) }); }
    if (b.kind === 'p') { const m = b.text.match(/^([A-Za-z][\w /&]{2,30}):\s/); if (m) cover.push({ key: newSectionId(), label: titleCase(m[1]) }); }
  }
  const sections: TemplateSection[] = [];
  let cur: { title: string; blocks: Block[] } | null = null;
  const flush = () => {
    if (!cur) return;
    const tables = cur.blocks.filter((b) => b.kind === 'tbl');
    const images = cur.blocks.reduce((n, b) => n + b.images, 0);
    const bullets = cur.blocks.filter((b) => b.kind === 'p' && b.bullet && b.text).length;
    const add = (kind: SectionKind, extra: Partial<TemplateSection> = {}, title = cur!.title) => sections.push({ id: newSectionId(), title, kind, ...extra });
    // a charts section becomes a chart (counting a table column, chosen in the editor)
    if (/chart/i.test(cur.title)) add('chart');
    else if (images >= 2 || /photo/i.test(cur.title)) add('photos');
    else {
      const paras = cur.blocks.filter((b) => b.kind === 'p' && b.text && !b.bullet).length;
      if (paras) add('text');
      if (bullets) add('bullets', {}, paras ? `${cur.title} - key points` : cur.title);
      tables.forEach((t, k) => {
        const head = t.rows[0] ?? [];
        if (t.rows.length === 1 && head.length >= 2 && head.length <= 6 && head.every((c) => c.includes('\n'))) {
          // one row of "VALUE / LABEL" tiles
          add('status', { items: head.map((c) => titleCase(c.split('\n').slice(-1)[0])) }, k ? `${cur!.title} (${k + 1})` : 'Status at a glance');
        } else if (head.length) {
          add('table', { columns: head.map((c) => c.split('\n')[0]), rows: t.rows.slice(1).map((r) => head.map((_, i) => (i === 0 ? (r[0] ?? '').split('\n')[0] : ''))) }, tables.length > 1 && k ? `${cur!.title} (${k + 1})` : cur!.title);
        }
      });
      if (!paras && !bullets && !tables.length) add('text');
    }
    cur = null;
  };
  for (const b of blocks.slice(bodyStart)) {
    if (isHeading(b)) { flush(); cur = { title: headingTitle(b.text), blocks: [] }; continue; }
    if (cur) cur.blocks.push(b);
  }
  flush();
  if (!sections.length) throw new Error('No numbered headings (for example “1. Executive Summary”) or Heading styles were found to build sections from.');
  // a heading that only introduces sub-headings (e.g. "4. Summary Chart Reports" with 4.1, 4.2 …) stays a text section
  return { title, division, cover: cover.slice(0, 20), sections };
}

/** PowerPoint deck → template: the first slide gives the title, every other slide becomes a section. */
export async function templateFromPptx(file: Blob): Promise<TemplateDefinition> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/g)!.pop()) - Number(b.match(/\d+/g)!.pop()));
  if (!names.length) throw new Error('This is not a PowerPoint (.pptx) file.');
  let title = 'Report';
  const sections: TemplateSection[] = [];
  for (const [i, n] of names.entries()) {
    const xml = (await zip.file(n)!.async('string'));
    const shapes = [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((m) => m[0]);
    const titleShape = shapes.find((s) => /<p:ph [^>]*type="(title|ctrTitle)"/.test(s)) ?? shapes[0] ?? '';
    const slideTitle = clean(texts(titleShape, 'a:t').join(' '));
    if (i === 0) { title = slideTitle || title; continue; }
    const name = slideTitle || `Slide ${i + 1}`;
    const tbl = xml.match(/<a:tbl>[\s\S]*?<\/a:tbl>/)?.[0];
    if (tbl) {
      const rows = [...tbl.matchAll(/<a:tr[ >][\s\S]*?<\/a:tr>/g)].map((r) => [...r[0].matchAll(/<a:tc[ >][\s\S]*?<\/a:tc>/g)].map((c) => clean(texts(c[0], 'a:t').join(' '))));
      const head = rows[0] ?? [];
      sections.push({ id: newSectionId(), title: name, kind: 'table', columns: head, rows: rows.slice(1).map((r) => head.map((_, k) => (k === 0 ? r[0] ?? '' : ''))) });
    } else if ((xml.match(/<p:pic>/g) ?? []).length >= 2) sections.push({ id: newSectionId(), title: name, kind: 'photos' });
    else {
      const body = shapes.filter((s) => s !== titleShape);
      const paras = body.flatMap((s) => [...s.matchAll(/<a:p>[\s\S]*?<\/a:p>/g)].map((p) => clean(texts(p[0], 'a:t').join('')))).filter(Boolean);
      sections.push({ id: newSectionId(), title: name, kind: paras.length > 1 ? 'bullets' : 'text' });
    }
  }
  if (!sections.length) throw new Error('The deck has only a title slide.');
  return { title, cover: [{ key: 'report_date', label: 'Report date' }, { key: 'prepared_by', label: 'Prepared by', default: 'NextEdge Access Solutions (NEAS)' }], sections };
}

export async function templateFromFile(file: File): Promise<TemplateDefinition> {
  const n = file.name.toLowerCase();
  if (n.endsWith('.docx')) return templateFromDocx(file);
  if (n.endsWith('.pptx')) return templateFromPptx(file);
  if (n.endsWith('.pdf')) throw new Error('PDF files keep no headings or tables to rebuild a template from. Open the PDF in Word (File → Open), save it as .docx, and import that file.');
  if (n.endsWith('.doc') || n.endsWith('.ppt')) throw new Error('Older .doc/.ppt files cannot be read. Save the file as .docx or .pptx and import that.');
  throw new Error('Choose a Word (.docx) or PowerPoint (.pptx) file.');
}
