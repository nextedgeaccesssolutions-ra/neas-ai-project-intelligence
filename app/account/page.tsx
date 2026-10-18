'use client';
import Link from 'next/link';
import AuthCard from '@/components/AuthCard';
import { cloudSignOut, useCloudStatus } from '@/lib/cloud/cloudSync';
import { useStore } from '@/lib/store';

export default function AccountPage() {
  const c = useCloudStatus();
  const { resetDemo } = useStore();
  const p = c.profile;
  const signOut = () => cloudSignOut(resetDemo).then(() => (window.location.href = '/login'));
  if (c.auth === 'checking') return <AuthCard title="My account" subtitle="Loading…" />;
  if (c.auth === 'signed_out' || c.auth === 'expired')
    return <AuthCard title="Signed out" subtitle={c.auth === 'expired' ? 'Your offline access period ended. Connect to the internet and sign in again.' : 'Sign in to continue.'}><Link className="btn btn-primary" href="/login">Sign in</Link></AuthCard>;
  const pending = c.auth === 'pending';
  return (
    <AuthCard title="My account" subtitle={p ? `${p.full_name || p.email} · ${p.email}` : undefined}>
      <div className="kv">
        <span className="note">Status</span><span>{p?.status}{p && !p.email_verified_at ? ' · e-mail not verified' : ''}</span>
        <span className="note">Role</span><span>{p?.global_role === 'super_admin' ? 'Super Admin' : 'Staff'}</span>
        <span className="note">Projects</span><span>{c.memberships.length}</span>
      </div>
      {pending && <p className="banner">Your request is waiting for administrator approval. You will receive an e-mail with a link to set your password once it is approved.</p>}
      <div className="form-actions">
        {!pending && <Link className="btn btn-primary" href="/">Open my projects</Link>}
        <Link className="btn" href="/auth/setup-password">Change password</Link>
        <button className="btn btn-danger" onClick={signOut}>Sign out and clear this device</button>
      </div>
    </AuthCard>
  );
}
