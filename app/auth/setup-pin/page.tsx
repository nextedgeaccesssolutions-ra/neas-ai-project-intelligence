'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import AuthCard from '@/components/AuthCard';
import { supabaseBrowser } from '@/lib/cloud/browser';
import { checkPin } from '@/lib/cloud/validate';
import { CLOUD } from '@/lib/cloud/env';
import { forgetOfflineLogin } from '@/lib/offlineLogin';

export default function SetupPinPage() {
  const [ready, setReady] = useState<boolean | null>(null);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!CLOUD) { setReady(false); return; }
    supabaseBrowser()?.auth.getSession().then(({ data }) => setReady(!!data.session)).catch(() => setReady(false));
  }, []);

  const digits = (value: string) => value.replace(/\D/g, '').slice(0, 6);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const problem = checkPin(pin);
    if (problem) return setError(problem);
    if (pin !== confirmPin) return setError('The two PINs do not match.');

    setBusy(true);
    const response = await fetch('/api/auth/setup-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin, confirmPin }),
    }).catch(() => null);
    const result = response ? await response.json().catch(() => ({})) : {};
    if (!response || !response.ok) {
      setBusy(false);
      return setError(!response ? 'Cannot reach the server. Check your connection and try again.' : result.error ?? 'Your PIN could not be changed. Request a new recovery link.');
    }

    await supabaseBrowser()?.auth.signOut().catch(() => undefined);
    setDone(true);
  };

  if (!CLOUD) return <AuthCard title="Accounts not set up" subtitle="Connect the NEAS account service before resetting a PIN."><Link className="btn btn-primary" href="/login">Back to sign in</Link></AuthCard>;
  if (ready === false) {
    return <AuthCard title="Recovery link expired" subtitle="The secure recovery link is expired or has already been used. Return to sign in and request a new PIN reset link."><Link className="btn btn-primary" href="/login">Back to sign in</Link></AuthCard>;
  }
  if (done) {
    return <AuthCard title="PIN updated" subtitle="Your new PIN is saved and previous failed-attempt locks have been cleared. Sign in with your username and new 6-digit PIN."><Link className="btn btn-primary" href="/login">Return to sign in</Link></AuthCard>;
  }

  return (
    <AuthCard eyebrow="NEAS Enterprise Platform" title="Reset your PIN" subtitle="Choose a new 6-digit PIN. This recovery page is available only after opening the secure link sent to your verified e-mail address.">
      <form onSubmit={submit} className="auth-form">
        <label className="field">New 6-digit PIN<input id="reset-pin" className="input" type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} required value={pin} onChange={(event) => setPin(digits(event.target.value))} style={{ letterSpacing: '0.3em' }} /></label>
        <label className="field">Repeat new PIN<input id="reset-pin-confirm" className="input" type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} required value={confirmPin} onChange={(event) => setConfirmPin(digits(event.target.value))} style={{ letterSpacing: '0.3em' }} /></label>
        <p className="note" style={{ margin: 0 }}>Use six digits. Avoid repeated digits and simple sequences such as 123456. NEAS will never ask you to share your PIN.</p>
        {error && <p className="bad" role="alert">{error}</p>}
        <button className="btn btn-primary" disabled={!ready || busy}>{busy ? 'Saving PIN…' : 'Save new PIN'}</button>
      </form>
    </AuthCard>
  );
}
