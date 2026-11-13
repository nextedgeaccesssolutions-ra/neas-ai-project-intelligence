'use client';
import Link from 'next/link';
import { Fragment, useState } from 'react';
import DataIO, { asPlan } from '@/components/DataIO';
import * as IO from '@/lib/moduleIO';
import { ManagerOnly } from '@/components/RoleGate';
import ProjectBar, { Loading, NoProject } from '@/components/ProjectBar';
import { useBoqTotals, useProjectData, useStore } from '@/lib/store';
import { lineAmount } from '@/lib/calc';
import { boqLocked } from '@/lib/quote';
import { fmtNum, fmtPHP, uid } from '@/lib/format';
import { askConfirm } from '@/components/Dialogs';
import { BOQ_CATEGORIES, type BoqCategory, type BoqLine, type CostSettings } from '@/lib/types';

type Draft = { id: string | null; item: string; description: string; category: BoqCategory; unit: string; qty: string; unitCost: string };
const blank = (item = ''): Draft => ({ id: null, item, description: '', category: 'Labor', unit: 'lot', qty: '', unitCost: '' });

const PCT_FIELDS: { key: keyof CostSettings; label: string }[] = [
  { key: 'overheadPct', label: 'Overhead (% of direct)' },
  { key: 'contingencyPct', label: 'Contingency (% of direct + OH)' },
  { key: 'insurancePct', label: 'Insurance (%)' },
  { key: 'bondPct', label: 'Bonds (%)' },
  { key: 'warrantyPct', label: 'Warranty reserve (%)' },
  { key: 'markupPct', label: 'Markup / profit (%)' },
  { key: 'vatPct', label: 'VAT (%)' },
];

export default function EstimatingGate() {
  return (
    <ManagerOnly what="Estimating & BOQ">
      <Estimating />
    </ManagerOnly>
  );
}

function Estimating() {
  const { ready, project, upsertBoq, deleteBoq, costSettingsFor, setCostSettings, quotationFor, state, replaceAll } = useStore();
  const { pid, boq } = useProjectData();
  const t = useBoqTotals();
  const [draft, setDraft] = useState<Draft>(blank());
  const [error, setError] = useState<string | null>(null);

  if (!ready) return <Loading />;
  if (!project) return <NoProject />;

  const cs = costSettingsFor(pid);
  const quote = quotationFor(pid);
  const locked = boqLocked(quote);
  const nextItem = () => `1.${String(boq.length + 1).padStart(2, '0')}`;

  const save = () => {
    const qty = Number(draft.qty);
    const cost = Number(draft.unitCost);
    if (!draft.description.trim()) return setError('Description is required.');
    if (!draft.unit.trim()) return setError('Unit is required.');
    if (!Number.isFinite(qty) || qty <= 0) return setError('Quantity must be more than 0.');
    if (!Number.isFinite(cost) || cost < 0) return setError('Unit cost must be 0 or more.');
    const line: BoqLine = { id: draft.id ?? uid('boq'), projectId: pid, item: draft.item.trim() || nextItem(), description: draft.description.trim(), category: draft.category, unit: draft.unit.trim(), qty, unitCost: cost };
    upsertBoq(line);
    setDraft(blank());
    setError(null);
  };

  const setPct = (key: keyof CostSettings, v: string) => {
    const n = Number(v);
    if (v === '' || (Number.isFinite(n) && n >= 0 && n <= 100)) setCostSettings(pid, { ...cs, [key]: v === '' ? 0 : n });
  };


  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Commercial · internal</div>
          <h1>Estimating &amp; BOQ</h1>
          <p className="lead">Direct costs per line, then each markup as a separate, configurable component. Internal only; clients see the quotation.</p>
        </div>
        <div className="form-actions" style={{ marginTop: 0 }}>
          <DataIO doc={() => IO.boqDoc(state)} capture={() => document.getElementById('boq-card')} importColumns={locked ? undefined : IO.COLS.boq} importSheet="BOQ" onImport={(rows) => asPlan(IO.planBoq(state, rows), replaceAll)} label="BOQ lines" />
          <Link className="btn btn-gold" href="/quotation">Quotation preview →</Link>
        </div>
      </div>
      <ProjectBar>
        <div className="field">
          Quotation status
          <Link href="/quotation" className={`pill ${quote.status === 'Issued' ? 'pill-ok' : quote.status === 'Approved' ? 'pill-ok' : quote.status === 'Submitted' ? 'pill-warn' : ''}`} style={{ minHeight: 42, justifyContent: 'center', textDecoration: 'none' }}>
            {quote.status}
          </Link>
        </div>
      </ProjectBar>

      {locked && <div className="banner">The quotation for this project was issued, so the BOQ is locked. Create a new project or revision to change prices.</div>}
      {!locked && (quote.status === 'Submitted' || quote.status === 'Approved') && (
        <div className="banner">Editing the BOQ or percentages will return the {quote.status.toLowerCase()} quotation to Draft for re-approval.</div>
      )}

      {!locked && (
        <section className="card">
          <div className="card-head"><h2>{draft.id ? 'Edit BOQ line' : 'Add BOQ line'}</h2></div>
          <div className="form-grid">
            <label className="field">Item no.<input className="input" value={draft.item} placeholder={nextItem()} onChange={(e) => setDraft({ ...draft, item: e.target.value })} /></label>
            <label className="field" style={{ gridColumn: 'span 2' }}>Description<input className="input" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="e.g. Rope access technician, 2-person team" /></label>
            <label className="field">Category
              <select className="input" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as BoqCategory })}>
                {BOQ_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label className="field">Unit<input className="input" value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} placeholder="sqm, day, lot" /></label>
            <label className="field">Quantity<input className="input" type="number" min="0" step="any" value={draft.qty} onChange={(e) => setDraft({ ...draft, qty: e.target.value })} /></label>
            <label className="field">Unit cost (₱)<input className="input" type="number" min="0" step="0.01" value={draft.unitCost} onChange={(e) => setDraft({ ...draft, unitCost: e.target.value })} /></label>
          </div>
          {error && <p className="bad" role="alert">{error}</p>}
          <div className="form-actions">
            <button className="btn btn-primary" onClick={save}>{draft.id ? 'Save line' : 'Add line'}</button>
            {draft.id && <button className="btn" onClick={() => setDraft(blank())}>Cancel</button>}
          </div>
        </section>
      )}

      <section className="card" id="boq-card">
        <div className="card-head"><h2>Bill of quantities ({boq.length} lines)</h2><span className="note">Direct cost, before markups</span></div>
        {boq.length === 0 ? <div className="empty">No BOQ lines yet. Enter your own quantities and rates above.</div> : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Item</th><th>Description</th><th>Category</th><th>Unit</th><th className="num">Qty</th><th className="num">Unit cost</th><th className="num">Amount</th>{!locked && <th />}</tr></thead>
              <tbody>
                {boq.map((l) => (
                  <tr key={l.id}>
                    <td>{l.item}</td><td>{l.description}</td><td>{l.category}</td><td>{l.unit}</td>
                    <td className="num">{fmtNum(l.qty)}</td><td className="num">{fmtPHP(l.unitCost)}</td><td className="num">{fmtPHP(lineAmount(l))}</td>
                    {!locked && (
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn btn-sm" onClick={() => setDraft({ id: l.id, item: l.item, description: l.description, category: l.category, unit: l.unit, qty: String(l.qty), unitCost: String(l.unitCost) })}>Edit</button>{' '}
                        <button className="btn btn-sm btn-danger" onClick={() => askConfirm('Delete this BOQ line?').then((ok) => ok && deleteBoq(l.id))}>Delete</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={6}>Total direct cost</td><td className="num">{fmtPHP(t.direct)}</td>{!locked && <td />}</tr></tfoot>
            </table>
          </div>
        )}
      </section>

      <div className="grid two">
        <section className="card">
          <div className="card-head"><h2>Cost components</h2><span className="note">Defaults — confirm rates for each job</span></div>
          <div className="form-grid">
            {PCT_FIELDS.map((f) => (
              <label key={f.key} className="field">{f.label}
                <input className="input" type="number" min="0" max="100" step="0.01" disabled={locked} value={String(cs[f.key])} onChange={(e) => setPct(f.key, e.target.value)} />
              </label>
            ))}
            <label className="field">VAT treatment
              <select className="input" disabled={locked} value={cs.vatMode} onChange={(e) => setCostSettings(pid, { ...cs, vatMode: e.target.value as CostSettings['vatMode'] })}>
                <option value="exclusive">VAT added on top (exclusive)</option>
                <option value="exempt">VAT-exempt / zero-rated</option>
              </select>
            </label>
          </div>
          <p className="note">Contingency is on direct + overhead. Insurance, bonds and warranty are on direct + overhead + contingency. Markup is on total cost.</p>
        </section>

        <section className="card">
          <div className="card-head"><h2>Price build-up</h2></div>
          <div className="kv">
            {BOQ_CATEGORIES.filter((c) => t.byCategory[c]).map((c) => (
              <Fragment key={c}><span className="note">· {c}</span><span className="note">{fmtPHP(t.byCategory[c])}</span></Fragment>
            ))}
            <span>Direct cost</span><span>{fmtPHP(t.direct)}</span>
            <span>Overhead {cs.overheadPct}%</span><span>{fmtPHP(t.overhead)}</span>
            <span>Contingency {cs.contingencyPct}%</span><span>{fmtPHP(t.contingency)}</span>
            <span>Insurance {cs.insurancePct}%</span><span>{fmtPHP(t.insurance)}</span>
            <span>Bonds {cs.bondPct}%</span><span>{fmtPHP(t.bond)}</span>
            <span>Warranty reserve {cs.warrantyPct}%</span><span>{fmtPHP(t.warranty)}</span>
            <span>Markup {cs.markupPct}%</span><span>{fmtPHP(t.markup)}</span>
            <span><b>Selling price ex-VAT</b></span><span><b>{fmtPHP(t.sellingExVat)}</b></span>
            <span>VAT {cs.vatMode === 'exclusive' ? `${cs.vatPct}%` : '(exempt)'}</span><span>{fmtPHP(t.vat)}</span>
            <span className="total">Quotation total</span><span className="total">{fmtPHP(t.total)}</span>
          </div>
          <p className="note">Gross margin on selling price ex-VAT: {t.sellingExVat > 0 ? `${((t.markup / t.sellingExVat) * 100).toFixed(1)}%` : '—'}</p>
        </section>
      </div>
    </>
  );
}
