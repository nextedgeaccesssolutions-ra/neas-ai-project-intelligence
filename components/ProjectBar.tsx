'use client';
import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { useStore } from '@/lib/store';

/** Active-project selector shared by every module, with search by code, name, client or site. */
export default function ProjectBar({ children }: { children?: ReactNode }) {
  const { state, setActiveProject, project } = useStore();
  const [q, setQ] = useState('');
  const label = (p: (typeof state.projects)[number]) => `${p.code ?? p.id} · ${p.name}`;
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return state.projects;
    return state.projects.filter((p) => [p.code, p.id, p.name, p.client, p.site].some((v) => (v ?? '').toLowerCase().includes(t)));
  }, [q, state.projects]);
  // keep the active project in the list so the select always shows it
  const options = project && !matches.some((p) => p.id === project.id) ? [project, ...matches] : matches;
  return (
    <section className="card">
      <div className="form-grid">
        <label className="field">
          Search projects
          <input
            className="input" type="search" value={q} placeholder="Code, project name, client or site"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && matches[0]) { setActiveProject(matches[0].id); setQ(''); } }}
            aria-describedby="project-search-count"
          />
          <span id="project-search-count" className="note">{q.trim() ? `${matches.length} match${matches.length === 1 ? '' : 'es'}${matches[0] ? ' · Enter opens the first' : ''}` : `${state.projects.length} projects`}</span>
        </label>
        <label className="field" style={{ gridColumn: 'span 2' }}>
          Active project
          <select className="input" value={project?.id ?? ''} onChange={(e) => { setActiveProject(e.target.value); setQ(''); }}>
            {options.map((p) => (
              <option key={p.id} value={p.id}>{label(p)}</option>
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
