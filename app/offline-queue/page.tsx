'use client';
import { useEffect, useState } from 'react';
import { allOps, discardOp, onOutboxChange, resolveConflict, retryOp, type Operation } from '@/lib/offline/outbox';
import { applyServerRecord, syncNow, useCloudStatus } from '@/lib/cloud/cloudSync';
import { CLOUD } from '@/lib/cloud/env';
import { askConfirm, notify } from '@/components/Dialogs';

const LABEL: Record<string, string> = { activities: 'Schedule activity', project_reports: 'Report', report_attachments: 'Photo / document', boq_lines: 'BOQ line', cost_settings: 'Cost settings', quotations: 'Quotation' };
const STATUS: Record<string, [string, string]> = { pending: ['Pending sync', 'pill-warn'], syncing: ['Syncing', ''], conflict: ['Conflict detected', 'pill-bad'], rejected: ['Sync error', 'pill-bad'] };

export default function OfflineQueue() {
  const c = useCloudStatus();
  const [ops, setOps] = useState<Operation[]>([]);
  useEffect(() => {
    const load = () => void allOps().then((o) => setOps(o.sort((a, b) => a.seq - b.seq)));
    load();
    return onOutboxChange(load);
  }, []);

  if (!CLOUD) return <div className="card">The offline queue is part of the cloud version. In device mode every change is saved on this device immediately.</div>;

  const summary = (o: Operation) => {
    const p = o.payload as Record<string, unknown>;
    return String(p.name ?? p.description ?? p.caption ?? (p.report_date ? `${p.report_date} · ${p.actual_pct ?? ''}%` : '') ?? '');
  };
  const keepMine = async (o: Operation) => { await resolveConflict(o.op_id, 'mine'); void syncNow(); };
  const useServer = async (o: Operation) => {
    if (!(await askConfirm('Replace your version with the one on the server? Your offline edit to this record will be discarded.'))) return;
    applyServerRecord(o);
    await resolveConflict(o.op_id, 'server');
  };
  const discard = async (o: Operation) => {
    if (!(await askConfirm('Discard this change permanently? It has not reached the server.'))) return;
    await discardOp(o.op_id);
    notify('Discarded.');
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Field operations</div>
          <h1>Offline queue</h1>
          <p className="lead">Changes made on this device that have not reached the server yet. They survive refreshes and restarts and are sent automatically when you are online.</p>
        </div>
        <button className="btn btn-primary" onClick={() => void syncNow()} disabled={!c.online || c.syncing}>{c.syncing ? 'Syncing…' : 'Sync now'}</button>
      </div>
      <section className="grid kpis">
        <div className="card"><div className="kpi-label">Connection</div><div className="kpi-val">{c.online ? 'Online' : 'Offline'}</div><div className="kpi-sub">{c.lastSyncAt ? `Last sync ${new Date(c.lastSyncAt).toLocaleTimeString()}` : 'Not synced yet'}</div></div>
        <div className="card"><div className="kpi-label">Pending sync</div><div className="kpi-val">{c.pending}</div></div>
        <div className="card"><div className="kpi-label">Conflicts</div><div className={`kpi-val ${c.conflicts ? 'bad' : ''}`}>{c.conflicts}</div></div>
        <div className="card"><div className="kpi-label">Sync errors</div><div className={`kpi-val ${c.rejected ? 'bad' : ''}`}>{c.rejected}</div></div>
      </section>
      {c.error && <div className="banner">{c.error}</div>}
      <section className="card">
        {!ops.length ? <div className="empty">Everything is synchronized.</div> : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Saved</th><th>Change</th><th>Details</th><th>Status</th><th>Tries</th><th>Actions</th></tr></thead>
              <tbody>
                {ops.map((o) => {
                  const [label, tone] = STATUS[o.status];
                  return (
                    <tr key={o.op_id}>
                      <td className="note">{new Date(o.created_at).toLocaleString()}</td>
                      <td>{o.op === 'delete' ? 'Delete ' : ''}{LABEL[o.entity] ?? o.entity}</td>
                      <td className="note">{summary(o)}{o.error && <div className={o.status === 'pending' ? 'note' : 'bad'}>{o.error}</div>}</td>
                      <td><span className={`pill ${tone}`}>{label}</span></td>
                      <td className="num">{o.attempts}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {o.status === 'conflict' && <><button className="btn btn-sm btn-primary" onClick={() => keepMine(o)}>Keep mine</button>{' '}<button className="btn btn-sm" onClick={() => useServer(o)}>Use server version</button>{' '}</>}
                        {o.status === 'rejected' && <><button className="btn btn-sm" onClick={() => retryOp(o.op_id).then(() => syncNow())}>Retry</button>{' '}</>}
                        {(o.status === 'rejected' || o.status === 'conflict') && <button className="btn btn-sm btn-danger" onClick={() => discard(o)}>Discard</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="note">“Keep mine” re-sends your version on top of the newer server copy. “Use server version” replaces your edit. Refused changes (for example after access was removed) stay here until you retry or discard them.</p>
      </section>
    </>
  );
}
