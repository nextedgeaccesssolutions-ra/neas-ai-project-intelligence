// Checks for photo links fetched by the app server: no private or local network addresses, and share links
// (Google Drive, Dropbox) turned into links to the file itself.
import { isIP } from 'node:net';

const privateV4 = (ip: string) => {
  const parts = ip.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return true;
  const [a, b, c, d] = parts.map(Number);
  if ([a, b, c, d].some((n) => n < 0 || n > 255)) return true;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19))
    || a >= 224;
};

const mappedIpv4 = (address: string): string | null => {
  const value = address.toLowerCase();
  if (!value.startsWith('::ffff:')) return null;
  const suffix = value.slice('::ffff:'.length);
  if (isIP(suffix) === 4) return suffix;
  // URL.hostname and DNS APIs may canonicalise an IPv4-mapped address to two hex words.
  const words = suffix.split(':');
  if (words.length !== 2 || words.some((word) => !/^[0-9a-f]{1,4}$/.test(word))) return null;
  const packed = Number.parseInt(words[0], 16) * 0x10000 + Number.parseInt(words[1], 16);
  return [packed >>> 24, (packed >>> 16) & 255, (packed >>> 8) & 255, packed & 255].join('.');
};

export const isPrivateIp = (ip: string) => {
  const version = isIP(ip);
  if (version === 4) return privateV4(ip);
  if (version !== 6) return true;
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) {
    const mapped = mappedIpv4(v);
    return mapped === null || privateV4(mapped);
  }
  // IPv6 unspecified, loopback, unique-local, link-local, multicast and IPv4-compatible forms.
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd')
    || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb')
    || v.startsWith('ff') || v.startsWith('::');
};

// Google Drive and Dropbox share links point at a viewer page; ask for the file itself
export const directImageUrl = (u: URL) => {
  const drive = u.hostname === 'drive.google.com' && (u.pathname.match(/\/file\/d\/([^/]+)/)?.[1] ?? u.searchParams.get('id'));
  if (drive) return new URL(`https://drive.google.com/uc?export=download&id=${encodeURIComponent(drive)}`);
  if (u.hostname.endsWith('dropbox.com')) { u.searchParams.set('dl', '1'); return u; }
  return u;
};
