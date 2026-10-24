'use client';
import Link from 'next/link';
import { useState } from 'react';
import AuthCard from '@/components/AuthCard';
import { supabaseBrowser, supabaseLinkClient } from '@/lib/cloud/browser';
import { CLOUD } from '@/lib/cloud/env';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [linkSent, setLinkSent] = useState(false);

  if (!CLOUD) return <AuthCard title="Sign-in not set up" subtitle="This copy runs in device mode. Connect Supabase to enable accounts."><Link className="btn" href="/">Open the app</Link></AuthCard>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setLinkSent(false);
    setResetSent(false);
    const sb = supabaseBrowser()!;
    const { error: err } = await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (err) {
      setBusy(false);
      // one message for every failure so the form never reveals whether an address is registered
      return setError(/rate|too many/i.test(err.message) ? 'Too many attempts. Wait a few minutes and try again.' : 'E-mail or password is incorrect, or the account is not active yet. No password yet? Use “E-mail me a sign-in link” below.');
    }
    const res = await fetch('/api/auth/after-login', { method: 'POST' }).catch(() => null);
    const r = res ? await res.json().catch(() => null) : null;
    if (!res || !res.ok || !r?.profile) {
      // the password was accepted; the account check did not finish (network or server problem)
      await sb.auth.signOut().catch(() => undefined);
      setBusy(false);
      return setError('Your password was accepted, but the account check did not finish. Check your connection and try again.');
    }
    const p = r.profile;
    if (p?.status === 'active' && p?.email_verified_at) {
      window.location.href = p.global_role === 'super_admin' ? '/admin' : '/';
      return;
    }
    // Only accounts approved by the administrator may sign in to the workspace.
    await sb.auth.signOut().catch(() => undefined);
    setBusy(false);
    setError(
      p?.status === 'pending' ? 'Your account is waiting for approval by the NEAS administrator. You will receive an e-mail when it is approved.'
        : p?.status === 'suspended' ? 'This account is suspended. Contact the NEAS administrator.'
        : p?.status === 'rejected' ? 'This registration was not approved. Contact the NEAS administrator.'
        : 'E-mail or password is incorrect, or the account is not active yet.',
    );
  };

  // Passwordless sign-in for existing accounts (also the way in for an account that has no password yet).
  const sendLink = async () => {
    if (!email.trim()) return setError('Enter your e-mail first.');
    setError(null);
    setLinkSent(false);
    setResetSent(false);
    const { error: err } = await supabaseLinkClient()!.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: false, emailRedirectTo: `${location.origin}/auth/callback?next=/` },
    });
    if (err && /rate|too many|security purposes|after \d+ seconds/i.test(err.message)) return setError('A link was sent less than a minute ago. Use that e-mail, or wait a minute and try again.');
    setLinkSent(true); // same reply whether or not the address has an account
  };

  const forgot = async () => {
    if (!email.trim()) return setError('Enter your e-mail first.');
    setError(null);
    setLinkSent(false);
    setResetSent(false);
    const { error: err } = await supabaseLinkClient()!.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: `${location.origin}/auth/callback?next=/auth/setup-password` });
    if (err && /rate|too many|security purposes|after \d+ seconds/i.test(err.message)) return setError('A link was sent less than a minute ago. Use that e-mail, or wait a minute and try again.');
    setResetSent(true);
  };

  return (
    <AuthCard eyebrow="Staff & project managers" title="Secure team sign-in" subtitle="Sign in with your NEAS account to manage projects, field reports and site evidence. Your work stays available offline on this device after you sign in." note="Clients: open the project link from NEAS and enter your passcode instead.">
      <form onSubmit={submit} className="auth-form">
        <label className="field">E-mail<input id="login-email" className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="field">Password<input id="login-password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {error && <p className="bad" role="alert">{error}</p>}
        {resetSent && <p className="ok" role="status">If that address has an account, a reset link is on its way.</p>}
        {linkSent && <p className="ok" role="status">If that address has an account, a sign-in link is on its way. Open it from your e-mail on any device.</p>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <button type="button" className="btn" onClick={sendLink}>E-mail me a sign-in link</button>
      </form>
      <div className="auth-links">
        <button className="linklike" onClick={forgot}>Forgot password?</button>
        <Link className="linklike" href="/activate">Have a one-time code?</Link>
        <Link href="/register">Request an account</Link>
      </div>
    </AuthCard>
  );
}
