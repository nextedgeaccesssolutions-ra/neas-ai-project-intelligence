'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import AuthCard from '@/components/AuthCard';
import { supabaseBrowser } from '@/lib/cloud/browser';

const EXPIRED = 'This link has expired or was already used. Each new e-mail replaces the previous link, so use the most recent one, or request a new sign-in link.';

// Lands here from e-mail links (verification, sign-in link, invitation, password setup/reset).
// Handles all three forms Supabase can send: #access_token (works in any browser), ?code (same
// browser only) and #error (expired or used link).
export default function AuthCallback() {
  const [msg, setMsg] = useState('Checking your link…');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    (async () => {
      const sb = supabaseBrowser();
      const url = new URL(window.location.href);
      const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
      const next = url.searchParams.get('next') || '/';
      const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
      const fail = (m: string) => { setFailed(true); setMsg(m); };
      if (!sb) return fail('Accounts are not set up on this copy.');
      // never leave tokens in the address bar or browser history
      if (url.hash) window.history.replaceState(null, '', url.pathname + url.search);

      const errCode = hash.get('error_code') || url.searchParams.get('error_code');
      if (hash.get('error') || url.searchParams.get('error')) {
        return fail(errCode === 'otp_expired' ? EXPIRED : 'This link could not be used. Request a new sign-in link.');
      }
      const access_token = hash.get('access_token');
      const refresh_token = hash.get('refresh_token');
      const code = url.searchParams.get('code');
      if (access_token && refresh_token) {
        const { error } = await sb.auth.setSession({ access_token, refresh_token });
        if (error) return fail(EXPIRED);
      } else if (code) {
        const { error } = await sb.auth.exchangeCodeForSession(code);
        if (error) return fail('Open this link in the same browser you used to request it, or request a new sign-in link.');
      } else {
        const { data } = await sb.auth.getSession();
        if (!data.session) return fail(EXPIRED);
      }
      // record the sign-in (and refuse accounts that are not approved)
      const res = await fetch('/api/auth/after-login', { method: 'POST' }).catch(() => null);
      const r = res ? await res.json().catch(() => null) : null;
      // An approved account that has never chosen a password (owner bootstrap, e-mail-link sign-up)
      // is sent to password setup first, so the e-mail + password sign-in works next time.
      const { data: u } = await sb.auth.getUser();
      if (u.user && !safeNext.startsWith('/auth/setup-password')) {
        const { data: prof } = await sb.from('profiles').select('status, password_set_at').eq('id', u.user.id).maybeSingle();
        if (prof?.status === 'active' && !prof.password_set_at) return window.location.replace('/auth/setup-password?first=1');
        if (prof?.status === 'active' && safeNext === '/' && r?.profile?.global_role === 'super_admin') return window.location.replace('/admin');
      }
      window.location.replace(safeNext);
    })();
  }, []);
  return (
    <AuthCard title={failed ? 'Link not valid' : 'One moment'} subtitle={msg}>
      {failed && <Link className="btn btn-primary" href="/login">Back to sign in</Link>}
    </AuthCard>
  );
}
