'use client';
import Link from 'next/link';
import { useState } from 'react';
import AuthCard from '@/components/AuthCard';
import { supabaseBrowser } from '@/lib/cloud/browser';
import { CLOUD } from '@/lib/cloud/env';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  if (!CLOUD) return <AuthCard title="Sign-in not set up" subtitle="This copy runs in device mode. Connect Supabase to enable accounts."><Link className="btn" href="/">Open the app</Link></AuthCard>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const sb = supabaseBrowser()!;
    const { error: err } = await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (err) {
      setBusy(false);
      // one message for every failure so the form never reveals whether an address is registered
      return setError(/rate|too many/i.test(err.message) ? 'Too many attempts. Wait a few minutes and try again.' : 'E-mail or password is incorrect, or the account is not active yet.');
    }
    const r = await fetch('/api/auth/after-login', { method: 'POST' }).then((x) => x.json()).catch(() => null);
    const p = r?.profile;
    window.location.href = p?.status === 'active' && p?.email_verified_at ? (p.global_role === 'super_admin' ? '/admin' : '/') : '/account';
  };

  const forgot = async () => {
    if (!email.trim()) return setError('Enter your e-mail first.');
    await supabaseBrowser()!.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: `${location.origin}/auth/callback?next=/auth/setup-password` });
    setResetSent(true);
  };

  return (
    <AuthCard title="Sign in" subtitle="Employees and project managers. Clients use the project link and passcode they were given.">
      <form onSubmit={submit} className="auth-form">
        <label className="field">E-mail<input id="login-email" className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="field">Password<input id="login-password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {error && <p className="bad" role="alert">{error}</p>}
        {resetSent && <p className="ok" role="status">If that address has an account, a reset link is on its way.</p>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <div className="auth-links">
        <button className="linklike" onClick={forgot}>Forgot password?</button>
        <Link href="/register">Request an account</Link>
      </div>
    </AuthCard>
  );
}
