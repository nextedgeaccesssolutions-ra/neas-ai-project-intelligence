'use client';
// In-page confirmation dialog and toast. Replaces window.confirm/alert, which some
// embedded viewers (and many kiosk/field browsers) block.
import { useEffect, useRef, useState } from 'react';

type Ask = { message: string; danger: boolean; resolve: (ok: boolean) => void };
let pushAsk: ((a: Ask) => void) | null = null;
let pushToast: ((m: string) => void) | null = null;

export function askConfirm(message: string, opts: { danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    if (!pushAsk) return resolve(false);
    pushAsk({ message, danger: opts.danger ?? true, resolve });
  });
}

export function notify(message: string) {
  pushToast?.(message);
}

export const IS_ARTIFACT = !!process.env.NEXT_PUBLIC_ARTIFACT;

/** Saves a text file. Where downloads are blocked, copies it to the clipboard instead. */
export async function saveText(name: string, text: string, type = 'text/csv') {
  if (IS_ARTIFACT) {
    try {
      await navigator.clipboard.writeText(text);
      notify(`Copied ${name} to the clipboard. Paste it into Sheets, Excel or a text file.`);
    } catch {
      notify('Downloads and clipboard are blocked in this view. Open the app in its own browser tab.');
    }
    return;
  }
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify(`Downloaded ${name}.`);
}

export default function DialogHost() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    pushAsk = (a) => setAsk(a);
    pushToast = (m) => {
      setToast(m);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setToast(null), 4500);
    };
    return () => {
      pushAsk = null;
      pushToast = null;
    };
  }, []);

  useEffect(() => {
    if (!ask) return;
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ask]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = (ok: boolean) => {
    ask?.resolve(ok);
    setAsk(null);
  };

  return (
    <>
      {ask && (
        <div className="modal-back" onClick={() => close(false)}>
          <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-msg" onClick={(e) => e.stopPropagation()}>
            <p id="confirm-msg">{ask.message}</p>
            <div className="form-actions">
              <button ref={okRef} className={`btn ${ask.danger ? 'btn-danger-solid' : 'btn-primary'}`} onClick={() => close(true)}>
                {ask.danger ? 'Yes, continue' : 'Confirm'}
              </button>
              <button className="btn" onClick={() => close(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}
