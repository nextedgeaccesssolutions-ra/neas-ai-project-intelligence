'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useStore } from '@/lib/store';
import DialogHost, { IS_ARTIFACT } from '@/components/Dialogs';
import { useSyncStatus } from '@/lib/sheetsSync';
import { CLOUD } from '@/lib/cloud/env';
import { canManage, canView, isClientViews, cloudSignOut, cloudStatusNow, useCloudStatus, VIEWS, viewOfPath } from '@/lib/cloud/cloudSync';
import { requestPersistentStorage, unsentSummary, type PersistState } from '@/lib/offline/persist';
import { askConfirm } from '@/components/Dialogs';

/** Pages that render without the workspace frame (sign-in flows and the client portal). */
const BARE = [/^\/login/, /^\/activate/, /^\/register/, /^\/auth\//, /^\/client\//, /^\/share/, /^\/account/];
const MANAGER_ONLY = new Set(['/estimating', '/quotation']);

function CloudPill() {
  const c = useCloudStatus();
  let label = 'Online — synchronized';
  let tone = 'pill-ok';
  if (!c.online) { label = `Offline — working locally${c.pending ? ` · ${c.pending} pending` : ''}`; tone = 'pill-warn'; }
  else if (c.conflicts) { label = `Conflict detected (${c.conflicts})`; tone = 'pill-bad'; }
  else if (c.rejected) { label = `Sync error (${c.rejected})`; tone = 'pill-bad'; }
  else if (c.pending || c.syncing) { label = `Pending sync (${c.pending})`; tone = 'pill-warn'; }
  else if (c.error) { label = 'Sync error'; tone = 'pill-bad'; }
  return (
    <Link href="/offline-queue" className={`pill sync-pill ${tone}`} style={{ textDecoration: 'none' }} title={c.error ?? (c.lastSyncAt ? `Last sync ${new Date(c.lastSyncAt).toLocaleString()}` : '')}>
      <span className="dot" />
      {label}
    </Link>
  );
}

function SyncPill() {
  const s = useSyncStatus();
  const map: Record<string, [string, string]> = {
    checking: ['Sheets: checking', ''],
    unavailable: ['Sheets: not connected', 'pill-warn'],
    paused: ['Sheets: auto-sync off', 'pill-warn'],
    idle: ['Sheets: connected', 'pill-ok'],
    pending: ['Sheets: changes waiting', 'pill-warn'],
    syncing: ['Sheets: syncing…', ''],
    synced: [`Sheets: synced ${s.at ? new Date(s.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}`, 'pill-ok'],
    error: ['Sheets: sync problem', 'pill-bad'],
  };
  const [label, tone] = map[s.state] ?? map.checking;
  return (
    <Link href="/google-sheets" className={`pill sync-pill ${tone}`} title={s.message ?? 'Google Sheets sync'} style={{ textDecoration: 'none' }}>
      <span className="dot" />
      {label}
    </Link>
  );
}

export const NAV = [
  { href: '/', label: 'Overview', icon: 'grid', group: 'Dashboard' },
  { href: '/projects', label: 'Project register', icon: 'table', group: 'Projects' },
  { href: '/project-management', label: 'Schedule & Gantt', icon: 'gantt', group: 'Projects' },
  { href: '/field-reports', label: 'Field reports', icon: 'spark', group: 'Field operations' },
  { href: '/site-evidence', label: 'Site evidence', icon: 'camera', group: 'Field operations' },
  { href: '/global-reports', label: 'Global reports', icon: 'chart', group: 'Reports' },
  { href: '/reports', label: 'Project reports', icon: 'doc', group: 'Reports' },
  { href: '/templates', label: 'Report templates', icon: 'doc', group: 'Reports' },
  { href: '/google-sheets', label: 'Google Sheets sync', icon: 'sheet', group: 'Reports' },
  { href: '/estimating', label: 'Estimating & BOQ', icon: 'list', group: 'Commercial' },
  { href: '/quotation', label: 'Quotation preview', icon: 'quote', group: 'Commercial' },
] as const;
const GROUPS = ['Dashboard', 'Projects', 'Field operations', 'Reports', 'Commercial'] as const;

function Icon({ name }: { name: string }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const paths: Record<string, ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" {...p} /><rect x="14" y="3" width="7" height="7" rx="1.5" {...p} /><rect x="3" y="14" width="7" height="7" rx="1.5" {...p} /><rect x="14" y="14" width="7" height="7" rx="1.5" {...p} /></>,
    list: <><path d="M8 6h13M8 12h13M8 18h13" {...p} /><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" {...p} strokeWidth={3} /></>,
    chart: <><path d="M4 20V10M10 20V4M16 20v-7M21 20H3" {...p} /></>,
    doc: <><path d="M6 3h9l4 4v14H6z" {...p} /><path d="M9 12h7M9 16h7M14 3v5h5" {...p} /></>,
    gantt: <><path d="M4 6h9M8 12h10M6 18h8" {...p} strokeWidth={3} /></>,
    spark: <><path d="M12 3v6M12 15v6M3 12h6M15 12h6" {...p} /></>,
    table: <><rect x="3" y="4" width="18" height="16" rx="2" {...p} /><path d="M3 10h18M9 10v10" {...p} /></>,
    camera: <><rect x="3" y="7" width="18" height="13" rx="2" {...p} /><circle cx="12" cy="13.5" r="3.5" {...p} /><path d="M9 7l1.5-3h3L15 7" {...p} /></>,
    sheet: <><rect x="4" y="3" width="16" height="18" rx="2" {...p} /><path d="M4 9h16M4 15h16M10 3v18" {...p} /></>,
    quote: <><path d="M6 3h9l4 4v14H6z" {...p} /><path d="M9 13h3m-3 4h7M10 8.5h3" {...p} /></>,
    sync: <><path d="M20 11a8 8 0 0 0-14-4.9L4 8M4 13a8 8 0 0 0 14 4.9L20 16M4 4v4h4M20 20v-4h-4" {...p} /></>,
    user: <><circle cx="12" cy="8" r="4" {...p} /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" {...p} /></>,
    collapse: <><path d="M15 6l-6 6 6 6" {...p} /></>,
    expand: <><path d="M9 6l6 6-6 6" {...p} /></>,
    gear: <><circle cx="12" cy="12" r="3" {...p} /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" {...p} /></>,
  };
  return <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const set = () => setOnline(navigator.onLine);
    set();
    window.addEventListener('online', set);
    window.addEventListener('offline', set);
    return () => {
      window.removeEventListener('online', set);
      window.removeEventListener('offline', set);
    };
  }, []);
  return online;
}

export default function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (CLOUD && BARE.some((r) => r.test(pathname))) return <>{children}<DialogHost /></>;
  return <Workspace pathname={pathname}>{children}</Workspace>;
}

function Workspace({ children, pathname }: { children: ReactNode; pathname: string }) {
  const { state, persistError, ready, resetDemo } = useStore();
  const cloud = useCloudStatus();
  const [open, setOpen] = useState(false);
  // desktop: icon-only sidebar, remembered per device
  const [mini, setMini] = useState(false);
  useEffect(() => { try { setMini(localStorage.getItem('neas-side-mini') === '1'); } catch { /* per-device convenience */ } }, []);
  const toggleMini = () => setMini((m) => { try { localStorage.setItem('neas-side-mini', m ? '0' : '1'); } catch { /* ignore */ } return !m; });
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open]);
  const online = useOnline();
  const current = NAV.find((n) => (n.href === '/' ? pathname === '/' : pathname.startsWith(n.href))) ?? NAV[0];

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production' && !IS_ARTIFACT) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);
  // keep the offline queue and photos from being cleared by the browser
  const [persist, setPersist] = useState<PersistState>('unsupported');
  useEffect(() => { if (CLOUD) void requestPersistentStorage().then(setPersist); }, []);

  const saved = state.savedAt ? new Date(state.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;

  // cloud mode: only signed-in, approved users reach the workspace
  useEffect(() => {
    if (!CLOUD) return;
    if (cloud.auth === 'signed_out' || cloud.auth === 'expired') window.location.replace('/login');
    else if (cloud.auth === 'pending') window.location.replace('/account');
  }, [cloud.auth]);
  if (CLOUD && cloud.auth !== 'active' && cloud.auth !== 'offline_grace') {
    return <div className="auth-wrap"><div className="auth-card note">{cloud.auth === 'checking' ? 'Checking your access…' : 'Redirecting to sign in…'}</div></div>;
  }
  const isAdmin = CLOUD && cloud.profile?.global_role === 'super_admin';
  const nav = NAV.filter((n) => !CLOUD || ((!MANAGER_ONLY.has(n.href) || canManage(state.activeProjectId)) && canView(viewOfPath(n.href), cloud.profile) && !(n.href === '/templates' && isClientViews(cloud.profile?.allowed_views))));
  const blocked = CLOUD && !pathname.startsWith('/admin') && !canView(viewOfPath(pathname), cloud.profile);
  const allowedLinks = VIEWS.filter(([k]) => canView(k, cloud.profile));

  const page = pathname.startsWith('/admin') ? { label: 'Control panel', group: 'Administration', href: '/admin' }
    : pathname.startsWith('/offline-queue') ? { label: 'Offline queue', group: 'System', href: '/offline-queue' } : current;
  const role = !CLOUD ? 'Device mode' : isAdmin ? 'Super Admin' : canManage(state.activeProjectId) ? 'Project manager' : 'Staff';
  const link = (href: string, label: string, icon: string, active: boolean) => (
    <Link key={href} href={href} aria-current={active ? 'page' : undefined} title={mini ? label : undefined} aria-label={mini ? label : undefined}>
      <Icon name={icon} />
      <span className="nav-text">{label}</span>
    </Link>
  );

  return (
    <div className={`shell${mini ? ' mini' : ''}`}>
      <a className="skip-link" href="#main-content">Skip to content</a>
      {open && <div className="side-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />}
      <aside className={`side${open ? ' open' : ''}`} aria-label="Main navigation">
        <Link href="/" className="brand" title="NEAS Intelligence · Project Control">
          <img className="brand-mark brand-logo" src="/neas-logo.png" alt="NEAS — NextEdge Access Solutions" width={44} height={44} />
          <span className="nav-text">
            <div className="brand-name">NEAS INTELLIGENCE</div>
            <div className="brand-sub">PROJECT CONTROL</div>
          </span>
        </Link>
        <nav className="side-scroll" aria-label="Main">
          {GROUPS.map((g) => {
            const items = nav.filter((n) => n.group === g);
            if (!items.length) return null;
            return (
              <div key={g} className="nav-group" role="group" aria-labelledby={`nav-${g.replace(/\W+/g, '-')}`}>
                <div className="side-label" id={`nav-${g.replace(/\W+/g, '-')}`}>{g.toUpperCase()}</div>
                <div className="nav">
                  {items.map((n) => link(n.href, n.label, n.icon, n.href === current.href && page === current))}
                </div>
              </div>
            );
          })}
          {CLOUD && canView('offline_queue', cloud.profile) && (
            <div className="nav-group" role="group" aria-labelledby="nav-system">
              <div className="side-label" id="nav-system">SYSTEM</div>
              <div className="nav">{link('/offline-queue', 'Offline queue', 'sync', pathname.startsWith('/offline-queue'))}</div>
            </div>
          )}
          {isAdmin && (
            <div className="nav-group" role="group" aria-labelledby="nav-admin">
              <div className="side-label" id="nav-admin">ADMINISTRATION</div>
              <div className="nav">{link('/admin', 'Control panel', 'gear', pathname.startsWith('/admin'))}</div>
            </div>
          )}
        </nav>
        <button className="side-collapse" onClick={toggleMini} aria-label={mini ? 'Expand sidebar' : 'Collapse sidebar'} title={mini ? 'Expand sidebar' : 'Collapse sidebar'}>
          <Icon name={mini ? 'expand' : 'collapse'} /><span className="nav-text">Collapse</span>
        </button>
        {mini && (
          <div className="nav side-mini-foot">
            {link('/account', CLOUD ? 'Your account and sign out' : 'About this preview build', 'user', pathname.startsWith('/account'))}
          </div>
        )}
        <div className="side-foot nav-text">
          {CLOUD && cloud.profile ? (
            <>
              <Link href="/account" style={{ color: '#fff', textDecoration: 'none' }}><b>{cloud.profile.full_name || cloud.profile.email}</b></Link>
              <br />
              {isAdmin ? 'Super Admin' : 'Staff'} · <button className="linklike" style={{ color: 'var(--sand)' }} onClick={() => signOutChecked(resetDemo).then((ok) => { if (ok) window.location.replace('/login'); })}>Sign out</button>
            </>
          ) : (
            <>
              NEAS AI Project Intelligence
              <br />
              Preview build · data saved on this device
            </>
          )}
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="btn btn-sm menu-btn" onClick={() => setOpen((o) => !o)} aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open}>
            ☰
          </button>
          <div style={{ minWidth: 0 }}>
            <nav className="crumb" aria-label="Breadcrumb">
              <ol>
                <li><Link href="/">Dashboard</Link></li>
                {page.group !== 'Dashboard' && <li>{page.group}</li>}
                {page.href !== '/' && <li aria-current="page">{page.label}</li>}
              </ol>
            </nav>
            <div className="top-title">{page.label}</div>
          </div>
          <div className="top-right">
            <span className={`pill ${online ? 'pill-ok' : 'pill-warn'}`} title="Network status of this device">
              <span className="dot" />
              {online ? 'Online' : 'Offline — still saving locally'}
            </span>
            {persistError ? (
              <span className="pill pill-bad" title={persistError}>Not saved: storage full or blocked</span>
            ) : (
              <span className="pill hide-sm" title="Saved in this browser">
                {ready && saved ? `Saved · ${saved}` : 'Device storage'}
              </span>
            )}
            {CLOUD ? <CloudPill /> : <SyncPill />}
            {CLOUD && cloud.profile && (
              <Link href="/account" className="user-chip hide-sm" title="Your account">
                <span className="user-initial" aria-hidden="true">{(cloud.profile.full_name || cloud.profile.email || '?').trim()[0]?.toUpperCase()}</span>
                <span><b>{cloud.profile.full_name || cloud.profile.email}</b><small>{role}</small></span>
              </Link>
            )}
          </div>
        </header>
        <main className="content" id="main-content" tabIndex={-1}>
          {CLOUD && persist !== 'persisted' && unsentSummary(cloud) && (
            <div className="banner" role="status">
              {unsentSummary(cloud)} This browser has not agreed to keep them permanently, so they could be cleared if the phone runs low on space or the site is not opened for several days.
              {' '}{online ? 'They will sync shortly.' : 'Connect to the internet to sync them.'} Installing the app (Add to Home Screen) makes this safer.
            </div>
          )}
          {blocked ? (
            <section className="card">
              <h2 style={{ marginTop: 0 }}>Not available for your account</h2>
              <p className="note">Your administrator has not given you access to this module. Ask them in Control panel → User directory if you need it.</p>
              <div className="form-actions">{allowedLinks.map(([k, label, href]) => <Link key={k} className="btn btn-sm" href={href}>{label}</Link>)}</div>
            </section>
          ) : children}
        </main>
        <DialogHost />
      </div>
    </div>
  );
}

/** Sign out, warning first when this device still holds changes the server has not received. */
export async function signOutChecked(clearCache: () => void): Promise<boolean> {
  const msg = unsentSummary(cloudStatusNow());
  if (msg && !(await askConfirm(`${msg} They stay on this device after you sign out, but nobody else sees them until you sign in here again and they sync. If this browser's data is cleared, they are lost. Sign out anyway?`))) return false;
  await cloudSignOut(clearCache);
  return true;
}
