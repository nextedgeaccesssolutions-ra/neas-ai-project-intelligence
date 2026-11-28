'use client';
// Landing page for a shared report link or QR code: /share#<token>. The token stays in the URL
// fragment (never sent in a request line) and is checked by the server on every open.
import { useEffect, useState } from 'react';
import type { ClientView } from '@/lib/cloud/clientView';
import ClientProjectView from '@/components/ClientProjectView';

export default function SharedReport() {
  const [view, setView] = useState<ClientView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = window.location.hash.slice(1);
    if (!token) return setError('This link is incomplete. Ask NEAS to send it again.');
    fetch('/api/share/view', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }), cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error ?? 'This link cannot be opened.');
        setView(j as ClientView);
      })
      .catch((e: Error) => setError(e.message === 'Failed to fetch' ? 'Cannot reach the server. Check your connection.' : e.message));
  }, []);

  return (
    <div className="client-shell">
      <header className="client-top">
        <div className="auth-brand">
          <img className="brand-mark brand-logo" src="/neas-logo.png" alt="NEAS — NextEdge Access Solutions" width={44} height={44} />
          <span><div className="auth-brand-name">NEXTEDGE ACCESS SOLUTIONS</div><div className="brand-sub">SHARED PROJECT REPORT</div></span>
        </div>
      </header>
      <main className="client-main">
        {error && (
          <section className="card client-login" role="alert">
            <h1>Report not available</h1>
            <p className="lead">{error}</p>
            <p className="note">Shared links expire and can be withdrawn. Contact your NEAS project manager for a new link.</p>
          </section>
        )}
        {!error && !view && <div className="card note">Checking the link…</div>}
        {view && (
          <ClientProjectView
            view={view}
            footer={<p className="note" style={{ textAlign: 'center' }}>Read-only shared view · link expires {new Date(view.sessionExpiresAt).toLocaleString()}</p>}
          />
        )}
      </main>
    </div>
  );
}
