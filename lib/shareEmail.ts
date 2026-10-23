// E-mail for a shared project report. Pure: the server fills in the link after creating the share.
// The e-mail carries only a link to approved information, never attachments or internal data.

export interface ShareEmailInput {
  projectCode: string;
  projectName: string;
  senderName: string;
  message: string;
  link: string;
  expiresAt: string;
  subject?: string;
}

const EMAIL_RE = /^[^@\s<>",;]+@[^@\s<>",;]+\.[a-z]{2,}$/i;
export const validEmail = (s: string) => s.length <= 254 && EMAIL_RE.test(s.trim());

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/** Header-safe single line (no CR/LF), length-limited. */
const line = (s: string, max: number) => s.replace(/[\r\n]+/g, ' ').trim().slice(0, max);

export const defaultSubject = (code: string, name: string) => line(`NEAS Project Report — ${name} — ${code}`, 150);

export function buildShareEmail(i: ShareEmailInput): { subject: string; html: string; text: string } {
  const subject = line(i.subject?.trim() || defaultSubject(i.projectCode, i.projectName), 150);
  const message = i.message.trim().slice(0, 1500);
  const expires = new Date(i.expiresAt).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' });
  const text = [
    `${i.senderName} shared the approved project report for ${i.projectName} (${i.projectCode}).`,
    message ? `\n${message}\n` : '',
    `View the report: ${i.link}`,
    `This link expires on ${expires} (Philippine time). It shows only information NEAS has approved for sharing.`,
    '',
    'NextEdge Access Solutions (NEAS) OPC',
  ].join('\n');
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#17232C;max-width:560px">
<div style="background:#071D29;color:#EBC07E;padding:16px 20px;font-weight:bold;letter-spacing:.08em">NEXTEDGE ACCESS SOLUTIONS</div>
<div style="padding:20px;border:1px solid #dde3e8;border-top:0">
<p style="margin:0 0 12px">${esc(i.senderName)} shared the approved project report for <b>${esc(i.projectName)}</b> (${esc(i.projectCode)}).</p>
${message ? `<p style="margin:0 0 12px;white-space:pre-wrap">${esc(message)}</p>` : ''}
<p style="margin:20px 0"><a href="${esc(i.link)}" style="background:#CA9332;color:#071D29;padding:10px 18px;text-decoration:none;font-weight:bold;border-radius:4px">View report</a></p>
<p style="margin:0 0 6px;font-size:12px;color:#5b6b78">This link expires on ${esc(expires)} (Philippine time) and can be withdrawn by NEAS at any time. It shows only information NEAS has approved for sharing.</p>
<p style="margin:0;font-size:12px;color:#5b6b78">If the button does not work, copy this address into your browser:<br>${esc(i.link)}</p>
</div></div>`;
  return { subject, html, text };
}
