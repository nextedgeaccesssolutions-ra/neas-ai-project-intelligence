'use client';
import { useEffect, useState } from 'react';
import AuthCard from '@/components/AuthCard';
import { supabaseBrowser } from '@/lib/cloud/browser';
import { checkPassword } from '@/lib/cloud/validate';

// One-time password setup (after approval or invitation) and password reset.
// The link that brings the user here is single-use and expires; the admin never sees the password.
export default function SetupPassword() {
  const [ready, setReady] = useState<boolean | null>(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [first, setFirst] = useState(false);

  useEffect(() => {
    setFirst(new URLSearchParams(window.location.search).has('first'));
    supabaseBrowser()?.auth.getSession().then(({ data }) => setReady(!!data.session));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problems = checkPassword(pw);
    if (problems.length) return setError(`Use ${problems.join('; ')}.`);
    if (pw !== pw2) return setError('The two passwords do not match.');
    const { error: err } = await supabaseBrowser()!.auth.updateUser({ password: pw });
    if (err) return setError('Could not save the password. Request a new link and try again.');
    // record "password set" for the administrator's directory (never the password itself)
    await supabaseBrowser()!.rpc('mark_password_set').then(() => undefined, () => undefined);
    await fetch('/api/auth/after-login', { method: 'POST' }).catch(() => undefined);
    setDone(true);
  };

  if (ready === false) return <AuthCard title="Link expired" subtitle="This password link has expired or was already used. Use “Forgot password?” on the sign-in page to get a new one." />;
  if (done) return <AuthCard title="Password saved" subtitle="You can now sign in with your e-mail and new password."><a className="btn btn-primary" href="/">Continue</a></AuthCard>;
  return (
    <AuthCard title={first ? 'Create your password' : 'Set your password'} subtitle="Choose a password only you know. At least 12 characters, using three of: lowercase, uppercase, numbers, symbols.">
      <form onSubmit={submit} className="auth-form">
        <label className="field">New password<input id="pw1" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        <label className="field">Repeat password<input id="pw2" className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>
        {error && <p className="bad" role="alert">{error}</p>}
        <button className="btn btn-primary" disabled={!ready}>Save password</button>
      </form>
    </AuthCard>
  );
}
