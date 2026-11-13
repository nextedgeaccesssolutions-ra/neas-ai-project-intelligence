'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import DataIO from '@/components/DataIO';
import * as IO from '@/lib/moduleIO';
import { ManagerOnly } from '@/components/RoleGate';
import ProjectBar, { Loading, NoProject } from '@/components/ProjectBar';
import { useProjectData, useStore } from '@/lib/store';
import { addDays, quoteFigures, todayLocal } from '@/lib/calc';
import { approveQuote, issueQuote, returnToDraft, submitQuote, WorkflowError } from '@/lib/quote';
import { fmtDate, fmtNum, fmtPHP } from '@/lib/format';
import { askConfirm, IS_ARTIFACT } from '@/components/Dialogs';
import type { QuoteStatus } from '@/lib/types';

const FLOW: QuoteStatus[] = ['Draft', 'Submitted', 'Approved', 'Issued'];

export default function QuotationPageGate() {
  return (
    <ManagerOnly what="The quotation">
      <QuotationPage />
    </ManagerOnly>
  );
}

function QuotationPage() {
  const { ready, project, state, costSettingsFor, quotationFor, setQuotation, setUserName } = useStore();
  const { pid, boq } = useProjectData();
  const [error, setError] = useState<string | null>(null);
  const cs = costSettingsFor(pid);
  const f = useMemo(() => quoteFigures(boq, cs), [boq, cs]);

  if (!ready) return <Loading />;
  if (!project) return <NoProject />;

  const q = quotationFor(pid);
  const who = state.userName.trim();
  const now = () => new Date().toISOString();
  const run = (fn: () => void) => {
    try {
      if (!who) throw new WorkflowError('Enter your name first, so the approval trail shows who acted.');
      fn();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const idx = FLOW.indexOf(q.status);
  const official = q.status === 'Approved' || q.status === 'Issued';
  const date = q.issuedAt ? todayLocal(new Date(q.issuedAt)) : todayLocal();

  return (
    <>
      <div className="page-head no-print">
        <div>
          <div className="eyebrow">Commercial · client-facing</div>
          <h1>Quotation preview</h1>
          <p className="lead">Prices come from the BOQ with all markups built into the unit prices. Internal costs and margins are not shown.</p>
        </div>
        <div className="form-actions" style={{ marginTop: 0 }}>
          <DataIO doc={() => IO.quotationDoc(state)} capture={() => document.querySelector('.paper')} />
          <Link className="btn btn-sm" href="/estimating">← Edit BOQ</Link>
          {!IS_ARTIFACT && <button className="btn btn-primary" onClick={() => window.print()} disabled={!boq.length}>Print / save PDF</button>}
        </div>
      </div>
      <div className="no-print"><ProjectBar /></div>

      <section className="card no-print">
        <div className="card-head">
          <h2>Approval workflow</h2>
          <div className="steps">
            {FLOW.map((s, i) => <span key={s} className={`step ${i < idx ? 'done' : i === idx ? 'on' : ''}`}>{s}</span>)}
          </div>
        </div>
        <div className="form-grid">
          <label className="field">Your name (recorded on each action)
            <input className="input" value={state.userName} onChange={(e) => setUserName(e.target.value)} placeholder="e.g. J. Dela Cruz" />
          </label>
          <label className="field">Validity (days)
            <input className="input" type="number" min="1" disabled={q.status !== 'Draft'} value={q.validityDays} onChange={(e) => setQuotation({ ...q, validityDays: Math.max(1, Number(e.target.value) || 1) })} />
          </label>
          <label className="field" style={{ gridColumn: 'span 2' }}>Terms
            <input className="input" disabled={q.status !== 'Draft'} value={q.terms} onChange={(e) => setQuotation({ ...q, terms: e.target.value })} />
          </label>
        </div>
        {error && <p className="bad" role="alert">{error}</p>}
        <div className="form-actions">
          {q.status === 'Draft' && <button className="btn btn-primary" onClick={() => run(() => setQuotation(submitQuote(q, who, now(), f.total)))}>Submit for approval</button>}
          {q.status === 'Submitted' && <button className="btn btn-gold" onClick={() => run(() => setQuotation(approveQuote(q, who, now(), f.total)))}>Approve {fmtPHP(f.total)}</button>}
          {q.status === 'Approved' && <button className="btn btn-primary" onClick={async () => { if (await askConfirm('Issue this quotation to the client? It will be locked.', { danger: false })) run(() => setQuotation(issueQuote(q, who, now(), f.total))); }}>Issue to client</button>}
          {(q.status === 'Submitted' || q.status === 'Approved') && <button className="btn" onClick={() => run(() => setQuotation(returnToDraft(q, who, now(), 'manual')))}>Return to draft</button>}
        </div>
        <p className="note">Approval is recorded on this device only. Enforced, role-based approval needs the signed-in cloud version.</p>
      </section>

      <article className="paper">
        <div className="hdr">
          <div>
            <div className="eyebrow">NextEdge Access Solutions</div>
            <h1>Quotation {q.number}</h1>
            <div className="note">Date {fmtDate(date)} · Valid until {fmtDate(addDays(date, q.validityDays))}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            {!official ? <span className="watermark">DRAFT — NOT FOR ISSUE</span> : <span className="pill pill-ok">{q.status}</span>}
            <div className="note" style={{ marginTop: 8 }}>{q.approvedBy ? `Approved by ${q.approvedBy}` : 'Not yet approved'}</div>
          </div>
        </div>
        <p><b>Project:</b> {project.name} ({project.id})<br /><b>Client:</b> {project.client || '—'}<br /><b>Site:</b> {project.site || '—'}</p>
        {f.lines.length === 0 ? <div className="empty">No BOQ lines. <Link href="/estimating">Add them in Estimating &amp; BOQ</Link>.</div> : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Item</th><th>Description</th><th>Unit</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {f.lines.map((l) => (
                  <tr key={l.id}><td>{l.item}</td><td>{l.description}</td><td>{l.unit}</td><td className="num">{fmtNum(l.qty)}</td><td className="num">{fmtPHP(l.unitPrice)}</td><td className="num">{fmtPHP(l.amount)}</td></tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={5}>Subtotal (VAT-exclusive)</td><td className="num">{fmtPHP(f.subtotal)}</td></tr>
                <tr><td colSpan={5}>{cs.vatMode === 'exclusive' ? `VAT ${cs.vatPct}%` : 'VAT (exempt / zero-rated)'}</td><td className="num">{fmtPHP(f.vat)}</td></tr>
                <tr><td colSpan={5} style={{ fontSize: 16 }}>Total amount</td><td className="num" style={{ fontSize: 16 }}>{fmtPHP(f.total)}</td></tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="note"><b>Terms:</b> {q.terms}</p>
      </article>

      <section className="card no-print">
        <div className="card-head"><h2>Approval trail</h2></div>
        <table className="tbl">
          <thead><tr><th>When</th><th>Action</th><th>By</th></tr></thead>
          <tbody>{q.history.slice().reverse().map((h, i) => <tr key={i}><td className="note">{new Date(h.at).toLocaleString()}</td><td>{h.action}</td><td>{h.by}</td></tr>)}</tbody>
        </table>
      </section>
    </>
  );
}
