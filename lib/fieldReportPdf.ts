// PDF of one step-by-step field report (A4, NEAS layout): details, work done, materials, remarks,
// BEFORE / AFTER photos side by side with captions, other photos, signatures, page numbers.
import type { Evidence, FieldReport } from './types';
import { drawCompanyFooter } from './companyFooter';

export const reportNo = (r: FieldReport) => `FR-${r.date.replace(/-/g, '')}-${r.id.slice(0, 4).toUpperCase()}`;

export async function fieldReportPdf(r: FieldReport, opts: {
  projectName: string; projectCode: string; client?: string; activity: string;
  photos: Evidence[]; image: (e: Evidence) => Promise<{ data: string; w: number; h: number } | null>;
  logo?: { data: string; w: number; h: number } | null;
}): Promise<Blob> {
  const d = r.details;
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const { makePdfSafe, fit } = await import('./evidenceExport');
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  makePdfSafe(pdf);
  const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight(), M = 40;
  const NAVY: [number, number, number] = [7, 29, 41], GOLD: [number, number, number] = [202, 147, 50], MUTED: [number, number, number] = [93, 111, 123];
  let y = M;
  const room = (need: number) => { if (y + need > H - M - 20) { pdf.addPage(); y = M; } };
  const after = () => { y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14; };
  const heading = (t: string) => {
    room(36);
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11.5); pdf.setTextColor(...NAVY); pdf.text(t.toUpperCase(), M, y);
    pdf.setDrawColor(...GOLD); pdf.setLineWidth(1.2); pdf.line(M, y + 5, W - M, y + 5); y += 18;
  };
  const para = (t: string, size = 10) => {
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(size); pdf.setTextColor(30, 40, 48);
    for (const line of pdf.splitTextToSize(t, W - M * 2) as string[]) { room(14); pdf.text(line, M, y); y += 13; }
    y += 4;
  };

  // header band
  pdf.setFillColor(...NAVY); pdf.rect(0, 0, W, 78, 'F');
  if (opts.logo) { const f = fit(opts.logo, 52, 52); pdf.addImage(opts.logo.data, 'PNG', M, 13 + f.dy, f.w, f.h); }
  pdf.setTextColor(255, 255, 255); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15);
  pdf.text('NEXTEDGE ACCESS SOLUTIONS', M + 64, 34);
  pdf.setFontSize(10); pdf.setTextColor(...GOLD); pdf.text('FIELD REPORT', M + 64, 50);
  pdf.setTextColor(255, 255, 255); pdf.setFont('helvetica', 'normal');
  pdf.text(reportNo(r), W - M, 34, { align: 'right' });
  pdf.text(`Status: ${(r.status ?? 'submitted').toUpperCase()}`, W - M, 50, { align: 'right' });
  y = 100;

  autoTable(pdf, {
    startY: y, margin: { left: M, right: M }, theme: 'grid', styles: { fontSize: 9, cellPadding: 5 },
    columnStyles: { 0: { fontStyle: 'bold', fillColor: [241, 244, 246], cellWidth: 120 }, 2: { fontStyle: 'bold', fillColor: [241, 244, 246], cellWidth: 90 } },
    body: [
      ['Project', `${opts.projectCode} · ${opts.projectName}`, 'Report date', r.date],
      ['Client', opts.client || '—', 'Report type', d?.type ?? 'Progress'],
      ['Location', d?.location || '—', 'Weather', d?.weather || '—'],
      ['Work area', [d?.area, d?.floor].filter(Boolean).join(' - ') || '—', 'Activity', opts.activity],
      ...(d?.type === 'Progress' || !d ? [['Progress', `${r.actualPct}% complete`, '', '']] : []),
    ],
  });
  after();

  heading('Work description');
  para(d?.description || r.notes || '—');
  if (d?.tasks.some((t) => t.label.trim())) {
    heading('Work done / activities');
    autoTable(pdf, { startY: y, margin: { left: M, right: M }, theme: 'grid', head: [['Status', 'Activity', 'By', 'Note']], styles: { fontSize: 9.5, cellPadding: 4 },
      headStyles: { fillColor: NAVY, textColor: 255 }, columnStyles: { 0: { cellWidth: 70 } },
      body: d.tasks.filter((t) => t.label.trim()).map((t) => [({ done: 'Done', progress: 'In progress', not: 'Not done' } as Record<string, string>)[t.status ?? (t.done ? 'done' : 'not')], t.label, t.by ?? '', t.note ?? '']) });
    after();
  }
  if (d?.materials.length) {
    heading('Materials used');
    autoTable(pdf, { startY: y, margin: { left: M, right: M }, theme: 'grid', head: [['Material', 'Quantity', 'Unit']], styles: { fontSize: 9.5, cellPadding: 4 },
      headStyles: { fillColor: NAVY, textColor: 255 }, columnStyles: { 1: { halign: 'right', cellWidth: 70 }, 2: { cellWidth: 60 } },
      body: d.materials.map((m) => [m.name, String(m.qty), m.unit]) });
    after();
  }
  if (d?.remarks) { heading('Remarks'); para(d.remarks); }

  // photos: BEFORE / AFTER side by side (paired by order), then the other categories two per row
  const signIds = new Set((d?.signers ?? []).map((s) => s.photoId));
  const shots = opts.photos.filter((p) => !signIds.has(p.id));
  const before = shots.filter((p) => p.kind === 'Before'), afterP = shots.filter((p) => p.kind === 'After');
  const other = shots.filter((p) => p.kind !== 'Before' && p.kind !== 'After');
  const cw = (W - M * 2 - 14) / 2, ch = 200;
  const tile = async (e: Evidence | undefined, x: number, label: string) => {
    pdf.setFillColor(241, 244, 246); pdf.rect(x, y, cw, ch, 'F');
    if (!e) return;
    const img = await opts.image(e).catch(() => null);
    if (img) { const f = fit(img, cw, ch); pdf.addImage(img.data, 'JPEG', x + f.dx, y + f.dy, f.w, f.h); }
    else { pdf.setFontSize(9); pdf.setTextColor(...MUTED); pdf.text('Photo not available on this device', x + cw / 2, y + ch / 2, { align: 'center' }); }
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8.5); pdf.setTextColor(...NAVY);
    pdf.text(label, x, y + ch + 12);
    pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...MUTED);
    pdf.text((pdf.splitTextToSize([e.ref, e.caption, [e.workArea, e.locationDetail].filter(Boolean).join(' - ')].filter(Boolean).join(' · '), cw) as string[]).slice(0, 2), x, y + ch + 24);
  };
  if (before.length || afterP.length) {
    heading('Before and after photos');
    for (let i = 0; i < Math.max(before.length, afterP.length); i++) {
      room(ch + 44);
      await tile(before[i], M, before[i] ? `Before ${i + 1}` : '');
      await tile(afterP[i], M + cw + 14, afterP[i] ? `After ${i + 1}` : '');
      y += ch + 40;
    }
  }
  if (other.length) {
    heading('Other photos');
    for (let i = 0; i < other.length; i += 2) {
      room(ch + 44);
      await tile(other[i], M, `${other[i].kind} ${i + 1}`);
      if (other[i + 1]) await tile(other[i + 1], M + cw + 14, `${other[i + 1].kind} ${i + 2}`);
      y += ch + 40;
    }
  }

  if (d?.signers.length) {
    heading('Signatures');
    const per = Math.max(2, d.signers.length);
    const sw = (W - M * 2 - 14 * (per - 1)) / per;
    room(110);
    for (const [k, s] of d.signers.entries()) {
      const x = M + k * (sw + 14);
      const e = opts.photos.find((p) => p.id === s.photoId);
      const img = e ? await opts.image(e).catch(() => null) : null;
      if (img) { const f = fit(img, sw, 60); pdf.addImage(img.data, 'JPEG', x + f.dx, y + f.dy, f.w, f.h); }
      pdf.setDrawColor(...MUTED); pdf.line(x, y + 66, x + sw, y + 66);
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(...NAVY); pdf.text((pdf.splitTextToSize(s.name || '—', sw) as string[])[0], x, y + 80);
      pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...MUTED); pdf.text((pdf.splitTextToSize(s.role, sw) as string[])[0], x, y + 92);
      pdf.text(new Date(s.at).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }), x, y + 103);
    }
    y += 116;
    para('Signatures are drawn on the device and are not independently verified.', 8);
  }

  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(...MUTED);
    pdf.text(`${reportNo(r)} · ${opts.projectCode} · NEAS Field Report`, M, H - 20);
    pdf.text(`Page ${p} of ${pages}`, W - M, H - 20, { align: 'right' });
    drawCompanyFooter(pdf, H - 30);
  }
  return pdf.output('blob');
}
