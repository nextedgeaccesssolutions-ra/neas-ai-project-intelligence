'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import DataIO, { asPlan } from '@/components/DataIO';
import * as IO from '@/lib/moduleIO';
import { Loading } from '@/components/ProjectBar';
import { CLOUD } from '@/lib/cloud/env';
import { isSuperAdmin } from '@/lib/cloud/cloudSync';
import { askConfirm } from '@/components/Dialogs';
import { useStore } from '@/lib/store';
import { useQueryParam } from '@/lib/useQuery';
import { projectProgress, todayLocal, boqTotals } from '@/lib/calc';
import { fmtPct, fmtPHP } from '@/lib/format';
import type { Project, ProjectStatus } from '@/lib/types';
import { useOrgList } from '@/components/OrgList';

const STATUSES: ProjectStatus[] = ['draft', 'active', 'on-hold', 'completed'];
type Draft = { id: string; name: string; client: string; site: string; status: ProjectStatus; contractValue: string; isNew: boolean };
const blank = (): Draft => ({ id: '', name: '', client: '', site: '', status: 'draft', contractValue: '', isNew: true });

export default function ProjectRegister() {
  const store = useStore();
  const { ready, state, upsertProject, deleteProject, setActiveProject, costSettingsFor, replaceAll } = store;
  const newParam = useQueryParam('new');
  const editParam = useQueryParam('edit');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (!ready) return;
    if (newParam) setDraft(blank());
    const p = editParam ? state.projects.find((x) => x.id === editParam) : null;
    if (p) setDraft({ ...p, contractValue: p.contractValue == null ? '' : String(p.contractValue), isNew: false });
  }, [ready, newParam, editParam]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = state.projects.filter((p) => !q || `${p.id} ${p.code ?? ''} ${p.name} ${p.client} ${p.site}`.toLowerCase().includes(q.toLowerCase()));
  const o = useOrgList({ list: 'projects', kind: 'project', items: rows, id: (p) => p.id, project: (p) => p.id, noun: 'project' });

  if (!ready) return <Loading />;

  const today = todayLocal();
  const save = () => {
    if (!draft) return;
    const id = draft.id.trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9-]{1,39}$/.test(id)) return setError('Project ID: 2–40 letters, digits or dashes, e.g. NEAS-002.');
    if (draft.isNew && state.projects.some((p) => p.id === id)) return setError(`Project ${id} already exists.`);
    if (!draft.name.trim()) return setError('Project name is required.');
    const cv = draft.contractValue.trim() === '' ? null : Number(draft.contractValue);
    if (cv != null && (!Number.isFinite(cv) || cv < 0)) return setError('Contract value must be a positive number.');
    const existing = state.projects.find((p) => p.id === id);
    const p: Project = { id, name: draft.name.trim(), client: draft.client.trim(), site: draft.site.trim(), status: draft.status, contractValue: cv, createdAt: existing?.createdAt ?? new Date().toISOString() };
    upsertProject(p);
    if (draft.isNew) setActiveProject(id);
    setDraft(null);
    setError(null);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Portfolio</div>
          <h1>Project register</h1>
          <p className="lead">All projects on this device. Open one to make it the active project in every module.</p>
        </div>
        <div className="form-actions" style={{ marginTop: 0 }}>
          <DataIO doc={() => IO.projectsDoc(state)} capture={() => document.getElementById('projects-card')} importColumns={CLOUD ? undefined : IO.COLS.projects} importSheet="Projects" onImport={(rows) => asPlan(IO.planProjects(state, rows), replaceAll)} label="projects" />
          {CLOUD ? (isSuperAdmin() && <Link className="btn btn-primary" href="/admin#projects">Manage projects</Link>) : <button className="btn btn-primary" onClick={() => { setDraft(blank()); setError(null); }}>+ New project</button>}
        </div>
      </div>

      {!CLOUD && draft && (
        <section className="card">
          <div className="card-head"><h2>{draft.isNew ? 'New project' : `Edit ${draft.id}`}</h2></div>
          <div className="form-grid">
            <label className="field">Project ID<input className="input" value={draft.id} disabled={!draft.isNew} onChange={(e) => setDraft({ ...draft, id: e.target.value })} placeholder="NEAS-002" /></label>
            <label className="field" style={{ gridColumn: 'span 2' }}>Project name<input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
            <label className="field">Client<input className="input" value={draft.client} onChange={(e) => setDraft({ ...draft, client: e.target.value })} /></label>
            <label className="field">Site<input className="input" value={draft.site} onChange={(e) => setDraft({ ...draft, site: e.target.value })} /></label>
            <label className="field">Status
              <select className="input" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as ProjectStatus })}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="field">Contract value (₱)<input className="input" type="number" min="0" step="0.01" value={draft.contractValue} onChange={(e) => setDraft({ ...draft, contractValue: e.target.value })} placeholder="Blank if not yet agreed" /></label>
          </div>
          {error && <p className="bad" role="alert">{error}</p>}
          <div className="form-actions">
            <button className="btn btn-primary" onClick={save}>{draft.isNew ? 'Create project' : 'Save changes'}</button>
            <button className="btn" onClick={() => { setDraft(null); setError(null); }}>Cancel</button>
          </div>
        </section>
      )}

      <section className="card" id="projects-card">
        <div className="card-head">
          <h2>Projects ({rows.length})</h2>
          <input className="input" style={{ maxWidth: 280 }} placeholder="Search projects" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search projects" />
        </div>
        {o.toolbar}
        {o.listed.length === 0 ? <div className="empty">{o.showHidden ? 'You have not hidden any projects.' : 'No projects match.'}</div> : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th className="pick-col">{o.headerCheckbox}</th><th>Project</th><th>Client / site</th><th>Status</th><th className="num">Contract value</th><th className="num">BOQ selling price</th><th className="num">Planned</th><th className="num">Actual</th><th>Actions</th></tr></thead>
              {o.tbodies((p) => {
                  const acts = state.activities.filter((a) => a.projectId === p.id);
                  const reps = state.reports.filter((r) => r.projectId === p.id);
                  const prog = projectProgress(acts, reps, today, (id) => state.calendars?.[id]);
                  const boq = boqTotals(state.boq.filter((b) => b.projectId === p.id), costSettingsFor(p.id));
                  const active = p.id === state.activeProjectId;
                  return (
                    <tr style={active ? { background: '#f6f9fb' } : undefined}>
                      <td className="pick-col">{o.checkbox(p)}</td>
                      <td><b>{p.code ?? p.id}</b><div className="note">{p.name}</div></td>
                      <td>{p.client || '—'}<div className="note">{p.site}</div></td>
                      <td><span className={`pill ${p.status === 'active' ? 'pill-ok' : p.status === 'on-hold' ? 'pill-warn' : ''}`}>{p.status}</span></td>
                      <td className="num">{fmtPHP(p.contractValue)}</td>
                      <td className="num">{boq.direct > 0 ? fmtPHP(boq.total) : '—'}</td>
                      <td className="num">{acts.length ? fmtPct(prog.planned) : '—'}</td>
                      <td className="num">{acts.length ? fmtPct(prog.actual) : '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <Link className="btn btn-sm btn-primary" href="/" onClick={() => setActiveProject(p.id)}>Open</Link>{' '}
                        <Link className="btn btn-sm" href={`/reports?project=${encodeURIComponent(p.id)}`} onClick={() => setActiveProject(p.id)}>View reports</Link>{' '}
                        {!CLOUD && <><button className="btn btn-sm" onClick={() => { setDraft({ ...p, contractValue: p.contractValue == null ? '' : String(p.contractValue), isNew: false }); setError(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Edit</button>{' '}
                        <button className="btn btn-sm btn-danger" onClick={() => askConfirm(`Delete ${p.id} and all its activities, reports, BOQ and photos? This cannot be undone.`).then((ok) => ok && deleteProject(p.id))}>Delete</button></>}
                      </td>
                    </tr>
                  );
                }, 9)}
            </table>
          </div>
        )}
        <p className="note">Planned and actual are as of today ({today}).</p>
      </section>
    </>
  );
}
