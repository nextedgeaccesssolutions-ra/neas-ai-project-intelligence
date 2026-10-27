'use client';
// File import/export for every module: Excel (.xlsx/.csv), PDF, Word (.docx) and JPEG.
// Heavy libraries load on demand so pages stay fast.
import { gridToRows, type Column, type Row } from './sheetSchema';

export interface TableColumn extends Column {
  /** display formatter for PDF/Word (Excel keeps raw values) */
  fmt?: (v: unknown, row: Row) => string;
}
export interface TableSpec {
  title: string;
  columns: TableColumn[];
  rows: Row[];
}
export interface ExportDoc {
  filename: string; // without extension
  title: string;
  subtitle?: string;
  meta?: [string, string][];
  tables: TableSpec[];
  images?: { caption: string; blob: Blob }[];
  footer?: string;
}

const BRAND = { navy: '071D29', sand: 'EBC07E', gold: 'CA9332', muted: '5D6F7B' };
const PDF_MARK = '%NEAS-DATA:';

// ---------- saving ----------
type Downloads = { save: (r: { filename: string; data: Blob | string }) => Promise<unknown> };
let dlPromise: Promise<Downloads | null> | null = null;
function downloadsCap(): Promise<Downloads | null> {
  if (!dlPromise) {
    const c = typeof window !== 'undefined' ? (window as unknown as { claude?: { use?: (n: string) => Promise<unknown> } }).claude : undefined;
    dlPromise = c?.use ? (c.use('downloads') as Promise<Downloads | null>).catch(() => null) : Promise.resolve(null);
  }
  return dlPromise;
}

/** Save a generated file: through the viewer's download prompt inside Claude, or a normal browser download. */
export async function saveFile(filename: string, data: Blob | string): Promise<'saved' | 'declined'> {
  const dl = await downloadsCap();
  if (dl) {
    try {
      await dl.save({ filename, data });
      return 'saved';
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === 'declined') return 'declined';
      throw new Error(code === 'rejected_extension' ? 'This file type cannot be saved here.' : (e as Error)?.message || 'Could not save the file.');
    }
  }
  const blob = typeof data === 'string' ? new Blob([data], { type: 'text/plain' }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  return 'saved';
}

const cellText = (c: TableColumn, r: Row) => {
  const v = r[c.key];
  if (c.fmt) return c.fmt(v, r);
  return v == null ? '' : String(v);
};
/** Standard PDF fonts cannot draw ₱ or the minus sign. */
const pdfSafe = (t: string) => t.replace(/₱/g, 'PHP ').replace(/−/g, '-').replace(/[–—]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/·/g, '-');

const blobToDataUrl = (b: Blob) =>
  new Promise<string>((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(b);
  });
const imgSize = (url: string) =>
  new Promise<{ w: number; h: number }>((res) => {
    const im = new Image();
    im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight });
    im.onerror = () => res({ w: 4, h: 3 });
    im.src = url;
  });

// ---------- Excel ----------
export async function exportExcel(doc: ExportDoc) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'NEAS Project Control';
  wb.created = new Date();
  for (const t of doc.tables) {
    const ws = wb.addWorksheet(t.title.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet');
    ws.columns = t.columns.map((c) => ({ header: c.label, key: c.key, width: Math.min(48, Math.max(10, c.label.length + 4)) }));
    for (const r of t.rows) ws.addRow(Object.fromEntries(t.columns.map((c) => [c.key, r[c.key] ?? ''])));
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: 'FF' + BRAND.navy } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + BRAND.sand } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    t.columns.forEach((c, i) => {
      if (c.num) ws.getColumn(i + 1).numFmt = /php/i.test(c.label) ? '#,##0.00' : '#,##0.##';
    });
  }
  if (doc.meta?.length) {
    const ws = wb.addWorksheet('Info');
    ws.addRow([doc.title]).font = { bold: true, size: 14 };
    if (doc.subtitle) ws.addRow([doc.subtitle]);
    doc.meta.forEach(([k, v]) => ws.addRow([k, v]));
    ws.getColumn(1).width = 28;
    ws.getColumn(2).width = 60;
  }
  const buf = await wb.xlsx.writeBuffer();
  return saveFile(`${doc.filename}.xlsx`, new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}

// ---------- PDF ----------
export async function exportPdf(doc: ExportDoc) {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const wide = doc.tables.some((t) => t.columns.length > 6);
  const pdf = new jsPDF({ orientation: wide ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const M = 40;
  // header band
  pdf.setFillColor(7, 29, 41);
  pdf.rect(0, 0, W, 64, 'F');
  pdf.setTextColor(235, 192, 126);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9);
  pdf.text('NEXTEDGE ACCESS SOLUTIONS - PROJECT CONTROL', M, 26);
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(16);
  pdf.text(pdfSafe(doc.title), M, 48);
  let y = 86;
  pdf.setTextColor(11, 31, 42);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  if (doc.subtitle) {
    pdf.text(pdfSafe(doc.subtitle), M, y);
    y += 16;
  }
  for (const [k, v] of doc.meta ?? []) {
    pdf.setFont('helvetica', 'bold');
    pdf.text(pdfSafe(k) + ':', M, y);
    pdf.setFont('helvetica', 'normal');
    pdf.text(pdfSafe(v), M + 130, y);
    y += 14;
  }
  y += 6;
  for (const t of doc.tables) {
    if (doc.tables.length > 1) {
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(11);
      pdf.text(pdfSafe(t.title), M, y);
      y += 8;
    }
    autoTable(pdf, {
      startY: y,
      margin: { left: M, right: M },
      head: [t.columns.map((c) => pdfSafe(c.label))],
      body: t.rows.length ? t.rows.map((r) => t.columns.map((c) => pdfSafe(cellText(c, r)))) : [[{ content: 'No records', colSpan: t.columns.length }]],
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 4, textColor: [11, 31, 42] },
      headStyles: { fillColor: [235, 192, 126], textColor: [7, 29, 41], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [245, 247, 249] },
      columnStyles: Object.fromEntries(t.columns.map((c, i) => [i, c.num ? { halign: 'right' } : {}])),
    });
    y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 22;
  }
  for (const im of doc.images ?? []) {
    const url = await blobToDataUrl(im.blob);
    const { w, h } = await imgSize(url);
    const maxW = W - 2 * M;
    const dw = Math.min(maxW, 360);
    const dh = (dw * h) / w;
    if (y + dh + 30 > H - M) {
      pdf.addPage();
      y = M;
    }
    pdf.addImage(url, 'JPEG', M, y, dw, dh);
    pdf.setFontSize(9);
    pdf.text(pdfSafe(im.caption), M, y + dh + 12, { maxWidth: maxW });
    y += dh + 30;
  }
  const pages = pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i);
    pdf.setFontSize(8);
    pdf.setTextColor(93, 111, 123);
    pdf.text(pdfSafe(`${doc.footer ?? 'Generated by NEAS Project Control'} - ${new Date().toLocaleString()}`), M, H - 18);
    pdf.text(`Page ${i} of ${pages}`, W - M, H - 18, { align: 'right' });
  }
  // embed the data so this PDF can be imported back into the app
  const payload = { v: 1, tables: doc.tables.map((t) => ({ title: t.title, columns: t.columns.map((c) => c.key), rows: t.rows })) };
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  const bytes = pdf.output('arraybuffer');
  const blob = new Blob([bytes, `\n${PDF_MARK}${b64}\n`], { type: 'application/pdf' });
  return saveFile(`${doc.filename}.pdf`, blob);
}

// ---------- Word ----------
export async function exportWord(doc: ExportDoc) {
  const d = await import('docx');
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel, ShadingType, AlignmentType, ImageRun, PageOrientation } = d;
  const wide = doc.tables.some((t) => t.columns.length > 6);
  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [
    new Paragraph({ children: [new TextRun({ text: 'NEXTEDGE ACCESS SOLUTIONS · PROJECT CONTROL', bold: true, color: BRAND.gold, size: 18 })] }),
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: doc.title, color: BRAND.navy })] }),
  ];
  if (doc.subtitle) children.push(new Paragraph({ children: [new TextRun({ text: doc.subtitle, color: BRAND.muted })] }));
  for (const [k, v] of doc.meta ?? []) children.push(new Paragraph({ children: [new TextRun({ text: `${k}: `, bold: true }), new TextRun(v)] }));
  for (const t of doc.tables) {
    if (doc.tables.length > 1) children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240 }, children: [new TextRun({ text: t.title, color: BRAND.navy })] }));
    const header = new TableRow({
      tableHeader: true,
      children: t.columns.map((c) => new TableCell({ shading: { type: ShadingType.CLEAR, fill: BRAND.sand, color: 'auto' }, children: [new Paragraph({ children: [new TextRun({ text: c.label, bold: true, size: 18 })] })] })),
    });
    const body = (t.rows.length ? t.rows : [{}]).map(
      (r) =>
        new TableRow({
          children: t.columns.map((c, i) =>
            new TableCell({
              children: [new Paragraph({ alignment: c.num ? AlignmentType.RIGHT : AlignmentType.LEFT, children: [new TextRun({ text: t.rows.length ? cellText(c, r) : i === 0 ? 'No records' : '', size: 18 })] })],
            }),
          ),
        }),
    );
    children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [header, ...body] }));
  }
  for (const im of doc.images ?? []) {
    const buf = await im.blob.arrayBuffer();
    const url = await blobToDataUrl(im.blob);
    const { w, h } = await imgSize(url);
    const dw = 420;
    children.push(new Paragraph({ spacing: { before: 200 }, children: [new ImageRun({ data: buf, transformation: { width: dw, height: Math.round((dw * h) / w) }, type: 'jpg' } as never)] }));
    children.push(new Paragraph({ children: [new TextRun({ text: im.caption, italics: true, size: 18, color: BRAND.muted })] }));
  }
  children.push(new Paragraph({ spacing: { before: 300 }, children: [new TextRun({ text: `${doc.footer ?? 'Generated by NEAS Project Control'} · ${new Date().toLocaleString()}`, size: 16, color: BRAND.muted })] }));
  const file = new Document({
    creator: 'NEAS Project Control',
    title: doc.title,
    sections: [{ properties: { page: { size: { orientation: wide ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT } } }, children }],
  });
  const blob = await Packer.toBlob(file);
  return saveFile(`${doc.filename}.docx`, blob);
}

// ---------- JPEG ----------
export async function exportJpeg(el: HTMLElement, filename: string) {
  const html2canvas = (await import('html2canvas')).default;
  const canvas = await html2canvas(el, { scale: Math.min(2, window.devicePixelRatio || 1) * 1.5, backgroundColor: '#ffffff', useCORS: true, logging: false });
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not render image'))), 'image/jpeg', 0.92));
  return saveFile(`${filename}.jpg`, blob);
}

// ---------- import ----------
export type ImportSource = 'Excel' | 'CSV' | 'Word' | 'PDF';

function parseCsv(raw: string): string[][] {
  const text = raw.replace(/^\uFEFF/, '');
  // semicolon-separated files: more semicolons than commas outside quotes on the first lines
  const head = text.slice(0, 4000).replace(/"[^"]*"/g, '');
  const sep = (head.match(/;/g) ?? []).length > (head.match(/,/g) ?? []).length ? ';' : ',';
  const out: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep || ch === '\t') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); out.push(row); row = []; cur = '';
    } else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); out.push(row); }
  return out;
}

function excelCell(v: unknown): unknown {
  if (v == null) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: string; hyperlink?: string };
    if (o.result !== undefined) return excelCell(o.result);
    if (o.richText) return o.richText.map((t) => t.text).join('');
    if (o.text !== undefined) return o.text;
    return '';
  }
  return v;
}

/** Excel workbook → { sheetName: grid } */
export async function readWorkbook(file: File): Promise<Record<string, unknown[][]>> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const out: Record<string, unknown[][]> = {};
  wb.eachSheet((ws) => {
    const grid: unknown[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = row.values as unknown[];
      grid.push(vals.slice(1).map(excelCell));
    });
    out[ws.name] = grid;
  });
  return out;
}

function tableFromHtml(html: string): string[][] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = doc.querySelector('table');
  if (!table) return [];
  return Array.from(table.querySelectorAll('tr')).map((tr) => Array.from(tr.querySelectorAll('th,td')).map((c) => (c.textContent ?? '').trim()));
}

/**
 * Read a table file into rows keyed by column key.
 * Excel/CSV: the sheet named like `preferSheet`, else the first. Word: the first table.
 * PDF: only PDFs exported by this app (they carry their data).
 */
export async function importTable(file: File, columns: Column[], preferSheet?: string): Promise<{ rows: Row[]; source: ImportSource }> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx')) {
    const books = await readWorkbook(file);
    const sheetName = Object.keys(books).find((n) => preferSheet && n.toLowerCase() === preferSheet.toLowerCase()) ?? Object.keys(books)[0];
    return { rows: gridToRows(columns, books[sheetName] ?? []), source: 'Excel' };
  }
  if (name.endsWith('.csv') || name.endsWith('.tsv') || name.endsWith('.txt')) {
    return { rows: gridToRows(columns, parseCsv(await file.text())), source: 'CSV' };
  }
  if (name.endsWith('.docx')) {
    const mammoth = (await import('mammoth/mammoth.browser')).default ?? (await import('mammoth/mammoth.browser'));
    const { value } = await (mammoth as { convertToHtml: (o: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }> }).convertToHtml({ arrayBuffer: await file.arrayBuffer() });
    const grid = tableFromHtml(value);
    if (!grid.length) throw new Error('No table found in this Word file.');
    return { rows: gridToRows(columns, grid), source: 'Word' };
  }
  if (name.endsWith('.pdf')) {
    const text = new TextDecoder('latin1').decode(await file.arrayBuffer());
    const i = text.lastIndexOf(PDF_MARK);
    if (i < 0) throw new Error('This PDF was not exported from NEAS Project Control, so its data cannot be read. Import an Excel, CSV or Word file instead.');
    const b64 = text.slice(i + PDF_MARK.length).trim().split(/\s/)[0];
    const payload = JSON.parse(decodeURIComponent(escape(atob(b64)))) as { tables: { columns: string[]; rows: Row[] }[] };
    const keys = new Set(columns.map((c) => c.key));
    const t = payload.tables.find((tb) => tb.columns.filter((k) => keys.has(k)).length >= Math.min(2, keys.size)) ?? payload.tables[0];
    return { rows: t?.rows ?? [], source: 'PDF' };
  }
  throw new Error('Unsupported file. Use .xlsx, .csv, .docx or a PDF exported from this app.');
}

export const IMPORT_ACCEPT = '.xlsx,.csv,.docx,.pdf';
