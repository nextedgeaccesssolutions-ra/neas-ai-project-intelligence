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
  // daily sign-in is username + 6-digit PIN; e-mail + password stays for administrators during the change-over
  const [mode, setMode] = useState<'pin' | 'email'>('pin');
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [pinHelp, setPinHelp] = useState(false);
  const online = typeof navigator === 'undefined' || navigator.onLine;

  if (!CLOUD) return <AuthCard title="Sign-in not set up" subtitle="This copy runs in device mode. Connect Supabase to enable accounts."><Link className="btn" href="/">Open the app</Link></AuthCard>;

  const submitPin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!navigator.onLine) return setError('Signing in needs an internet connection. If you signed in on this device recently, open the app instead: your work is available offline.');
    if (!/^\d{6}$/.test(pin)) return setError('Your PIN is 6 digits.');
    setBusy(true);
    const r = await fetch('/api/auth/pin-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, pin }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (!r || !r.ok) {
      setBusy(false);
      setPin('');
      return setError(!r ? 'Cannot reach the server. Check your connection.' : j.error ?? 'Username or PIN is not correct, or the account is not active.');
    }
    await afterLogin('Your PIN was accepted');
  };

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
    await afterLogin('Your password was accepted');
  };

  const afterLogin = async (accepted: string) => {
    const sb = supabaseBrowser()!;
    const res = await fetch('/api/auth/after-login', { method: 'POST' }).catch(() => null);
    const r = res ? await res.json().catch(() => null) : null;
    if (!res || !res.ok || !r?.profile) {
      // the password was accepted; the account check did not finish (network or server problem)
      await sb.auth.signOut().catch(() => undefined);
      setBusy(false);
      return setError(`${accepted}, but the account check did not finish. Check your connection and try again.`);
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
        : 'The account is not active yet. Contact the NEAS administrator.',
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
    <AuthCard eyebrow="NEAS Enterprise Platform" title="Secure team sign-in" subtitle="Sign in with your username and 6-digit PIN to manage projects, field reports and site evidence. Your work stays available offline on this device after you sign in." note="Clients: open the project link from NEAS and enter your passcode instead. Forgot your PIN or locked out? Ask your NEAS administrator for a one-time code.">
      <p className={online ? 'ok' : 'bad'} role="status" style={{ margin: 0 }}>{online ? '● Online — ready to sign in' : '● Offline — signing in needs a connection; if you signed in here recently, open the app instead'}</p>
      {mode === 'pin' ? (
        <>
          <form onSubmit={submitPin} className="auth-form">
            <label className="field">Username<input id="login-username" className="input" autoComplete="username" autoCapitalize="none" spellCheck={false} required value={username} onChange={(e) => setUsername(e.target.value)} /></label>
            <label className="field">PIN
              <span style={{ display: 'flex', gap: 8 }}>
                <input id="login-pin" className="input" type={showPin ? 'text' : 'password'} inputMode="numeric" autoComplete="current-password" pattern="\d{6}" maxLength={6} required value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} style={{ letterSpacing: '0.3em' }} />
                <button type="button" className="btn" onClick={() => setShowPin((s) => !s)} aria-pressed={showPin} aria-controls="login-pin">{showPin ? 'Hide' : 'Show'}</button>
              </span>
            </label>
            {error && <p className="bad" role="alert">{error}</p>}
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          </form>
          <div className="auth-links">
            <button type="button" className="linklike" onClick={() => setPinHelp((f) => !f)} aria-expanded={pinHelp}>Forgot your PIN?</button>
            <Link className="linklike" href="/activate">Have a one-time code?</Link>
            <button className="linklike" onClick={() => { setMode('email'); setError(null); }}>Administrator e-mail sign-in</button>
          </div>
          {pinHelp && (
            <p className="note" role="status">
              Ask your NEAS administrator to reset your PIN. They give you a one-time code (valid 24 hours). Then open <Link className="linklike" href="/activate">Have a one-time code?</Link>, enter your username and the code, and choose a new 6-digit PIN. NEAS never asks for your PIN by phone or message.
            </p>
          )}
        </>
      ) : (<>
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
        <button className="linklike" onClick={() => { setMode('pin'); setError(null); }}>Username + PIN sign-in</button>
      </div>
      </>)}
    </AuthCard>
  );
}
