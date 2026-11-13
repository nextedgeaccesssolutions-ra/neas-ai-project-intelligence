'use client';
// Photo library: every site photo this account can see, arranged Project → Work area → Floor → category.
// The arrangement comes from each photo's saved details, not from folder or file names.
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useStore } from '@/lib/store';
import PhotoThumb from '@/components/PhotoThumb';
import { fmtDate } from '@/lib/format';
import type { Evidence } from '@/lib/types';

const PER = 24;

export default function PhotoLibrary() {
  const { state, setActiveProject } = useStore();
  const [pid, setPid] = useState('');
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const byId = useMemo(() => new Map(state.projects.map((p) => [p.id, p])), [state.projects]);
  const proj = (id: string) => byId.get(id);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return state.evidence
      .filter((e) => e.kind !== 'Reference' && (!pid || e.projectId === pid) && (!kind || e.kind === kind))
      .filter((e) => !t || `${proj(e.projectId)?.code ?? ''} ${proj(e.projectId)?.name ?? ''} ${e.ref ?? ''} ${e.caption} ${e.workArea ?? ''} ${e.locationDetail ?? ''}`.toLowerCase().includes(t))
      .sort((a, b) => (proj(a.projectId)?.code ?? '').localeCompare(proj(b.projectId)?.code ?? '') || (a.workArea ?? '').localeCompare(b.workArea ?? '')
        || (a.locationDetail ?? '').localeCompare(b.locationDetail ?? '', undefined, { numeric: true }) || a.kind.localeCompare(b.kind) || a.takenAt.localeCompare(b.takenAt));
  }, [state.evidence, pid, kind, q, byId]); // eslint-disable-line react-hooks/exhaustive-deps
  const pages = Math.max(1, Math.ceil(list.length / PER));
  const pg = Math.min(page, pages - 1);
  const shown = list.slice(pg * PER, (pg + 1) * PER);
  const path = (e: Evidence) => [proj(e.projectId)?.code, e.workArea, e.locationDetail, e.kind.toUpperCase()].filter(Boolean).join(' → ');
  let last = '';

  return (
    <>
      <div className="page-head"><div><div className="eyebrow">Field operations</div><h1>Photo library</h1><p className="lead">All site photos you can see, by project, work area, floor and category.</p></div></div>
      <section className="card">
        <div className="form-grid">
          <label className="field">Project<select className="input" value={pid} onChange={(e) => { setPid(e.target.value); setPage(0); }}><option value="">All projects</option>{state.projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></label>
          <label className="field">Category<select className="input" value={kind} onChange={(e) => { setKind(e.target.value); setPage(0); }}><option value="">All</option>{['Before', 'After', 'During', 'Inspection', 'Safety', 'Defect'].map((k) => <option key={k}>{k}</option>)}</select></label>
          <label className="field">Search<input className="input" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Project, photo ref, caption, area, floor" /></label>
        </div>
        <p className="note">{list.length} photo(s)</p>
        <div className="lib-grid">
          {shown.map((e) => {
            const head = path(e).split(' → ').slice(0, -1).join(' → ');
            const showHead = head !== last; last = head;
            return (
              <div key={e.id} className="lib-cell" style={showHead ? undefined : undefined}>
                {showHead && <div className="lib-head">{head || 'No work area'}</div>}
                <figure className="fr-photo">
                  <PhotoThumb id={e.id} storagePath={e.storagePath} alt={`${e.kind}: ${e.caption}`} />
                  <figcaption><b>{e.ref || e.kind} · {e.kind}</b><span className="note">{e.caption}</span><span className="note">{fmtDate(e.takenAt.slice(0, 10))}</span>
                    <Link className="note" href="/site-evidence" onClick={() => setActiveProject(e.projectId)}>Open in Site evidence ›</Link>
                  </figcaption>
                </figure>
              </div>
            );
          })}
        </div>
        {pages > 1 && <div className="grid-pager"><button className="btn btn-sm" disabled={pg === 0} onClick={() => setPage(pg - 1)}>‹ Previous</button><span className="note">Page {pg + 1} of {pages}</span><button className="btn btn-sm" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}>Next ›</button></div>}
      </section>
    </>
  );
}
