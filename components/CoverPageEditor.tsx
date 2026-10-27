'use client';
// Edit the project report's first page for this project. Project members change the text of each line
// (it replaces the Project register value on the cover only). A Super Admin also changes the layout:
// report title, line names, which lines show, their order, and extra lines.
import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/cloud/browser';
import { LOCKED_COVER_LINES, type CoverSettings } from '@/lib/projectReport';
import { notify } from '@/components/Dialogs';

type Row = { key: string; label: string; show: boolean };

export default function CoverPageEditor({ projectId, defaults, settings, isAdmin, onSaved }: {
  projectId: string;
  /** cover lines as generated from the Project register, in default order */
  defaults: [string, string][];
  settings: CoverSettings | null;
  isAdmin: boolean;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [title, setTitle] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [extra, setExtra] = useState<{ key: string; label: string }[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setValues(settings?.values ?? {});
    setTitle(settings?.layout?.title ?? '');
    const ex = settings?.layout?.extra ?? [];
    setExtra(ex);
    const saved = settings?.layout?.rows ?? [];
    const keys = [...defaults.map(([k]) => k), ...ex.map((x) => x.key)];
    const ordered = [...saved.map((r) => r.key).filter((k) => keys.includes(k)), ...keys.filter((k) => !saved.some((r) => r.key === k))];
    setRows(ordered.map((key) => ({ key, label: saved.find((r) => r.key === key)?.label ?? '', show: saved.find((r) => r.key === key)?.show !== false })));
  }, [settings, defaults.map(([k]) => k).join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const def = new Map(defaults);
  const nameOf = (key: string) => extra.find((x) => x.key === key)?.label ?? key;
  const move = (i: number, d: -1 | 1) => setRows((r) => { const n = r.slice(); const j = i + d; if (j < 0 || j >= n.length) return r; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const addLine = () => {
    const key = `custom:${Date.now().toString(36)}`;
    setExtra((x) => [...x, { key, label: 'New line' }]);
    setRows((r) => [...r, { key, label: '', show: true }]);
  };
  const removeLine = (key: string) => { setExtra((x) => x.filter((e) => e.key !== key)); setRows((r) => r.filter((e) => e.key !== key)); setValues((v) => { const n = { ...v }; delete n[key]; return n; }); };

  const save = async () => {
    setBusy(true);
    const sb = supabaseBrowser()!;
    const clean = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()]).filter(([k, v]) => v && !LOCKED_COVER_LINES.includes(k)));
    const { error } = await sb.rpc('save_report_cover_values', { p_project: projectId, p_values: clean });
    let layoutErr = null;
    if (!error && isAdmin) {
      ({ error: layoutErr } = await sb.rpc('save_report_cover_layout', {
        p_project: projectId,
        p_layout: { title: title.trim() || undefined, rows: rows.map((r) => ({ key: r.key, label: r.label.trim() || undefined, show: r.show })), extra: extra.map((x) => ({ key: x.key, label: x.label.trim() || 'Line' })) },
      }));
    }
    setBusy(false);
    if (error || layoutErr) return notify(`Cover page not saved: ${(error ?? layoutErr)!.message}`);
    notify('Cover page saved. It applies to reports generated from now on.');
    onSaved();
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>Cover page details</h2>
        <button className="btn btn-sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? 'Close' : 'Edit first page'}</button>
      </div>
      {!open ? <p className="note">The first page lists the project's details from the Project register. Edit them for this project's reports without changing the register{isAdmin ? ', and change the report title, line names, order and which lines show' : ''}.</p> : (
        <>
          {isAdmin && <label className="field">Report title<input className="input" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Project Report" /></label>}
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Line</th><th>Text on the cover</th>{isAdmin && <><th>Name shown</th><th>Show</th><th>Order</th><th /></>}</tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const locked = LOCKED_COVER_LINES.includes(r.key);
                  const custom = r.key.startsWith('custom:');
                  return (
                    <tr key={r.key}>
                      <td>{custom && isAdmin ? <input className="input" value={nameOf(r.key)} maxLength={60} onChange={(e) => setExtra((x) => x.map((y) => (y.key === r.key ? { ...y, label: e.target.value } : y)))} aria-label="Extra line name" /> : nameOf(r.key)}</td>
                      <td>{locked ? <span className="note">Filled in when the report is generated</span> : (
                        <input className="input" maxLength={300} value={values[r.key] ?? ''} placeholder={def.get(r.key) ?? 'Text for this line'} onChange={(e) => setValues((v) => ({ ...v, [r.key]: e.target.value }))} aria-label={`${nameOf(r.key)} text`} />
                      )}</td>
                      {isAdmin && <>
                        <td>{custom || r.key === 'Project title' || r.key === 'Report reference' ? null : <input className="input" maxLength={60} value={r.label} placeholder={r.key} onChange={(e) => setRows((x) => x.map((y, k) => (k === i ? { ...y, label: e.target.value } : y)))} aria-label={`Name for ${r.key}`} />}</td>
                        <td><input type="checkbox" checked={r.show} onChange={(e) => setRows((x) => x.map((y, k) => (k === i ? { ...y, show: e.target.checked } : y)))} aria-label={`Show ${r.key}`} /></td>
                        <td style={{ whiteSpace: 'nowrap' }}><button className="btn btn-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button> <button className="btn btn-sm" disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button></td>
                        <td>{custom && <button className="btn btn-sm btn-danger" onClick={() => removeLine(r.key)}>Remove</button>}</td>
                      </>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="note">Leave a line empty to use the Project register value (shown in grey). Changes apply to reports generated after saving; reports already generated or sent to the client do not change.</p>
          <div className="form-actions">
            <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save cover page'}</button>
            {isAdmin && <button className="btn" onClick={addLine}>Add a line</button>}
            <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </>
      )}
    </section>
  );
}
