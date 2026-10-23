'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useStore } from '@/lib/store';
import DialogHost, { IS_ARTIFACT } from '@/components/Dialogs';
import { useSyncStatus } from '@/lib/sheetsSync';
import { CLOUD } from '@/lib/cloud/env';
import { canManage, canView, cloudSignOut, useCloudStatus, VIEWS, viewOfPath } from '@/lib/cloud/cloudSync';

/** Pages that render without the workspace frame (sign-in flows and the client portal). */
const BARE = [/^\/login/, /^\/activate/, /^\/register/, /^\/auth\//, /^\/client\//, /^\/account/];
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
  { href: '/', label: 'Overview', icon: 'grid' },
  { href: '/estimating', label: 'Estimating & BOQ', icon: 'list' },
  { href: '/quotation', label: 'Quotation preview', icon: 'doc' },
  { href: '/project-management', label: 'Project management', icon: 'gantt' },
  { href: '/field-reports', label: 'Field reports', icon: 'spark' },
  { href: '/projects', label: 'Project register', icon: 'table' },
  { href: '/site-evidence', label: 'Site evidence', icon: 'camera' },
  { href: '/reports', label: 'Project reports', icon: 'doc' },
  { href: '/google-sheets', label: 'Google Sheets setup', icon: 'gear' },
] as const;

function Icon({ name }: { name: string }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const paths: Record<string, ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" {...p} /><rect x="14" y="3" width="7" height="7" rx="1.5" {...p} /><rect x="3" y="14" width="7" height="7" rx="1.5" {...p} /><rect x="14" y="14" width="7" height="7" rx="1.5" {...p} /></>,
    list: <><path d="M8 6h13M8 12h13M8 18h13" {...p} /><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" {...p} strokeWidth={3} /></>,
    doc: <><path d="M6 3h9l4 4v14H6z" {...p} /><path d="M9 12h7M9 16h7M14 3v5h5" {...p} /></>,
    gantt: <><path d="M4 6h9M8 12h10M6 18h8" {...p} strokeWidth={3} /></>,
    spark: <><path d="M12 3v6M12 15v6M3 12h6M15 12h6" {...p} /></>,
    table: <><rect x="3" y="4" width="18" height="16" rx="2" {...p} /><path d="M3 10h18M9 10v10" {...p} /></>,
    camera: <><rect x="3" y="7" width="18" height="13" rx="2" {...p} /><circle cx="12" cy="13.5" r="3.5" {...p} /><path d="M9 7l1.5-3h3L15 7" {...p} /></>,
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
  const online = useOnline();
  const current = NAV.find((n) => (n.href === '/' ? pathname === '/' : pathname.startsWith(n.href))) ?? NAV[0];

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production' && !IS_ARTIFACT) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);

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
  const nav = NAV.filter((n) => !CLOUD || ((!MANAGER_ONLY.has(n.href) || canManage(state.activeProjectId)) && canView(viewOfPath(n.href), cloud.profile)));
  const blocked = CLOUD && !pathname.startsWith('/admin') && !canView(viewOfPath(pathname), cloud.profile);
  const allowedLinks = VIEWS.filter(([k]) => canView(k, cloud.profile));

  return (
    <div className="shell">
      <aside className={`side${open ? ' open' : ''}`} aria-label="Main navigation">
        <Link href="/" className="brand">
          <img className="brand-mark brand-logo" src="/neas-logo.png" alt="NEAS — NextEdge Access Solutions" width={44} height={44} />
          <span>
            <div className="brand-name">NEAS INTELLIGENCE</div>
            <div className="brand-sub">PROJECT CONTROL</div>
          </span>
        </Link>
        <div className="side-label">WORKSPACE</div>
        <nav className="nav">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} aria-current={n.href === current.href && !pathname.startsWith('/admin') && !pathname.startsWith('/offline-queue') ? 'page' : undefined}>
              <Icon name={n.icon} />
              {n.label}
            </Link>
          ))}
          {CLOUD && canView('offline_queue', cloud.profile) && (
            <Link href="/offline-queue" aria-current={pathname.startsWith('/offline-queue') ? 'page' : undefined}>
              <Icon name="list" />
              Offline queue
            </Link>
          )}
        </nav>
        {isAdmin && (
          <>
            <div className="side-label">ADMINISTRATION</div>
            <nav className="nav">
              <Link href="/admin" aria-current={pathname.startsWith('/admin') ? 'page' : undefined}>
                <Icon name="gear" />
                Control panel
              </Link>
            </nav>
          </>
        )}
        <div className="side-foot">
          {CLOUD && cloud.profile ? (
            <>
              <Link href="/account" style={{ color: '#fff', textDecoration: 'none' }}><b>{cloud.profile.full_name || cloud.profile.email}</b></Link>
              <br />
              {isAdmin ? 'Super Admin' : 'Staff'} · <button className="linklike" style={{ color: 'var(--sand)' }} onClick={() => cloudSignOut(resetDemo).then(() => window.location.replace('/login'))}>Sign out</button>
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
          <button className="btn btn-sm menu-btn" onClick={() => setOpen((o) => !o)} aria-label="Open menu" aria-expanded={open}>
            ☰
          </button>
          <div>
            <div className="crumb">NEAS / Project Intelligence</div>
            <div className="top-title">{pathname.startsWith('/admin') ? 'Control panel' : pathname.startsWith('/offline-queue') ? 'Offline queue' : current.label}</div>
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
          </div>
        </header>
        <main className="content">
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
