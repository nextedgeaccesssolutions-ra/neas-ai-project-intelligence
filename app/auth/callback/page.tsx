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
      window.location.replace(safeNext);
    })();
  }, []);
  return <AuthCard title="One moment" subtitle={msg} />;
}
