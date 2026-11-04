import { describe, expect, it } from 'vitest';
import { directImageUrl, isPrivateIp } from '../lib/photoUrlSafety';

describe('photo links fetched by the server', () => {
  it('refuses private, local and cloud-metadata addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.5', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1'])
      expect(isPrivateIp(ip)).toBe(true);
  });
  it('allows public addresses', () => {
    for (const ip of ['8.8.8.8', '142.250.72.14', '2606:4700::1111']) expect(isPrivateIp(ip)).toBe(false);
  });
  it('turns share links into file links', () => {
    expect(directImageUrl(new URL('https://drive.google.com/file/d/AbC123/view?usp=sharing')).toString()).toBe('https://drive.google.com/uc?export=download&id=AbC123');
    expect(directImageUrl(new URL('https://www.dropbox.com/s/x/site.jpg?dl=0')).searchParams.get('dl')).toBe('1');
    expect(directImageUrl(new URL('https://example.com/a.jpg')).toString()).toBe('https://example.com/a.jpg');
  });
});
