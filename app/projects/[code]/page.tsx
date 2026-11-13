'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/lib/store';
import { normaliseProjectCode } from '@/lib/cloud/validate';

// Project-specific URL: /projects/PRJ-2026-001. Opening it selects the project if — and only if —
// the signed-in user can already see it. The URL itself grants nothing.
export default function ProjectLink({ params }: { params: { code: string } }) {
  const { ready, state, setActiveProject } = useStore();
  const router = useRouter();
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const code = normaliseProjectCode(decodeURIComponent(params.code));
    const p = state.projects.find((x) => (x.code ?? x.id).toUpperCase() === code);
    if (p) {
      setActiveProject(p.id);
      router.replace('/');
    } else {
      const t = setTimeout(() => setMissing(true), 2500); // allow the first sync to finish
      return () => clearTimeout(t);
    }
  }, [ready, state.projects, params.code]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="card note">{missing ? 'This project does not exist or you are not assigned to it.' : 'Opening project…'}</div>;
}
