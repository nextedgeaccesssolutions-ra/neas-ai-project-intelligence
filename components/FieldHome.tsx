'use client';
// Field home: the NEAS banner, quick actions, live figures and the latest field reports.
// Every figure is counted from the data this person can see; nothing is fixed.
import FieldIcon from './FieldIcons';
import PhotoThumb from './PhotoThumb';
import { notify } from './Dialogs';
import Link from 'next/link';
import { useStore } from '@/lib/store';
import { CLOUD } from '@/lib/cloud/env';
import { canView, useCloudStatus } from '@/lib/cloud/cloudSync';
import type { ViewKey } from '@/lib/cloud/cloudSync';
import { fmtDate, fmtPct } from '@/lib/format';
import { useProjectProgress } from './MobileLists';
import { reportNo } from '@/lib/fieldReportPdf';

const STATUS_TONE: Record<string, string> = { approved: 'pill-ok', submitted: 'pill-info', draft: 'pill-warn', rejected: 'pill-bad' };
const STATUS_LABEL: Record<string, string> = { approved: 'Approved', submitted: 'For review', draft: 'Draft', rejected: 'Returned' };

const closeMenu = (e: React.MouseEvent) => { const d = (e.currentTarget as HTMLElement).closest('details'); if (d) d.open = false; };

export default function FieldHome() {
  const { state, setActiveProject } = useStore();
  const cloud = useCloudStatus();
  const may = (v: ViewKey) => !CLOUD || canView(v, cloud.profile);
  const active = state.projects.filter((p) => p.status === 'active');
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const reportsThisMonth = state.reports.filter((r) => r.date.startsWith(monthStart)).length;
  const photos = state.evidence.filter((e) => e.kind !== 'Reference').length;
  // overall progress: the average actual % of active projects that have a schedule
  const prog = useProjectProgress();
  const scheduled = active.map((p) => prog.get(p.id)).filter((v): v is number => v != null);
  const overall = scheduled.length ? scheduled.reduce((a, b) => a + b, 0) / scheduled.length : null;
  const openIssues = state.reports.filter((r) => r.details?.type === 'Issue' && r.status !== 'approved').length;
  const recent = [...state.reports].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
  const proj = (id: string) => state.projects.find((p) => p.id === id);

  return (
    <section className="fh" aria-label="Field home" onClick={(e) => {
      // one menu at a time; a click elsewhere closes it
      for (const d of (e.currentTarget as HTMLElement).querySelectorAll('details.fh-menu[open]')) if (!d.contains(e.target as Node)) (d as HTMLDetailsElement).open = false;
    }}>
      <div className="fh-hero">
        <img src="/neas-logo.png" alt="" width={56} height={56} />
        <div>
          <p className="fh-slogan">SAFE ACCESS.<br />SMARTER REPORTS.<br /><span>BRIGHTER BUILDINGS.</span></p>
          <p className="fh-tag">Field reports · Inspections · Photos · Teams · Projects · Clients</p>
        </div>
      </div>
      <nav className="fh-actions" aria-label="Quick actions">
        {may('field_reports') && <Link href="/field-reports/new" className="fh-act on"><FieldIcon name="report" size={26} />New field report</Link>}
        {may('site_evidence') && <Link href="/site-evidence" className="fh-act"><FieldIcon name="photos" size={26} />Add photos</Link>}
        {may('offline_queue') && <Link href="/offline-queue" className="fh-act"><FieldIcon name="offline" size={26} />Offline mode</Link>}
        {may('projects') && <Link href="/scan" className="fh-act"><FieldIcon name="qr" size={26} />Scan QR code</Link>}
      </nav>
      <div className="fh-stats">
        <Link href={may('projects') ? '/projects' : '/'}><b>{active.length}</b><span>Active projects</span></Link>
        {may('project_management') && <Link href="/project-management"><b>{overall == null ? '—' : fmtPct(overall)}</b><span>Overall progress</span></Link>}
        {may('field_reports') && <Link href="/field-reports"><b>{reportsThisMonth}</b><span>Reports this month</span></Link>}
        {may('site_evidence') && <Link href="/photos"><b>{photos}</b><span>Site photos</span></Link>}
        {may('field_reports') && <Link href="/field-reports" className={openIssues ? 'bad' : ''}><b>{openIssues}</b><span>Open issues</span></Link>}
      </div>
      {may('field_reports') && <>
      <div className="card-head"><h2>Recent reports</h2><Link href="/field-reports" className="note">View all ›</Link></div>
      {!recent.length ? <div className="empty">No field reports yet. Press “New field report” to start one.</div> : (
        <ul className="fh-recent">
          {recent.map((r) => {
            const p = proj(r.projectId);
            const st = r.status ?? 'approved';
            return (
              <li key={r.id}>
                {(() => {
                  // the report's own first photo (older reports show an icon)
                  const first = r.details?.photos.find((x) => x.kind !== 'Inspection')?.id;
                  const ev = first ? state.evidence.find((e) => e.id === first) : undefined;
                  return <span className="fh-thumb">{ev ? <PhotoThumb id={ev.id} storagePath={ev.storagePath} alt="" /> : <FieldIcon name="report" />}</span>;
                })()}
                <Link href="/field-reports" onClick={() => p && setActiveProject(p.id)}>
                  <b>{r.details?.description?.slice(0, 60) || p?.name || 'Field report'}</b>
                  <span className="note">{reportNo(r)} · {p?.code ?? ''} · {[r.details?.area, r.details?.floor].filter(Boolean).join(' - ') || p?.site || ''}</span>
                  <span className="note">{fmtDate(r.date)}</span>
                </Link>
                <span className={`pill ${STATUS_TONE[st] ?? ''}`}>{STATUS_LABEL[st] ?? st}</span>
                <details className="fh-menu">
                  <summary aria-label="Report actions">⋮</summary>
                  <div>
                    <Link href="/field-reports" onClick={(e) => { closeMenu(e); if (p) setActiveProject(p.id); }}>Open in Field reports</Link>
                    {p && <button type="button" onClick={(e) => { closeMenu(e); notify('Building PDF…'); void import('@/lib/fieldReportExport').then((m) => m.downloadFieldReportPdf(r, { project: p, activities: state.activities.filter((a) => a.projectId === p.id), evidence: state.evidence.filter((e) => e.projectId === p.id) })).catch((e) => notify(`PDF not created: ${(e as Error).message}`)); }}>Download PDF</button>}
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
      </>}
    </section>
  );
}
