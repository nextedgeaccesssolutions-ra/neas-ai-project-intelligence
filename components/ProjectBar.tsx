'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useStore } from '@/lib/store';

/** Active-project selector shared by every module, so all pages stay in step. */
export default function ProjectBar({ children }: { children?: ReactNode }) {
  const { state, setActiveProject, project } = useStore();
  return (
    <section className="card">
      <div className="form-grid">
        <label className="field">
          Active project
          <select className="input" value={project?.id ?? ''} onChange={(e) => setActiveProject(e.target.value)}>
            {state.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id} · {p.name}
              </option>
            ))}
          </select>
        </label>
        {children}
        {!state.projects.length && (
          <div className="empty">
            No projects yet. <Link href="/projects?new=1">Create one</Link>.
          </div>
        )}
      </div>
    </section>
  );
}

export function Loading() {
  return <div className="card note">Loading device data…</div>;
}

export function NoProject() {
  return (
    <div className="card empty">
      No project selected. <Link href="/projects?new=1">Create a project</Link> in the register.
    </div>
  );
}
