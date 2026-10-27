'use client';
// Report templates: every project has its own editable template(s), started from the NEAS library
// (the Triconti quarterly mast inspection layout). Staff fill reports in from a template and export Word.
import { useCallback, useEffect, useState } from 'react';
import ProjectBar, { Loading, NoProject } from '@/components/ProjectBar';
import { askConfirm, notify } from '@/components/Dialogs';
import { fetchFromServer } from '@/components/PhotoThumb';
import { useProjectData, useStore } from '@/lib/store';
import { CLOUD } from '@/lib/cloud/env';
import { supabaseBrowser } from '@/lib/cloud/browser';
import { canManage, isClientViews, useCloudStatus } from '@/lib/cloud/cloudSync';
import { getPhoto } from '@/lib/photos';
import { saveFile } from '@/lib/fileio';
import { fmtDate } from '@/lib/format';
import {
  blankReport, KIND_LABEL, newSectionId, normaliseTemplate, templateReportDocx,
  type SectionData, type SectionKind, type TemplateDefinition, type TemplateReportData, type TemplateSection,
} from '@/lib/reportTemplates';

type TemplateRow = { id: string; project_id: string | null; name: string; definition: unknown; updated_at: string };
type ReportRow = { id: string; template_id: string | null; title: string; definition: unknown; data: TemplateReportData; status: 'draft' | 'final'; updated_at: string };

export default function TemplatesPage() {
  const { ready, project } = useStore();
  const { pid, evidence } = useProjectData();
  const cloud = useCloudStatus();
  const sb = CLOUD ? supabaseBrowser() : null;
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [editing, setEditing] = useState<TemplateRow | null>(null);
  const [open, setOpen] = useState<ReportRow | null>(null);
  const [pick, setPick] = useState('');
  const manager = !!pid && canManage(pid);

  const load = useCallback(async () => {
    if (!sb || !pid) return;
    const [t, r] = await Promise.all([
      sb.from('report_templates').select('id, project_id, name, definition, updated_at').or(`project_id.eq.${pid},project_id.is.null`).order('name'),
      sb.from('template_reports').select('id, template_id, title, definition, data, status, updated_at').eq('project_id', pid).order('updated_at', { ascending: false }),
    ]);
    setTemplates((t.data as TemplateRow[]) ?? []);
    setReports((r.data as ReportRow[]) ?? []);
  }, [sb, pid]);
  useEffect(() => { void load(); }, [load]);

  if (!ready) return <Loading />;
  if (!project) return <NoProject />;
  if (!CLOUD || !sb) return <div className="card">Report templates are part of the cloud version.</div>;
  if (isClientViews(cloud.profile?.allowed_views)) return <div className="card">Report templates are for NEAS staff.</div>;

  const mine = templates.filter((t) => t.project_id === pid);
  const library = templates.filter((t) => t.project_id === null);
  const chosen = templates.find((t) => t.id === pick) ?? mine[0] ?? null;

  const copyFromLibrary = async (lib: TemplateRow) => {
    const { error } = await sb.rpc('save_report_template', { p_id: null, p_project: pid, p_name: `${project.code ?? project.name} – ${lib.name}`.slice(0, 120), p_definition: normaliseTemplate(lib.definition) });
    if (error) return notify(error.message);
    notify('Template copied to this project. Edit it to fit the project.');
    await load();
  };
  const startReport = async (t: TemplateRow) => {
    const def = normaliseTemplate(t.definition);
    const { data, error } = await sb.from('template_reports')
      .insert({ project_id: pid, template_id: t.id, title: `${def.title} – ${new Date().toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })}`, definition: def, data: blankReport(def) })
      .select('id, template_id, title, definition, data, status, updated_at').single();
    if (error) return notify(`Report not started: ${error.message}`);
    await load();
    setOpen(data as ReportRow);
  };
  const removeReport = async (r: ReportRow) => {
    if (!(await askConfirm(`Delete the report “${r.title}”? This cannot be undone.`))) return;
    const { error } = await sb.from('template_reports').delete().eq('id', r.id);
    if (error) return notify(error.message);
    await load();
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Reporting</div>
          <h1>Report templates</h1>
          <p className="lead">Each project has its own report layout. Fill a report in from the template and export it to Word. Editing a template never changes reports already started.</p>
        </div>
      </div>
      <ProjectBar />

      {open ? (
        <ReportForm report={open} evidence={evidence} manager={manager} projectName={`${project.code ?? ''} · ${project.name}`} onClose={async () => { setOpen(null); await load(); }} />
      ) : editing ? (
        <TemplateEditor row={editing} onClose={async () => { setEditing(null); await load(); }} />
      ) : (
        <>
          <section className="card">
            <div className="card-head"><h2>Templates for this project ({mine.length})</h2></div>
            {mine.length === 0 && <p className="note">This project has no template yet.{manager ? ' Copy one from the library below, then adjust it.' : ' Ask the project manager to set one up.'}</p>}
            {mine.length > 0 && (
              <div className="form-actions" style={{ marginTop: 0 }}>
                <select className="input" style={{ maxWidth: 360 }} value={chosen?.id ?? ''} onChange={(e) => setPick(e.target.value)} aria-label="Template">
                  {mine.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                {chosen && <button className="btn btn-primary" onClick={() => startReport(chosen)}>New report from this template</button>}
                {chosen && manager && <button className="btn" onClick={() => setEditing(chosen)}>Edit template</button>}
              </div>
            )}
            {manager && library.length > 0 && (
              <>
                <h3 className="share-sub">Library</h3>
                <div className="form-actions" style={{ marginTop: 0 }}>
                  {library.map((l) => <button key={l.id} className="btn btn-sm" onClick={() => copyFromLibrary(l)}>Copy “{l.name}” to this project</button>)}
                </div>
              </>
            )}
          </section>

          <section className="card">
            <div className="card-head"><h2>Reports ({reports.length})</h2></div>
            {reports.length === 0 ? <div className="empty">No reports yet. Start one from a template above.</div> : (
              <div className="table-wrap">
                <table className="tbl">
                  <thead><tr><th>Title</th><th>Status</th><th>Updated</th><th /></tr></thead>
                  <tbody>
                    {reports.map((r) => (
                      <tr key={r.id}>
                        <td>{r.title}</td>
                        <td><span className={`pill ${r.status === 'final' ? 'pill-ok' : 'pill-warn'}`}>{r.status === 'final' ? 'Final' : 'Draft'}</span></td>
                        <td className="note">{fmtDate(r.updated_at.slice(0, 10))}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <button className="btn btn-sm btn-primary" onClick={() => setOpen(r)}>Open</button>{' '}
                          {(manager || r.status === 'draft') && <button className="btn btn-sm btn-danger" onClick={() => removeReport(r)}>Delete</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------- template editor (managers)
function TemplateEditor({ row, onClose }: { row: TemplateRow; onClose: () => void }) {
  const [name, setName] = useState(row.name);
  const [t, setT] = useState<TemplateDefinition>(() => normaliseTemplate(row.definition));
  const [busy, setBusy] = useState(false);
  const setSection = (i: number, patch: Partial<TemplateSection>) => setT((x) => ({ ...x, sections: x.sections.map((s, k) => (k === i ? { ...s, ...patch } : s)) }));
  const move = (i: number, d: -1 | 1) => setT((x) => { const s = x.sections.slice(); const j = i + d; if (j < 0 || j >= s.length) return x; [s[i], s[j]] = [s[j], s[i]]; return { ...x, sections: s }; });
  const lines = (v: string) => v.split('\n').map((l) => l.trim()).filter(Boolean);

  const save = async () => {
    setBusy(true);
    const { error } = await supabaseBrowser()!.rpc('save_report_template', { p_id: row.id, p_project: row.project_id, p_name: name, p_definition: t });
    setBusy(false);
    if (error) return notify(error.message);
    notify('Template saved. New reports use it; reports already started keep their own copy.');
    onClose();
  };
  const remove = async () => {
    if (!(await askConfirm(`Remove the template “${row.name}”? Reports already made from it are kept.`))) return;
    const { error } = await supabaseBrowser()!.rpc('delete_report_template', { p_id: row.id });
    if (error) return notify(error.message);
    onClose();
  };

  return (
    <section className="card">
      <div className="card-head"><h2>Edit template</h2><button className="btn btn-sm" onClick={onClose}>Close</button></div>
      <div className="form-grid">
        <label className="field">Template name<input className="input" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field">Report title<input className="input" maxLength={200} value={t.title} onChange={(e) => setT({ ...t, title: e.target.value })} /></label>
        <label className="field">Division line<input className="input" maxLength={200} value={t.division ?? ''} onChange={(e) => setT({ ...t, division: e.target.value })} /></label>
      </div>

      <fieldset className="progress-box">
        <legend>Cover fields</legend>
        {t.cover.map((c, i) => (
          <div key={c.key} className="form-actions" style={{ marginTop: 4 }}>
            <input className="input" style={{ maxWidth: 280 }} value={c.label} maxLength={120} onChange={(e) => setT({ ...t, cover: t.cover.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) })} aria-label="Cover field name" />
            <input className="input" style={{ maxWidth: 280 }} value={c.default ?? ''} maxLength={300} placeholder="Default value (optional)" onChange={(e) => setT({ ...t, cover: t.cover.map((x, k) => (k === i ? { ...x, default: e.target.value } : x)) })} aria-label="Default value" />
            <button className="btn btn-sm btn-danger" onClick={() => setT({ ...t, cover: t.cover.filter((_, k) => k !== i) })}>Remove</button>
          </div>
        ))}
        <button className="btn btn-sm" onClick={() => setT({ ...t, cover: [...t.cover, { key: newSectionId(), label: 'New field' }] })}>Add a cover field</button>
      </fieldset>

      {t.sections.map((s, i) => (
        <fieldset key={s.id} className="progress-box">
          <legend>Section {i + 1}</legend>
          <div className="form-actions" style={{ marginTop: 0 }}>
            <input className="input" style={{ maxWidth: 380 }} value={s.title} maxLength={200} onChange={(e) => setSection(i, { title: e.target.value })} aria-label="Section title" />
            <select className="input" style={{ maxWidth: 180 }} value={s.kind} onChange={(e) => setSection(i, { kind: e.target.value as SectionKind })} aria-label="Section type">
              {(Object.keys(KIND_LABEL) as SectionKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
            <button className="btn btn-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
            <button className="btn btn-sm" disabled={i === t.sections.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
            <button className="btn btn-sm btn-danger" onClick={() => setT({ ...t, sections: t.sections.filter((_, k) => k !== i) })}>Remove section</button>
          </div>
          {s.kind === 'status' && <label className="field">Status tiles (one per line)<textarea className="input" rows={3} value={(s.items ?? []).join('\n')} onChange={(e) => setSection(i, { items: lines(e.target.value) })} /></label>}
          {s.kind === 'table' && <>
            <label className="field">Columns (one per line)<textarea className="input" rows={3} value={(s.columns ?? []).join('\n')} onChange={(e) => setSection(i, { columns: lines(e.target.value) })} /></label>
            <label className="field">Standard rows: one row per line, cells separated by “ | ”<textarea className="input" rows={5} value={(s.rows ?? []).map((r) => r.join(' | ')).join('\n')} onChange={(e) => setSection(i, { rows: e.target.value.split('\n').filter((l) => l.trim()).map((l) => l.split('|').map((c) => c.trim())) })} /></label>
          </>}
        </fieldset>
      ))}
      <div className="form-actions">
        <button className="btn" onClick={() => setT({ ...t, sections: [...t.sections, { id: newSectionId(), title: 'New section', kind: 'text' }] })}>Add a section</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save template'}</button>
        <button className="btn btn-danger" onClick={remove}>Remove template</button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- filling in a report
function ReportForm({ report, evidence, manager, projectName, onClose }: {
  report: ReportRow; evidence: { id: string; caption: string; ref?: string; kind: string; storagePath?: string }[]; manager: boolean; projectName: string; onClose: () => void;
}) {
  const def = normaliseTemplate(report.definition);
  const [title, setTitle] = useState(report.title);
  const [d, setD] = useState<TemplateReportData>(() => ({ ...blankReport(def), ...report.data, sections: { ...blankReport(def).sections, ...(report.data?.sections ?? {}) } }));
  const [busy, setBusy] = useState<string | null>(null);
  const final = report.status === 'final';
  const locked = final && !manager;
  const setSec = (id: string, patch: SectionData) => setD((x) => ({ ...x, sections: { ...x.sections, [id]: { ...x.sections[id], ...patch } } }));

  const save = async (status?: 'draft' | 'final') => {
    setBusy('Saving…');
    const { error } = await supabaseBrowser()!.from('template_reports').update({ title, data: d, ...(status ? { status } : {}) }).eq('id', report.id);
    setBusy(null);
    if (error) { notify(`Not saved: ${error.message}`); return false; }
    notify(status === 'final' ? 'Report marked final.' : status === 'draft' ? 'Report reopened.' : 'Report saved.');
    return true;
  };
  const exportWord = async () => {
    setBusy('Building Word file…');
    try {
      const logo = await fetch('/neas-logo.png').then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => (b ? new Uint8Array(b) : null)).catch(() => null);
      const blob = await templateReportDocx(def, d, {
        projectName, reportTitle: title, logo,
        photo: async (id) => {
          const ev = evidence.find((e) => e.id === id);
          const b = (await getPhoto(id).catch(() => undefined)) ?? (ev?.storagePath ? await fetchFromServer(id, ev.storagePath) : null);
          if (!b) return null;
          const bmp = await createImageBitmap(b);
          const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; c.getContext('2d')!.drawImage(bmp, 0, 0);
          const jpg = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.85));
          return jpg ? { data: new Uint8Array(await jpg.arrayBuffer()), w: bmp.width, h: bmp.height } : null;
        },
      });
      await saveFile(`${title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'NEAS_Report'}.docx`, blob);
    } catch (e) { notify(`Word export failed: ${(e as Error).message}`); }
    setBusy(null);
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>{final ? 'Final report' : 'Report draft'}</h2>
        <button className="btn btn-sm" onClick={onClose}>Back to reports</button>
      </div>
      {locked && <p className="note">This report is final. The project manager can reopen it.</p>}
      <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 12 }}>
        <label className="field">Report title<input className="input" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <fieldset className="progress-box">
          <legend>Cover</legend>
          <div className="form-grid">
            {def.cover.map((c) => <label key={c.key} className="field">{c.label}<input className="input" maxLength={300} value={d.cover[c.key] ?? ''} onChange={(e) => setD({ ...d, cover: { ...d.cover, [c.key]: e.target.value } })} /></label>)}
          </div>
        </fieldset>
        {def.sections.map((s, i) => {
          const sd = d.sections[s.id] ?? {};
          return (
            <fieldset key={s.id} className="progress-box">
              <legend>{/^annex/i.test(s.title) ? s.title : `${i + 1}. ${s.title}`}</legend>
              {s.kind === 'text' && <textarea className="input" rows={5} maxLength={20000} value={sd.text ?? ''} onChange={(e) => setSec(s.id, { text: e.target.value })} placeholder="Leave a blank line between paragraphs" />}
              {s.kind === 'bullets' && <>
                {(sd.bullets ?? ['']).map((b, k) => (
                  <div key={k} className="form-actions" style={{ marginTop: 4 }}>
                    <input className="input" maxLength={600} value={b} onChange={(e) => setSec(s.id, { bullets: (sd.bullets ?? ['']).map((x, j) => (j === k ? e.target.value : x)) })} aria-label={`Point ${k + 1}`} />
                    <button type="button" className="btn btn-sm" onClick={() => setSec(s.id, { bullets: (sd.bullets ?? []).filter((_, j) => j !== k) })}>Remove</button>
                  </div>
                ))}
                <button type="button" className="btn btn-sm" onClick={() => setSec(s.id, { bullets: [...(sd.bullets ?? []), ''] })}>Add a point</button>
              </>}
              {s.kind === 'status' && <div className="form-grid">
                {(s.items ?? []).map((it) => <label key={it} className="field">{it}<input className="input" maxLength={60} value={sd.status?.[it] ?? ''} onChange={(e) => setSec(s.id, { status: { ...(sd.status ?? {}), [it]: e.target.value } })} placeholder="e.g. GOOD" /></label>)}
              </div>}
              {s.kind === 'table' && <div className="table-wrap">
                <table className="tbl">
                  <thead><tr>{(s.columns ?? []).map((c) => <th key={c}>{c}</th>)}<th /></tr></thead>
                  <tbody>
                    {(sd.rows ?? []).map((r, k) => (
                      <tr key={k}>
                        {(s.columns ?? []).map((_, j) => <td key={j}><textarea className="input" rows={2} maxLength={2000} value={r[j] ?? ''} onChange={(e) => setSec(s.id, { rows: (sd.rows ?? []).map((row, x) => (x === k ? (s.columns ?? []).map((__, y) => (y === j ? e.target.value : row[y] ?? '')) : row)) })} /></td>)}
                        <td><button type="button" className="btn btn-sm" onClick={() => setSec(s.id, { rows: (sd.rows ?? []).filter((_, x) => x !== k) })}>Remove</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button type="button" className="btn btn-sm" onClick={() => setSec(s.id, { rows: [...(sd.rows ?? []), (s.columns ?? []).map(() => '')] })}>Add a row</button>
              </div>}
              {s.kind === 'photos' && <>
                {(sd.photos ?? []).map((ph, k) => (
                  <div key={ph.evidenceId} className="form-actions" style={{ marginTop: 4 }}>
                    <span className="note" style={{ minWidth: 70 }}>Photo {k + 1}</span>
                    <input className="input" maxLength={300} value={ph.caption} onChange={(e) => setSec(s.id, { photos: (sd.photos ?? []).map((x, j) => (j === k ? { ...x, caption: e.target.value } : x)) })} aria-label={`Caption for photo ${k + 1}`} />
                    <button type="button" className="btn btn-sm" onClick={() => setSec(s.id, { photos: (sd.photos ?? []).filter((_, j) => j !== k) })}>Remove</button>
                  </div>
                ))}
                <select className="input" style={{ maxWidth: 420, marginTop: 6 }} value="" onChange={(e) => {
                  const ev = evidence.find((x) => x.id === e.target.value);
                  if (ev) setSec(s.id, { photos: [...(sd.photos ?? []), { evidenceId: ev.id, caption: ev.caption || ev.ref || ev.kind }] });
                }} aria-label="Add a photo from Site evidence">
                  <option value="">Add a photo from Site evidence…</option>
                  {evidence.filter((e) => !(sd.photos ?? []).some((p) => p.evidenceId === e.id)).map((e) => <option key={e.id} value={e.id}>{e.ref || e.kind} · {e.caption}</option>)}
                </select>
              </>}
            </fieldset>
          );
        })}
      </fieldset>
      <div className="form-actions">
        {!locked && <button className="btn btn-primary" disabled={!!busy} onClick={() => void save()}>{busy === 'Saving…' ? busy : 'Save'}</button>}
        <button className="btn" disabled={!!busy} onClick={exportWord}>{busy === 'Building Word file…' ? busy : 'Export Word (.docx)'}</button>
        {manager && !final && <button className="btn" disabled={!!busy} onClick={async () => { if (await save('final')) onClose(); }}>Mark final</button>}
        {manager && final && <button className="btn" disabled={!!busy} onClick={async () => { if (await save('draft')) onClose(); }}>Reopen</button>}
      </div>
    </section>
  );
}
