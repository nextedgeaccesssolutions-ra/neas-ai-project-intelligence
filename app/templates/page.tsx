'use client';
// Report templates: every project has its own editable template(s), started from the NEAS library
// (the Triconti quarterly mast inspection layout). Staff fill reports in from a template and export Word.
import { getMeta, setMeta } from '@/lib/offline/outbox';
import { useCallback, useEffect, useState } from 'react';
import ProjectBar, { Loading, NoProject } from '@/components/ProjectBar';
import { askConfirm, notify } from '@/components/Dialogs';
import { fetchFromServer } from '@/components/PhotoThumb';
import { useProjectData, useStore } from '@/lib/store';
import { CLOUD } from '@/lib/cloud/env';
import { supabaseBrowser } from '@/lib/cloud/browser';
import { canManage, isClientAccount, useCloudStatus } from '@/lib/cloud/cloudSync';
import { getPhoto } from '@/lib/photos';
import { saveFile } from '@/lib/fileio';
import { fmtDate } from '@/lib/format';
import { templateFromFile } from '@/lib/templateImport';
import { cacheProject, cachedProject, dropPending, flushPending, keepOnDevice, pendingFor, serverStamp, type PendingSave } from '@/lib/templateReportDrafts';
import {
  blankReport, chartCounts, KIND_LABEL, newSectionId, normaliseTemplate, templateReportDocx, templateReportPdf,
  type SectionData, type SectionKind, type TemplateDefinition, type TemplateReportData, type TemplateSection,
  photoSrc,
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

  const [pending, setPending] = useState<PendingSave[]>([]);
  const [offlineCopy, setOfflineCopy] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!sb || !pid) return;
    if (navigator.onLine) {
      const sent = await flushPending(sb).catch(() => null);
      if (sent?.sent) notify(`${sent.sent} report save(s) from this device reached the server.`);
      if (sent?.refused || sent?.conflicts) notify('Some report saves on this device need your attention (see “Saved on this device”).');
    }
    const [t, r] = await Promise.all([
      sb.from('report_templates').select('id, project_id, name, definition, updated_at').or(`project_id.eq.${pid},project_id.is.null`).order('name'),
      sb.from('template_reports').select('id, template_id, title, definition, data, status, updated_at').eq('project_id', pid).order('updated_at', { ascending: false }),
    ]).catch(() => [{ data: null, error: true }, { data: null, error: true }] as const);
    if (t.data && r.data) {
      setTemplates(t.data as TemplateRow[]);
      setReports(r.data as ReportRow[]);
      cacheProject(pid, { templates: t.data, reports: r.data });
      setOfflineCopy(null);
    } else {
      // offline: the copy saved on this device the last time the page was online
      const c = cachedProject(pid);
      setTemplates((c?.templates as TemplateRow[]) ?? []);
      setReports((c?.reports as ReportRow[]) ?? []);
      setOfflineCopy(c?.at ?? '');
    }
    setPending(pendingFor(pid));
  }, [sb, pid]);
  useEffect(() => { void load(); }, [load]);
  // a Word / PowerPoint file chosen in another page's Import arrives here, ready to review
  useEffect(() => {
    // wait for the project and the person's roles (they load after a page reload) before deciding
    if (!pid || !cloud.profile || !/[?&]imported=1/.test(window.location.search)) return;
    // kept in IndexedDB: an import with photos is too large for session storage
    void (async () => {
      try {
        const got = await getMeta<{ name: string; definition: TemplateDefinition }>('imported-template');
        await setMeta('imported-template', null);
        window.history.replaceState(null, '', '/templates');
        if (!got) return;
        const { name, definition } = got;
        if (!canManage(pid)) return notify('Only the project manager or a Super Admin can add report templates.');
        setEditing({ id: '', project_id: pid, name, definition, updated_at: '' });
        notify(`Read ${definition.sections.length} section(s) from ${name}. Check them, then press Save template.`);
      } catch { /* nothing to pick up */ }
    })();
  }, [pid, cloud.profile, cloud.memberships]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const on = () => void load();
    window.addEventListener('online', on);
    return () => window.removeEventListener('online', on);
  }, [load]);

  if (!ready) return <Loading />;
  if (!project) return <NoProject />;
  if (!CLOUD || !sb) return <div className="card">Report templates are part of the cloud version.</div>;
  const client = isClientAccount(cloud.profile);

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
    const title = `${def.title} – ${new Date().toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })}`;
    if (!navigator.onLine) {
      const row: ReportRow = { id: crypto.randomUUID(), template_id: t.id, title, definition: def, data: blankReport(def), status: 'draft', updated_at: '' };
      if (!keepOnDevice({ id: row.id, project_id: pid, template_id: t.id, title, definition: def, data: row.data, base: null, savedAt: new Date().toISOString() })) return notify('This device has no room left to keep a new report. Free up space or reconnect.');
      setPending(pendingFor(pid));
      setOpen(row);
      return;
    }
    const { data, error } = await sb.from('template_reports')
      .insert({ project_id: pid, template_id: t.id, title, definition: def, data: blankReport(def) })
      .select('id, template_id, title, definition, data, status, updated_at').single();
    if (error) return notify(`Report not started: ${error.message}`);
    await load();
    setOpen(data as ReportRow);
  };
  // a Word / PowerPoint report becomes a new template, opened in the editor for review before saving
  const importFile = async (file: File) => {
    try {
      notify(`Reading ${file.name}…`);
      const def = await templateFromFile(file);
      setEditing({ id: '', project_id: pid, name: file.name.replace(/\.[^.]+$/, '').slice(0, 100), definition: def, updated_at: '' });
      notify(`Read ${def.sections.length} section(s) from ${file.name}. Check them, then press Save template.`);
    } catch (e) { notify((e as Error).message); }
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
        <ReportForm report={open} evidence={evidence} manager={manager} projectId={pid} projectName={`${project.code ?? ''} · ${project.name}`} onClose={async () => { setOpen(null); await load(); }} />
      ) : client ? (
        // client accounts: view only, finished reports of this project (the database returns only final ones)
        <section className="card">
          <div className="card-head"><h2>Reports ({reports.length})</h2><span className="note">View only</span></div>
          {reports.length === 0 ? <div className="empty">No finished reports for this project yet.</div> : (
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>Title</th><th>Updated</th><th /></tr></thead>
                <tbody>
                  {reports.map((r) => (
                    <tr key={r.id}>
                      <td>{r.title}</td>
                      <td className="note">{fmtDate(r.updated_at.slice(0, 10))}</td>
                      <td><button className="btn btn-sm btn-primary" onClick={() => setOpen(r)}>Open</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
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
            {manager && (
              <div className="form-actions">
                <label className="btn" style={{ cursor: 'pointer' }}>
                  Import a template from Word / PowerPoint / Excel / PDF
                  <input type="file" hidden accept=".docx,.pptx,.xlsx,.pdf,.doc,.ppt,.xls" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f); }} />
                </label>
                <span className="note">Headings become sections, tables keep their columns and standard rows, photo pages become the photo annex.</span>
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

          {offlineCopy !== null && <div className="banner">Offline: showing the copy saved on this device{offlineCopy ? ` (${new Date(offlineCopy).toLocaleString()})` : ''}. Changes are kept here and sent when you are back online.</div>}
          {pending.length > 0 && (
            <section className="card">
              <div className="card-head"><h2>Saved on this device ({pending.length})</h2><span className="note">Sent automatically when online</span></div>
              {pending.map((p) => (
                <div key={p.id} className="form-actions" style={{ marginTop: 4 }}>
                  <b>{p.title}</b>
                  <span className={`pill ${p.conflict || p.error ? 'pill-bad' : 'pill-warn'}`}>{p.conflict ? 'Someone changed this report meanwhile' : p.error ? 'Not accepted' : 'Waiting to sync'}</span>
                  {p.error && <span className="note">{p.error}</span>}
                  <span className="note">{new Date(p.savedAt).toLocaleString()}</span>
                  <button className="btn btn-sm" onClick={() => setOpen({ id: p.id, template_id: p.template_id, title: p.title, definition: p.definition, data: p.data as TemplateReportData, status: 'draft', updated_at: p.base ?? '' })}>Open device copy</button>
                  {p.conflict && <button className="btn btn-sm" onClick={async () => { if (await askConfirm('Replace the server copy with the copy on this device? Changes others saved meanwhile are overwritten.')) { keepOnDevice({ ...p, conflict: false, error: undefined, base: '' }); await load(); } }}>Keep device copy (replace server)</button>}
                  {p.error && <button className="btn btn-sm" onClick={async () => { keepOnDevice({ ...p, error: undefined }); await load(); }}>Send again</button>}
                  <button className="btn btn-sm btn-danger" onClick={async () => { if (await askConfirm(`Discard the device copy of “${p.title}”? Changes not sent are lost.`)) { dropPending(p.id); setPending(pendingFor(pid)); } }}>Discard device copy</button>
                </div>
              ))}
            </section>
          )}
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
    const { error } = await supabaseBrowser()!.rpc('save_report_template', { p_id: row.id || null, p_project: row.project_id, p_name: name, p_definition: t });
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
      <div className="card-head"><h2>{row.id ? 'Edit template' : 'New template (imported)'}</h2><button className="btn btn-sm" onClick={onClose}>Close</button></div>
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
          {s.kind === 'chart' && (() => {
            const tables = t.sections.filter((x) => x.kind === 'table');
            const src = tables.find((x) => x.id === s.source);
            return (
              <div className="form-grid">
                <label className="field">Count values from table
                  <select className="input" value={s.source ?? ''} onChange={(e) => setSection(i, { source: e.target.value || undefined, column: undefined })}>
                    <option value="">Choose a table…</option>
                    {tables.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
                  </select>
                </label>
                {src && <label className="field">Column
                  <select className="input" value={s.column ?? ''} onChange={(e) => setSection(i, { column: e.target.value || undefined })}>
                    <option value="">Choose a column…</option>
                    {(src.columns ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>}
              </div>
            );
          })()}
          {s.kind === 'status' && <label className="field">Status tiles (one per line)<textarea className="input" rows={3} value={(s.items ?? []).join('\n')} onChange={(e) => setSection(i, { items: [...new Set(lines(e.target.value))] })} /></label>}
          {s.kind === 'table' && <>
            <label className="field">Columns (one per line)<textarea className="input" rows={3} value={(s.columns ?? []).join('\n')} onChange={(e) => setSection(i, { columns: lines(e.target.value) })} /></label>
            <label className="field">Standard rows: one row per line, cells separated by “ | ”<textarea className="input" rows={5} value={(s.rows ?? []).map((r) => r.join(' | ')).join('\n')} onChange={(e) => setSection(i, { rows: e.target.value.split('\n').filter((l) => l.trim()).map((l) => l.split('|').map((c) => c.trim())) })} /></label>
          </>}
        </fieldset>
      ))}
      <div className="form-actions">
        <button className="btn" onClick={() => setT({ ...t, sections: [...t.sections, { id: newSectionId(), title: 'New section', kind: 'text' }] })}>Add a section</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save template'}</button>
        {row.id && <button className="btn btn-danger" onClick={remove}>Remove template</button>}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- filling in a report
function ReportForm({ report, evidence, manager, projectName, projectId, onClose }: {
  report: ReportRow; evidence: { id: string; caption: string; ref?: string; kind: string; storagePath?: string }[]; manager: boolean; projectName: string; projectId: string; onClose: () => void;
}) {
  const def = normaliseTemplate(report.definition);
  const [title, setTitle] = useState(report.title);
  const [d, setD] = useState<TemplateReportData>(() => ({ ...blankReport(def), ...report.data, sections: { ...blankReport(def).sections, ...(report.data?.sections ?? {}) } }));
  const [busy, setBusy] = useState<string | null>(null);
  const [base, setBase] = useState<string | null>(report.updated_at);
  const final = report.status === 'final';
  const locked = final && !manager;
  const setSec = (id: string, patch: SectionData) => setD((x) => ({ ...x, sections: { ...x.sections, [id]: { ...x.sections[id], ...patch } } }));

  const keepHere = () => {
    const prev = pendingFor(projectId).find((x) => x.id === report.id);
    const ok = keepOnDevice({ id: report.id, project_id: projectId, template_id: report.template_id, title, definition: def, data: d, base: prev ? prev.base : base || null, savedAt: new Date().toISOString() });
    notify(ok ? 'Saved on this device. It is sent to the server when you are back online.' : 'This device has no room left to keep the report. Free up space or reconnect.');
    return ok;
  };
  const save = async (status?: 'draft' | 'final') => {
    const startedOffline = !base && pendingFor(projectId).some((x) => x.id === report.id && x.base === null);
    if (!navigator.onLine || startedOffline) {
      if (status) { notify('Marking a report final needs a connection.'); return false; }
      if (startedOffline && navigator.onLine) {
        // a report started offline is created on the server first
        if (!keepHere()) return false;
        const r = await flushPending(supabaseBrowser()!).catch(() => null);
        if (r?.sent) {
          notify('Report sent to the server.');
          // from now on, saves start from the server's copy
          setBase(await serverStamp(supabaseBrowser()!, report.id));
        }
        return true;
      }
      return keepHere();
    }
    setBusy('Saving…');
    const q = supabaseBrowser()!.from('template_reports').update({ title, data: d, ...(status ? { status } : {}) }).eq('id', report.id);
    const { data, error } = await (base ? q.eq('updated_at', base) : q).select('updated_at');
    setBusy(null);
    if (error) {
      // no connection after all: keep the work on this device
      if (/fetch|network|Failed to fetch/i.test(error.message)) return keepHere();
      notify(`Not saved: ${error.message}`); return false;
    }
    if (!data || !data.length) {
      const kept = keepOnDevice({ id: report.id, project_id: projectId, template_id: report.template_id, title, definition: def, data: d, base, savedAt: new Date().toISOString(), conflict: true });
      notify(kept ? 'Someone else saved this report after you opened it. Your version is kept on this device; open the report list to choose which to keep.'
        : 'Someone else saved this report after you opened it, and this device has no room to keep your version. Copy your changes before leaving this page.');
      return false;
    }
    setBase((data[0] as { updated_at: string }).updated_at);
    dropPending(report.id);
    notify(status === 'final' ? 'Report marked final.' : status === 'draft' ? 'Report reopened.' : 'Report saved.');
    return true;
  };
  const loadBlob = async (id: string) => {
    const ev = evidence.find((e) => e.id === id);
    return (await getPhoto(id).catch(() => undefined)) ?? (ev?.storagePath && navigator.onLine ? await fetchFromServer(id, ev.storagePath) : null);
  };
  const fileBase = () => title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'NEAS_Report';
  const exportPdf = async () => {
    setBusy('Building PDF…');
    try {
      const { loadLogo } = await import('@/lib/projectReportPdf');
      const { toImage } = await import('@/lib/evidenceExport');
      const blob = await templateReportPdf(def, d, {
        projectName, reportTitle: title, logo: await loadLogo().catch(() => null),
        photo: async (id) => { const b = await loadBlob(id); return b ? toImage(b) : null; },
      });
      await saveFile(`${fileBase()}.pdf`, blob);
    } catch (e) { notify(`PDF export failed: ${(e as Error).message}`); }
    setBusy(null);
  };
  const exportWord = async () => {
    setBusy('Building Word file…');
    try {
      const logo = await fetch('/neas-logo.png').then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => (b ? new Uint8Array(b) : null)).catch(() => null);
      const blob = await templateReportDocx(def, d, {
        projectName, reportTitle: title, logo,
        photo: async (id) => {
          const b = await loadBlob(id);
          if (!b) return null;
          const bmp = await createImageBitmap(b);
          const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; c.getContext('2d')!.drawImage(bmp, 0, 0);
          const jpg = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.85));
          return jpg ? { data: new Uint8Array(await jpg.arrayBuffer()), w: bmp.width, h: bmp.height } : null;
        },
      });
      await saveFile(`${fileBase()}.docx`, blob);
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
                {[...new Set(s.items ?? [])].map((it, n) => <label key={`${n}-${it}`} className="field">{it}<input className="input" maxLength={60} value={sd.status?.[it] ?? ''} onChange={(e) => setSec(s.id, { status: { ...(sd.status ?? {}), [it]: e.target.value } })} placeholder="e.g. GOOD" /></label>)}
              </div>}
              {s.kind === 'table' && <div className="table-wrap">
                <table className="tbl">
                  <thead><tr>{(s.columns ?? []).map((c, n) => <th key={n}>{c}</th>)}<th /></tr></thead>
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
              {s.kind === 'chart' && (() => {
                const counts = chartCounts(def, d, s);
                const max = Math.max(1, ...counts.map((c) => c.count));
                return counts.length ? (
                  <div style={{ display: 'grid', gap: 4 }}>
                    {counts.map((c) => (
                      <div key={c.label} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 30%) 1fr auto', gap: 8, alignItems: 'center' }}>
                        <span className="note">{c.label}</span>
                        <div style={{ height: 14, width: `${(c.count / max) * 100}%`, background: 'var(--gold)', borderRadius: 3 }} />
                        <b>{c.count}</b>
                      </div>
                    ))}
                    <span className="note">Counts the “{s.column}” column of “{def.sections.find((x) => x.id === s.source)?.title}”. It updates as that table is filled in.</span>
                  </div>
                ) : <p className="note">{s.source ? `Fill in the “${s.column}” column of “${def.sections.find((x) => x.id === s.source)?.title ?? 'the table'}” to see this chart.` : 'Ask the project manager to choose what this chart counts (Edit template).'}</p>;
              })()}
              {s.kind === 'photos' && <>
                {(sd.photos ?? []).map((ph, k) => (
                  <div key={ph.evidenceId} className="form-actions" style={{ marginTop: 4 }}>
                    {photoSrc(def, ph) ? <img src={photoSrc(def, ph)} alt={ph.caption || `Photo ${k + 1}`} style={{ width: 96, height: 72, objectFit: 'cover', borderRadius: 4 }} /> : null}
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
        <button className="btn" disabled={!!busy} onClick={exportPdf}>{busy === 'Building PDF…' ? busy : 'Export PDF'}</button>
        <button className="btn" disabled={!!busy} onClick={exportWord}>{busy === 'Building Word file…' ? busy : 'Export Word (.docx)'}</button>
        {manager && !final && <button className="btn" disabled={!!busy} onClick={async () => { if (await save('final')) onClose(); }}>Mark final</button>}
        {manager && final && <button className="btn" disabled={!!busy} onClick={async () => { if (await save('draft')) onClose(); }}>Reopen</button>}
      </div>
    </section>
  );
}
