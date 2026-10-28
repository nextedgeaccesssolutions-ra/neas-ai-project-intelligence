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
import DataIO from '@/components/DataIO';
import { askPin, isPinRequired, withPin } from '@/components/PinPrompt';
import { useOrgList } from '@/components/OrgList';
import { ALWAYS_VIEWS, CLIENT_VIEWS, isClientViews, VIEWS } from '@/lib/cloud/cloudSync';

type Tab = 'overview' | 'projects' | 'users' | 'approvals' | 'invitations' | 'client' | 'sync' | 'recovery' | 'audit' | 'security';
const TABS: [Tab, string][] = [
  ['overview', 'Overview'], ['projects', 'Projects'], ['users', 'User directory'], ['approvals', 'Pending approvals'], ['invitations', 'Invitations'],
  ['client', 'Client viewer access'], ['sync', 'Synchronization'], ['recovery', 'Data recovery'], ['audit', 'Audit log'], ['security', 'Security settings'],
];

interface Profile { id: string; email: string; full_name: string; job_title: string; global_role: string; status: string; email_verified_at: string | null; approved_at: string | null; approved_by: string | null; password_set_at: string | null; password_reset_requested_at: string | null; sessions_revoked_at: string | null; allowed_views: string[] | null; username?: string | null; pin_locked_at?: string | null; is_client?: boolean; last_login_at: string | null; created_at: string; status_reason: string | null; deleted_at?: string | null }
interface Project { id: string; code: string; name: string; reference_no: string; client_name: string; site: string; status: string; start_date: string | null; end_date: string | null; contract_value: number | null; client_portal_enabled: boolean; created_at: string; deleted_at?: string | null }
interface Member { project_id: string; user_id: string; role: string; can_approve_reports: boolean }
interface Cred { id: string; project_id: string; label: string; username?: string | null; created_at: string; expires_at: string | null; revoked_at: string | null; last_used_at: string | null; max_uses: number | null; use_count: number }
interface Audit { id: number; at: string; actor_id: string | null; actor_kind: string; action: string; project_id: string | null; target_type: string | null; target_id: string | null; details: Record<string, unknown> }
interface SyncOp { op_id: string; user_id: string; entity: string; status: string; result: { error?: string }; received_at: string; project_id: string; record_id: string; op: string }
interface IntLog { id: number; at: string; status: string; rows_written: number; error: string | null }
interface Content { project_id: string; [k: string]: unknown }

const sb = () => supabaseBrowser()!;
const api = async (url: string, body: unknown, retried = false): Promise<{ message?: string }> => {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  // sensitive changes need the PIN again: ask once, then retry
  if (!r.ok && !retried && isPinRequired(j.error) && (await askPin())) return api(url, body, true);
  if (!r.ok) throw new Error(j.error ?? 'Request failed');
  return j as { message?: string };
};
const EVENT: Record<string, string> = {
  'auth:login': 'Signed in', 'auth:login_blocked': 'Sign-in refused (not approved)', 'account:views_changed': 'Module access changed', 'account:setup_code_issued': 'One-time code issued', 'account:setup_code_used': 'Activated with one-time code', 'account:setup_code_failed': 'Wrong or expired one-time code', 'account:owner_bootstrapped': 'Owner account made Super Admin', 'account:password_set': 'Password set', 'account:password_reset_sent': 'Password reset link sent',
  'account:sessions_revoked': 'Signed out everywhere', 'account:registration_requested': 'Registered (waiting for approval)',
  'account:invited_user_created': 'Joined from invitation', 'insert:project_memberships': 'Project access granted',
  'update:project_memberships': 'Project role changed', 'delete:project_memberships': 'Project access removed',
  'update:profiles': 'Account updated (status, role or approval)', 'insert:profiles': 'Account created',
  'account:deleted': 'Account deleted (reversible)',
  'recovery:dry_run': 'Data recovery dry run', 'recovery:applied': 'Data recovery applied', 'recovery:rolled_back': 'Data recovery rolled back',
  'client:login': 'Client portal sign-in', 'client:login_failed': 'Client portal: wrong passcode', 'client:login_throttled': 'Client portal locked after failed tries', 'system:legacy_import': 'Imported from the old app',
};
const eventLabel = (a: string) => EVENT[a] ?? a.replace(':', ' · ').replace(/_/g, ' ');
const when = (s: string | null) => (s ? new Date(s).toLocaleString() : '—');
const Pill = ({ s }: { s: string }) => {
  const tone = ['active', 'approved', 'ok', 'applied'].includes(s) ? 'pill-ok' : ['pending', 'draft', 'conflict', 'skipped'].includes(s) ? 'pill-warn' : ['suspended', 'rejected', 'error', 'archived', 'deleted'].includes(s) ? 'pill-bad' : '';
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
        sb().from('client_access_credentials').select('id, project_id, label, username, created_at, expires_at, revoked_at, last_used_at, max_uses, use_count').order('created_at', { ascending: false }),
        sb().from('audit_logs').select('*').order('at', { ascending: false }).limit(300),
        sb().from('sync_operations').select('op_id, user_id, entity, status, result, received_at, project_id, record_id, op').eq('status', 'rejected').is('resolved_at', null).order('received_at', { ascending: false }).limit(200),
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
        <div className="form-actions" style={{ marginTop: 0 }}>
          <Link className="btn btn-sm btn-primary" href="/reports">Preview reports</Link>
          <button className="btn btn-sm" onClick={() => void load()}>Refresh</button>
        </div>
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
          {tab === 'users' && <Users d={data} reload={load} selfId={cloud.profile!.id} go={go} />}
          {tab === 'approvals' && <Approvals d={data} reload={load} />}
          {tab === 'invitations' && <Invitations d={data} reload={load} />}
          {tab === 'client' && <ClientAccess d={data} reload={load} />}
          {tab === 'sync' && <SyncMonitor d={data} reload={load} />}
          {tab === 'recovery' && <Recovery d={data} />}
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
    const prog = projectProgress(acts, reps, today, (id) => state.calendars?.[id]);
    const cv = Number(p.contract_value ?? 0);
    return { p, planned: prog.planned, actual: prog.actual, pv: (cv * prog.planned) / 100, ev: (cv * prog.actual) / 100, spi: prog.planned > 0 ? prog.actual / prog.planned : null, acts: acts.length };
  });
  const o = useOrgList({ list: 'projects', kind: 'project', items: portfolio, id: (r) => r.p.id, project: (r) => r.p.id, noun: 'project' });
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
        {o.toolbar}
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th className="pick-col">{o.headerCheckbox}</th><th>Project</th><th>Status</th><th className="num">Contract</th><th className="num">Planned</th><th className="num">Actual</th><th className="num">SPI</th><th className="num">Earned value</th></tr></thead>
              {o.tbodies((r) => (
                <tr>
                  <td className="pick-col">{o.checkbox(r)}</td>
                  <td><b>{r.p.code}</b><div className="note">{r.p.name}</div></td>
                  <td><Pill s={r.p.status} /></td>
                  <td className="num">{fmtPHP(r.p.contract_value)}</td>
                  <td className="num">{r.acts ? fmtPct(r.planned) : '—'}</td>
                  <td className="num">{r.acts ? fmtPct(r.actual) : '—'}</td>
                  <td className={`num ${r.spi != null && r.spi < 0.9 ? 'bad' : r.spi != null && r.spi < 1 ? 'warn' : 'ok'}`}>{r.spi != null ? r.spi.toFixed(2) : '—'}</td>
                  <td className="num">{fmtPHP(r.ev)}</td>
                </tr>
              ), 8)}
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
  const [codeEdit, setCodeEdit] = useState<{ id: string; value: string } | null>(null);
  const saveCode = async (p: Project) => {
    if (!codeEdit) return;
    const code = codeEdit.value.trim().toUpperCase();
    if (code === p.code) return setCodeEdit(null);
    if (!PROJECT_CODE_RE.test(code)) return notify('Project ID: 3–40 capital letters, digits or dashes, e.g. PRJ-2026-003.');
    if (!(await askConfirm(`Change ${p.code} to ${code}? Team and client links, QR codes and shared bookmarks that use ${p.code} stop working; clients sign in with ${code} from now on.`))) return;
    const { error } = await withPin(() => sb().from('projects').update({ code }).eq('id', p.id));
    if (error) return notify(error.message.includes('duplicate') ? `${code} already exists.` : error.message);
    notify(`Project ID changed to ${code}.`);
    setCodeEdit(null);
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
    const { error } = await withPin(() => sb().from('project_memberships').upsert({ project_id: p.id, user_id: userId, role, can_approve_reports: role === 'project_manager' }));
    if (error) return notify(error.message);
    await reload();
  };
  const removeMember = async (m: Member) => {
    if (!(await askConfirm(`Remove ${names.get(m.user_id)} from this project? They lose access immediately.`))) return;
    const { error } = await withPin(() => sb().from('project_memberships').delete().eq('project_id', m.project_id).eq('user_id', m.user_id));
    if (error) return notify(error.message);
    await reload();
  };
  const copy = (t: string) => navigator.clipboard.writeText(t).then(() => notify('Copied.'), () => notify(t));
  // deleting hides an archived project everywhere and closes its client portal; its records stay and it can be restored
  const removeProject = async (p: Project) => {
    if (!(await askConfirm(`Delete ${p.code}? It disappears from every list and its client portal closes. Its reports, photos and history are kept, and you can restore it from “Show deleted”.`, { danger: true }))) return;
    const { error } = await withPin(() => sb().from('projects').update({ deleted_at: new Date().toISOString(), client_portal_enabled: false }).eq('id', p.id));
    if (error) return notify(error.message);
    notify(`${p.code} deleted.`);
    await reload();
  };
  const restoreProject = async (p: Project) => {
    const { error } = await withPin(() => sb().from('projects').update({ deleted_at: null }).eq('id', p.id));
    if (error) return notify(error.message);
    notify(`${p.code} restored (still archived).`);
    await reload();
  };
  const [showDeleted, setShowDeleted] = useState(false);
  const deletedCount = d.projects.filter((p) => p.deleted_at).length;

  const rows = d.projects.filter((p) => !!p.deleted_at === showDeleted).filter((p) => !q || `${p.code} ${p.name} ${p.client_name} ${p.reference_no}`.toLowerCase().includes(q.toLowerCase()));
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
        <div className="card-head"><h2>{showDeleted ? 'Deleted projects' : 'Projects'} ({rows.length})</h2>{(deletedCount > 0 || showDeleted) && <button className="btn btn-sm" onClick={() => setShowDeleted(!showDeleted)}>{showDeleted ? 'Back to projects' : `Show deleted (${deletedCount})`}</button>}<input className="input" style={{ maxWidth: 260 }} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search projects" /></div>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Project</th><th>Client / ref.</th><th>Dates</th><th>Status</th><th>Team</th><th>Client portal</th><th>Actions</th></tr></thead>
            <tbody>
              {rows.map((p) => {
                const team = d.members.filter((m) => m.project_id === p.id);
                return (
                  <Fragment key={p.id}>
                    <tr>
                      <td>
                        {codeEdit?.id === p.id ? (
                          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                            <input className="input" style={{ maxWidth: 180 }} value={codeEdit.value} autoFocus aria-label="Project ID"
                              onChange={(e) => setCodeEdit({ id: p.id, value: e.target.value.toUpperCase() })}
                              onKeyDown={(e) => { if (e.key === 'Enter') void saveCode(p); if (e.key === 'Escape') setCodeEdit(null); }} />
                            <button className="btn btn-sm btn-primary" onClick={() => saveCode(p)}>Save</button>
                            <button className="btn btn-sm" onClick={() => setCodeEdit(null)}>Cancel</button>
                          </span>
                        ) : (
                          <><b>{p.code}</b> <button className="btn btn-sm" title="Edit project ID" onClick={() => setCodeEdit({ id: p.id, value: p.code })}>Edit</button></>
                        )}
                        <div className="note">{p.name}</div>
                      </td>
                      <td>{p.client_name || '—'}<div className="note">{p.reference_no}</div></td>
                      <td className="note">{fmtDate(p.start_date)} – {fmtDate(p.end_date)}</td>
                      <td><Pill s={p.status} /></td>
                      <td>{team.length}</td>
                      <td>{p.client_portal_enabled ? <span className="pill pill-ok">On</span> : <span className="pill">Off</span>}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn btn-sm" onClick={() => setOpen(open === p.id ? null : p.id)}>{open === p.id ? 'Close' : 'Manage'}</button>{' '}
                        {p.deleted_at ? <button className="btn btn-sm" onClick={() => restoreProject(p)}>Restore</button> : <>
                        {p.status !== 'active' && <button className="btn btn-sm" onClick={() => setStatus(p, 'active')}>Activate</button>}{' '}
                        {p.status === 'active' && <button className="btn btn-sm" onClick={() => setStatus(p, 'suspended')}>Suspend</button>}{' '}
                        {p.status !== 'archived' && <button className="btn btn-sm btn-danger" onClick={() => setStatus(p, 'archived')}>Archive</button>}
                        {p.status === 'archived' && <button className="btn btn-sm btn-danger" onClick={() => removeProject(p)}>Delete</button>}</>}
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

// ---------- User directory ----------
const approvalOf = (u: Profile) => (u.status === 'pending' ? 'Waiting for approval' : u.status === 'rejected' ? 'Rejected' : u.approved_at ? `Approved ${fmtDate(u.approved_at.slice(0, 10))}` : 'Approved');
const passwordOf = (u: Profile) => (u.password_set_at ? `Set ${fmtDate(u.password_set_at.slice(0, 10))}` : u.last_login_at ? 'Set (before tracking)' : 'Not set yet');
const resetOf = (u: Profile) => {
  if (!u.password_reset_requested_at) return '—';
  if (u.password_set_at && u.password_set_at > u.password_reset_requested_at) return `Completed ${fmtDate(u.password_set_at.slice(0, 10))}`;
  return `Link sent ${when(u.password_reset_requested_at)} · not used yet`;
};
const roleLabel = (r: string) => (r === 'project_manager' ? 'Project manager' : 'Employee');

function UserAvatar({ name, role }: { name: string; role: string }) {
  const initials = (name || '?').split(/\s+/).map((w) => w[0]?.toUpperCase() ?? '').slice(0, 2).join('');
  return <div className={`user-avatar ${role === 'super_admin' ? 'user-avatar-admin' : 'user-avatar-staff'}`}>{initials}</div>;
}

function UserActionMenu({ u, selfId, onAction, onReview }: { u: Profile; selfId: string; onAction: (u: Profile, action: string, confirmText: string, danger?: boolean, reason?: string) => Promise<void>; onReview: (u: Profile, approve: boolean) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const self = u.id === selfId;
  const close = () => setOpen(false);
  const act = (action: string, text: string, danger = true, reason?: string) => { close(); onAction(u, action, text, danger, reason); };
  return (
    <div className="user-actions-menu">
      <button className="user-actions-btn" onClick={() => setOpen(!open)} aria-label="User actions" aria-expanded={open}>⋮</button>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 25 }} onClick={close} />
          <div className="user-actions-drop">
            {u.status === 'pending' && <><button onClick={() => { close(); onReview(u, true); }}>✓ Approve</button><button className="danger" onClick={() => { close(); onReview(u, false); }}>✕ Reject</button></>}
            {u.status === 'active' && <button onClick={() => act('issue_code', u.username
              ? `Reset the PIN for ${u.full_name || u.email} (@${u.username})? You get a one-time code valid for 24 hours to hand them; they choose a new PIN on the activation page. Their current PIN keeps working until then.`
              : `Issue a one-time code for ${u.full_name || u.email}? They have no username yet, so they can set a new e-mail password with it. To use a PIN, first give them a username (Edit).`, false)}>🔢 Reset PIN / password (one-time code)</button>}
            {u.status === 'active' && <button onClick={() => act('reset_password', `Send ${u.email} a secure password reset link? (Supabase sends only a few per hour.)`, false)}>🔑 Send password reset e-mail</button>}
            {u.status === 'active' && <button onClick={() => act('revoke_sessions', `Sign ${u.email} out on every device?${self ? ' This includes you.' : ''}`, true, 'Revoked by administrator')}>⏏ Sign out everywhere</button>}
            {!self && u.status === 'active' && <button className="danger" onClick={() => act('suspend', `Suspend ${u.email}? They lose access to all projects immediately.`)}>⛔ Suspend</button>}
            {(u.status === 'suspended' || u.status === 'rejected') && <button onClick={() => act('reactivate', `Reactivate ${u.email}?`, false)}>▶ Activate</button>}
            {!self && u.status === 'active' && (u.global_role === 'super_admin'
              ? <button onClick={() => act('make_staff', `Remove Super Admin rights from ${u.email}?`)}>👤 Remove Super Admin</button>
              : <button onClick={() => act('make_admin', `Give ${u.email} full Super Admin rights?`)}>🛡 Make Super Admin</button>)}
          </div>
        </>
      )}
    </div>
  );
}

function Users({ d, reload, selfId, go }: { d: D; reload: () => Promise<void>; selfId: string; go: (t: Tab) => void }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [role, setRole] = useState('');
  const [project, setProject] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editUser, setEditUser] = useState('');
  const [saving, setSaving] = useState(false);
  const [sort, setSort] = useState<'name' | 'status' | 'role' | 'last_login' | 'created'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const code = (id: string) => d.projects.find((p) => p.id === id)?.code ?? '?';
  const membersOf = (id: string) => d.members.filter((m) => m.user_id === id);
  const projectsText = (id: string) => membersOf(id).map((m) => `${code(m.project_id)} (${m.role === 'project_manager' ? 'PM' : 'Employee'})`).join(', ');

  const toggleSort = (col: typeof sort) => {
    if (sort === col) setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    else { setSort(col); setSortDir('asc'); }
  };

  const [resetCode, setResetCode] = useState<{ code: string; expiresAt: string; who: string } | null>(null);
  // Role column: Super Admin uses the existing admin rights actions; Client and Staff set the account's modules
  const changeRole = async (u: Profile, role: string) => {
    const who = u.full_name || u.email;
    const text = role === 'super_admin' ? `Give ${who} full Super Admin rights?`
      : role === 'client' ? `Make ${who} a client account? They will see only reports for their projects.`
      : `Make ${who} staff? ${u.global_role === 'super_admin' ? 'Super Admin rights are removed.' : 'They can use every module (change this under Module access).'}`;
    if (!(await askConfirm(text, { danger: role === 'super_admin' || u.global_role === 'super_admin' }))) return;
    try {
      if (role === 'super_admin') await api(`/api/admin/users/${u.id}`, { action: 'make_admin', hours: 24 });
      else {
        if (u.global_role === 'super_admin') await api(`/api/admin/users/${u.id}`, { action: 'make_staff', hours: 24 });
        const { error } = await withPin(() => sb().rpc('admin_set_client', { p_user: u.id, p_client: role === 'client' }));
        if (error) throw new Error(error.message);
      }
      notify('Role changed. Recorded in the audit log.');
    } catch (e) {
      notify((e as Error).message);
    }
    await reload();
  };
  const act = async (u: Profile, action: string, confirmText: string, danger = true, reason?: string) => {
    if (!(await askConfirm(confirmText, { danger }))) return;
    try {
      const r = (await api(`/api/admin/users/${u.id}`, { action, reason, hours: 24 })) as unknown as { code?: string; expiresAt?: string };
      if (action === 'issue_code' && r.code && r.expiresAt) setResetCode({ code: r.code, expiresAt: r.expiresAt, who: u.full_name || u.email });
      notify('Done. Recorded in the audit log.');
      await reload();
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const review = async (u: Profile, approve: boolean) => {
    if (!(await askConfirm(approve ? `Approve ${u.email}? They get a one-time link to set their own password.` : `Reject ${u.email}?`, { danger: !approve }))) return;
    try {
      await api(`/api/admin/registrations/${u.id}`, { action: approve ? 'approve' : 'reject', reason: approve ? null : 'Not authorized by NEAS' });
      notify(approve ? 'Approved. Password setup link sent.' : 'Rejected.');
      await reload();
    } catch (e) {
      notify((e as Error).message);
    }
  };

  const startEdit = (u: Profile) => { setEditing(u.id); setEditName(u.full_name); setEditTitle(u.job_title ?? ''); setEditUser(u.username ?? ''); setOpen(null); };
  const saveEdit = async (u: Profile) => {
    const n = checkName(editName);
    if (!n.ok) return notify(n.error);
    setSaving(true);
    try {
      await api(`/api/admin/users/${u.id}`, { action: 'update_profile', fullName: n.name, jobTitle: editTitle.trim() });
      if (editUser.trim().toLowerCase() !== (u.username ?? '')) await api(`/api/admin/users/${u.id}`, { action: 'set_username', username: editUser.trim().toLowerCase() });
      notify('Saved. Recorded in the audit log.');
      setEditing(null);
      await reload();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const remove = (u: Profile) => act(u, 'delete',
    `Delete ${u.full_name || u.email}? They are signed out everywhere, can no longer sign in and lose all project access. Their reports and photos are kept, and the account can be restored later with Activate.`,
    true, 'Deleted by administrator');

  const forget = (u: Profile) => act(u, 'delete_forever',
    `Delete ${u.full_name || u.email} forever? Their e-mail and username become free, so you can create a new account with the same details. This cannot be undone. Their past reports and photos stay, shown as "${u.full_name || 'Removed user'} (removed)".`,
    true);

  const ql = q.trim().toLowerCase();
  const filtered = d.profiles.filter((u) =>
    (status === 'deleted' ? !!u.deleted_at : !u.deleted_at && (!status || u.status === status)) &&
    (!role || (role === 'super_admin' ? u.global_role === 'super_admin' : role === 'client' ? u.global_role !== 'super_admin' && !!u.is_client : membersOf(u.id).some((m) => m.role === role))) &&
    (!project || membersOf(u.id).some((m) => m.project_id === project)) &&
    (!ql || `${u.full_name} ${u.email} ${u.job_title} ${projectsText(u.id)}`.toLowerCase().includes(ql)),
  );
  const rows = [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sort === 'name') cmp = (a.full_name || a.email).localeCompare(b.full_name || b.email);
    else if (sort === 'status') cmp = a.status.localeCompare(b.status);
    else if (sort === 'role') cmp = a.global_role.localeCompare(b.global_role);
    else if (sort === 'last_login') cmp = (a.last_login_at ?? '').localeCompare(b.last_login_at ?? '');
    else if (sort === 'created') cmp = a.created_at.localeCompare(b.created_at);
    return sortDir === 'desc' ? -cmp : cmp;
  });

  const totalActive = d.profiles.filter((p) => p.status === 'active').length;
  const totalPending = d.profiles.filter((p) => p.status === 'pending').length;
  const totalAdmins = d.profiles.filter((p) => p.global_role === 'super_admin').length;
  const arrow = (col: typeof sort) => sort === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  const exportDoc = () => ({
    filename: `neas-user-directory-${new Date().toISOString().slice(0, 10)}`,
    title: 'NEAS user directory',
    meta: [['Users', String(rows.length)], ['Exported', new Date().toLocaleString()]] as [string, string][],
    tables: [{
      title: 'Users',
      columns: ['Full name', 'E-mail', 'E-mail verified', 'Account status', 'Approval', 'Global role', 'Projects (role)', 'Last sign-in', 'Created', 'Password', 'Password reset', 'Modules'].map((label) => ({ key: label, label })),
      rows: rows.map((u) => ({
        'Full name': u.full_name, 'E-mail': u.email, 'E-mail verified': u.email_verified_at ? 'Yes' : 'No', 'Account status': u.status, Approval: approvalOf(u),
        'Global role': u.global_role === 'super_admin' ? 'Super Admin' : !!u.is_client ? 'Client' : 'Staff', 'Projects (role)': projectsText(u.id), 'Last sign-in': when(u.last_login_at),
        Created: fmtDate(u.created_at.slice(0, 10)), Password: passwordOf(u), 'Password reset': resetOf(u), Modules: u.global_role === 'super_admin' || !u.allowed_views ? 'All' : u.allowed_views.join(', '),
      })),
    }],
  });

  // active client portal logins are listed too, so every person who can sign in appears in one place
  const portal = (status === 'deleted' || (role && role !== 'client') ? [] : d.creds)
    .filter((c) => c.username && !c.revoked_at && (!c.expires_at || new Date(c.expires_at) > new Date()))
    .filter((c) => !project || c.project_id === project)
    .filter((c) => !ql || `${c.label} ${c.username} ${d.projects.find((p) => p.id === c.project_id)?.code ?? ''}`.toLowerCase().includes(ql));
  return (
    <>
      {resetCode && <CodeReveal code={resetCode.code} expiresAt={resetCode.expiresAt} who={resetCode.who} onClose={() => setResetCode(null)} />}
      <div className="user-stats">
        <div className="user-stat"><div className="user-stat-val">{d.profiles.length}</div><div className="user-stat-label">Total users</div></div>
        <div className="user-stat active-stat"><div className="user-stat-val">{totalActive}</div><div className="user-stat-label">Active</div></div>
        <div className="user-stat pending-stat"><div className="user-stat-val">{totalPending}</div><div className="user-stat-label">Pending approval</div></div>
        <div className="user-stat admin-stat"><div className="user-stat-val">{totalAdmins}</div><div className="user-stat-label">Super Admins</div></div>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>User management</h2>
          <div className="form-actions" style={{ marginTop: 0 }}>
            <DataIO doc={exportDoc} label="users" />
            <button className="btn btn-sm btn-primary" onClick={() => go('invitations')}>+ Invite user</button>
          </div>
        </div>

        <div className="form-grid" style={{ marginBottom: 14 }}>
          <label className="field" style={{ gridColumn: 'span 2' }}>Search<input className="input" placeholder="Name, e-mail, job title or project ID" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" /></label>
          <label className="field">Status<select className="input" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option><option value="active">Active</option><option value="pending">Pending</option><option value="suspended">Suspended</option><option value="rejected">Rejected</option><option value="deleted">Deleted</option></select></label>
          <label className="field">Role<select className="input" value={role} onChange={(e) => setRole(e.target.value)}><option value="">All roles</option><option value="super_admin">Super Admin</option><option value="client">Client</option><option value="project_manager">Project manager</option><option value="employee">Employee</option></select></label>
          <label className="field">Project<select className="input" value={project} onChange={(e) => setProject(e.target.value)}><option value="">All projects</option>{d.projects.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></label>
        </div>

        {(status || role || project || ql) && (
          <div style={{ marginBottom: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="note">{rows.length} of {d.profiles.length} users{portal.length ? ` · ${portal.length} client portal login${portal.length === 1 ? '' : 's'}` : ''}</span>
            <button className="btn btn-sm" onClick={() => { setQ(''); setStatus(''); setRole(''); setProject(''); }}>Clear filters</button>
          </div>
        )}

        <div className="table-wrap">
          <table className="tbl user-tbl">
            <thead><tr>
              <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('name')}>User{arrow('name')}</th>
              <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('status')}>Status{arrow('status')}</th>
              <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('role')}>Role{arrow('role')}</th>
              <th>Projects</th>
              <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('last_login')}>Last active{arrow('last_login')}</th>
              <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('created')}>Joined{arrow('created')}</th>
              <th />
            </tr></thead>
            <tbody>
              {rows.map((u) => (
                <Fragment key={u.id}>
                  <tr style={{ cursor: 'pointer' }} onClick={() => setOpen(open === u.id ? null : u.id)}>
                    <td>
                      <div className="user-name-cell">
                        <UserAvatar name={u.full_name || u.email} role={u.global_role} />
                        <div className="name-wrap">
                          <b>{u.full_name || '—'}</b>
                          <div className="note">{u.email}{u.email_verified_at ? '' : ' · unverified'}</div>
                        </div>
                      </div>
                    </td>
                    <td><Pill s={u.deleted_at ? 'deleted' : u.status} />{u.pin_locked_at && <> <span className="pill pill-bad">PIN locked</span></>}{u.status_reason && <div className="note">{u.status_reason}</div>}{u.username && <div className="note">@{u.username}</div>}</td>
                    <td onClick={(e) => e.stopPropagation()}>{u.id === selfId || u.status !== 'active'
                      ? (u.global_role === 'super_admin' ? <span style={{ fontWeight: 700, color: 'var(--navy)' }}>Super Admin</span> : !!u.is_client ? <span className="pill">Client</span> : 'Staff')
                      : <select className="input" style={{ minWidth: 120 }} aria-label="Account role" value={u.global_role === 'super_admin' ? 'super_admin' : !!u.is_client ? 'client' : 'staff'} onChange={(e) => void changeRole(u, e.target.value)}>
                          <option value="staff">Staff</option><option value="client">Client</option><option value="super_admin">Super Admin</option>
                        </select>}</td>
                    <td className="note">{projectsText(u.id) || '—'}</td>
                    <td className="note">{u.last_login_at ? new Date(u.last_login_at).toLocaleDateString() : 'Never'}</td>
                    <td className="note">{fmtDate(u.created_at.slice(0, 10))}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end' }}>
                        <button className="btn btn-sm" onClick={() => startEdit(u)}>Edit</button>
                        {u.id !== selfId && !u.deleted_at && <button className="btn btn-sm btn-danger" onClick={() => remove(u)}>Delete</button>}
                        {u.deleted_at && !u.email.startsWith('removed-') && <button className="btn btn-sm btn-danger" onClick={() => forget(u)}>Delete forever</button>}
                        <UserActionMenu u={u} selfId={selfId} onAction={act} onReview={review} />
                      </div>
                    </td>
                  </tr>
                  {editing === u.id && (
                    <tr><td colSpan={7}>
                      <div className="user-section">
                        <h4>Edit {u.email}</h4>
                        <div className="form-grid">
                          <label className="field">Full name<input className="input" value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={120} autoFocus /></label>
                          <label className="field">Job title<input className="input" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} maxLength={120} placeholder="e.g. Rope access technician" /></label>
                          <label className="field">Username (for PIN sign-in)<input className="input" value={editUser} onChange={(e) => setEditUser(e.target.value)} maxLength={32} autoCapitalize="none" spellCheck={false} placeholder="e.g. j.granaderos" /></label>
                        </div>
                        <p className="note">Usernames are 3–32 lowercase letters, numbers, dots or dashes. After setting one, issue a one-time code: the person uses it on the activation page to choose their own 6-digit PIN. E-mail cannot be changed here.</p>
                        {u.pin_locked_at && <p className="bad">Locked after repeated wrong PINs since {new Date(u.pin_locked_at).toLocaleString()}. <button className="btn btn-sm" onClick={async () => { try { await api(`/api/admin/users/${u.id}`, { action: 'unlock_pin' }); notify('Unlocked. Recorded in the audit log.'); await reload(); } catch (e) { notify((e as Error).message); } }}>Unlock</button></p>}
                        <div className="form-actions">
                          <button className="btn btn-primary" onClick={() => saveEdit(u)} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
                          <button className="btn" onClick={() => setEditing(null)} disabled={saving}>Cancel</button>
                        </div>
                      </div>
                    </td></tr>
                  )}
                  {open === u.id && (
                    <tr><td colSpan={7}>
                      <UserPanel u={u} d={d} self={u.id === selfId} act={act} review={review} reload={reload} />
                    </td></tr>
                  )}
                </Fragment>
              ))}
              {!rows.length && !portal.length && <tr><td colSpan={7} className="empty">No users match your filters.</td></tr>}
              {/* client portal logins (username + passcode, one project): managed under Client viewer access */}
              {portal.map((c) => (
                <tr key={`portal-${c.id}`}>
                  <td>
                    <div className="user-name-cell">
                      <UserAvatar name={c.label} role="staff" />
                      <div className="name-wrap"><b>{c.label}</b><div className="note">Client portal login</div></div>
                    </div>
                  </td>
                  <td><Pill s="active" /><div className="note">@{c.username}</div></td>
                  <td><span className="pill">Client portal</span></td>
                  <td className="note">{d.projects.find((p) => p.id === c.project_id)?.code ?? '—'}</td>
                  <td className="note">{c.last_used_at ? new Date(c.last_used_at).toLocaleDateString() : 'Never'}</td>
                  <td className="note">{fmtDate(c.created_at.slice(0, 10))}</td>
                  <td style={{ whiteSpace: 'nowrap' }}><button className="btn btn-sm" onClick={() => go('client')}>Manage</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

const LIFETIMES: [number, string][] = [[24, '1 day'], [72, '3 days'], [168, '7 days'], [720, '30 days']];

function CodeReveal({ code, expiresAt, who, onClose }: { code: string; expiresAt: string; who: string; onClose: () => void }) {
  return (
    <div className="banner" role="status" style={{ display: 'grid', gap: 6 }}>
      <div><b>One-time code for {who}: </b><code style={{ fontSize: 20, letterSpacing: '.1em' }}>{code}</code>{' '}
        <button className="btn btn-sm" onClick={() => navigator.clipboard.writeText(code).then(() => notify('Copied.'), () => undefined)}>Copy</button>{' '}
        <button className="btn btn-sm" onClick={onClose}>Done</button></div>
      <div className="note">Shown only now (stored as a hash). Give it to the person directly — in person, by phone or a separate message. It works once, until {new Date(expiresAt).toLocaleString()}. They open <b>{typeof location !== 'undefined' ? location.origin : ''}/activate</b>, enter their username and this code, and choose a new 6-digit PIN (people without a username use “Activate with e-mail and password instead”). Until then their old PIN or password keeps working. After that first online sign-in they can also work offline.</div>
    </div>
  );
}

function ViewsEditor({ u, reload }: { u: Profile; reload: () => Promise<void> }) {
  const all = u.allowed_views === null;
  const [sel, setSel] = useState<string[]>(u.allowed_views ?? VIEWS.map(([k]) => k));
  const [saving, setSaving] = useState(false);
  const save = async (next: string[] | null) => {
    setSaving(true);
    // a client keeps its client status (view only, shared items) whatever modules it is given
    const { error } = await withPin(() => u.is_client
      ? sb().rpc('admin_set_client_views', { p_user: u.id, p_views: next ?? VIEWS.map(([k]) => k) })
      : sb().rpc('admin_set_views', { p_user: u.id, p_views: next }));
    setSaving(false);
    if (error) return notify(error.message);
    notify(next === null ? 'All modules allowed.' : 'Module access saved. It applies on their next page load.');
    await reload();
  };
  if (u.global_role === 'super_admin') return <p className="note" style={{ margin: 0 }}>Super Admins can use every module.</p>;
  return (
    <div>
      <h3 style={{ margin: '0 0 6px' }}>Modules this person can use</h3>
      <div className="form-actions" style={{ marginTop: 0 }}>
        {!!u.is_client
          ? <><span className="pill">Client account</span><span className="note">View only, for their projects, in the modules ticked below (plus Global reports, Project reports and Report templates with final reports), showing only approved, client-shared reports and photos. They cannot submit, upload or edit anything, whatever is ticked.</span></>
          : <button className="btn btn-sm" disabled={saving} onClick={async () => { setSaving(true); const { error } = await withPin(() => sb().rpc('admin_set_client', { p_user: u.id, p_client: true })); setSaving(false); if (error) return notify(error.message); notify('Client account: view only, shared items only.'); await reload(); }}>Make this a client account (view only)</button>}
      </div>
      <p className="note" style={{ marginTop: 0 }}>{all ? 'Currently: all modules.' : `Currently: ${u.allowed_views!.length} of ${VIEWS.length} modules.`} Costing (BOQ, cost settings, quotations), schedule changes, report submission and photo uploads are also blocked in the database when the module is off.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px' }}>
        {VIEWS.map(([k, label]) => {
          const client = !!u.is_client;
          const always = ALWAYS_VIEWS.includes(k) && !client;
          // a client account can be given more modules; it stays view only with shared items in each of them
          return (
            <label key={k} style={{ display: 'flex', gap: 6, alignItems: 'center' }} title={client ? 'View only for clients' : always ? 'Every user always has this module' : undefined}>
              <input type="checkbox" checked={always || sel.includes(k)} disabled={always} onChange={(e) => setSel(e.target.checked ? [...sel, k] : sel.filter((x) => x !== k))} />
              {label}{always && <span className="note"> (always on)</span>}
            </label>
          );
        })}
      </div>
      <div className="form-actions">
        <button className="btn btn-sm btn-primary" disabled={saving} onClick={() => save(VIEWS.map(([k]) => k).filter((k) => sel.includes(k)))}>Save module access</button>
        {!all && <button className="btn btn-sm" disabled={saving} onClick={() => save(null)}>Allow all modules</button>}
        {!!u.is_client && <button className="btn btn-sm" disabled={saving} onClick={() => save([...CLIENT_VIEWS])}>Standard client modules</button>}
      </div>
    </div>
  );
}

function UserPanel({ u, d, self, act, review, reload }: {
  u: Profile; d: D; self: boolean; reload: () => Promise<void>;
  act: (u: Profile, action: string, confirmText: string, danger?: boolean, reason?: string) => Promise<void>;
  review: (u: Profile, approve: boolean) => Promise<void>;
}) {
  const [addProject, setAddProject] = useState('');
  const [codeHours, setCodeHours] = useState(72);
  const [issued, setIssued] = useState<{ code: string; expiresAt: string } | null>(null);
  const issue = async (approveFirst: boolean) => {
    const msg = approveFirst
      ? `Approve ${u.email} and create a one-time sign-in code?`
      : `Create a new one-time sign-in code for ${u.email}? Any earlier unused code stops working.`;
    if (!(await askConfirm(msg, { danger: false }))) return;
    try {
      if (approveFirst) await api(`/api/admin/registrations/${u.id}`, { action: 'approve', reason: null, silent: true });
      const r = (await api(`/api/admin/users/${u.id}`, { action: 'issue_code', hours: codeHours })) as unknown as { code: string; expiresAt: string };
      setIssued({ code: r.code, expiresAt: r.expiresAt });
      await reload();
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const [addRole, setAddRole] = useState('employee');
  const mine = d.members.filter((m) => m.user_id === u.id);
  const free = d.projects.filter((p) => !mine.some((m) => m.project_id === p.id) && p.status !== 'archived');
  const names = new Map(d.profiles.map((p) => [p.id, p.full_name || p.email]));
  const log = d.audit.filter((a) => a.target_id === u.id || a.actor_id === u.id).slice(0, 40);

  // Client is an account setting (reports-only modules) on top of an employee membership
  const changeMemberRole = async (m: Member, role: string) => {
    const client = !!u.is_client;
    if (role === 'client' && !client) {
      if (!(await askConfirm(`Make ${u.full_name || u.email} a client account? They will see only reports for their projects, on every project they belong to.`))) return;
      const { error } = await withPin(() => sb().rpc('admin_set_client', { p_user: u.id, p_client: true }));
      if (error) return notify(error.message);
    } else if (role !== 'client' && client) {
      if (!(await askConfirm(`Make ${u.full_name || u.email} staff again? Their account gets every module (narrow it under Module access).`))) return;
      const { error } = await withPin(() => sb().rpc('admin_set_client', { p_user: u.id, p_client: false }));
      if (error) return notify(error.message);
    }
    await setMember(m.project_id, role === 'client' ? 'employee' : role, role === 'client' ? false : m.can_approve_reports);
  };
  const setMember = async (projectId: string, role: string, canApprove: boolean) => {
    const { error } = await withPin(() => sb().from('project_memberships').upsert({ project_id: projectId, user_id: u.id, role, can_approve_reports: role === 'project_manager' || canApprove }));
    if (error) return notify(error.message);
    await reload();
  };
  const remove = async (projectId: string) => {
    if (!(await askConfirm(`Remove ${u.email} from ${d.projects.find((p) => p.id === projectId)?.code}? Their access ends immediately, including queued offline changes for that project.`))) return;
    const { error } = await withPin(() => sb().from('project_memberships').delete().eq('project_id', projectId).eq('user_id', u.id));
    if (error) return notify(error.message);
    await reload();
  };

  return (
    <div className="user-detail-panel">
      <div className="user-detail-header">
        <UserAvatar name={u.full_name || u.email} role={u.global_role} />
        <div className="user-detail-info">
          <h3>{u.full_name || u.email}</h3>
          <div className="note">{u.email} · {u.email_verified_at ? 'Verified' : 'Unverified'} · {u.global_role === 'super_admin' ? 'Super Admin' : !!u.is_client ? 'Client' : 'Staff'} · <Pill s={u.status} /></div>
        </div>
      </div>

      {issued && <CodeReveal code={issued.code} expiresAt={issued.expiresAt} who={u.full_name || u.email} onClose={() => setIssued(null)} />}

      <div className="user-section">
        <h4>Account actions</h4>
        <div className="kv" style={{ maxWidth: 400, marginBottom: 12 }}>
          <span className="note">Password</span><span className="note">{passwordOf(u)}</span>
          <span className="note">Reset</span><span className="note">{resetOf(u)}</span>
          <span className="note">Approval</span><span className="note">{approvalOf(u)}</span>
          {u.sessions_revoked_at && <><span className="note">Sessions revoked</span><span className="note">{when(u.sessions_revoked_at)}</span></>}
        </div>
        {(u.status === 'active' || u.status === 'pending') && (
          <div className="form-actions" style={{ marginTop: 0, marginBottom: 10 }}>
            <label className="note" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>Code valid for
              <select className="input" style={{ maxWidth: 120 }} value={codeHours} onChange={(e) => setCodeHours(Number(e.target.value))}>{LIFETIMES.map(([h, l]) => <option key={h} value={h}>{l}</option>)}</select>
            </label>
            <button className="btn btn-sm btn-primary" onClick={() => issue(u.status === 'pending')}>{u.status === 'pending' ? 'Approve + one-time code' : 'One-time sign-in code'}</button>
          </div>
        )}
        <div className="user-detail-actions">
          {u.status === 'pending' && <><button className="btn btn-sm" onClick={() => review(u, true)}>Approve (e-mail)</button><button className="btn btn-sm btn-danger" onClick={() => review(u, false)}>Reject</button></>}
          {!self && u.status === 'active' && <button className="btn btn-sm btn-danger" onClick={() => act(u, 'suspend', `Suspend ${u.email}? They lose access immediately.`)}>Suspend</button>}
          {(u.status === 'suspended' || u.status === 'rejected') && <button className="btn btn-sm" onClick={() => act(u, 'reactivate', `Reactivate ${u.email}?`, false)}>Activate</button>}
          {u.status === 'active' && <button className="btn btn-sm" onClick={() => issue(false)}>Reset PIN / password (code)</button>}
          {u.status === 'active' && <button className="btn btn-sm" onClick={() => act(u, 'reset_password', `Send ${u.email} a password reset link? (Supabase sends only a few per hour.)`, false)}>Reset e-mail</button>}
          {u.status === 'active' && <button className="btn btn-sm" onClick={() => act(u, 'revoke_sessions', `Sign ${u.email} out everywhere?${self ? ' This includes you.' : ''}`, true, 'Revoked by administrator')}>Sign out all</button>}
          {!self && u.status === 'active' && (u.global_role === 'super_admin'
            ? <button className="btn btn-sm" onClick={() => act(u, 'make_staff', `Remove Super Admin from ${u.email}?`)}>Remove Admin</button>
            : <button className="btn btn-sm" onClick={() => act(u, 'make_admin', `Make ${u.email} Super Admin?`)}>Make Admin</button>)}
        </div>
      </div>

      <div className="user-section">
        <h4>Module access</h4>
        <ViewsEditor key={(u.allowed_views ?? ['*']).join(',')} u={u} reload={reload} />
      </div>

      <div className="user-section">
        <h4>Project access</h4>
        {u.global_role === 'super_admin' && <p className="note" style={{ marginTop: 0 }}>Super Admins can open every project; memberships below set their project role.</p>}
        <table className="tbl">
          <thead><tr><th>Project</th><th>Role</th><th>Can approve</th><th /></tr></thead>
          <tbody>
            {mine.map((m) => {
              const p = d.projects.find((x) => x.id === m.project_id);
              return (
                <tr key={m.project_id}>
                  <td><b>{p?.code}</b> <span className="note">{p?.name}</span></td>
                  <td><select className="input" value={m.role === 'employee' && !!u.is_client && u.global_role !== 'super_admin' ? 'client' : m.role} onChange={(e) => void changeMemberRole(m, e.target.value)} aria-label="Project role"><option value="employee">{roleLabel('employee')}</option><option value="project_manager">{roleLabel('project_manager')}</option>{u.global_role !== 'super_admin' && <option value="client">Client (view only)</option>}</select></td>
                  <td><input type="checkbox" checked={m.can_approve_reports} disabled={m.role === 'project_manager'} onChange={(e) => setMember(m.project_id, m.role, e.target.checked)} aria-label="Can approve reports" /></td>
                  <td><button className="btn btn-sm btn-danger" onClick={() => remove(m.project_id)}>Remove</button></td>
                </tr>
              );
            })}
            {!mine.length && <tr><td colSpan={4} className="note">No project access yet.</td></tr>}
          </tbody>
        </table>
        {u.status === 'active' && free.length > 0 && (
          <div className="form-actions">
            <select className="input" style={{ maxWidth: 240 }} value={addProject} onChange={(e) => setAddProject(e.target.value)} aria-label="Project to add"><option value="">Add to project…</option>{free.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</select>
            <select className="input" style={{ maxWidth: 180 }} value={addRole} onChange={(e) => setAddRole(e.target.value)} aria-label="Role for new project"><option value="employee">Employee</option><option value="project_manager">Project manager</option>{u.global_role !== 'super_admin' && <option value="client">Client (view only)</option>}</select>
            <button className="btn btn-sm btn-primary" disabled={!addProject} onClick={async () => {
              // a client is a project member whose account sees only the client report views
              if (addRole === 'client' && !!!u.is_client) {
                if (!(await askConfirm(`Make ${u.full_name || u.email} a client account? They will see only reports for their projects; every other module is hidden.`))) return;
                const { error } = await withPin(() => sb().rpc('admin_set_client', { p_user: u.id, p_client: true }));
                if (error) return notify(error.message);
              }
              await setMember(addProject, addRole === 'client' ? 'employee' : addRole, false); setAddProject('');
            }}>Give access</button>
          </div>
        )}
      </div>

      <div className="user-section">
        <h4>Activity log</h4>
        {!log.length ? <p className="note" style={{ margin: 0 }}>No recorded events.</p> : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>When</th><th>Event</th><th>By</th><th>Project</th></tr></thead>
              <tbody>
                {log.map((a) => (
                  <tr key={a.id}>
                    <td className="note" style={{ whiteSpace: 'nowrap' }}>{when(a.at)}</td>
                    <td title={a.action}>{eventLabel(a.action)}</td>
                    <td className="note">{a.actor_kind === 'system' ? 'System' : a.actor_id === u.id ? 'User' : names.get(a.actor_id ?? '') ?? '—'}</td>
                    <td className="note">{d.projects.find((p) => p.id === a.project_id)?.code ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
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
  const [f, setF] = useState({ fullName: '', email: '', projectId: '', role: 'employee', pin: '', username: '' });
  const fClient = f.role === 'client';
  const send = async () => {
    const n = checkName(f.fullName);
    if (!n.ok) return notify(n.error);
    const e = checkEmail(f.email);
    if (!e.ok) return notify(e.error);
    if (fClient && !f.projectId) return notify('Choose the project this client may see.');
    if ((fClient || f.pin) && !/^\d{6}$/.test(f.pin)) return notify('The passcode is 6 digits. Type one or press Generate.');
    // with a passcode (always for clients) the login is made now and the details are e-mailed by you; without one, a single-use link is sent
    if (f.pin) {
      const username = f.username.trim().toLowerCase() || e.email.split('@')[0].toLowerCase().replace(/[^a-z0-9.-]+/g, '.').replace(/^[^a-z0-9]+/, '').slice(0, 32).padEnd(3, '0');
      try {
        await api('/api/admin/users/create', { fullName: n.name, username, email: fClient ? undefined : e.email, projectId: f.projectId || undefined, role: f.role, pin: f.pin });
        setMadeLogin({ who: n.name, username, pin: f.pin, client: fClient, email: e.email });
        notify('Login ready. The username and passcode are shown at the top of this page.');
        setF({ fullName: '', email: '', projectId: f.projectId, role: f.role, pin: '', username: '' });
        await reload();
      } catch (x) {
        notify((x as Error).message);
      }
      return;
    }
    try {
      const r = await api('/api/admin/invitations', { ...f, fullName: n.name, email: e.email, projectId: f.projectId || undefined });
      notify(r.message ?? 'Invitation sent.');
      setF({ fullName: '', email: '', projectId: f.projectId, role: f.role, pin: '', username: '' });
      await reload();
    } catch (x) {
      notify((x as Error).message);
    }
  };
  const [g, setG] = useState({ fullName: '', username: '', email: '', projectId: '', role: 'employee', hours: 72, pin: '' });
  const [issued, setIssued] = useState<{ code: string; expiresAt: string; who: string } | null>(null);
  const [madeLogin, setMadeLogin] = useState<{ who: string; username: string; pin: string; client: boolean; email?: string } | null>(null);
  const isClient = g.role === 'client';
  const newPin = () => {
    // 6 random digits, never all the same or a simple run
    for (;;) {
      const p = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
      if (new Set(p).size > 1 && !'0123456789'.includes(p) && !'9876543210'.includes(p)) return p;
    }
  };
  const generatePin = () => { const p = newPin(); setG((x) => ({ ...x, pin: p })); };
  const addWithCode = async () => {
    const n = checkName(g.fullName);
    if (!n.ok) return notify(n.error);
    if (!g.username.trim()) return notify('Enter a username: it is their sign-in name.');
    const e = g.email.trim() ? checkEmail(g.email) : { ok: true as const, email: '' };
    if (!e.ok) return notify(e.error);
    if (isClient && !g.projectId) return notify('Choose the project this client may see.');
    if ((isClient || g.pin) && !/^\d{6}$/.test(g.pin)) return notify('The passcode is 6 digits. Type one or press Generate.');
    try {
      const r = (await api('/api/admin/users/create', { ...g, fullName: n.name, email: isClient ? undefined : e.email || undefined, projectId: g.projectId || undefined, pin: g.pin || undefined })) as unknown as { code?: string; expiresAt?: string };
      if (r.code && r.expiresAt) setIssued({ code: r.code, expiresAt: r.expiresAt, who: n.name });
      else setMadeLogin({ who: n.name, username: g.username.trim().toLowerCase(), pin: g.pin, client: isClient });
      setG((x) => ({ ...x, fullName: '', username: '', email: '', pin: '' }));
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
        <div className="card-head"><h2>Add a person or client</h2><span className="note">Sign-in is username + 6-digit passcode. No e-mail needed.</span></div>
        {issued && <CodeReveal code={issued.code} expiresAt={issued.expiresAt} who={issued.who} onClose={() => setIssued(null)} />}
        {madeLogin && (
          <div className="banner" role="status" style={{ display: 'grid', gap: 6 }}>
            <div><b>{madeLogin.client ? 'Client login' : 'Account'} ready for {madeLogin.who}.</b> Username <code>{madeLogin.username}</code>, passcode <code style={{ letterSpacing: '.1em' }}>{madeLogin.pin}</code>{' '}
              <button className="btn btn-sm" onClick={() => setMadeLogin(null)}>Done</button></div>
            {madeLogin.email && <div><a className="btn btn-sm" href={`mailto:${madeLogin.email}?subject=${encodeURIComponent('Your NEAS sign-in')}&body=${encodeURIComponent(`Hello ${madeLogin.who},\n\nSign in at ${window.location.origin}/login\nUsername: ${madeLogin.username}\nPasscode: ${madeLogin.pin}\n`)}`}>E-mail these details to {madeLogin.email}</a></div>}
            <div className="note">Shown only now (stored as a hash). Hand it over directly. They sign in on the normal sign-in page{madeLogin.client ? ' and see only what you approved for clients on that project' : ''}. After their first online sign-in on a device, that device also works offline.</div>
          </div>
        )}
        <div className="form-grid">
          <label className="field">Full name{isClient ? ' / company contact' : ''}<input className="input" value={g.fullName} onChange={(e) => setG({ ...g, fullName: e.target.value })} /></label>
          <label className="field">Username<input className="input" autoCapitalize="none" spellCheck={false} placeholder="e.g. jancho.client" value={g.username} onChange={(e) => setG({ ...g, username: e.target.value })} /></label>
          {!isClient && <label className="field">E-mail (optional)<input className="input" type="email" value={g.email} onChange={(e) => setG({ ...g, email: e.target.value })} /></label>}
          <label className="field">Project<select className="input" value={g.projectId} onChange={(e) => setG({ ...g, projectId: e.target.value })}><option value="">{isClient ? 'Choose a project' : 'No project yet'}</option>{d.projects.filter((p) => !p.deleted_at).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></label>
          <label className="field">Role<select className="input" value={g.role} onChange={(e) => setG({ ...g, role: e.target.value })}><option value="employee">Employee / Technician / Inspector</option><option value="project_manager">Project Manager</option><option value="client">Client</option></select></label>
          <label className="field">Passcode (6 digits){isClient ? '' : ' — or leave empty for a one-time code'}
            <span style={{ display: 'flex', gap: 8 }}>
              <input className="input" inputMode="numeric" maxLength={6} value={g.pin} onChange={(e) => setG({ ...g, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })} style={{ letterSpacing: '0.3em' }} />
              <button type="button" className="btn" onClick={generatePin}>Generate</button>
            </span>
          </label>
          {!isClient && !g.pin && <label className="field">Code valid for<select className="input" value={g.hours} onChange={(e) => setG({ ...g, hours: Number(e.target.value) })}>{LIFETIMES.map(([h, l]) => <option key={h} value={h}>{l}</option>)}</select></label>}
        </div>
        <div className="form-actions"><button className="btn btn-primary" onClick={addWithCode}>{isClient ? 'Create client login' : g.pin ? 'Create account' : 'Create account and code'}</button></div>
      </section>
      <section className="card">
        <div className="card-head"><h2>Invite a person by e-mail</h2><span className="note">Pre-approved: they set their own password from a single-use link</span></div>
        <div className="form-grid">
          <label className="field">Full name<input className="input" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></label>
          <label className="field">E-mail<input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
          <label className="field">Project<select className="input" value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}><option value="">No project yet</option>{d.projects.filter((p) => !p.deleted_at).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></label>
          <label className="field">Role<select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="employee">Employee / Technician / Inspector</option><option value="project_manager">Project Manager</option><option value="client">Client</option></select></label>
          <label className="field">Passcode (6 digits){fClient ? '' : ' — or leave empty for a one-time code'}
            <span style={{ display: 'flex', gap: 8 }}>
              <input className="input" inputMode="numeric" maxLength={6} value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })} style={{ letterSpacing: '0.3em' }} />
              <button type="button" className="btn" onClick={() => { const p = newPin(); setF((x) => ({ ...x, pin: p })); }}>Generate</button>
            </span>
          </label>
          {f.pin && <label className="field">Username<input className="input" autoCapitalize="none" spellCheck={false} placeholder={f.email.split('@')[0] || 'e.g. jancho.client'} value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></label>}
        </div>
        <div className="form-actions"><button className="btn btn-primary" onClick={send}>{f.pin ? (fClient ? 'Create client login' : 'Create account') : 'Send invitation'}</button></div>
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
  ['show_overview', 'Overview'], ['show_estimating', 'Estimating & BOQ'], ['show_quotation', 'Quotation preview'],
  ['show_project_management', 'Project management'], ['show_field_reports', 'Field reports'],
  ['show_project_register', 'Project register'], ['show_site_evidence', 'Site evidence'],
  ['show_google_sheets', 'Google Sheets setup'], ['show_offline_queue', 'Offline queue'],
  ['show_milestones', 'Approved milestones'], ['show_progress', 'Overall progress %'], ['show_gantt', 'Gantt chart'],
  ['show_scurve', 'S-curve'], ['show_reports', 'Approved progress reports'], ['show_photos', 'Approved before/after photos'], ['show_photo_locations', 'Photo locations (GPS)'], ['show_documents', 'Approved documents'], ['show_completion', 'Completion status'],
];

function ClientAccess({ d, reload }: { d: D; reload: () => Promise<void> }) {
  const [pid, setPid] = useState(d.projects[0]?.id ?? '');
  const [label, setLabel] = useState('Client representative');
  const [days, setDays] = useState('30');
  const [oneTime, setOneTime] = useState(true);
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
    if (rotate && !(await askConfirm('Rotate the project passcode? All shared project passcodes and their sessions stop working. Client username logins keep working.'))) return;
    const expires = days ? new Date(Date.now() + Number(days) * 864e5).toISOString() : null;
    const { data, error } = await withPin(() => sb().rpc('admin_create_client_passcode', { p_project: p.id, p_label: label, p_expires_at: expires, p_revoke_existing: rotate, p_one_time: oneTime }));
    if (error) return notify(error.message);
    setShown(String(data));
    await reload();
  };
  // a client username login: set a new 6-digit passcode (also restores a revoked login)
  const [resetShown, setResetShown] = useState<{ username: string; pin: string } | null>(null);
  const resetLogin = async (c: Cred) => {
    if (!(await askConfirm(`Give @${c.username} a new 6-digit passcode${c.revoked_at ? ' and restore the login' : ''}? The old passcode stops working.`, { danger: false }))) return;
    let pin = '';
    while (!pin || new Set(pin).size === 1 || '0123456789'.includes(pin) || '9876543210'.includes(pin)) pin = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
    const { error } = await withPin(() => sb().rpc('admin_reset_client_login', { p_credential: c.id, p_passcode: pin }));
    if (error) return notify(error.message);
    setResetShown({ username: c.username!, pin });
    await reload();
  };
  const revoke = async (c: Cred) => {
    if (!(await askConfirm(`Revoke “${c.label}”? Clients using it are signed out.`))) return;
    const { error } = await withPin(() => sb().rpc('admin_revoke_client_passcode', { p_credential: c.id }));
    if (error) return notify(error.message);
    await reload();
  };
  const setVis = async (k: string, v: boolean | number) => {
    const { error } = await withPin(() => sb().from('approved_client_content').upsert({ project_id: pid, ...(content ?? {}), [k]: v }));
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
          <b>New passcode for /client/{p?.code}: </b><code style={{ fontSize: 18, letterSpacing: '.08em' }}>{shown}</code>{' '}
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
            <label className="field">Type<select className="input" value={oneTime ? 'once' : 'multi'} onChange={(e) => setOneTime(e.target.value === 'once')}><option value="once">One-time (first sign-in only)</option><option value="multi">Reusable until it expires</option></select></label>
          </div>
          <p className="note" style={{ marginTop: 0 }}>With a one-time passcode the client signs in once; the portal then stays open on that device for the session length below and keeps an offline copy.</p>
          <div className="form-actions">
            <button className="btn btn-primary" onClick={() => create(false)}>Generate passcode</button>
            <button className="btn" onClick={() => create(true)}>Rotate project passcode (revoke old ones, issue new)</button>
          </div>
          {resetShown && (
            <div className="banner" role="status" style={{ marginTop: 10 }}>
              <b>New passcode for @{resetShown.username}: </b><code style={{ fontSize: 18, letterSpacing: '.15em' }}>{resetShown.pin}</code>{' '}
              <button className="btn btn-sm" onClick={() => setResetShown(null)}>Done</button>
              <div className="note">Shown only now. The client signs in on the normal sign-in page with the username and this passcode.</div>
            </div>
          )}
          <table className="tbl" style={{ marginTop: 12 }}>
            <thead><tr><th>Label</th><th>Type</th><th>Created</th><th>Expires</th><th>Last used</th><th>Status</th><th /></tr></thead>
            <tbody>
              {creds.map((c) => {
                const st = c.revoked_at ? 'revoked' : c.expires_at && c.expires_at < new Date().toISOString() ? 'expired' : c.max_uses && c.use_count >= c.max_uses ? 'used' : 'active';
                return (
                  <tr key={c.id}><td>{c.label}</td><td className="note">{c.username ? <>Client login <b>@{c.username}</b></> : c.max_uses === 1 ? 'One-time passcode' : 'Reusable passcode'}</td><td className="note">{when(c.created_at)}</td><td className="note">{when(c.expires_at)}</td><td className="note">{when(c.last_used_at)}</td><td><Pill s={st} /></td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {c.username && <button className="btn btn-sm" onClick={() => resetLogin(c)}>{st === 'revoked' ? 'Restore with new passcode' : 'New passcode'}</button>}{' '}
                      {st === 'active' && <button className="btn btn-sm btn-danger" onClick={() => revoke(c)}>Revoke</button>}
                    </td></tr>
                );
              })}
              {!creds.length && <tr><td colSpan={7} className="note">No passcodes yet.</td></tr>}
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
              <label className="field" style={{ marginTop: 10 }}>Stay signed in for (online and offline)
                <select className="input" value={String(content.session_hours ?? 8)} onChange={(e) => setVis('session_hours', Number(e.target.value))}>
                  {[[8, '8 hours'], [24, '1 day'], [72, '3 days'], [168, '7 days'], [336, '14 days'], [720, '30 days']].map(([h, l]) => <option key={h} value={String(h)}>{l}</option>)}
                  {![8, 24, 72, 168, 336, 720].includes(Number(content.session_hours ?? 8)) && <option value={String(content.session_hours)}>{String(content.session_hours)} hours</option>}
                </select>
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

const SYNC_TABLES = ['activities', 'project_reports', 'report_attachments', 'boq_lines', 'quotations'];

// Automatic report backup: the Google Apps Script refreshes the reporting sheet from the app every 30 minutes and
// saves it to the Drive folder as Excel and PDF (integrations/apps-script-cloud.gs, backupReports).
const BACKUP_FOLDER = 'https://drive.google.com/drive/folders/1RRDCkWAz2sbDyVybzS0zq6dThWDxDqXW';
function BackupCard() {
  const [busy, setBusy] = useState(false);
  const now = async () => {
    setBusy(true);
    try {
      const r = (await api('/api/integrations/sheets', {})) as unknown as { message?: string };
      notify(`${r.message ?? 'Google Sheet updated.'} The next 30-minute backup saves it to Drive as Excel and PDF.`);
    } catch (e) { notify((e as Error).message); }
    setBusy(false);
  };
  return (
    <section className="card">
      <div className="card-head"><h2>Report backups</h2><span className="note">Every 30 minutes · Excel and PDF · kept 14 days</span></div>
      <p className="note" style={{ marginTop: 0 }}>All projects, activities, field reports, review status, photos list and team are copied to the NEAS Google Sheet and saved to the backup folder in Google Drive as an Excel workbook and a PDF, every 30 minutes.</p>
      <div className="form-actions" style={{ marginTop: 0 }}>
        <a className="btn btn-sm" href={BACKUP_FOLDER} target="_blank" rel="noreferrer">Open backup folder</a>
        <button className="btn btn-sm" disabled={busy} onClick={() => void now()}>{busy ? 'Updating…' : 'Update the sheet now'}</button>
      </div>
    </section>
  );
}

function SyncMonitor({ d, reload }: { d: D; reload: () => Promise<void> }) {
  const names = new Map(d.profiles.map((p) => [p.id, p.full_name || p.email]));
  // current server state of each record, so the administrator sees whether anything is actually lost
  const [gone, setGone] = useState<Map<string, boolean>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    const byEntity = new Map<string, string[]>();
    for (const o of d.ops) if (SYNC_TABLES.includes(o.entity)) byEntity.set(o.entity, [...(byEntity.get(o.entity) ?? []), o.record_id]);
    Promise.all([...byEntity].map(([t, ids]) => sb().from(t).select('id, deleted_at').in('id', ids).then(({ data }) => ({ ids, rows: (data ?? []) as { id: string; deleted_at: string | null }[] }))))
      .then((res) => {
        const m = new Map<string, boolean>();
        for (const { ids, rows } of res) for (const id of ids) { const r = rows.find((x) => x.id === id); m.set(id, !r || !!r.deleted_at); }
        setGone(m);
      });
  }, [d.ops]);
  const stateOf = (o: SyncOp) => {
    const g = gone.get(o.record_id);
    if (g === undefined) return 'Checking…';
    if (o.op === 'delete') return g ? 'Already deleted on the server: nothing to do' : 'Still on the server: the delete did not happen';
    return g ? 'Record was deleted on the server' : 'Server version kept; the device still holds the edit';
  };
  const resolve = async (o: SyncOp, action: 'dismiss' | 'apply_delete') => {
    const what = action === 'apply_delete' ? 'Apply this delete on the server now? The record is soft-deleted and can be restored from Data recovery.' : 'Mark this problem as resolved, keeping the server version?';
    if (!(await askConfirm(what, { danger: action === 'apply_delete' }))) return;
    setBusy(o.op_id);
    const { data, error } = await sb().rpc('resolve_sync_operation', { p_op: o.op_id, p_action: action, p_note: '' });
    setBusy(null);
    notify(error ? `Not resolved: ${error.message}` : data === 'already_applied' ? 'Resolved: the record was already deleted.' : data === 'applied_by_admin' ? 'Delete applied and recorded in the audit log.' : 'Marked resolved; recorded in the audit log.');
    await reload();
  };
  // clear every listed problem at once, keeping the server versions (deletes are not applied)
  const resolveAll = async () => {
    if (!(await askConfirm(`Mark all ${d.ops.length} sync problem(s) as resolved, keeping the server versions? Nothing on the server changes; each is recorded in the audit log.`, { danger: false }))) return;
    setBusy('all');
    let ok = 0, failed = 0;
    for (const o of d.ops) { const { error } = await sb().rpc('resolve_sync_operation', { p_op: o.op_id, p_action: 'dismiss', p_note: 'bulk' }); if (error) failed++; else ok++; }
    setBusy(null);
    notify(`Resolved ${ok} problem(s).${failed ? ` ${failed} could not be resolved.` : ''}`);
    await reload();
  };
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
      <BackupCard />
      <section className="card">
        <div className="card-head"><h2>Offline sync problems</h2><span className="note">Conflicts and refused changes from field devices</span>{d.ops.length > 0 && <button className="btn btn-sm" disabled={!!busy} onClick={() => void resolveAll()}>{busy === 'all' ? 'Resolving…' : `Resolve all (${d.ops.length}) — keep server versions`}</button>}</div>
        {!d.ops.length ? <div className="empty">No sync problems.</div> : (
          <div className="table-wrap"><table className="tbl">
            <thead><tr><th>When</th><th>Person</th><th>Project</th><th>Record type</th><th>Change</th><th>Status</th><th>Reason</th><th>On the server now</th><th>Resolve</th></tr></thead>
            <tbody>
              {d.ops.map((o) => (
                <tr key={o.op_id}>
                  <td className="note">{when(o.received_at)}</td><td>{names.get(o.user_id)}</td><td>{d.projects.find((p) => p.id === o.project_id)?.code ?? '—'}</td><td>{o.entity}</td><td>{o.op}</td><td><Pill s={o.status} /></td>
                  <td className="note">{o.result?.error ?? (o.status === 'conflict' ? 'Edited from an older version' : '')}</td>
                  <td className="note">{stateOf(o)}</td>
                  <td className="row-actions">
                    {o.op === 'delete' && gone.get(o.record_id) === false && <button className="btn btn-sm" disabled={busy === o.op_id} onClick={() => resolve(o, 'apply_delete')}>Apply delete</button>}
                    <button className="btn btn-sm" disabled={busy === o.op_id} onClick={() => resolve(o, 'dismiss')}>{o.op === 'delete' && gone.get(o.record_id) ? 'Clear' : 'Keep server version'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        <p className="note">Resolving here records your decision in the audit log and removes the item from this list. It does not change the person's device: they can still keep or discard their copy in their Offline queue. Nothing is discarded automatically.</p>
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

interface RecItem { entity: string; record_id: string; project_id: string; label: string; action?: string; reason?: string; note?: string | null; fields?: string[]; storage_path?: string; resolution?: string }
interface RecPlan {
  run_id: string; target_at: string; source: string;
  ledger: { operations_total: number; operations_before_target: number; first_received_at: string | null; last_received_before_target: string | null };
  snapshot_counts: Record<string, number>; created_after: Record<string, number>;
  restore: RecItem[]; conflicts: RecItem[]; skipped: RecItem[]; missing_files: RecItem[]; unchanged: number; changed_after: number;
}
interface RecValidation { checked_at: string; expected: Record<string, number>; present: Record<string, number>; not_present: RecItem[]; integrity: Record<string, number>; restored: { total: number; live: number }; integrity_ok: boolean }
interface RecRun { id: string; created_at: string; created_by: string | null; target_at: string; project_id: string | null; status: string; applied_at: string | null; rolled_back_at: string | null; plan: RecPlan; validation: RecValidation | null }

const ENTITY: Record<string, string> = { activities: 'Activity', project_reports: 'Field report', report_attachments: 'Photo / attachment' };
const MANILA_DEFAULT = '2026-10-21T17:00';
// The input is Asia/Manila wall-clock time (UTC+8, no daylight saving).
const manilaToIso = (local: string): string | null => {
  const d = new Date(`${local.slice(0, 16)}:00+08:00`);
  return local.length >= 16 && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
};
const manilaText = (iso: string) => new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) + ' (Manila)';

function Recovery({ d }: { d: D }) {
  const [at, setAt] = useState(MANILA_DEFAULT);
  const [project, setProject] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [plan, setPlan] = useState<RecPlan | null>(null);
  const [confirm, setConfirm] = useState('');
  const [result, setResult] = useState<RecValidation | null>(null);
  const [runs, setRuns] = useState<RecRun[] | null>(null);
  const names = new Map(d.profiles.map((p) => [p.id, p.full_name || p.email]));
  const code = (id: string | null) => (id ? d.projects.find((p) => p.id === id)?.code ?? id.slice(0, 8) : 'All projects');

  const loadRuns = useCallback(async () => {
    const { data, error } = await sb().from('recovery_runs').select('*').order('created_at', { ascending: false }).limit(20);
    if (error) return setErr(`Could not load recovery history: ${error.message}`);
    setRuns((data ?? []) as RecRun[]);
  }, []);
  useEffect(() => { void loadRuns(); }, [loadRuns]);

  const dryRun = async () => {
    const iso = manilaToIso(at);
    if (!iso) return setErr('Enter a valid date and time.');
    setBusy(true); setErr(null); setPlan(null); setResult(null); setConfirm('');
    const { data, error } = await sb().rpc('recovery_plan_field_reports', { p_at: iso, p_project: project || null });
    setBusy(false);
    if (error) return setErr(error.message);
    setPlan(data as RecPlan);
    void loadRuns();
  };

  const apply = async () => {
    if (!plan) return;
    if (!(await askConfirm(`Restore ${plan.restore.length} record(s) to the state of ${manilaText(plan.target_at)}? The current state is backed up first and the restore can be rolled back.`))) return;
    setBusy(true); setErr(null);
    const { data, error } = await sb().rpc('recovery_apply_field_reports', { p_run: plan.run_id, p_confirm: confirm });
    setBusy(false);
    if (error) return setErr(error.message);
    const r = data as { restored: RecItem[]; skipped: RecItem[]; validation: RecValidation };
    setResult(r.validation);
    notify(`${r.restored.length} record(s) restored${r.skipped.length ? `, ${r.skipped.length} skipped` : ''}.`);
    setPlan(null); setConfirm('');
    void loadRuns();
  };

  const rollback = async (run: RecRun) => {
    if (!(await askConfirm(`Roll back the recovery from ${when(run.applied_at)}? Records it restored are deleted again (soft delete, nothing is erased).`, { danger: true }))) return;
    const { error } = await sb().rpc('recovery_rollback_field_reports', { p_run: run.id, p_confirm: 'ROLLBACK' });
    if (error) return notify(error.message);
    notify('Recovery rolled back.');
    void loadRuns();
  };

  const revalidate = async (run: RecRun) => {
    const { data, error } = await sb().rpc('recovery_validate_field_reports', { p_run: run.id });
    if (error) return notify(error.message);
    setResult(data as RecValidation);
    void loadRuns();
  };

  const Items = ({ title, items, empty, extra }: { title: string; items: RecItem[]; empty: string; extra?: (i: RecItem) => ReactNode }) => (
    <div className="user-section">
      <h4>{title} ({items.length})</h4>
      {!items.length ? <p className="note">{empty}</p> : (
        <div className="table-wrap"><table className="tbl">
          <thead><tr><th>Type</th><th>Project</th><th>Record</th><th>Details</th></tr></thead>
          <tbody>{items.map((i) => (
            <tr key={`${i.entity}:${i.record_id}`}><td>{ENTITY[i.entity] ?? i.entity}</td><td>{code(i.project_id)}</td><td>{i.label || <span className="note">{i.record_id.slice(0, 8)}</span>}</td><td className="note">{extra?.(i)}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );

  const Counts = ({ v }: { v: RecValidation }) => (
    <div className="user-section">
      <h4>Validation {v.integrity_ok ? <Pill s="ok" /> : <Pill s="error" />}</h4>
      <table className="tbl">
        <thead><tr><th>Record type</th><th className="num">At recovery point</th><th className="num">Live now</th></tr></thead>
        <tbody>{Object.keys(ENTITY).map((k) => <tr key={k}><td>{ENTITY[k]}</td><td className="num">{v.expected?.[k] ?? 0}</td><td className="num">{v.present?.[k] ?? 0}</td></tr>)}</tbody>
      </table>
      <p className="note">Links: {v.integrity.reports_without_project} report(s) without a project · {v.integrity.reports_with_deleted_activity} with a deleted activity · {v.integrity.attachments_with_deleted_report} attachment(s) on a deleted report · {v.integrity.attachments_missing_file} attachment(s) whose file is missing. Restored records live: {v.restored.live} of {v.restored.total}.</p>
      {v.not_present.length > 0 && <p className="note">Not live now: {v.not_present.map((i) => `${ENTITY[i.entity]} ${i.label || i.record_id.slice(0, 8)}`).join('; ')}</p>}
    </div>
  );

  return (
    <>
      <section className="card">
        <div className="card-head"><h2>Field reports recovery</h2><span className="note">Super Admin only · every step is recorded in the audit log</span></div>
        <p className="note">Rebuilds field reports, activities and photo records as they were at a chosen time from the server&apos;s sync history, then restores what has since been deleted. Changes made after that time are kept. Nothing is changed until you review the dry run and type RESTORE.</p>
        <div className="form-grid">
          <label className="field">Recovery point (Asia/Manila time)
            <input className="input" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
          </label>
          <label className="field">Project
            <select className="input" value={project} onChange={(e) => setProject(e.target.value)}>
              <option value="">All projects</option>
              {d.projects.filter((p) => !p.deleted_at).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
            </select>
          </label>
        </div>
        {err && <p className="bad" role="alert">{err}</p>}
        <div className="form-actions">
          <button className="btn btn-primary" onClick={dryRun} disabled={busy || !at}>{busy && !plan ? 'Checking…' : 'Run dry run'}</button>
        </div>
      </section>

      {plan && (
        <section className="card">
          <div className="card-head"><h2>Dry run · {manilaText(plan.target_at)}</h2><span className="note">{code(project || null)}</span></div>
          <div className="user-stats">
            <div className="user-stat"><div className="user-stat-val">{plan.restore.length}</div><div className="user-stat-label">To restore</div></div>
            <div className="user-stat"><div className="user-stat-val">0</div><div className="user-stat-label">To update</div></div>
            <div className="user-stat"><div className="user-stat-val">{plan.conflicts.length}</div><div className="user-stat-label">Conflicts (kept)</div></div>
            <div className="user-stat"><div className="user-stat-val">{plan.skipped.length}</div><div className="user-stat-label">Cannot restore</div></div>
            <div className="user-stat"><div className="user-stat-val">{plan.unchanged}</div><div className="user-stat-label">Unchanged</div></div>
          </div>
          <div className="user-section">
            <h4>Snapshot source</h4>
            <p className="note">{plan.source}. {plan.ledger.operations_before_target} of {plan.ledger.operations_total} synced changes happened before the recovery point{plan.ledger.last_received_before_target ? `; the last one at ${manilaText(plan.ledger.last_received_before_target)}` : ''}.</p>
            <p className="note">At the recovery point: {Object.keys(ENTITY).map((k) => `${plan.snapshot_counts[k] ?? 0} ${ENTITY[k].toLowerCase()}(s)`).join(' · ')}. Created since and kept: {Object.keys(ENTITY).map((k) => `${plan.created_after[k] ?? 0} ${ENTITY[k].toLowerCase()}(s)`).join(' · ')}.</p>
            {plan.ledger.operations_before_target === 0 && <p className="bad">No synced history exists before this time, so only soft-deleted rows can be recovered. For anything else use the Supabase project backups (Database → Backups).</p>}
          </div>
          <Items title="Records to be restored" items={plan.restore} empty="Nothing is missing compared with the recovery point." extra={(i) => <>{i.action === 'insert' ? 'Re-created under its original id' : 'Undeleted'}{i.note ? ` · ${i.note}` : ''}</>} />
          <Items title="Conflicts: changed after the recovery point (current version kept)" items={plan.conflicts} empty="No conflicts." extra={(i) => `Changed: ${(i.fields ?? []).join(', ')}`} />
          <Items title="Cannot be restored" items={plan.skipped} empty="Everything missing can be restored." extra={(i) => i.reason} />
          <Items title="Missing or unrecoverable files" items={plan.missing_files} empty="All photo files are still in storage." extra={(i) => i.storage_path} />

          <div className="user-section">
            <h4>Approve and restore</h4>
            {!plan.restore.length ? <p className="note">There is nothing to restore.</p> : (
              <>
                <p className="note">The current state of each record is backed up before it changes, the restore runs as one transaction, and it can be rolled back from the history below. Type <b>RESTORE</b> to enable the button.</p>
                <div className="form-actions">
                  <input className="input" style={{ maxWidth: 200 }} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="RESTORE" aria-label="Type RESTORE to confirm" />
                  <button className="btn btn-primary" onClick={apply} disabled={busy || confirm !== 'RESTORE'}>{busy ? 'Restoring…' : `Restore ${plan.restore.length} record(s)`}</button>
                  <button className="btn" onClick={() => { setPlan(null); setConfirm(''); }} disabled={busy}>Cancel</button>
                </div>
              </>
            )}
          </div>
        </section>
      )}

      {result && <section className="card"><div className="card-head"><h2>Recovery result</h2><span className="note">checked {when(result.checked_at)}</span></div><Counts v={result} /></section>}

      <section className="card">
        <div className="card-head"><h2>Recovery history</h2><button className="btn btn-sm" onClick={loadRuns}>Refresh</button></div>
        {runs === null ? <div className="empty">Loading…</div> : !runs.length ? <div className="empty">No recovery runs yet.</div> : (
          <div className="table-wrap"><table className="tbl">
            <thead><tr><th>When</th><th>By</th><th>Recovery point</th><th>Project</th><th>Status</th><th className="num">Restore / skip / conflicts</th><th></th></tr></thead>
            <tbody>{runs.map((r) => (
              <tr key={r.id}>
                <td className="note">{when(r.created_at)}</td><td>{r.created_by ? names.get(r.created_by) ?? '—' : '—'}</td><td>{manilaText(r.target_at)}</td><td>{code(r.project_id)}</td>
                <td><Pill s={r.status} /></td>
                <td className="num">{r.plan.restore.length} / {r.plan.skipped.length} / {r.plan.conflicts.length}</td>
                <td style={{ display: 'flex', gap: 6 }}>
                  {r.status !== 'planned' && <button className="btn btn-sm" onClick={() => revalidate(r)}>Validate</button>}
                  {r.status === 'applied' && <button className="btn btn-sm btn-danger" onClick={() => rollback(r)}>Roll back</button>}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}

function AuditLog({ d }: { d: D }) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const names = new Map(d.profiles.map((p) => [p.id, p.full_name || p.email]));
  const isAuth = (a: Audit) => a.action.startsWith('auth:') || a.action.startsWith('account:') || a.action.startsWith('client:');
  const rows = d.audit.filter((a) => (!kind || (kind === 'auth' ? isAuth(a) : !isAuth(a))) && (!q || `${a.action} ${a.target_type} ${names.get(a.actor_id ?? '') ?? ''} ${JSON.stringify(a.details)}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <section className="card">
      <div className="card-head"><h2>Audit log (latest {d.audit.length})</h2><div className="form-actions" style={{ marginTop: 0 }}><select className="input" style={{ maxWidth: 200 }} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Event type"><option value="">All events</option><option value="auth">Sign-in and account</option><option value="admin">Data and administration</option></select><input className="input" style={{ maxWidth: 260 }} placeholder="Filter by person, action…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter audit log" /></div></div>
      <div className="table-wrap"><table className="tbl">
        <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Project</th><th>Details</th></tr></thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}>
              <td className="note" style={{ whiteSpace: 'nowrap' }}>{when(a.at)}</td>
              <td>{a.actor_kind === 'client' ? 'Client (passcode)' : a.actor_kind === 'system' ? 'System' : names.get(a.actor_id ?? '') ?? '—'}</td>
              <td title={a.action}>{eventLabel(a.action)}</td>
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
