'use client';
import { useCallback, useEffect, useState } from 'react';
import type { ClientView } from '@/lib/cloud/clientView';
import { normaliseProjectCode } from '@/lib/cloud/validate';
import ClientProjectView from '@/components/ClientProjectView';
import AuthCard from '@/components/AuthCard';
import ClientReportReviews from '@/components/ClientReportReviews';

const cacheKey = (code: string) => `neas-client-cache:${code}`;

// Client viewer portal: passcode only, read-only, approved content only.
export default function ClientPortal({ params }: { params: { code: string } }) {
  const code = normaliseProjectCode(decodeURIComponent(params.code));
  const [view, setView] = useState<ClientView | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/client/snapshot?code=${encodeURIComponent(code)}`, { cache: 'no-store' });
      if (r.status === 401) {
        setNeedLogin(true);
        setView(null);
        return;
      }
      if (!r.ok) throw new Error('unavailable');
      const v = (await r.json()) as ClientView;
      setView(v);
      setCachedAt(null);
      setNeedLogin(false);
      try {
        // cache the summary for offline viewing (no file links: they expire)
        localStorage.setItem(cacheKey(code), JSON.stringify({ at: new Date().toISOString(), view: { ...v, files: v.files?.map((f) => ({ ...f, url: null })) } }));
      } catch { /* storage blocked */ }
    } catch {
      try {
        const c = JSON.parse(localStorage.getItem(cacheKey(code)) ?? 'null');
        if (c?.view) {
          setView(c.view);
          setCachedAt(c.at);
          return;
        }
      } catch { /* ignore */ }
      setError('Cannot reach the server. Check your connection.');
    }
  }, [code]);

  useEffect(() => {
    void load();
  }, [load]);

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await fetch('/api/client/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, passcode }) }).catch(() => null);
    setBusy(false);
    if (!r) return setError('Cannot reach the server. Check your connection.');
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setError(j.error ?? 'Could not sign in.');
    setPasscode('');
    await load();
  };

  const logout = async () => {
    await fetch('/api/client/logout', { method: 'POST' }).catch(() => undefined);
    try { localStorage.removeItem(cacheKey(code)); localStorage.removeItem('neas-offline-logins'); } catch { /* ignore */ }
    setView(null);
    setNeedLogin(true);
  };

  if (needLogin && !view) return (
    <AuthCard eyebrow="Client project view" title={`Project ${code}`} subtitle="Read-only view of the progress, schedule, reports and photos NEAS has approved for you." note="Lost the passcode or it stopped working? Contact your NEAS project manager for a new one.">
      <form onSubmit={login} className="auth-form">
        <label className="field">Passcode<input id="client-passcode" className="input" autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} placeholder="XXXX-XXXX-XXXX" value={passcode} onChange={(e) => setPasscode(e.target.value)} /></label>
        {error && <p className="bad" role="alert">{error}</p>}
        <button className="btn btn-primary" disabled={busy || passcode.replace(/[^A-Za-z0-9]/g, '').length < 8}>{busy ? 'Checking…' : 'View project'}</button>
      </form>
      <p className="note" style={{ margin: 0 }}>Have a username and a 6-digit passcode instead? <a className="linklike" href="/login">Sign in here</a>.</p>
    </AuthCard>
  );

  return (
    <div className="client-shell">
      <header className="client-top">
        <div className="auth-brand">
          <img className="brand-mark brand-logo" src="/neas-logo.png" alt="NEAS — NextEdge Access Solutions" width={44} height={44} />
          <span><div className="auth-brand-name">NEXTEDGE ACCESS SOLUTIONS</div><div className="brand-sub">CLIENT PROJECT VIEW</div></span>
        </div>
        {view && !cachedAt && <button className="btn btn-sm" onClick={logout}>Sign out</button>}
      </header>

      <main className="client-main">
        {!needLogin && !view && <div className="card note">{error ?? 'Loading…'}</div>}

        {view && !cachedAt && <ClientReportReviews code={code} />}
        {view && (
          <ClientProjectView
            view={view}
            cachedAt={cachedAt}
            footer={<p className="note" style={{ textAlign: 'center' }}>Read-only view · session ends {new Date(view.sessionExpiresAt).toLocaleString()}</p>}
          />
        )}
      </main>
    </div>
  );
}
