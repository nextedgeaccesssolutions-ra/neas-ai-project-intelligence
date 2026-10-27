// Turn an existing Word (.docx), PowerPoint (.pptx), Excel (.xlsx) or PDF report into an editable report template.
// The file's own structure is read (headings, paragraphs, bullet lists, tables, photos, the cover table) and arranged
// into template sections. What the file contained is kept in each section (`content`), so a report started from the
// template opens with the same text, tables and photos as the original. Nothing is sent anywhere.
import JSZip from 'jszip';
import { newSectionId, type ReportPhoto, type SectionData, type SectionKind, type TemplateDefinition, type TemplateSection } from './reportTemplates';

const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const texts = (xml: string, tag: string) => (xml.match(new RegExp(`<${tag}(?: [^>]*)?>([^<]*)</${tag}>`, 'g')) ?? []).map((m) => decode(m.replace(/<[^>]+>/g, '')));
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const titleCase = (s: string) => (s === s.toUpperCase() && /[A-Z]/.test(s) ? s.toLowerCase().replace(/(^|[\s/(-])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase()).replace(/\b(And|Of|The|To|For|In|On|By)\b/g, (w) => w.toLowerCase()).replace(/^./, (c) => c.toUpperCase()) : s);

/** Most photos a template keeps (each is stored inside the template). */
const MAX_PHOTOS = 40;
let photoCount = 0;
/** Running number for imported photo ids, unique within one import. */
let photoSeq = 0;

/** An image from the file as a compressed JPEG data URL (long side at most 1400 px); formats the browser cannot draw (EMF/WMF) are skipped. */
async function toJpeg(data: Blob | ArrayBuffer | Uint8Array, type = 'image/png'): Promise<string | null> {
  if (photoCount >= MAX_PHOTOS || typeof document === 'undefined') return null;
  try {
    const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type });
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, 1000 / Math.max(bmp.width, bmp.height));
    if (bmp.width < 40 || bmp.height < 40) return null; // icons and bullets, not photos
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bmp, 0, 0, c.width, c.height);
    photoCount++;
    return c.toDataURL('image/jpeg', 0.68);
  } catch { return null; }
}
const mimeOf = (path: string) => (/\.jpe?g$/i.test(path) ? 'image/jpeg' : /\.gif$/i.test(path) ? 'image/gif' : /\.bmp$/i.test(path) ? 'image/bmp' : 'image/png');

/** Relationship id → file path inside the zip, for a part such as word/document.xml. */
async function rels(zip: JSZip, part: string): Promise<Map<string, string>> {
  const dir = part.slice(0, part.lastIndexOf('/'));
  const xml = await zip.file(`${dir}/_rels/${part.slice(part.lastIndexOf('/') + 1)}.rels`)?.async('string') ?? '';
  const m = new Map<string, string>();
  for (const r of xml.matchAll(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    const target = r[2].startsWith('/') ? r[2].slice(1) : `${dir}/${r[2]}`.split('/').reduce<string[]>((a, s) => (s === '..' ? a.slice(0, -1) : [...a, s]), []).join('/');
    m.set(r[1], target);
  }
  return m;
}
async function imagesIn(xml: string, zip: JSZip, rel: Map<string, string>): Promise<string[]> {
  const out: string[] = [];
  for (const id of [...xml.matchAll(/r:embed="([^"]+)"/g)].map((m) => m[1])) {
    const path = rel.get(id);
    const f = path ? zip.file(path) : null;
    if (!f) continue;
    const src = await toJpeg(await f.async('uint8array'), mimeOf(path!));
    if (src) out.push(src);
  }
  return out;
}

interface Block { kind: 'p' | 'tbl'; text: string; style: string; bullet: boolean; rows: string[][]; images: string[]; drawings: number }

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

async function docxBlocks(xml: string, zip: JSZip, rel: Map<string, string>): Promise<Block[]> {
  const body = xml.match(/<w:body>([\s\S]*)<\/w:body>/)?.[1] ?? '';
  const out: Block[] = [];
  for (const b of topLevel(body)) {
    const images = /<w:drawing>|<w:pict>/.test(b) ? await imagesIn(b, zip, rel) : [];
    if (b.startsWith('<w:tbl>')) {
      const rows = [...b.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((r) => [...r[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((c) =>
        [...c[0].matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((p) => clean(texts(p[0], 'w:t').join(''))).filter(Boolean).join('\n')));
      out.push({ kind: 'tbl', text: '', style: '', bullet: false, rows, images, drawings: (b.match(/<w:drawing>|<w:pict>/g) ?? []).length });
    } else {
      const text = clean(texts(b, 'w:t').join(''));
      // bullets: Word list paragraphs, or lines typed with a bullet character
      const typed = /^[•▪●◦‣\-–]\s*/.test(text);
      out.push({ kind: 'p', text: typed ? text.replace(/^[•▪●◦‣\-–]\s*/, '') : text, style: b.match(/<w:pStyle w:val="([^"]+)"/)?.[1] ?? '', bullet: typed || /<w:numPr>/.test(b), rows: [], images, drawings: (b.match(/<w:drawing>|<w:pict>/g) ?? []).length });
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
const isCaption = (t: string) => t.length < 200 && /^(photo|figure|fig\.?|plate|image)\s*\d*/i.test(t);

/** Photos of a run of blocks, each captioned by the photo/figure line that follows it (or the text in its own table cell). */
function photosOf(blocks: Block[]): ReportPhoto[] {
  const out: ReportPhoto[] = [];
  blocks.forEach((b, i) => {
    if (!b.images.length) return;
    const cellText = b.kind === 'tbl' ? b.rows.flat().filter((c) => c && !/^\s*$/.test(c)) : [];
    const next = blocks[i + 1];
    const after = next && next.kind === 'p' && isCaption(next.text) ? next.text : '';
    b.images.forEach((src, k) => out.push({ evidenceId: `imported-${++photoSeq}`, src,
      caption: clean(cellText[k] ?? (k === 0 ? after || b.text : '') ?? '').replace(/^(photo|figure|fig\.?)\s*\d+\s*[-–:.]?\s*/i, '').slice(0, 300) }));
  });
  return out;
}

/** Word report → template, with its text, tables and photos. */
export async function templateFromDocx(file: Blob): Promise<TemplateDefinition> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) throw new Error('This is not a Word (.docx) file.');
  photoCount = 0;
  const blocks = await docxBlocks(xml, zip, await rels(zip, 'word/document.xml'));
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
  // cover fields with their values: "LABEL / value" cells of the first table(s) before the body, or "Label: value" lines
  const cover: TemplateDefinition['cover'] = [];
  for (const b of intro) {
    if (b.kind === 'tbl') for (const r of b.rows) {
      // a two-cell row is "label | value"; otherwise each cell is "label\nvalue"
      if (r.length === 2 && r[0] && !r[0].includes('\n') && r[0].length < 40) { cover.push({ key: newSectionId(), label: titleCase(r[0]), default: r[1].replace(/\n/g, ' ').slice(0, 300) || undefined }); continue; }
      for (const c of r) { const [label, ...rest] = c.split('\n'); if (label && label.length < 40) cover.push({ key: newSectionId(), label: titleCase(label), default: rest.join(' ').slice(0, 300) || undefined }); }
    }
    if (b.kind === 'p') { const m = b.text.match(/^([A-Za-z][\w /&]{2,30}):\s*(.*)$/); if (m) cover.push({ key: newSectionId(), label: titleCase(m[1]), default: m[2].slice(0, 300) || undefined }); }
  }
  const coverPhotos = photosOf(intro);
  const sections: TemplateSection[] = [];
  if (coverPhotos.length) sections.push({ id: newSectionId(), title: 'Cover photos', kind: 'photos', content: { photos: coverPhotos } });
  let cur: { title: string; blocks: Block[] } | null = null;
  const flush = () => {
    if (!cur) return;
    const c = cur;
    const tables = c.blocks.filter((b) => b.kind === 'tbl');
    const photos = photosOf(c.blocks);
    const drawn = c.blocks.reduce((n, b) => n + b.drawings, 0);
    const paraTexts = c.blocks.filter((b) => b.kind === 'p' && b.text && !b.bullet && !isCaption(b.text)).map((b) => b.text);
    const bulletTexts = c.blocks.filter((b) => b.kind === 'p' && b.bullet && b.text).map((b) => b.text);
    const add = (kind: SectionKind, content: SectionData | undefined, extra: Partial<TemplateSection> = {}, title = c.title) => sections.push({ id: newSectionId(), title, kind, ...extra, ...(content ? { content } : {}) });
    // a charts section becomes a chart (counting a table column, chosen in the editor); its pictures are kept as photos
    if (/chart/i.test(c.title)) { add('chart', undefined); if (photos.length) add('photos', { photos }, {}, `${c.title} - figures`); }
    // pictures are counted from the file itself, so a section is a photo annex even where a picture format cannot be shown
    else if (drawn >= 2 || (/photo/i.test(c.title) && drawn)) add('photos', { ...(photos.length ? { photos } : {}), ...(paraTexts.length ? { text: paraTexts.join('\n\n') } : {}) });
    else {
      if (paraTexts.length) add('text', { text: paraTexts.join('\n\n') });
      if (bulletTexts.length) add('bullets', { bullets: bulletTexts }, {}, paraTexts.length ? `${c.title} - key points` : c.title);
      tables.forEach((t, k) => {
        if (!t.rows.length || !t.rows.some((r) => r.some(Boolean))) return;
        const head = t.rows[0];
        const name = tables.length > 1 && k ? `${c.title} (${k + 1})` : c.title;
        if (t.rows.length === 1 && head.length >= 2 && head.length <= 6 && head.every((x) => x.includes('\n'))) {
          // one row of "VALUE / LABEL" tiles
          const items = head.map((x) => titleCase(x.split('\n').slice(-1)[0]));
          add('status', { status: Object.fromEntries(items.map((it, i) => [it, head[i].split('\n')[0]])) }, { items }, k ? name : 'Status at a glance');
        } else {
          const width = Math.max(...t.rows.map((r) => r.length));
          const columns = head.map((x, i) => x.split('\n')[0] || `Column ${i + 1}`).concat(Array.from({ length: Math.max(0, width - head.length) }, (_, i) => `Column ${head.length + i + 1}`));
          add('table', { rows: t.rows.slice(1).map((r) => columns.map((_, i) => r[i] ?? '')) }, { columns }, name);
        }
      });
      if (photos.length) add('photos', { photos }, {}, `${c.title} - photos`);
      if (!paraTexts.length && !bulletTexts.length && !tables.length && !photos.length) add('text', undefined);
    }
    cur = null;
  };
  for (const b of blocks.slice(bodyStart)) {
    if (isHeading(b)) { flush(); cur = { title: headingTitle(b.text), blocks: [] }; continue; }
    if (cur) cur.blocks.push(b);
  }
  flush();
  // a document without numbered headings or Heading styles is kept whole as one section
  if (!sections.some((s) => s.title !== 'Cover photos')) {
    cur = { title: title || 'Report', blocks: blocks.slice(Math.max(0, firstHeading)) };
    flush();
  }
  return { title, division, cover: cover.slice(0, 30), sections };
}

/** PowerPoint deck → template: the first slide gives the title, every other slide becomes a section with its text, table and pictures. */
export async function templateFromPptx(file: Blob): Promise<TemplateDefinition> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/g)!.pop()) - Number(b.match(/\d+/g)!.pop()));
  if (!names.length) throw new Error('This is not a PowerPoint (.pptx) file.');
  photoCount = 0;
  let title = 'Report';
  const sections: TemplateSection[] = [];
  for (const [i, n] of names.entries()) {
    const xml = (await zip.file(n)!.async('string'));
    const shapes = [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((m) => m[0]);
    const titleShape = shapes.find((s) => /<p:ph [^>]*type="(title|ctrTitle)"/.test(s)) ?? shapes[0] ?? '';
    const slideTitle = clean(texts(titleShape, 'a:t').join(' '));
    const pics = [...xml.matchAll(/<p:pic>[\s\S]*?<\/p:pic>/g)].map((m) => m[0]).join('');
    const images = pics ? await imagesIn(pics, zip, await rels(zip, n)) : [];
    const paras = shapes.filter((s) => s !== titleShape).flatMap((s) => [...s.matchAll(/<a:p>[\s\S]*?<\/a:p>/g)].map((p) => clean(texts(p[0], 'a:t').join('')))).filter(Boolean);
    if (i === 0) {
      title = slideTitle || title;
      if (images.length) sections.push({ id: newSectionId(), title: 'Cover photos', kind: 'photos', content: { photos: images.map((src, k) => ({ evidenceId: `imported-0-${k + 1}`, caption: '', src })), ...(paras.length ? { text: paras.join('\n\n') } : {}) } });
      continue;
    }
    const name = slideTitle || `Slide ${i + 1}`;
    const tbl = xml.match(/<a:tbl>[\s\S]*?<\/a:tbl>/)?.[0];
    if (tbl) {
      const rows = [...tbl.matchAll(/<a:tr[ >][\s\S]*?<\/a:tr>/g)].map((r) => [...r[0].matchAll(/<a:tc[ >][\s\S]*?<\/a:tc>/g)].map((c) => clean(texts(c[0], 'a:t').join(' '))));
      const head = rows[0] ?? [];
      sections.push({ id: newSectionId(), title: name, kind: 'table', columns: head.map((h, k) => h || `Column ${k + 1}`), content: { rows: rows.slice(1) } });
    }
    if (images.length) {
      // a caption per picture: the slide's short text lines in order, when there is one per picture
      const caps = paras.length === images.length ? paras : [];
      sections.push({ id: newSectionId(), title: tbl ? `${name} - photos` : name, kind: 'photos', content: { photos: images.map((src, k) => ({ evidenceId: `imported-${i}-${k + 1}`, caption: caps[k] ?? '', src })), ...(!caps.length && paras.length && !tbl ? { text: paras.join('\n\n') } : {}) } });
    } else if (!tbl) {
      sections.push(paras.length > 1 ? { id: newSectionId(), title: name, kind: 'bullets', content: { bullets: paras } } : { id: newSectionId(), title: name, kind: 'text', content: paras.length ? { text: paras[0] } : undefined });
    }
  }
  if (!sections.length) throw new Error('The deck has only a title slide.');
  return { title, cover: [{ key: 'report_date', label: 'Report date' }, { key: 'prepared_by', label: 'Prepared by', default: 'NextEdge Access Solutions (NEAS)' }], sections };
}

/** Excel workbook → template: each sheet becomes a table with all its rows; pictures on a sheet become a photo section. */
export async function templateFromXlsx(file: Blob): Promise<TemplateDefinition> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  photoCount = 0;
  const cellText = (v: unknown): string => {
    if (v == null) return '';
    if (v instanceof Date) return v.toLocaleDateString('en-PH');
    if (typeof v === 'object') {
      const o = v as { result?: unknown; text?: unknown; richText?: { text: string }[]; hyperlink?: string };
      if (o.richText) return o.richText.map((r) => r.text).join('');
      if (o.result !== undefined) return cellText(o.result);
      if (o.text !== undefined) return cellText(o.text);
      return '';
    }
    return String(v);
  };
  const sections: TemplateSection[] = [];
  for (const ws of wb.worksheets) {
    const grid: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = (row.values as unknown[]).slice(1).map((v) => clean(cellText(v)));
      if (vals.some(Boolean)) grid.push(vals);
    });
    // the header is the first row with at least two filled cells; rows above it are titles, kept as text
    const h = grid.findIndex((r) => r.filter(Boolean).length >= 2);
    if (h > 0) sections.push({ id: newSectionId(), title: ws.name, kind: 'text', content: { text: grid.slice(0, h).map((r) => r.filter(Boolean).join(' ')).join('\n\n') } });
    if (h >= 0) {
      const width = Math.max(...grid.slice(h).map((r) => r.length));
      const columns = Array.from({ length: width }, (_, i) => grid[h][i] || `Column ${i + 1}`);
      sections.push({ id: newSectionId(), title: h > 0 ? `${ws.name} - table` : ws.name, kind: 'table', columns, content: { rows: grid.slice(h + 1).map((r) => columns.map((_, i) => r[i] ?? '')) } });
    }
    const photos: ReportPhoto[] = [];
    for (const im of ws.getImages()) {
      const media = wb.getImage(Number(im.imageId)) as { buffer?: ArrayBuffer | Uint8Array; base64?: string; extension?: string };
      const data = media.buffer ?? (media.base64 ? Uint8Array.from(atob(media.base64.replace(/^data:[^,]+,/, '')), (c) => c.charCodeAt(0)) : null);
      const src = data ? await toJpeg(data, `image/${media.extension === 'jpeg' ? 'jpeg' : media.extension ?? 'png'}`) : null;
      if (src) photos.push({ evidenceId: `imported-${ws.id}-${photos.length + 1}`, caption: '', src });
    }
    if (photos.length) sections.push({ id: newSectionId(), title: `${ws.name} - photos`, kind: 'photos', content: { photos } });
  }
  if (!sections.length) throw new Error('The workbook has no filled sheets.');
  return { title: file instanceof File ? file.name.replace(/\.[^.]+$/, '') : 'Report', cover: [{ key: 'report_date', label: 'Report date' }, { key: 'prepared_by', label: 'Prepared by', default: 'NextEdge Access Solutions (NEAS)' }], sections };
}

/** PDF → template: each page's text becomes a section, and every page is kept as an image so the report shows it exactly as printed. */
export async function templateFromPdf(file: Blob): Promise<TemplateDefinition> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  photoCount = 0;
  const sections: TemplateSection[] = [];
  let title = '';
  const pages: ReportPhoto[] = [];
  for (let n = 1; n <= Math.min(doc.numPages, MAX_PHOTOS); n++) {
    const page = await doc.getPage(n);
    const tc = await page.getTextContent();
    // lines: text items grouped by their vertical position
    const lines: string[] = [];
    let lastY: number | null = null;
    for (const it of tc.items as { str: string; transform: number[] }[]) {
      const y = Math.round(it.transform[5]);
      if (lastY !== null && Math.abs(y - lastY) < 3) lines[lines.length - 1] += ` ${it.str}`;
      else lines.push(it.str);
      lastY = y;
    }
    const text = lines.map(clean).filter(Boolean);
    if (!title && text[0]) title = titleCase(text[0].slice(0, 120));
    if (text.length) sections.push({ id: newSectionId(), title: `Page ${n}`, kind: 'text', content: { text: text.join('\n\n') } });
    const vp = page.getViewport({ scale: 1.6 });
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise;
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
    const src = blob ? await toJpeg(blob) : null;
    if (src) pages.push({ evidenceId: `imported-page-${n}`, caption: `Page ${n} of the original PDF`, src });
  }
  if (pages.length) sections.push({ id: newSectionId(), title: 'Original pages', kind: 'photos', content: { photos: pages } });
  if (!sections.length) throw new Error('No text or pages could be read from this PDF.');
  return { title: title || (file instanceof File ? file.name.replace(/\.[^.]+$/, '') : 'Report'), cover: [{ key: 'report_date', label: 'Report date' }, { key: 'prepared_by', label: 'Prepared by', default: 'NextEdge Access Solutions (NEAS)' }], sections };
}

export async function templateFromFile(file: File): Promise<TemplateDefinition> {
  const n = file.name.toLowerCase();
  if (n.endsWith('.docx')) return templateFromDocx(file);
  if (n.endsWith('.pptx')) return templateFromPptx(file);
  if (n.endsWith('.xlsx')) return templateFromXlsx(file);
  if (n.endsWith('.pdf')) return templateFromPdf(file);
  if (n.endsWith('.doc') || n.endsWith('.ppt') || n.endsWith('.xls')) throw new Error('Older .doc/.ppt/.xls files cannot be read. Save the file as .docx, .pptx or .xlsx and import that.');
  throw new Error('Choose a Word (.docx), PowerPoint (.pptx), Excel (.xlsx) or PDF file.');
}
