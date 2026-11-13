// Checks for photo links fetched by the app server: no private or local network addresses, and share links
// (Google Drive, Dropbox) turned into links to the file itself.
import { isIP } from 'node:net';

const privateV4 = (ip: string) => {
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
};
export const isPrivateIp = (ip: string) => {
  if (isIP(ip) === 4) return privateV4(ip);
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return privateV4(v.slice(7));
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb');
};

// Google Drive and Dropbox share links point at a viewer page; ask for the file itself
export const directImageUrl = (u: URL) => {
  const drive = u.hostname === 'drive.google.com' && (u.pathname.match(/\/file\/d\/([^/]+)/)?.[1] ?? u.searchParams.get('id'));
  if (drive) return new URL(`https://drive.google.com/uc?export=download&id=${encodeURIComponent(drive)}`);
  if (u.hostname.endsWith('dropbox.com')) { u.searchParams.set('dl', '1'); return u; }
  return u;
};

