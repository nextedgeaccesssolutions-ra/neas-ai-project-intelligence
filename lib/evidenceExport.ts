// Draws a Site Evidence report (see evidenceReport.ts) as PDF, PowerPoint or Word, in the browser.
// Same title page, photo grid and summary in every format; NEAS navy and gold.
import { COMPANY, photoCaption, type Report, type ReportPhoto } from './evidenceReport';
import { saveFile } from './fileio';

export type ReportFormat = 'pdf' | 'pptx' | 'docx';
export interface ReportImage { data: string; w: number; h: number }
/** Returns the photo's image, or null when it cannot be loaded (the page then says so). */
export type LoadPhoto = (p: ReportPhoto) => Promise<Blob | null>;

const NAVY = '071D29', GOLD = 'CA9332', GOLD_SOFT = 'EBC07E', INK = '0B1F2A', MUTED = '5D6F7B';
const rgb = (hex: string) => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

/** Decode, orient and downscale a photo to a JPEG data URL (max 1600 px) so large collections stay small. */
async function toImage(blob: Blob, max = 1600): Promise<ReportImage> {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return { data: c.toDataURL('image/jpeg', 0.82), w: c.width, h: c.height };
}

export async function loadImages(report: Report, load: LoadPhoto, onProgress?: (done: number, total: number) => void) {
  const out = new Map<string, ReportImage | null>();
  let done = 0;
  for (const p of report.photos) {
    const b = await load(p).catch(() => null);
    out.set(p.id, b ? await toImage(b).catch(() => null) : null);
    onProgress?.(++done, report.photos.length);
  }
  return out;
}

/** Fit an image into a box, keeping its aspect ratio and centring it. */
const fit = (img: ReportImage, w: number, h: number) => {
  const k = Math.min(w / img.w, h / img.h);
  return { w: img.w * k, h: img.h * k, dx: (w - img.w * k) / 2, dy: (h - img.h * k) / 2 };
};

export async function exportReport(report: Report, format: ReportFormat, images: Map<string, ReportImage | null>) {
  if (format === 'pdf') return saveFile(`${report.fileName}.pdf`, await toPdf(report, images));
  if (format === 'pptx') return saveFile(`${report.fileName}.pptx`, await toPptx(report, images));
  return saveFile(`${report.fileName}.docx`, await toDocx(report, images));
}

// ---------------------------------------------------------------- PDF (A4 portrait)
async function toPdf(r: Report, images: Map<string, ReportImage | null>): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight(), M = 40;
  const band = (sub: string) => {
    pdf.setFillColor(...rgb(NAVY)); pdf.rect(0, 0, W, 54, 'F');
    pdf.setFillColor(...rgb(GOLD)); pdf.rect(0, 54, W, 3, 'F');
    pdf.setFillColor(...rgb(GOLD)); pdf.roundedRect(M, 13, 28, 28, 4, 4, 'F');
    pdf.setTextColor(...rgb(NAVY)); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12); pdf.text('NE', M + 14, 31.5, { align: 'center' });
    pdf.setTextColor(...rgb(GOLD_SOFT)); pdf.setFontSize(11); pdf.text(COMPANY.toUpperCase(), M + 38, 25);
    pdf.setTextColor(255, 255, 255); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9);
    pdf.text(pdf.splitTextToSize(sub, W - M * 2 - 40)[0], M + 38, 39);
  };
  const footer = (n: number) => {
    pdf.setTextColor(...rgb(MUTED)); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8);
    pdf.text(`${r.title} · ${r.reference}`, M, H - 20);
    pdf.text(`Page ${n}`, W - M, H - 20, { align: 'right' });
  };
  let page = 1;

  // title page
  band(`${r.project.code} · ${r.project.name}`);
  let y = 100;
  pdf.setTextColor(...rgb(GOLD)); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11);
  pdf.text(r.title.toUpperCase(), M, y); y += 26;
  const more = (h: number) => {
    if (y + h <= H - 50) return;
    footer(page); pdf.addPage(); page++;
    band(`${r.title} · ${r.project.code} · ${r.project.name}`); y = 84;
  };
  pdf.setTextColor(...rgb(INK)); pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(22);
  let nameLines = pdf.splitTextToSize(r.project.name, W - M * 2);
  const nameSize = nameLines.length > 3 ? 16 : 22;
  pdf.setFontSize(nameSize);
  nameLines = pdf.splitTextToSize(r.project.name, W - M * 2);
  for (const line of nameLines) { more(nameSize + 5); pdf.text(line, M, y); y += nameSize + 5; }
  y += 6;
  pdf.setFontSize(10);
  const labelW = 120;
  for (const [k, v] of r.fields) {
    const lines = pdf.splitTextToSize(v, W - M * 2 - labelW);
    more(14 * lines.length + 4);
    pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...rgb(MUTED)); pdf.text(k, M, y);
    pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...rgb(INK)); pdf.text(lines, M + labelW, y);
    y += 14 * lines.length + 4;
    pdf.setDrawColor(227, 233, 238); pdf.line(M, y - 9, W - M, y - 9);
  }
  const cover = r.cover && images.get(r.cover.id);
  if (cover && H - 50 - y > 120) {
    const box = { w: W - M * 2, h: H - 60 - y };
    const f = fit(cover, box.w, box.h);
    pdf.addImage(cover.data, 'JPEG', M + f.dx, y + 4 + f.dy, f.w, f.h);
  }
  footer(page);

  // photo pages
  const gap = 12, capH = r.rows === 4 ? 56 : 40;
  const cellW = (W - M * 2 - gap) / 2, cellH = (H - 80 - 40 - gap * (r.rows - 1)) / r.rows;
  for (const group of r.pages) {
    pdf.addPage(); page++;
    band(`${r.title} · ${r.project.code} · ${r.project.name}`);
    group.forEach((p, i) => {
      const cx = M + (i % 2) * (cellW + gap), cy = 72 + Math.floor(i / 2) * (cellH + gap);
      const img = images.get(p.id), boxH = cellH - capH;
      pdf.setFillColor(241, 244, 246); pdf.rect(cx, cy, cellW, boxH, 'F');
      if (img) { const f = fit(img, cellW, boxH); pdf.addImage(img.data, 'JPEG', cx + f.dx, cy + f.dy, f.w, f.h); }
      else { pdf.setTextColor(...rgb(MUTED)); pdf.setFontSize(9); pdf.text('Photo not available', cx + cellW / 2, cy + boxH / 2, { align: 'center' }); }
      const cap = Math.floor((capH - 3) / 9);
      const wrapped = photoCaption(p, r.audience, undefined, r.datesAre).flatMap((t, j) => { pdf.setFontSize(j === 0 ? 8 : 7.5); return (pdf.splitTextToSize(t, cellW) as string[]).map((s) => ({ s, j })); });
      if (wrapped.length > cap) { wrapped.length = cap; wrapped[cap - 1] = { ...wrapped[cap - 1], s: wrapped[cap - 1].s.replace(/.{0,2}$/, '…') }; }
      let ly = cy + boxH + 10;
      for (const { s, j } of wrapped) {
        pdf.setFont('helvetica', j === 0 ? 'bold' : 'normal'); pdf.setFontSize(j === 0 ? 8 : 7.5);
        pdf.setTextColor(...rgb(j === 0 ? INK : MUTED));
        pdf.text(s, cx, ly); ly += 9;
      }
    });
    footer(page);
  }

  // summary
  pdf.addPage(); page++;
  band(`${r.title} · Summary`);
  y = 96;
  pdf.setTextColor(...rgb(GOLD)); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.text('SUMMARY', M, y); y += 22;
  pdf.setFontSize(10);
  for (const s of r.summary) {
    pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...rgb(MUTED)); pdf.text(s.label, M, y);
    const sl = pdf.splitTextToSize(s.value, W - M * 2 - labelW);
    pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...rgb(INK)); pdf.text(sl, M + labelW, y); y += Math.max(18, sl.length * 14 + 4);
  }
  y += 10;
  pdf.setTextColor(...rgb(GOLD)); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.text('FINDINGS', M, y); y += 20;
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); pdf.setTextColor(...rgb(INK));
  for (const f of r.findings.length ? r.findings : ['No findings recorded.']) {
    const lines = pdf.splitTextToSize(`•  ${f}`, W - M * 2);
    if (y + lines.length * 14 > H - 50) { footer(page); pdf.addPage(); page++; band(`${r.title} · Summary`); y = 96; }
    pdf.text(lines, M, y); y += lines.length * 14 + 4;
  }
  footer(page);
  return pdf.output('blob');
}

// ---------------------------------------------------------------- PowerPoint (16:9)
async function toPptx(r: Report, images: Map<string, ReportImage | null>): Promise<Blob> {
  const PptxGen = (await import('pptxgenjs')).default;
  const ppt = new PptxGen();
  ppt.layout = 'LAYOUT_WIDE'; // 13.33 × 7.5 in
  ppt.title = `${r.title} – ${r.project.name}`;
  ppt.company = COMPANY;
  const W = 13.33, H = 7.5, M = 0.45;
  const band = (s: InstanceType<typeof PptxGen>['addSlide'] extends (...a: never[]) => infer T ? T : never, sub: string) => {
    s.background = { color: 'FFFFFF' };
    s.addShape('rect', { x: 0, y: 0, w: W, h: 0.62, fill: { color: NAVY }, line: { color: NAVY } });
    s.addShape('rect', { x: 0, y: 0.62, w: W, h: 0.04, fill: { color: GOLD }, line: { color: GOLD } });
    s.addShape('roundRect', { x: M, y: 0.12, w: 0.38, h: 0.38, fill: { color: GOLD }, line: { color: GOLD }, rectRadius: 0.05 });
    s.addText('NE', { x: M, y: 0.12, w: 0.38, h: 0.38, fontSize: 12, bold: true, color: NAVY, align: 'center', valign: 'middle', fontFace: 'Arial' });
    s.addText([{ text: COMPANY.toUpperCase(), options: { bold: true, color: GOLD_SOFT, fontSize: 11, breakLine: true } }, { text: sub, options: { color: 'FFFFFF', fontSize: 9 } }],
      { x: M + 0.5, y: 0.06, w: W - M * 2 - 0.5, h: 0.5, fontFace: 'Arial', valign: 'middle', fit: 'shrink' });
    s.addText(`${r.title} · ${r.reference}`, { x: M, y: H - 0.35, w: W - M * 2, h: 0.25, fontSize: 8, color: MUTED, fontFace: 'Arial' });
  };

  // title slide
  const t = ppt.addSlide();
  band(t, `${r.project.code} · ${r.project.name}`);
  const hasCover = !!(r.cover && images.get(r.cover.id));
  const textW = hasCover ? 7.6 : W - M * 2;
  t.addText(r.title.toUpperCase(), { x: M, y: 0.85, w: textW, h: 0.35, fontSize: 13, bold: true, color: GOLD, fontFace: 'Arial' });
  const n = r.project.name.length;
  const nameSize = n > 110 ? 16 : n > 70 ? 20 : 26;
  const nameLines = Math.ceil(n / Math.floor((textW * 72 * 1.9) / nameSize));
  const nameH = Math.min(1.6, nameLines * nameSize * 1.25 / 72 + 0.1);
  t.addText(r.project.name, { x: M, y: 1.2, w: textW, h: nameH, fontSize: nameSize, bold: true, color: INK, fontFace: 'Arial', valign: 'top' });
  // estimate wrapped lines per row (10 pt Arial ≈ 13 characters per inch) and continue on extra slides
  const perLine = Math.floor((textW - 1.9) * 13);
  const rowH = ([, v]: [string, string]) => Math.max(1, Math.ceil(v.length / perLine)) * 0.2 + 0.1;
  const chunks: [string, string][][] = [[]];
  let room = H - 0.5 - (1.2 + nameH + 0.15);
  for (const f of r.fields) {
    if (rowH(f) > room && chunks[chunks.length - 1].length) { chunks.push([]); room = H - 0.5 - 0.85; }
    chunks[chunks.length - 1].push(f); room -= rowH(f);
  }
  const table = (s: ReturnType<typeof ppt.addSlide>, rows: [string, string][], y: number, w: number) =>
    s.addTable(rows.map(([k, v]) => [{ text: k, options: { bold: true, color: MUTED } }, { text: v, options: { color: INK } }]),
      { x: M, y, w, colW: [1.9, w - 1.9], fontSize: 10, fontFace: 'Arial', border: { type: 'solid', pt: 0.5, color: 'E3E9EE' }, valign: 'top', autoPage: false });
  table(t, chunks[0], 1.2 + nameH + 0.15, textW);
  if (hasCover) {
    const img = images.get(r.cover!.id)!, f = fit(img, 4.7, 4.9);
    t.addImage({ data: img.data, x: W - M - 4.7 + f.dx, y: 1.0 + f.dy, w: f.w, h: f.h });
  }
  for (const rows of chunks.slice(1)) {
    const c = ppt.addSlide();
    band(c, `${r.project.code} · ${r.project.name} · project details (continued)`);
    table(c, rows, 0.85, textW);
  }

  // photo slides: 2 × 4 → 4 across × 2 down, 2 × 6 → 6 across × 2 down (same photos per slide)
  const across = r.rows, down = 2, gap = 0.15, capH = 0.62;
  const cellW = (W - M * 2 - gap * (across - 1)) / across, cellH = (H - 0.85 - 0.45 - gap) / down;
  for (const group of r.pages) {
    const s = ppt.addSlide();
    band(s, `${r.title} · ${r.project.code} · ${r.project.name}`);
    group.forEach((p, i) => {
      const x = M + (i % across) * (cellW + gap), y = 0.8 + Math.floor(i / across) * (cellH + gap), boxH = cellH - capH;
      s.addShape('rect', { x, y, w: cellW, h: boxH, fill: { color: 'F1F4F6' }, line: { color: 'F1F4F6' } });
      const img = images.get(p.id);
      if (img) { const f = fit(img, cellW, boxH); s.addImage({ data: img.data, x: x + f.dx, y: y + f.dy, w: f.w, h: f.h }); }
      else s.addText('Photo not available', { x, y, w: cellW, h: boxH, fontSize: 9, color: MUTED, align: 'center', valign: 'middle' });
      const lines = photoCaption(p, r.audience, undefined, r.datesAre);
      s.addText(lines.map((tx, j) => ({ text: tx, options: { bold: j === 0, color: j === 0 ? INK : MUTED, breakLine: true } })),
        { x, y: y + boxH + 0.02, w: cellW, h: capH - 0.02, fontSize: across > 4 ? 6.5 : 7.5, fontFace: 'Arial', valign: 'top', fit: 'shrink', margin: 1 });
    });
  }

  // summary slide
  const sm = ppt.addSlide();
  band(sm, `${r.title} · Summary`);
  sm.addText('SUMMARY', { x: M, y: 0.85, w: 6, h: 0.35, fontSize: 13, bold: true, color: GOLD, fontFace: 'Arial' });
  sm.addTable(r.summary.map((s) => [{ text: s.label, options: { bold: true, color: MUTED } }, { text: s.value, options: { color: INK } }]),
    { x: M, y: 1.3, w: 5.8, colW: [1.8, 4.0], fontSize: 11, fontFace: 'Arial', border: { type: 'solid', pt: 0.5, color: 'E3E9EE' } });
  sm.addText('FINDINGS', { x: 6.8, y: 0.85, w: 6, h: 0.35, fontSize: 13, bold: true, color: GOLD, fontFace: 'Arial' });
  sm.addText((r.findings.length ? r.findings : ['No findings recorded.']).map((f) => ({ text: f, options: { bullet: true, breakLine: true } })),
    { x: 6.8, y: 1.3, w: W - 6.8 - M, h: H - 1.9, fontSize: 11, color: INK, fontFace: 'Arial', valign: 'top', fit: 'shrink' });

  return (await ppt.write({ outputType: 'blob' })) as Blob;
}

// ---------------------------------------------------------------- Word (A4 portrait)
async function toDocx(r: Report, images: Map<string, ReportImage | null>): Promise<Blob> {
  const d = await import('docx');
  const { AlignmentType, BorderStyle, Document, HeadingLevel, ImageRun, Packer, PageBreak, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType, Footer, Header } = d;
  const bytes = (dataUrl: string) => Uint8Array.from(atob(dataUrl.split(',')[1]), (c) => c.charCodeAt(0));
  // docx 8 stores every picture as a .png part, so hand it real PNG data (smaller, at document resolution)
  const png = new Map<string, Uint8Array>();
  for (const [id, im] of images) {
    if (!im) continue;
    const el = new Image();
    el.src = im.data;
    await el.decode();
    const k = Math.min(1, 700 / Math.max(im.w, im.h));
    const c = document.createElement('canvas');
    c.width = Math.round(im.w * k); c.height = Math.round(im.h * k);
    c.getContext('2d')!.drawImage(el, 0, 0, c.width, c.height);
    png.set(id, bytes(c.toDataURL('image/png')));
  }
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const noBorders = { top: none, bottom: none, left: none, right: none };
  const line = { style: BorderStyle.SINGLE, size: 4, color: 'E3E9EE' };
  const kv = (rows: [string, string][]) => new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(([k, v]) => new TableRow({ children: [
      new TableCell({ width: { size: 28, type: WidthType.PERCENTAGE }, borders: { ...noBorders, bottom: line }, children: [new Paragraph({ children: [new TextRun({ text: k, bold: true, color: MUTED, size: 19 })] })] }),
      new TableCell({ width: { size: 72, type: WidthType.PERCENTAGE }, borders: { ...noBorders, bottom: line }, children: [new Paragraph({ children: [new TextRun({ text: v, color: INK, size: 20 })] })] }),
    ] })),
  });
  const img = (p: ReportPhoto, wPx: number, hPx: number) => {
    const im = images.get(p.id);
    if (!im) return new Paragraph({ children: [new TextRun({ text: 'Photo not available', color: MUTED, italics: true, size: 16 })] });
    const f = fit(im, wPx, hPx);
    return new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: png.get(p.id)!, transformation: { width: Math.round(f.w), height: Math.round(f.h) } })] });
  };
  const header = new Header({ children: [new Paragraph({
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: NAVY },
    children: [new TextRun({ text: ` ${COMPANY.toUpperCase()} `, bold: true, color: GOLD_SOFT, size: 18 }), new TextRun({ text: `  ${r.title} · ${r.project.code}`, color: 'FFFFFF', size: 16 })],
  })] });
  const footer = new Footer({ children: [new Paragraph({ children: [new TextRun({ text: `${r.title} · ${r.reference}`, color: MUTED, size: 14 })] })] });

  const title: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [
    new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: r.title.toUpperCase(), bold: true, color: GOLD, size: 22 })] }),
    new Paragraph({ heading: HeadingLevel.TITLE, spacing: { after: 240 }, children: [new TextRun({ text: r.project.name, bold: true, color: INK, size: 44 })] }),
    kv(r.fields),
  ];
  if (r.cover && images.get(r.cover.id)) title.push(new Paragraph({ spacing: { before: 240 }, children: [] }), img(r.cover, 600, 330));

  const cellPx = { w: 300, h: r.rows === 4 ? 165 : 105 };
  const photoSections = r.pages.map((group, gi) => {
    const rows: InstanceType<typeof TableRow>[] = [];
    for (let i = 0; i < group.length; i += 2) {
      rows.push(new TableRow({ cantSplit: true, children: [0, 1].map((j) => {
        const p = group[i + j];
        return new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, borders: noBorders, margins: { top: 60, bottom: 60, left: 60, right: 60 },
          children: p ? [img(p, cellPx.w, cellPx.h), ...photoCaption(p, r.audience, undefined, r.datesAre).map((t, k) => new Paragraph({ children: [new TextRun({ text: t, bold: k === 0, color: k === 0 ? INK : MUTED, size: 15 })] }))] : [new Paragraph('')] });
      }) }));
    }
    return [
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: `Photo evidence${r.pages.length > 1 ? ` (${gi + 1} of ${r.pages.length})` : ''}`, color: INK, bold: true, size: 24 })] }),
      new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }),
      new Paragraph({ children: [new PageBreak()] }),
    ];
  }).flat();

  const summary = [
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: 'Summary', color: INK, bold: true, size: 24 })] }),
    kv(r.summary.map((s) => [s.label, s.value])),
    new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240 }, children: [new TextRun({ text: 'Findings', color: INK, bold: true, size: 24 })] }),
    ...(r.findings.length ? r.findings : ['No findings recorded.']).map((f) => new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: f, size: 20 })] })),
  ];

  const page = { margin: { top: 900, bottom: 800, left: 800, right: 800 } };
  const doc = new Document({
    creator: COMPANY, title: `${r.title} – ${r.project.name}`,
    sections: [
      { properties: { page }, headers: { default: header }, footers: { default: footer }, children: [...title, new Paragraph({ children: [new PageBreak()] }), ...photoSections, ...summary] },
    ],
  });
  return Packer.toBlob(doc);
}
