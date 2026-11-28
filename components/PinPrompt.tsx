'use client';
// "Enter your PIN again" for sensitive changes. The PIN goes to /api/auth/reauth, which verifies it
// and lets the database accept sensitive changes for the next 10 minutes. Mounted by DialogHost.
import { useEffect, useRef, useState } from 'react';

export const PIN_REQUIRED_MSG = 'Enter your PIN again to confirm this change.';
export const isPinRequired = (e: { code?: string; message?: string } | string | null | undefined) =>
  !!e && (typeof e === 'string' ? e.startsWith(PIN_REQUIRED_MSG) : e.code === 'P0403' || (e.message ?? '').startsWith(PIN_REQUIRED_MSG));

let pushAsk: ((resolve: (ok: boolean) => void) => void) | null = null;

/** Ask for the PIN and verify it on the server. Resolves true once verified, false if cancelled. */
export function askPin(): Promise<boolean> {
  return new Promise((resolve) => (pushAsk ? pushAsk(resolve) : resolve(false)));
}

/** Run a Supabase call; if the server asks for a PIN re-check, ask once and retry. */
export async function withPin<T extends { error: { code?: string; message?: string } | null }>(run: () => PromiseLike<T>): Promise<T> {
  const first = await run();
  if (!isPinRequired(first.error) || !(await askPin())) return first;
  return run();
}

export function PinPromptHost() {
  const [resolver, setResolver] = useState<((ok: boolean) => void) | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    pushAsk = (resolve) => { setPin(''); setError(null); setResolver(() => resolve); };
    return () => { pushAsk = null; };
  }, []);
  useEffect(() => {
    if (!resolver) return;
    input.current?.focus();
    const k = (e: KeyboardEvent) => e.key === 'Escape' && done(false);
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [resolver]); // eslint-disable-line react-hooks/exhaustive-deps

  const done = (ok: boolean) => { resolver?.(ok); setResolver(null); setPin(''); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await fetch('/api/auth/reauth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    if (!r) return setError('Cannot reach the server. Check your connection.');
    if (!r.ok) { setPin(''); return setError(j.error ?? 'That PIN is not correct.'); }
    done(true);
  };

  if (!resolver) return null;
  return (
    <div className="modal-back" onClick={() => done(false)}>
      <form className="modal" role="dialog" aria-modal="true" aria-labelledby="pin-title" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <p id="pin-title"><b>Confirm with your PIN</b></p>
        <p className="note">This change needs your PIN again. It stays confirmed for 10 minutes. Administrators who sign in with e-mail enter their password.</p>
        <label className="field">PIN or password
          <input ref={input} className="input" type="password" autoComplete="current-password" required value={pin} onChange={(e) => setPin(e.target.value)} style={{ letterSpacing: '0.2em' }} />
        </label>
        {error && <p className="bad" role="alert">{error}</p>}
        <div className="form-actions">
          <button className="btn btn-primary" disabled={busy || !pin}>{busy ? 'Checking…' : 'Confirm'}</button>
          <button type="button" className="btn" onClick={() => done(false)}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
