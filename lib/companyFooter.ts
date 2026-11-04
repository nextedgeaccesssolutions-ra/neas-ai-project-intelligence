// Company line printed at the foot of every page of every report the app produces (PDF and Word).
import type { jsPDF } from 'jspdf';

export const COMPANY_FOOTER_TEXT = 'NEXTEDGE ACCESS SOLUTIONS. NEAS OPC  ·  Email: info.nextedgeaccesssolutions@gmail.com  ·  Mobile: +63 991 426 5886  ·  Website: ';
export const COMPANY_WEBSITE = 'www.nextedge-access-solutions.com';
export const COMPANY_WEBSITE_URL = 'https://www.nextedge-access-solutions.com';

/** Draws the company line centred at height y (one line, small type); the website part is a link. */
export function drawCompanyFooter(pdf: jsPDF, y: number) {
  const W = pdf.internal.pageSize.getWidth();
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6.5); pdf.setTextColor(93, 111, 123);
  const a = pdf.getTextWidth(COMPANY_FOOTER_TEXT), b = pdf.getTextWidth(COMPANY_WEBSITE);
  const x = (W - a - b) / 2;
  pdf.text(COMPANY_FOOTER_TEXT, x, y);
  pdf.text(COMPANY_WEBSITE, x + a, y);
  pdf.link(x + a, y - 6, b, 8, { url: COMPANY_WEBSITE_URL });
}

/** The same company line as a Word page footer (centred, small grey type, website as a link). */
export function docxCompanyFooter(d: typeof import('docx'), lead?: string) {
  const run = (text: string) => new d.TextRun({ text, size: 13, color: '5D6F7B' });
  return new d.Footer({
    children: [
      ...(lead ? [new d.Paragraph({ children: [new d.TextRun({ text: lead, size: 14, color: '5D6F7B' })] })] : []),
      new d.Paragraph({
        alignment: d.AlignmentType.CENTER,
        children: [run(COMPANY_FOOTER_TEXT), new d.ExternalHyperlink({ link: COMPANY_WEBSITE_URL, children: [new d.TextRun({ text: COMPANY_WEBSITE, size: 13, color: '5D6F7B', underline: {} })] })],
      }),
    ],
  });
}
