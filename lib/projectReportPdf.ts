// Draws the project report (projectReport.ts) as an A4 PDF: official logo cover with 9.21 cm photo
// tiles, photo location register, executive summary, S-curve, Gantt table, site evidence,
// observations and summary. Cover tiles are placed at exact physical size and never shrunk.
import { COVER_TILE_PT } from './coverPhotos';
import { photoCaption } from './evidenceReport';
import { fit, makePdfSafe, toImage, type ReportImage } from './evidenceExport';
import type { ProjectReport } from './projectReport';

export type LoadImage = (id: string) => Promise<Blob | null>;
const NAVY = [7, 29, 41] as const, GOLD = [202, 147, 50] as const, GOLD_SOFT = [235, 192, 126] as const;
const INK = [11, 31, 42] as const, MUTED = [93, 111, 123] as const, LINE = [227, 233, 238] as const, PLAN = [94, 129, 150] as const;
export const LOGO_URL = '/neas-logo.png';

/** The official logo as a PNG data URL with its own pixel size (transparency kept). */
export async function loadLogo(url = LOGO_URL): Promise<{ data: string; w: number; h: number } | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const b = await r.blob();
    const data = await new Promise<string>((res, rej) => { const f = new FileReader(); f.onload = () => res(String(f.result)); f.onerror = rej; f.readAsDataURL(b); });
    const bmp = await createImageBitmap(b);
    const out = { data, w: bmp.width, h: bmp.height };
    bmp.close?.();
    return out;
  } catch { return null; }
}

export async function loadReportImages(r: ProjectReport, load: LoadImage, onProgress?: (d: number, n: number) => void) {
  const ids = [...new Set([...r.cover.map((c) => c.item.id), ...r.evidence.map((e) => e.id)])];
  const out = new Map<string, ReportImage | null>();
  let d = 0;
  for (const id of ids) {
    const b = await load(id).catch(() => null);
    out.set(id, b ? await toImage(b, 1400).catch(() => null) : null);
    onProgress?.(++d, ids.length);
  }
  return out;
}

export async function projectReportPdf(r: ProjectReport, images: Map<string, ReportImage | null>, logo: { data: string; w: number; h: number } | null): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  makePdfSafe(pdf);
  const W = () => pdf.internal.pageSize.getWidth(), H = () => pdf.internal.pageSize.getHeight();
  const M = 30;
  let page = 1;
  const footer = () => {
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(...MUTED);
    pdf.text(`${r.project.code} · ${r.title} · ${r.reference}`, M, H() - 16);
    pdf.text(`Page ${page}`, W() - M, H() - 16, { align: 'right' });
  };
  const head = (title: string) => {
    pdf.setFillColor(...NAVY); pdf.rect(0, 0, W(), 40, 'F');
    pdf.setFillColor(...GOLD); pdf.rect(0, 40, W(), 2.5, 'F');
    if (logo) pdf.addImage(logo.data, 'PNG', M, 5, 30, 30 * (logo.h / logo.w));
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.setTextColor(...GOLD_SOFT);
    pdf.text('NEXTEDGE ACCESS SOLUTIONS', M + (logo ? 38 : 0), 18);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(255, 255, 255);
    pdf.text(pdf.splitTextToSize(`${r.project.code} · ${r.project.name}`, W() - M * 2 - 180)[0], M + (logo ? 38 : 0), 30);
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(...GOLD_SOFT);
    pdf.text(title.toUpperCase(), W() - M, 24, { align: 'right' });
  };
  const newPage = (title: string, orientation: 'portrait' | 'landscape' = 'portrait') => {
    footer(); pdf.addPage('a4', orientation); page++; head(title); return 62;
  };
  const sectionTitle = (t: string, y: number) => {
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12); pdf.setTextColor(...GOLD); pdf.text(t.toUpperCase(), M, y);
    return y + 16;
  };
  const bullets = (items: string[], y: number, title: string, empty = 'None recorded.') => {
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5); pdf.setTextColor(...INK);
    for (const it of items.length ? items : [empty]) {
      const lines = pdf.splitTextToSize(`•  ${it}`, W() - M * 2);
      if (y + lines.length * 12 > H() - 40) y = newPage(title);
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5); pdf.setTextColor(...INK);
      pdf.text(lines, M, y); y += lines.length * 12 + 3;
    }
    return y + 6;
  };
  /** One 9.21 cm cover tile with its location reference underneath; returns the bottom y. */
  const coverTile = (c: ProjectReport['cover'][number], x: number, y: number, maxLines: number) => {
    const T = COVER_TILE_PT;
    pdf.setFillColor(241, 244, 246); pdf.rect(x, y, T, T, 'F');
    pdf.setDrawColor(...LINE); pdf.rect(x, y, T, T, 'S');
    const img = images.get(c.item.id);
    if (img) { const f = fit(img, T, T); pdf.addImage(img.data, 'JPEG', x + f.dx, y + f.dy, f.w, f.h); }
    else { pdf.setFontSize(9); pdf.setTextColor(...MUTED); pdf.text('Photo not available', x + T / 2, y + T / 2, { align: 'center' }); }
    let ly = y + T + 11;
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8.5); pdf.setTextColor(...INK);
    const tl = pdf.splitTextToSize(c.title, T).slice(0, 2);
    pdf.text(tl, x, ly); ly += tl.length * 10;
    pdf.setFontSize(7.5);
    for (const [k, v] of c.lines.slice(0, maxLines)) {
      pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...MUTED); pdf.text(k, x, ly);
      pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...INK); pdf.text(pdf.splitTextToSize(v, T - 72)[0], x + 72, ly);
      ly += 9.2;
    }
    if (c.mapUrl) { pdf.setTextColor(...GOLD); pdf.textWithLink('Open location in Google Maps', x, ly, { url: c.mapUrl }); ly += 9.2; }
    return ly;
  };

  // ---------------- page 1: cover
  pdf.setFillColor(...NAVY); pdf.rect(0, 0, W(), 6, 'F');
  let y = 26;
  const logoH = 86;
  if (logo) pdf.addImage(logo.data, 'PNG', M, y, logoH * (logo.w / logo.h), logoH);
  const tx = M + (logo ? logoH * (logo.w / logo.h) + 16 : 0);
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15); pdf.setTextColor(...NAVY); pdf.text('NextEdge Access Solutions', tx, y + 22);
  pdf.setFontSize(10); pdf.setTextColor(...GOLD); pdf.text(r.title.toUpperCase(), tx, y + 40);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(...MUTED); pdf.text(`Report reference ${r.reference}`, tx, y + 56);
  y += logoH + 18;
  pdf.setFillColor(...GOLD); pdf.rect(M, y - 8, W() - M * 2, 2, 'F');
  pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...INK);
  let size = 19; pdf.setFontSize(size);
  let nameLines = pdf.splitTextToSize(r.project.name, W() - M * 2);
  if (nameLines.length > 2) { size = 15; pdf.setFontSize(size); nameLines = pdf.splitTextToSize(r.project.name, W() - M * 2); }
  y += 14;
  for (const l of nameLines) { pdf.text(l, M, y); y += size + 4; }
  y += 2;
  pdf.setFontSize(8.5);
  const labelW = 105;
  for (const [k, v] of r.fields.filter(([k]) => k !== 'Project title' && k !== 'Report reference')) {
    const lines = pdf.splitTextToSize(v, W() - M * 2 - labelW).slice(0, 3);
    pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...MUTED); pdf.text(k, M, y);
    pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...INK); pdf.text(lines, M + labelW, y);
    y += lines.length * 10.5 + 2;
  }
  const T = COVER_TILE_PT, gap = W() - M * 2 - 2 * T;
  const coverOnFirst = r.cover.slice(0, 2);
  // tiles keep their exact size: if they do not fit under the details, they start on page 2
  const tileBlock = T + 11 + 20 + 5 * 9.2;
  if (coverOnFirst.length && y + 10 + tileBlock <= H() - 34) {
    y += 10;
    coverOnFirst.forEach((c, i) => coverTile(c, M + i * (T + gap), y, 5));
  } else if (r.cover.length) {
    pdf.setFontSize(9); pdf.setTextColor(...MUTED);
    pdf.text('Cover photos are shown at full size (9.21 cm) in the photo location register on the next page.', M, y + 18);
  } else {
    pdf.setFontSize(9); pdf.setTextColor(...MUTED);
    pdf.text('No project cover photos have been selected for this report.', M, y + 18);
  }

  // ---------------- photo location register: 4 tiles a page at full size, all details
  if (r.cover.length) {
    for (let i = 0; i < r.cover.length; i += 4) {
      y = newPage('Photo location register');
      r.cover.slice(i, i + 4).forEach((c, k) => {
        const x = M + (k % 2) * (T + gap), ty = y + Math.floor(k / 2) * ((H() - 62 - 40) / 2);
        coverTile(c, x, ty, 8);
      });
    }
  }

  // ---------------- A. executive summary
  y = newPage('A. Executive summary');
  y = sectionTitle('A. Executive summary', y);
  if (r.overall) {
    const kp: [string, string][] = [
      ['Actual progress', `${r.overall.actual.toFixed(1)}%`], ['Planned progress', `${r.overall.planned.toFixed(1)}%`],
      ['Variance', `${r.overall.variance >= 0 ? '+' : '−'}${Math.abs(r.overall.variance).toFixed(1)} pp`], ['Schedule status', r.overall.status],
    ];
    const bw = (W() - M * 2 - 18) / 4;
    kp.forEach(([k, v], i) => {
      const x = M + i * (bw + 6);
      pdf.setFillColor(246, 248, 250); pdf.roundedRect(x, y, bw, 46, 4, 4, 'F');
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(...MUTED); pdf.text(k, x + 8, y + 14);
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(i === 3 ? 9 : 15); pdf.setTextColor(...INK); pdf.text(pdf.splitTextToSize(v, bw - 16)[0], x + 8, y + 34);
    });
    y += 62;
  }
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.setTextColor(...INK); pdf.text('Key accomplishments', M, y); y += 14;
  y = bullets(r.accomplishments, y, 'A. Executive summary', 'No accomplishments recorded in this period.');
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.setTextColor(...INK); pdf.text('Outstanding activities', M, y); y += 14;
  y = bullets(r.outstanding, y, 'A. Executive summary', 'No outstanding activities.');
  if (y > H() - 80) y = newPage('A. Executive summary');
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.setTextColor(...INK); pdf.text('Delays, risks and blockers', M, y); y += 14;
  bullets(r.delays, y, 'A. Executive summary', 'No delays or blockers recorded.');

  // ---------------- B. progress S-curve
  y = newPage('B. Progress dashboard');
  y = sectionTitle('B. Progress dashboard', y);
  if (r.series.length > 1) {
    const cx = M + 30, cw = W() - M * 2 - 40, ch = 230, cy = y + 4;
    pdf.setDrawColor(...LINE); pdf.setLineWidth(0.5);
    for (let v = 0; v <= 100; v += 25) {
      const yy = cy + ch - (v / 100) * ch;
      pdf.line(cx, yy, cx + cw, yy);
      pdf.setFontSize(7); pdf.setTextColor(...MUTED); pdf.text(`${v}%`, cx - 4, yy + 2.5, { align: 'right' });
    }
    const n = r.series.length - 1;
    const px = (i: number) => cx + (i / n) * cw, py = (v: number) => cy + ch - (v / 100) * ch;
    pdf.setLineWidth(1.6); pdf.setDrawColor(...PLAN);
    for (let i = 1; i <= n; i++) pdf.line(px(i - 1), py(r.series[i - 1].planned), px(i), py(r.series[i].planned));
    pdf.setDrawColor(...GOLD);
    for (let i = 1; i <= n && r.series[i].day <= r.asOf; i++) pdf.line(px(i - 1), py(r.series[i - 1].actual), px(i), py(r.series[i].actual));
    const cut = r.series.findIndex((s) => s.day >= r.asOf);
    if (cut > 0) {
      pdf.setLineWidth(0.6); pdf.setDrawColor(...MUTED); pdf.setLineDashPattern([3, 3], 0); pdf.line(px(cut), cy, px(cut), cy + ch); pdf.setLineDashPattern([], 0);
      pdf.setFontSize(7); pdf.setTextColor(...MUTED); pdf.text('Cut-off', px(cut) + 3, cy + 9);
    }
    pdf.setFontSize(7); pdf.setTextColor(...MUTED);
    pdf.text(r.series[0].day, cx, cy + ch + 11); pdf.text(r.series[n].day, cx + cw, cy + ch + 11, { align: 'right' });
    pdf.setLineWidth(2); pdf.setDrawColor(...PLAN); pdf.line(cx, cy + ch + 24, cx + 18, cy + ch + 24); pdf.text('Planned', cx + 22, cy + ch + 26.5);
    pdf.setDrawColor(...GOLD); pdf.line(cx + 70, cy + ch + 24, cx + 88, cy + ch + 24); pdf.text('Actual', cx + 92, cy + ch + 26.5);
    pdf.setLineWidth(0.5);
    y = cy + ch + 44;
  } else {
    pdf.setFontSize(9); pdf.setTextColor(...MUTED); pdf.text('No schedule data to draw the S-curve.', M, y + 10); y += 30;
  }
  autoTable(pdf, {
    startY: y, margin: { left: M, right: M, bottom: 40 }, styles: { fontSize: 8, cellPadding: 3 }, headStyles: { fillColor: [...NAVY] as [number, number, number], textColor: [235, 192, 126] },
    head: [['Activity', 'Weight', 'Planned', 'Actual', 'Status']],
    body: r.rows.map((x) => [x.name, `${x.a.weight}%`, `${x.m.plannedPct.toFixed(1)}%`, `${x.m.actualPct.toFixed(1)}%`, x.m.status]),
    didDrawPage: () => { /* header on continuation pages is drawn by newPage */ },
  });

  // ---------------- C. Gantt schedule (landscape table)
  y = newPage('C. Gantt schedule', 'landscape');
  y = sectionTitle('C. Gantt schedule', y);
  const d = (s?: string | null) => (s ? s : '—');
  autoTable(pdf, {
    startY: y, margin: { left: M, right: M, bottom: 40 }, styles: { fontSize: 7, cellPadding: 2.5, overflow: 'linebreak' },
    headStyles: { fillColor: [...NAVY] as [number, number, number], textColor: [235, 192, 126] },
    head: [['Scope / task', 'Baseline', 'Planned (revised)', 'Actual', 'Planned dur.', 'Actual days', 'Planned %', 'Actual %', 'Variance', 'Status', 'Delay reason']],
    body: r.rows.map((x) => [
      x.name, `${d(x.a.baselineStart)} – ${d(x.a.baselineEnd)}`, `${x.a.start} – ${x.a.end}`, `${d(x.a.actualStart)} – ${x.a.actualFinish ?? (x.a.actualStart ? '…' : '—')}`,
      `${x.m.currentDuration} wd`, x.m.actualDays == null ? '—' : `${x.m.actualDays} wd`, `${x.m.plannedPct.toFixed(1)}%`, `${x.m.actualPct.toFixed(1)}%`,
      `${x.m.variancePts >= 0 ? '+' : '−'}${Math.abs(x.m.variancePts).toFixed(1)} pp`, x.m.status, x.a.delayReason || '—',
    ]),
    columnStyles: { 0: { cellWidth: 120 }, 10: { cellWidth: 110 } },
  });

  // ---------------- D. site evidence: 2 × 4 photos per page
  if (r.evidence.length) {
    const per = 8, cw = (595.28 - M * 2 - 12) / 2, chH = (841.89 - 62 - 40 - 12 * 3) / 4, capH = 46;
    for (let i = 0; i < r.evidence.length; i += per) {
      y = newPage('D. Site evidence');
      r.evidence.slice(i, i + per).forEach((p, k) => {
        const x = M + (k % 2) * (cw + 12), ty = y + Math.floor(k / 2) * (chH + 12), boxH = chH - capH;
        pdf.setFillColor(241, 244, 246); pdf.rect(x, ty, cw, boxH, 'F');
        const img = images.get(p.id);
        if (img) { const f = fit(img, cw, boxH); pdf.addImage(img.data, 'JPEG', x + f.dx, ty + f.dy, f.w, f.h); }
        else { pdf.setFontSize(8); pdf.setTextColor(...MUTED); pdf.text('Photo not available', x + cw / 2, ty + boxH / 2, { align: 'center' }); }
        let ly = ty + boxH + 9;
        photoCaption(p, r.audience, undefined, 'captured', i + k + 1, r.audience === 'internal' || r.evidence.some((e) => e.gps)).slice(0, 4).forEach((t, j) => {
          pdf.setFont('helvetica', j === 0 ? 'bold' : 'normal'); pdf.setFontSize(j === 0 ? 7.5 : 7); { const c = j === 0 ? INK : MUTED; pdf.setTextColor(c[0], c[1], c[2]); }
          pdf.text(pdf.splitTextToSize(t, cw)[0], x, ly); ly += 8.6;
        });
      });
    }
  }

  // ---------------- E. observations and actions
  y = newPage('E. Observations and actions');
  y = sectionTitle('E. Observations and actions', y);
  y = bullets(r.observations, y, 'E. Observations and actions', 'No findings, defects or stoppages recorded.');

  // ---------------- F. summary and approval
  if (y > H() - 220) y = newPage('F. Summary and approval');
  y = sectionTitle('F. Summary and approval', y + 6);
  y = bullets(r.summary, y, 'F. Summary and approval');
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.setTextColor(...INK); pdf.text('Data limitations', M, y); y += 14;
  y = bullets(r.limitations, y, 'F. Summary and approval');
  for (const [k, v] of r.approval) {
    if (y > H() - 50) y = newPage('F. Summary and approval');
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(...MUTED); pdf.text(k, M, y);
    pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...INK); pdf.text(v, M + 110, y); y += 14;
  }
  footer();
  return pdf.output('blob');
}
