'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { CLOUD } from '@/lib/cloud/env';
import { canManage, useCloudStatus } from '@/lib/cloud/cloudSync';
import { useStore } from '@/lib/store';

/** Device mode: everyone manages. Cloud mode: Super Admin or the project's manager. (The database enforces the same.) */
export function useCanManage(): boolean {
  useCloudStatus(); // re-render when roles load
  const { state } = useStore();
  return !CLOUD || canManage(state.activeProjectId);
}

export function ManagerOnly({ children, what }: { children: ReactNode; what: string }) {
  const ok = useCanManage();
  if (ok) return <>{children}</>;
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>{what} is for project managers</h2>
      <p className="note">This section contains confidential commercial information. Ask your project manager or an administrator if you need it.</p>
      <Link className="btn" href="/">Back to the overview</Link>
    </div>
  );
}
