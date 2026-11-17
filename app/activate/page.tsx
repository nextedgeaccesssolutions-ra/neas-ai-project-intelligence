'use client';
import Link from 'next/link';
import { useState } from 'react';
import AuthCard from '@/components/AuthCard';
import { supabaseBrowser } from '@/lib/cloud/browser';
import { CLOUD } from '@/lib/cloud/env';
import { checkPassword } from '@/lib/cloud/validate';

// First sign-in with the one-time code the administrator handed over. The person chooses their own
// password here; the code then stops working. Needs an internet connection (once); after that the
// app also works offline on this device.
export default function ActivatePage() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!CLOUD) return <AuthCard title="Accounts not set up" subtitle="This copy runs in device mode."><Link className="btn" href="/">Open the app</Link></AuthCard>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!navigator.onLine) return setError('Activation needs an internet connection the first time. After that you can work offline.');
    const problems = checkPassword(pw);
    if (problems.length) return setError(`Use ${problems.join('; ')}.`);
    if (pw !== pw2) return setError('The two passwords do not match.');
    setBusy(true);
    const r = await fetch('/api/auth/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, code, password: pw }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setBusy(false);
      return setError(j.error ?? 'E-mail or code is not valid, or the code has expired.');
    }
    const sb = supabaseBrowser()!;
    const { error: err } = await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: pw });
    if (err) {
      setBusy(false);
      return setError('Your account is active. Sign in with your e-mail and new password.');
    }
    const a = await fetch('/api/auth/after-login', { method: 'POST' }).then((x) => x.json()).catch(() => null);
    window.location.href = a?.profile?.global_role === 'super_admin' ? '/admin' : '/';
  };

  return (
    <AuthCard title="Activate your account" subtitle="Enter the one-time code from your NEAS administrator and choose your own password. The code works once.">
      <form onSubmit={submit} className="auth-form">
        <label className="field">E-mail<input id="act-email" className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="field">One-time code<input id="act-code" className="input" autoComplete="one-time-code" placeholder="XXXX-XXXX-XXXX" required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: '0.12em', fontFamily: 'var(--mono, monospace)' }} /></label>
        <label className="field">New password<input id="act-pw1" className="input" type="password" autoComplete="new-password" required value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        <label className="field">Repeat password<input id="act-pw2" className="input" type="password" autoComplete="new-password" required value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>
        <p className="note" style={{ margin: 0 }}>At least 12 characters, mixing letters, numbers or symbols.</p>
        {error && <p className="bad" role="alert">{error}</p>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Activating…' : 'Activate and sign in'}</button>
        <Link className="note" href="/login">Already activated? Sign in</Link>
      </form>
    </AuthCard>
  );
}
