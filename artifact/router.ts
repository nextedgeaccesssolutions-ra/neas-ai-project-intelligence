// Tiny in-page router for the single-file web build (replaces Next.js routing).
import { useSyncExternalStore } from 'react';

export const ROUTES = ['/', '/estimating', '/quotation', '/project-management', '/field-reports', '/projects', '/site-evidence', '/google-sheets'];
type Loc = { path: string; query: URLSearchParams; key: number };

const fromHash = (): string => {
  try {
    const h = window.location.hash.replace(/^#/, '');
    const p = h === '' || h === 'overview' ? '/' : '/' + h;
    return ROUTES.includes(p) ? p : '/';
  } catch {
    return '/';
  }
};

let loc: Loc = { path: typeof window === 'undefined' ? '/' : fromHash(), query: new URLSearchParams(), key: 0 };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function navigate(href: string) {
  const [path, qs = ''] = href.split('?');
  loc = { path: ROUTES.includes(path) ? path : '/', query: new URLSearchParams(qs), key: loc.key + 1 };
  try {
    const token = loc.path === '/' ? 'overview' : loc.path.slice(1);
    if (window.location.hash !== '#' + token) history.replaceState(null, '', '#' + token);
  } catch {
    /* hash not writable in this frame; in-memory routing still works */
  }
  window.scrollTo?.({ top: 0 });
  emit();
}

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    const p = fromHash();
    if (p !== loc.path) {
      loc = { path: p, query: new URLSearchParams(), key: loc.key + 1 };
      emit();
    }
  });
}

export function useLocation(): Loc {
  return useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => loc, () => loc);
}
