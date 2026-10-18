'use client';
import Link from 'next/link';
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabaseBrowser } from '@/lib/cloud/browser';
import { CLOUD } from '@/lib/cloud/env';
import { useCloudStatus } from '@/lib/cloud/cloudSync';
import { useStore } from '@/lib/store';
import { askConfirm, notify } from '@/components/Dialogs';
import { projectProgress, todayLocal } from '@/lib/calc';
import { fmtDate, fmtPHP, fmtPct } from '@/lib/format';
import { checkEmail, checkName, PROJECT_CODE_RE } from '@/lib/cloud/validate';

type Tab = 'overview' | 'projects' | 'users' | 'approvals' | 'invitations' | 'client' | 'sync' | 'audit' | 'security';
const TABS: [Tab, string][] = [
  ['overview', 'Overview'], ['projects', 'Projects'], ['users', 'Active users'], ['approvals', 'Pending approvals'], ['invitations', 'Invitations'],
  ['client', 'Client viewer access'], ['sync', 'Synchronization'], ['audit', 'Audit log'], ['security', 'Security settings'],
];

interface Profile { id: string; email: string; full_name: string; job_title: string; global_role: string; status: string; email_verified_at: string | null; approved_at: string | null; password_reset_requested_at: string | null; last_login_at: string | null; created_at: string; status_reason: string | null }
interface Project { id: string; code: string; name: string; reference_no: string; client_name: string; site: string; status: string; start_date: string | null; end_date: string | null; contract_value: number | null; client_portal_enabled: boolean; created_at: string }
interface Member { project_id: string; user_id: string; role: string; can_approve_reports: boolean }
interface Cred { id: string; project_id: string; label: string; created_at: string; expires_at: string | null; revoked_at: string | null; last_used_at: string | null }
interface Audit { id: number; at: string; actor_id: string | null; actor_kind: string; action: string; project_id: string | null; target_type: string | null; target_id: string | null; details: Record<string, unknown> }
interface SyncOp { op_id: string; user_id: string; entity: string; status: string; result: { error?: string }; received_at: string; project_id: string }
interface IntLog { id: number; at: string; status: string; rows_written: number; error: string | null }
interface Content { project_id: string; [k: string]: unknown }

const sb = () => supabaseBrowser()!;
const api = async (url: string, body: unknown) => {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? 'Request failed');
  return j as { message?: string };
};
const when = (s: string | null) => (s ? new Date(s).toLocaleString() : '—');
const Pill = ({ s }: { s: string }) => {
  const tone = ['active', 'approved', 'ok', 'applied'].includes(s) ? 'pill-ok' : ['pending', 'draft', 'conflict', 'skipped'].includes(s) ? 'pill-warn' : ['suspended', 'rejected', 'error', 'archived'].includes(s) ? 'pill-bad' : '';
  return <span className={`pill ${tone}`}>{s}</span>;
};

export default function AdminPage() {
  const cloud = useCloudStatus();
  const [tab, setTab] = useState<Tab>('overview');
  const [data, setData] = useState<{ profiles: Profile[]; projects: Project[]; members: Member[]; creds: Cred[]; audit: Audit[]; ops: SyncOp[]; intlog: IntLog[]; content: Content[]; invites: Record<string, unknown>[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const h = location.hash.slice(1) as Tab;
    if (TABS.some(([t]) => t === h)) setTab(h);
  }, []);
  const go = (t: Tab) => {
    setTab(t);
    history.replaceState(null, '', `#${t}`);
  };

  const load = useCallback(async () => {
    try {
      const [profiles, projects, members, creds, audit, ops, intlog, content, invites] = await Promise.all([
        sb().from('profiles').select('*').order('created_at', { ascending: false }),
        sb().from('projects').select('*').order('code'),
        sb().from('project_memberships').select('project_id, user_id, role, can_approve_reports'),
        sb().from('client_access_credentials').select('id, project_id, label, created_at, expires_at, revoked_at, last_used_at').order('created_at', { ascending: false }),
        sb().from('audit_logs').select('*').order('at', { ascending: false }).limit(300),
        sb().from('sync_operations').select('op_id, user_id, entity, status, result, received_at, project_id').neq('status', 'applied').order('received_at', { ascending: false }).limit(200),
        sb().from('integration_sync_log').select('*').order('at', { ascending: false }).limit(50),
        sb().from('approved_client_content').select('*'),
        sb().from('project_invitations').select('*').order('created_at', { ascending: false }).limit(200),
      ]);
      const firstErr = [profiles, projects, members, creds, audit].find((r) => r.error)?.error;
      if (firstErr) throw firstErr;
      setData({
        profiles: (profiles.data ?? []) as Profile[], projects: (projects.data ?? []) as Project[], members: (members.data ?? []) as Member[], creds: (creds.data ?? []) as Cred[],
        audit: (audit.data ?? []) as Audit[], ops: (ops.data ?? []) as SyncOp[], intlog: (intlog.data ?? []) as IntLog[], content: (content.data ?? []) as Content[], invites: (invites.data ?? []) as Record<string, unknown>[],
      });
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (cloud.auth === 'active' && cloud.profile?.global_role === 'super_admin') void load();
  }, [cloud.auth, cloud.profile, load]);

  if (!CLOUD) return <div className="card">The control panel needs the cloud version (Supabase). This copy runs in device mode.</div>;
  if (cloud.auth === 'checking') return <div className="card note">Checking your access…</div>;
  if (cloud.profile?.global_role !== 'super_admin' || cloud.auth !== 'active')
    return <div className="card">Super Admin access is required. {cloud.auth === 'offline_grace' ? 'Administration needs an internet connection.' : ''}</div>;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Administration</div>
          <h1>Control panel</h1>
          <p className="lead">Projects, accounts, approvals, client access and system health. Every action here is recorded in the audit log.</p>
        </div>
        <button className="btn btn-sm" onClick={() => void load()}>Refresh</button>
      </div>
      <nav className="tabbar" aria-label="Control panel sections">
        {TABS.map(([t, label]) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => go(t)} aria-current={tab === t ? 'page' : undefined}>
            {label}
            {t === 'approvals' && data && data.profiles.filter((p) => p.status === 'pending').length > 0 && <span className="count">{data.profiles.filter((p) => p.status === 'pending').length}</span>}
            {t === 'sync' && data && data.ops.length > 0 && <span className="count">{data.ops.length}</span>}
          </button>
        ))}
      </nav>
      {err && <div className="banner banner-bad">Could not load: {err}</div>}
      {!data ? <div className="card note">Loading…</div> : (
        <>
          {tab === 'overview' && <Overview d={data} go={go} />}
          {tab === 'projects' && <Projects d={data} reload={load} />}
          {tab === 'users' && <Users d={data} reload={load} selfId={cloud.profile!.id} />}
          {tab === 'approvals' && <Approvals d={data} reload={load} />}
          {tab === 'invitations' && <Invitations d={data} reload={load} />}
          {tab === 'client' && <ClientAccess d={data} reload={load} />}
          {tab === 'sync' && <SyncMonitor d={data} reload={load} />}
          {tab === 'audit' && <AuditLog d={data} />}
          {tab === 'security' && <Security />}
        </>
      )}
    </>
  );
}

type D = NonNullable<Parameters<typeof Overview>[0]['d']>;

function Stat({ label, value, sub, onClick }: { label: string; value: ReactNode; sub?: ReactNode; onClick?: () => void }) {
  return (
    <button className="card stat" onClick={onClick} disabled={!onClick}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-val">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </button>
  );
}

function Overview({ d, go }: { d: { profiles: Profile[]; projects: Project[]; members: Member[]; creds: Cred[]; audit: Audit[]; ops: SyncOp[]; intlog: IntLog[]; content: Content[]; invites: Record<string, unknown>[] }; go: (t: Tab) => void }) {
  const { state } = useStore();
  const today = todayLocal();
  const by = (xs: { status: string }[], s: string) => xs.filter((x) => x.status === s).length;
  const liveCreds = d.creds.filter((c) => !c.revoked_at && (!c.expires_at || c.expires_at > new Date().toISOString()));
  const portfolio = d.projects.map((p) => {
    const acts = state.activities.filter((a) => a.projectId === p.id);
    const reps = state.reports.filter((r) => r.projectId === p.id && (r.status ?? 'approved') === 'approved');
    const prog = projectProgress(acts, reps, today);
    const cv = Number(p.contract_value ?? 0);
    return { p, planned: prog.planned, actual: prog.actual, pv: (cv * prog.planned) / 100, ev: (cv * prog.actual) / 100, spi: prog.planned > 0 ? prog.actual / prog.planned : null, acts: acts.length };
  });
  const totals = portfolio.reduce((t, r) => ({ cv: t.cv + Number(r.p.contract_value ?? 0), pv: t.pv + r.pv, ev: t.ev + r.ev }), { cv: 0, pv: 0, ev: 0 });
  return (
    <>
      <section className="grid kpis">
        <Stat label="Projects" value={d.projects.length} sub={`${by(d.projects, 'active')} active · ${by(d.projects, 'archived')} archived · ${by(d.projects, 'suspended')} suspended`} onClick={() => go('projects')} />
        <Stat label="Users" value={d.profiles.length} sub={`${by(d.profiles, 'active')} active · ${by(d.profiles, 'suspended')} suspended · ${by(d.profiles, 'rejected')} rejected`} onClick={() => go('users')} />
        <Stat label="Pending approvals" value={by(d.profiles, 'pending')} sub="Registrations waiting for review" onClick={() => go('approvals')} />
        <Stat label="Active client links" value={liveCreds.length} sub={`${d.projects.filter((p) => p.client_portal_enabled).length} projects with portal on`} onClick={() => go('client')} />
        <Stat label="Sync problems" value={d.ops.length} sub={`${d.ops.filter((o) => o.status === 'conflict').length} conflicts · ${d.ops.filter((o) => o.status === 'rejected').length} rejected`} onClick={() => go('sync')} />
      </section>

      <section className="card">
        <div className="card-head"><h2>Portfolio performance</h2><span className="note">As of {fmtDate(today)} · approved progress only</span></div>
        <div className="kv" style={{ maxWidth: 520, marginBottom: 12 }}>
          <span className="note">Total contract value</span><span>{fmtPHP(totals.cv)}</span>
          <span className="note">Planned value (PV)</span><span>{fmtPHP(totals.pv)}</span>
          <span className="note">Earned value (EV)</span><span>{fmtPHP(totals.ev)}</span>
          <span className="note">Portfolio SPI (EV ÷ PV)</span><span className={totals.pv && totals.ev / totals.pv < 0.9 ? 'bad' : 'ok'}>{totals.pv ? (totals.ev / totals.pv).toFixed(2) : '—'}</span>
        </div>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Project</th><th>Status</th><th className="num">Contract</th><th className="num">Planned</th><th className="num">Actual</th><th className="num">SPI</th><th className="num">Earned value</th></tr></thead>
            <tbody>
              {portfolio.map((r) => (
                <tr key={r.p.id}>
                  <td><b>{r.p.code}</b><div className="note">{r.p.name}</div></td>
                  <td><Pill s={r.p.status} /></td>
                  <td className="num">{fmtPHP(r.p.contract_value)}</td>
                  <td className="num">{r.acts ? fmtPct(r.planned) : '—'}</td>
                  <td className="num">{r.acts ? fmtPct(r.actual) : '—'}</td>
                  <td className={`num ${r.spi != null && r.spi < 0.9 ? 'bad' : r.spi != null && r.spi < 1 ? 'warn' : 'ok'}`}>{r.spi != null ? r.spi.toFixed(2) : '—'}</td>
                  <td className="num">{fmtPHP(r.ev)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">SPI below 1.00 means behind schedule. Earned value = contract value × approved actual progress. Cost performance (CPI) needs actual cost records, which are not captured yet.</p>
      </section>

      <div className="grid two">
        <section className="card">
          <div className="card-head"><h2>Recent sign-ins</h2></div>
          <table className="tbl"><tbody>
            {d.profiles.filter((p) => p.last_login_at).sort((a, b) => (b.last_login_at ?? '').localeCompare(a.last_login_at ?? '')).slice(0, 8).map((p) => (
              <tr key={p.id}><td>{p.full_name || p.email}</td><td className="note">{when(p.last_login_at)}</td></tr>
            ))}
          </tbody></table>
        </section>
        <section className="card">
          <div className="card-head"><h2>Recent administrative and security activity</h2></div>
          <table className="tbl"><tbody>
            {d.audit.filter((a) => !a.action.startsWith('insert:project_reports')).slice(0, 8).map((a) => (
              <tr key={a.id}><td>{a.action}</td><td className="note">{when(a.at)}</td></tr>
            ))}
          </tbody></table>
        </section>
      </div>
    </>
  );
}

function nextCode(projects: Project[]): string {
  const y = new Date().getFullYear();
  const n = projects.map((p) => p.code.match(new RegExp(`^PRJ-${y}-(\\d+)$`))?.[1]).filter(Boolean).map(Number);
  return `PRJ-${y}-${String((n.length ? Math.max(...n) : 0) + 1).padStart(3, '0')}`;
}

function Projects({ d, reload }: { d: D; reload: () => Promise<void> }) {
  const empty = { code: nextCode(d.projects), name: '', reference_no: '', client_name: '', site: '', start_date: '', end_date: '', contract_value: '', status: 'active' };
  const [f, setF] = useState(empty);
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const names = useMemo(() => new Map(d.profiles.map((p) => [p.id, p.full_name || p.email])), [d.profiles]);

  const create = async () => {
    const code = f.code.trim().toUpperCase();
    if (!PROJECT_CODE_RE.test(code)) return notify('Project ID: 3–40 capital letters, digits or dashes, e.g. PRJ-2026-003.');
    if (!f.name.trim()) return notify('Project name is required.');
    const { error } = await sb().from('projects').insert({
      code, name: f.name.trim(), reference_no: f.reference_no.trim(), client_name: f.client_name.trim(), site: f.site.trim(), status: f.status,
      start_date: f.start_date || null, end_date: f.end_date || null, contract_value: f.contract_value === '' ? null : Number(f.contract_value), created_by: (await sb().auth.getUser()).data.user?.id,
    });
    if (error) return notify(error.message.includes('duplicate') ? `${code} already exists.` : error.message);
    notify(`Project ${code} created.`);
    setF({ ...empty, code: nextCode([...d.projects, { code } as Project]) });
    await reload();
  };
  const setStatus = async (p: Project, status: string) => {
    if (!(await askConfirm(`Change ${p.code} to “${status}”? ${status === 'suspended' || status === 'archived' ? 'Members lose access until it is reactivated.' : ''}`, { danger: status !== 'active' }))) return;
    const { error } = await sb().from('projects').update({ status }).eq('id', p.id);
    if (error) return notify(error.message);
    await reload();
  };
  const addMember = async (p: Project, userId: string, role: string) => {
    if (!userId) return;
    const { error } = await sb().from('project_memberships').upsert({ project_id: p.id, user_id: userId, role, can_approve_reports: role === 'project_manager' });
    if (error) return notify(error.message);
    await reload();
  };
  const removeMember = async (m: Member) => {
    if (!(await askConfirm(`Remove ${names.get(m.user_id)} from this project? They lose access immediately.`))) return;
    const { error } = await sb().from('project_memberships').delete().eq('project_id', m.project_id).eq('user_id', m.user_id);
    if (error) return notify(error.message);
    await reload();
  };
  const copy = (t: string) => navigator.clipboard.writeText(t).then(() => notify('Copied.'), () => notify(t));

  const rows = d.projects.filter((p) => !q || `${p.code} ${p.name} ${p.client_name} ${p.reference_no}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <section className="card">
        <div className="card-head"><h2>Create project</h2></div>
        <div className="form-grid">
          <label className="field">Project ID<input className="input" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></label>
          <label className="field" style={{ gridColumn: 'span 2' }}>Project name<input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label className="field">Reference no.<input className="input" value={f.reference_no} onChange={(e) => setF({ ...f, reference_no: e.target.value })} placeholder="e.g. NEAS-Q-2026-001" /></label>
          <label className="field">Client<input className="input" value={f.client_name} onChange={(e) => setF({ ...f, client_name: e.target.value })} /></label>
          <label className="field">Site<input className="input" value={f.site} onChange={(e) => setF({ ...f, site: e.target.value })} /></label>
          <label className="field">Start<input className="input" type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></label>
          <label className="field">Completion<input className="input" type="date" value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></label>
          <label className="field">Contract value (₱)<input className="input" type="number" min="0" step="0.01" value={f.contract_value} onChange={(e) => setF({ ...f, contract_value: e.target.value })} /></label>
          <label className="field">Status<select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="draft">draft</option><option value="active">active</option></select></label>
        </div>
        <div className="form-actions"><button className="btn btn-primary" onClick={create}>Create project</button></div>
      </section>

      <section className="card">
        <div className="card-head"><h2>Projects ({rows.length})</h2><input className="input" style={{ maxWidth: 260 }} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search projects" /></div>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Project</th><th>Client / ref.</th><th>Dates</th><th>Status</th><th>Team</th><th>Client portal</th><th>Actions</th></tr></thead>
            <tbody>
              {rows.map((p) => {
                const team = d.members.filter((m) => m.project_id === p.id);
                return (
                  <Fragment key={p.id}>
                    <tr>
                      <td><b>{p.code}</b><div className="note">{p.name}</div></td>
                      <td>{p.client_name || '—'}<div className="note">{p.reference_no}</div></td>
                      <td className="note">{fmtDate(p.start_date)} – {fmtDate(p.end_date)}</td>
                      <td><Pill s={p.status} /></td>
                      <td>{team.length}</td>
                      <td>{p.client_portal_enabled ? <span className="pill pill-ok">On</span> : <span className="pill">Off</span>}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn btn-sm" onClick={() => setOpen(open === p.id ? null : p.id)}>{open === p.id ? 'Close' : 'Manage'}</button>{' '}
                        {p.status !== 'active' && <button className="btn btn-sm" onClick={() => setStatus(p, 'active')}>Activate</button>}{' '}
                        {p.status === 'active' && <button className="btn btn-sm" onClick={() => setStatus(p, 'suspended')}>Suspend</button>}{' '}
                        {p.status !== 'archived' && <button className="btn btn-sm btn-danger" onClick={() => setStatus(p, 'archived')}>Archive</button>}
                      </td>
                    </tr>
                    {open === p.id && (
                      <tr>
                        <td colSpan={7} style={{ background: '#fbfcfd' }}>
                          <div className="grid two">
                            <div>
                              <h3 className="h3">Team</h3>
                              <table className="tbl"><tbody>
                                {team.map((m) => (
                                  <tr key={m.user_id}><td>{names.get(m.user_id)}</td><td>{m.role === 'project_manager' ? 'Project Manager' : 'Employee'}</td><td><button className="btn btn-sm btn-danger" onClick={() => removeMember(m)}>Remove</button></td></tr>
                                ))}
                                {!team.length && <tr><td className="note">No one assigned yet.</td></tr>}
                              </tbody></table>
                              <AddMember p={p} d={d} onAdd={addMember} />
                            </div>
                            <div>
                              <h3 className="h3">Links</h3>
                              <div className="kv">
                                <span className="note">Team URL</span><span><code>/projects/{p.code}</code> <button className="btn btn-sm" onClick={() => copy(`${location.origin}/projects/${p.code}`)}>Copy</button></span>
                                <span className="note">Client URL</span><span><code>/client/{p.code}</code> <button className="btn btn-sm" onClick={() => copy(`${location.origin}/client/${p.code}`)}>Copy</button></span>
                              </div>
                              <p className="note">A link never grants access by itself: team members must be assigned above, and clients need a valid passcode.</p>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function AddMember({ p, d, onAdd }: { p: Project; d: D; onAdd: (p: Project, userId: string, role: string) => Promise<void> }) {
  const [user, setUser] = useState('');
  const [role, setRole] = useState('employee');
  const candidates = d.profiles.filter((u) => u.status === 'active' && !d.members.some((m) => m.project_id === p.id && m.user_id === u.id));
  return (
    <div className="form-actions">
      <select className="input" style={{ maxWidth: 260 }} value={user} onChange={(e) => setUser(e.target.value)} aria-label="Person">
        <option value="">Add an active user…</option>
        {candidates.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
      </select>
      <select className="input" style={{ maxWidth: 180 }} value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
        <option value="employee">Employee / Technician / Inspector</option>
        <option value="project_manager">Project Manager</option>
      </select>
      <button className="btn btn-sm btn-primary" onClick={() => onAdd(p, user, role).then(() => setUser(''))}>Assign</button>
    </div>
  );
}

function Users({ d, reload, selfId }: { d: D; reload: () => Promise<void>; selfId: string }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const projectsOf = (id: string) => d.members.filter((m) => m.user_id === id).map((m) => d.projects.find((p) => p.id === m.project_id)?.code).filter(Boolean).join(', ');
  const act = async (u: Profile, action: string, confirmText: string, danger = true) => {
    if (!(await askConfirm(confirmText, { danger }))) return;
    try {
      await api(`/api/admin/users/${u.id}`, { action });
      notify('Done.');
      await reload();
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const rows = d.profiles.filter((u) => u.status !== 'pending' && (!status || u.status === status) && (!q || `${u.full_name} ${u.email}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <section className="card">
      <div className="card-head">
        <h2>Users ({rows.length})</h2>
        <div className="form-actions" style={{ marginTop: 0 }}>
          <select className="input" style={{ maxWidth: 160 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter"><option value="">All statuses</option><option>active</option><option>suspended</option><option>rejected</option></select>
          <input className="input" style={{ maxWidth: 240 }} placeholder="Search name or e-mail" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" />
        </div>
      </div>
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>Name / e-mail</th><th>Status</th><th>Role</th><th>Projects</th><th>Last sign-in</th><th>Created</th><th>Password</th><th>Actions</th></tr></thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td><b>{u.full_name || '—'}</b><div className="note">{u.email}{u.email_verified_at ? ' · verified' : ' · not verified'}</div></td>
                <td><Pill s={u.status} />{u.status_reason && <div className="note">{u.status_reason}</div>}</td>
                <td>{u.global_role === 'super_admin' ? 'Super Admin' : 'Staff'}</td>
                <td className="note">{projectsOf(u.id) || '—'}</td>
                <td className="note">{when(u.last_login_at)}</td>
                <td className="note">{fmtDate(u.created_at.slice(0, 10))}</td>
                <td className="note">{u.password_reset_requested_at ? `Link sent ${when(u.password_reset_requested_at)}` : u.last_login_at ? 'Set' : 'Not set'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {u.id !== selfId && u.status === 'active' && <button className="btn btn-sm btn-danger" onClick={() => act(u, 'suspend', `Suspend ${u.email}? They lose access to all projects immediately.`)}>Suspend</button>}{' '}
                  {u.status === 'suspended' && <button className="btn btn-sm" onClick={() => act(u, 'reactivate', `Reactivate ${u.email}?`, false)}>Reactivate</button>}{' '}
                  {u.status === 'active' && <button className="btn btn-sm" onClick={() => act(u, 'reset_password', `Send ${u.email} a password reset link? You will not see their password.`, false)}>Reset password</button>}{' '}
                  {u.id !== selfId && u.status === 'active' && (u.global_role === 'super_admin'
                    ? <button className="btn btn-sm" onClick={() => act(u, 'make_staff', `Remove Super Admin rights from ${u.email}?`)}>Remove admin</button>
                    : <button className="btn btn-sm" onClick={() => act(u, 'make_admin', `Give ${u.email} full Super Admin rights?`)}>Make admin</button>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Approvals({ d, reload }: { d: D; reload: () => Promise<void> }) {
  const pending = d.profiles.filter((p) => p.status === 'pending');
  const review = async (u: Profile, approve: boolean) => {
    const reason = approve ? null : 'Not authorized by NEAS';
    if (!(await askConfirm(approve ? `Approve ${u.email}? They will get a one-time link to set their password. Assign projects afterwards.` : `Reject ${u.email}?`, { danger: !approve }))) return;
    try {
      await api(`/api/admin/registrations/${u.id}`, { action: approve ? 'approve' : 'reject', reason });
      notify(approve ? 'Approved. Password setup link sent.' : 'Rejected.');
      await reload();
    } catch (e) {
      notify((e as Error).message);
    }
  };
  return (
    <section className="card">
      <div className="card-head"><h2>Pending approvals ({pending.length})</h2></div>
      <p className="note" style={{ marginTop: 0 }}>A verified e-mail only proves the person can read that inbox. Confirm they work with NEAS before approving.</p>
      {!pending.length ? <div className="empty">No registrations waiting.</div> : (
        <table className="tbl">
          <thead><tr><th>Name</th><th>E-mail</th><th>E-mail verified</th><th>Requested</th><th /></tr></thead>
          <tbody>
            {pending.map((u) => (
              <tr key={u.id}>
                <td>{u.full_name || '—'}</td><td>{u.email}</td>
                <td>{u.email_verified_at ? <span className="pill pill-ok">Verified</span> : <span className="pill pill-warn">Not yet</span>}</td>
                <td className="note">{when(u.created_at)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-sm btn-primary" onClick={() => review(u, true)}>Approve</button>{' '}
                  <button className="btn btn-sm btn-danger" onClick={() => review(u, false)}>Reject</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Invitations({ d, reload }: { d: D; reload: () => Promise<void> }) {
  const [f, setF] = useState({ fullName: '', email: '', projectId: '', role: 'employee' });
  const send = async () => {
    const n = checkName(f.fullName);
    if (!n.ok) return notify(n.error);
    const e = checkEmail(f.email);
    if (!e.ok) return notify(e.error);
    try {
      const r = await api('/api/admin/invitations', { ...f, fullName: n.name, email: e.email, projectId: f.projectId || undefined });
      notify(r.message ?? 'Invitation sent.');
      setF({ fullName: '', email: '', projectId: f.projectId, role: f.role });
      await reload();
    } catch (x) {
      notify((x as Error).message);
    }
  };
  const revoke = async (id: string) => {
    const { error } = await sb().from('project_invitations').update({ status: 'revoked' }).eq('id', id);
    if (error) return notify(error.message);
    await reload();
  };
  return (
    <>
      <section className="card">
        <div className="card-head"><h2>Invite a person</h2><span className="note">Pre-approved: they set their own password from a single-use link</span></div>
        <div className="form-grid">
          <label className="field">Full name<input className="input" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></label>
          <label className="field">E-mail<input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
          <label className="field">Project<select className="input" value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}><option value="">No project yet</option>{d.projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></label>
          <label className="field">Role<select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="employee">Employee / Technician / Inspector</option><option value="project_manager">Project Manager</option></select></label>
        </div>
        <div className="form-actions"><button className="btn btn-primary" onClick={send}>Send invitation</button></div>
      </section>
      <section className="card">
        <div className="card-head"><h2>Invitations</h2></div>
        <table className="tbl">
          <thead><tr><th>E-mail</th><th>Project</th><th>Role</th><th>Status</th><th>Expires</th><th /></tr></thead>
          <tbody>
            {d.invites.map((i) => (
              <tr key={String(i.id)}>
                <td>{String(i.email)}</td>
                <td>{d.projects.find((p) => p.id === i.project_id)?.code ?? '—'}</td>
                <td>{i.role === 'project_manager' ? 'Project Manager' : 'Employee'}</td>
                <td><Pill s={String(i.status)} /></td>
                <td className="note">{when(String(i.expires_at))}</td>
                <td>{i.status === 'pending' && <button className="btn btn-sm btn-danger" onClick={() => revoke(String(i.id))}>Revoke</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

const VIS: [string, string][] = [
  ['show_overview', 'Project overview'], ['show_milestones', 'Approved milestones'], ['show_progress', 'Overall progress %'], ['show_gantt', 'Gantt chart'],
  ['show_scurve', 'S-curve'], ['show_reports', 'Approved progress reports'], ['show_photos', 'Approved before/after photos'], ['show_documents', 'Approved documents'], ['show_completion', 'Completion status'],
];

function ClientAccess({ d, reload }: { d: D; reload: () => Promise<void> }) {
  const [pid, setPid] = useState(d.projects[0]?.id ?? '');
  const [label, setLabel] = useState('Client representative');
  const [days, setDays] = useState('30');
  const [shown, setShown] = useState<string | null>(null);
  const p = d.projects.find((x) => x.id === pid);
  const content = d.content.find((c) => c.project_id === pid);
  const creds = d.creds.filter((c) => c.project_id === pid);
  const events = d.audit.filter((a) => a.project_id === pid && a.action.startsWith('client:')).slice(0, 20);

  const toggleEnabled = async () => {
    if (!p) return;
    const { error } = await sb().from('projects').update({ client_portal_enabled: !p.client_portal_enabled }).eq('id', p.id);
    if (error) return notify(error.message);
    await reload();
  };
  const create = async (rotate: boolean) => {
    if (!p) return;
    if (rotate && !(await askConfirm('Rotate the passcode? All current client passcodes and sessions for this project stop working.'))) return;
    const expires = days ? new Date(Date.now() + Number(days) * 864e5).toISOString() : null;
    const { data, error } = await sb().rpc('admin_create_client_passcode', { p_project: p.id, p_label: label, p_expires_at: expires, p_revoke_existing: rotate });
    if (error) return notify(error.message);
    setShown(String(data));
    await reload();
  };
  const revoke = async (c: Cred) => {
    if (!(await askConfirm(`Revoke “${c.label}”? Clients using it are signed out.`))) return;
    const { error } = await sb().rpc('admin_revoke_client_passcode', { p_credential: c.id });
    if (error) return notify(error.message);
    await reload();
  };
  const setVis = async (k: string, v: boolean | number) => {
    const { error } = await sb().from('approved_client_content').upsert({ project_id: pid, ...(content ?? {}), [k]: v });
    if (error) return notify(error.message);
    await reload();
  };

  return (
    <>
      <section className="card">
        <div className="form-grid">
          <label className="field">Project<select className="input" value={pid} onChange={(e) => { setPid(e.target.value); setShown(null); }}>{d.projects.map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}</select></label>
          <div className="field">Client portal
            <button className={`btn ${p?.client_portal_enabled ? 'btn-danger' : 'btn-primary'}`} onClick={toggleEnabled}>{p?.client_portal_enabled ? 'Turn off client viewing' : 'Turn on client viewing'}</button>
          </div>
          <div className="field">Client URL<code style={{ padding: '10px 0' }}>/client/{p?.code}</code></div>
        </div>
      </section>

      {shown && (
        <div className="banner" role="status">
          <b>New passcode: </b><code style={{ fontSize: 18, letterSpacing: '.08em' }}>{shown}</code>{' '}
          <button className="btn btn-sm" onClick={() => navigator.clipboard.writeText(shown).then(() => notify('Copied.'), () => undefined)}>Copy</button>
          <div className="note">Shown once. Share it with the client by phone or a separate message from the link. It is stored only as a hash.</div>
        </div>
      )}

      <div className="grid two">
        <section className="card">
          <div className="card-head"><h2>Passcodes</h2></div>
          <div className="form-grid">
            <label className="field">Label<input className="input" value={label} onChange={(e) => setLabel(e.target.value)} /></label>
            <label className="field">Expires after (days)<input className="input" type="number" min="1" value={days} onChange={(e) => setDays(e.target.value)} placeholder="blank = no expiry" /></label>
          </div>
          <div className="form-actions">
            <button className="btn btn-primary" onClick={() => create(false)}>Generate passcode</button>
            <button className="btn" onClick={() => create(true)}>Rotate (revoke all and issue new)</button>
          </div>
          <table className="tbl" style={{ marginTop: 12 }}>
            <thead><tr><th>Label</th><th>Created</th><th>Expires</th><th>Last used</th><th>Status</th><th /></tr></thead>
            <tbody>
              {creds.map((c) => {
                const st = c.revoked_at ? 'revoked' : c.expires_at && c.expires_at < new Date().toISOString() ? 'expired' : 'active';
                return (
                  <tr key={c.id}><td>{c.label}</td><td className="note">{when(c.created_at)}</td><td className="note">{when(c.expires_at)}</td><td className="note">{when(c.last_used_at)}</td><td><Pill s={st} /></td>
                    <td>{st === 'active' && <button className="btn btn-sm btn-danger" onClick={() => revoke(c)}>Revoke</button>}</td></tr>
                );
              })}
              {!creds.length && <tr><td colSpan={6} className="note">No passcodes yet.</td></tr>}
            </tbody>
          </table>
          <p className="note">A passcode works like a key: anyone it is forwarded to can view. For named accountability, invite clients as individual accounts instead.</p>
        </section>

        <section className="card">
          <div className="card-head"><h2>What the client can see</h2><span className="note">Everything else stays hidden</span></div>
          {!content ? <div className="empty">Generate a passcode first to set up client visibility.</div> : (
            <>
              {VIS.map(([k, l]) => (
                <label key={k} className="check-row"><input type="checkbox" checked={!!content[k]} onChange={(e) => setVis(k, e.target.checked)} /> {l}</label>
              ))}
              <label className="field" style={{ marginTop: 10 }}>Session length (hours)
                <input className="input" type="number" min="1" max="72" defaultValue={Number(content.session_hours ?? 8)} onBlur={(e) => setVis('session_hours', Math.min(72, Math.max(1, Number(e.target.value) || 8)))} />
              </label>
              <p className="note">Never shown to clients: BOQ and unit costs, margins, quotations, staff names and contacts, drafts, unapproved reports and photos, internal files.</p>
            </>
          )}
        </section>
      </div>

      <section className="card">
        <div className="card-head"><h2>Client access log</h2></div>
        <table className="tbl"><tbody>
          {events.map((a) => <tr key={a.id}><td>{a.action.replace('client:', '')}</td><td className="note">{when(a.at)}</td></tr>)}
          {!events.length && <tr><td className="note">No client activity yet.</td></tr>}
        </tbody></table>
      </section>
    </>
  );
}

function SyncMonitor({ d, reload }: { d: D; reload: () => Promise<void> }) {
  const names = new Map(d.profiles.map((p) => [p.id, p.full_name || p.email]));
  const runSheets = async () => {
    try {
      const r = await api('/api/integrations/sheets', {});
      notify(r.message ?? 'Google Sheet updated.');
      await reload();
    } catch (e) {
      notify((e as Error).message);
    }
  };
  return (
    <>
      <section className="card">
        <div className="card-head"><h2>Offline sync problems</h2><span className="note">Conflicts and refused changes from field devices</span></div>
        {!d.ops.length ? <div className="empty">No sync problems.</div> : (
          <div className="table-wrap"><table className="tbl">
            <thead><tr><th>When</th><th>Person</th><th>Project</th><th>Record type</th><th>Status</th><th>Reason</th></tr></thead>
            <tbody>
              {d.ops.map((o) => (
                <tr key={o.op_id}><td className="note">{when(o.received_at)}</td><td>{names.get(o.user_id)}</td><td>{d.projects.find((p) => p.id === o.project_id)?.code ?? '—'}</td><td>{o.entity}</td><td><Pill s={o.status} /></td><td className="note">{o.result?.error ?? (o.status === 'conflict' ? 'Edited from an older version' : '')}</td></tr>
              ))}
            </tbody>
          </table></div>
        )}
        <p className="note">The person who made the change resolves it on their device (Offline queue). Nothing is discarded automatically.</p>
      </section>
      <section className="card">
        <div className="card-head"><h2>Google Sheets integration</h2><button className="btn btn-sm btn-primary" onClick={runSheets}>Update Google Sheet now</button></div>
        <table className="tbl">
          <thead><tr><th>When</th><th>Status</th><th className="num">Rows</th><th>Error</th></tr></thead>
          <tbody>
            {d.intlog.map((l) => <tr key={l.id}><td className="note">{when(l.at)}</td><td><Pill s={l.status} /></td><td className="num">{l.rows_written}</td><td className="note">{l.error ?? ''}</td></tr>)}
            {!d.intlog.length && <tr><td colSpan={4} className="note">No runs yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}

function AuditLog({ d }: { d: D }) {
  const [q, setQ] = useState('');
  const names = new Map(d.profiles.map((p) => [p.id, p.full_name || p.email]));
  const rows = d.audit.filter((a) => !q || `${a.action} ${a.target_type} ${JSON.stringify(a.details)}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <section className="card">
      <div className="card-head"><h2>Audit log (latest {d.audit.length})</h2><input className="input" style={{ maxWidth: 260 }} placeholder="Filter" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter audit log" /></div>
      <div className="table-wrap"><table className="tbl">
        <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Project</th><th>Details</th></tr></thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}>
              <td className="note" style={{ whiteSpace: 'nowrap' }}>{when(a.at)}</td>
              <td>{a.actor_kind === 'client' ? 'Client (passcode)' : a.actor_kind === 'system' ? 'System' : names.get(a.actor_id ?? '') ?? '—'}</td>
              <td>{a.action}</td>
              <td>{d.projects.find((p) => p.id === a.project_id)?.code ?? ''}</td>
              <td className="note audit-details">{Object.keys(a.details ?? {}).length ? JSON.stringify(a.details).slice(0, 220) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </section>
  );
}

function Security() {
  return (
    <section className="card">
      <div className="card-head"><h2>Security settings in effect</h2></div>
      <table className="tbl"><tbody>
        <tr><td>Data access</td><td>Enforced in the database (Row Level Security) by project membership and role. Hiding a button is never the only control.</td></tr>
        <tr><td>Registration</td><td>Verified e-mail + Super Admin approval. Disposable inboxes refused. Responses never reveal whether an e-mail is registered.</td></tr>
        <tr><td>Passwords</td><td>Set by the user from a single-use, expiring link; at least 12 characters. Administrators can send a reset link but never see a password.</td></tr>
        <tr><td>Suspension</td><td>Takes effect immediately for all data; sign-in and token refresh are blocked. Queued offline changes from a suspended user are refused and kept for review.</td></tr>
        <tr><td>Client portal</td><td>Passcode checked on the server, stored only as a bcrypt hash; 5 failed tries per address lock it for 15 minutes; sessions expire and end on rotation or revocation.</td></tr>
        <tr><td>Offline use</td><td>Signed-in users can keep working offline for the configured grace period; sign-in, approvals and resets need a connection.</td></tr>
        <tr><td>Recommended next</td><td>Turn on multi-factor authentication for Super Admins in Supabase Auth, and Supabase leaked-password protection. <Link href="https://supabase.com/docs/guides/auth/auth-mfa" target="_blank">MFA guide</Link></td></tr>
      </tbody></table>
    </section>
  );
}
