'use client';
import Link from 'next/link';
import { useState } from 'react';
import AuthCard from '@/components/AuthCard';
import { checkEmail, checkName } from '@/lib/cloud/validate';

export default function RegisterPage() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState(''); // honeypot
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = checkName(fullName);
    if (!n.ok) return setError(n.error);
    const m = checkEmail(email);
    if (!m.ok) return setError(m.error);
    setBusy(true);
    setError(null);
    const res = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fullName: n.name, email: m.email, website }) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(j.error ?? 'Could not submit the request.');
    setDone(j.message);
  };

  if (done)
    return (
      <AuthCard title="Check your inbox" subtitle={done}>
        <ol className="steps-list">
          <li>Open the verification link we sent.</li>
          <li>An administrator reviews and approves your request.</li>
          <li>You receive a one-time link to set your own password.</li>
        </ol>
        <Link className="btn" href="/login">Back to sign in</Link>
      </AuthCard>
    );

  return (
    <AuthCard title="Request an account" subtitle="For NEAS employees, technicians and inspectors. Every request is reviewed by an administrator before access is granted.">
      <form onSubmit={submit} className="auth-form">
        <label className="field">Full name<input id="reg-name" className="input" autoComplete="name" required value={fullName} onChange={(e) => setFullName(e.target.value)} /></label>
        <label className="field">E-mail<input id="reg-email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="sr" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
        {error && <p className="bad" role="alert">{error}</p>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send verification link'}</button>
        <p className="note">Verification proves you can receive mail at this address. An administrator still confirms that you work with NEAS.</p>
      </form>
      <div className="auth-links"><Link href="/login">I already have an account</Link></div>
    </AuthCard>
  );
}
