'use client';
import { useEffect, useState } from 'react';
import AuthCard from '@/components/AuthCard';
import { supabaseBrowser } from '@/lib/cloud/browser';

// Lands here from e-mail links (verification, invitation, password setup/reset).
export default function AuthCallback() {
  const [msg, setMsg] = useState('Checking your link…');
  useEffect(() => {
    (async () => {
      const sb = supabaseBrowser();
      const url = new URL(window.location.href);
      const next = url.searchParams.get('next') || '/';
      const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
      const code = url.searchParams.get('code');
      if (!sb) return setMsg('Accounts are not set up on this copy.');
      if (code) {
        const { error } = await sb.auth.exchangeCodeForSession(code);
        if (error) return setMsg('This link has expired or was already used. Ask for a new one.');
      } else {
        const { data } = await sb.auth.getSession();
        if (!data.session) return setMsg('This link has expired or was already used. Ask for a new one.');
      }
      // An approved account that has never chosen a password (owner bootstrap, e-mail-link sign-up)
      // is sent to password setup first, so the e-mail + password sign-in works next time.
      const { data: u } = await sb.auth.getUser();
      if (u.user && !safeNext.startsWith('/auth/setup-password')) {
        const { data: p } = await sb.from('profiles').select('status, password_set_at').eq('id', u.user.id).maybeSingle();
        if (p?.status === 'active' && !p.password_set_at) return window.location.replace('/auth/setup-password?first=1');
      }
      window.location.replace(safeNext);
    })();
  }, []);
  return <AuthCard title="One moment" subtitle={msg} />;
}
