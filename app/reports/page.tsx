'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import ProjectBar, { Loading, NoProject } from '@/components/ProjectBar';
import ProjectReportPanel from '@/components/ProjectReportPanel';
import { fetchFromServer } from '@/components/PhotoThumb';
import { useProjectData, useStore } from '@/lib/store';
import { useQueryParam } from '@/lib/useQuery';
import { getPhoto } from '@/lib/photos';
import { CLOUD } from '@/lib/cloud/env';
import { supabaseBrowser } from '@/lib/cloud/browser';
import { coverPhotos } from '@/lib/coverPhotos';
import { gpsLabel, gpsSourceLabel, mapUrl } from '@/lib/geo';
import { fmtDate } from '@/lib/format';
import type { ProjectReport } from '@/lib/projectReport';

type Export = { report_ref: string; generated_at: string; actual_pct: number | null; planned_pct: number | null; schedule_status: string };

export default function Reports() {
  const { ready, project, state, setActiveProject, calendarFor } = useStore();
  const { pid, activities, reports, evidence, stops } = useProjectData();
  const want = useQueryParam('project');
  const [manager, setManager] = useState<string | null>(null);
  const [history, setHistory] = useState<Export[]>([]);
  const [logNote, setLogNote] = useState<string | null>(null);

  useEffect(() => { if (want && want !== state.activeProjectId && state.projects.some((p) => p.id === want)) setActiveProject(want); }, [want, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadHistory = () => {
    const sb = CLOUD ? supabaseBrowser() : null;
    if (!sb || !pid) return;
    sb.from('project_report_exports').select('report_ref, generated_at, actual_pct, planned_pct, schedule_status').eq('project_id', pid).order('generated_at', { ascending: false }).limit(20)
      .then(({ data }) => setHistory((data as Export[]) ?? []));
    sb.from('project_memberships').select('role, profiles(full_name, email)').eq('project_id', pid).eq('role', 'project_manager').limit(1)
      .then(({ data }) => {
        const p = (data?.[0] as { profiles?: { full_name?: string; email?: string } | { full_name?: string; email?: string }[] } | undefined)?.profiles;
        const one = Array.isArray(p) ? p[0] : p;
        setManager(one?.full_name || null);
      });
  };
  useEffect(loadHistory, [pid]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) return <Loading />;
  if (!project) return <NoProject />;
  const name = (id: string) => activities.find((a) => a.id === id)?.name;

  const logged = async (r: ProjectReport) => {
    const sb = CLOUD ? supabaseBrowser() : null;
    if (!sb) return;
    const { data: u } = await sb.auth.getUser();
    const { error } = await sb.from('project_report_exports').insert({
      project_id: pid, report_ref: r.reference, period_from: r.series[0]?.day ?? null, period_to: r.asOf,
      planned_pct: r.overall ? Math.round(r.overall.planned * 100) / 100 : null, actual_pct: r.overall ? Math.round(r.overall.actual * 100) / 100 : null,
      schedule_status: r.overall?.status ?? '', generated_by: u.user?.id,
    });
    setLogNote(error ? `Report not logged: ${error.message}` : 'Logged in the report history; the Google Sheet updates on the next sync.');
    if (!error) {
      loadHistory();
      fetch('/api/integrations/sheets/nudge', { method: 'POST' }).catch(() => undefined);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Reporting</div>
          <h1>Project reports</h1>
          <p className="lead">Branded PDF report for the active project: cover with the official NEAS logo and cover photos, location register, progress, Gantt schedule, site evidence, observations and summary.</p>
        </div>
        <div className="form-actions" style={{ marginTop: 0 }}>
          <Link className="btn btn-sm" href="/site-evidence#cover-photos">Manage cover photos</Link>
        </div>
      </div>
      <ProjectBar />
      <ProjectReportPanel
        note={coverPhotos(evidence).length ? undefined : 'No cover photos are selected yet: add them under Site evidence → Project cover photos.'}
        load={async (id) => (await getPhoto(id).catch(() => undefined)) ?? (CLOUD ? await fetchFromServer(id, evidence.find((e) => e.id === id)?.storagePath ?? `${pid}/${id}.jpg`) : null)}
        onGenerated={logged}
        input={(asOf, from) => ({
          audience: 'internal', generatedAt: new Date(), preparedBy: state.userName || 'NEAS', asOf, periodFrom: from,
          project: { code: project.code ?? project.id, name: project.name, client: project.client, site: project.site, referenceNo: project.referenceNo, status: project.status, startDate: project.startDate, endDate: project.endDate, manager },
          activities, reports, stops, calendar: calendarFor(pid), pendingReports: reports.filter((r) => r.status === 'submitted').length,
          cover: coverPhotos(evidence).map((e) => ({
            id: e.id, caption: e.caption, category: e.coverCategory, ref: e.ref, workArea: e.workArea, location: e.locationDetail,
            lat: e.gps?.lat ?? null, lng: e.gps?.lng ?? null, accuracy: e.gps?.accuracy ?? null, source: e.gpsSource ?? null, status: e.gpsStatus, takenAt: e.takenAt,
          })),
          evidence: evidence.filter((e) => e.kind !== 'Reference' && e.takenAt.slice(0, 10) <= asOf).sort((a, b) => a.takenAt.localeCompare(b.takenAt)).map((e) => ({
            id: e.id, kind: e.kind, caption: e.caption, takenAt: e.takenAt, ref: e.ref, activity: name(e.activityId), workArea: e.workArea, location: e.locationDetail, pairId: e.pairId,
            gps: e.gps ? gpsLabel(e) : undefined, gpsSource: e.gps ? gpsSourceLabel(e.gpsSource, e.gpsStatus) : undefined, mapUrl: mapUrl(e.gps?.lat, e.gps?.lng),
          })),
        })}
      />
      {logNote && <p className="note">{logNote}</p>}
      {CLOUD && (
        <section className="card">
          <div className="card-head"><h2>Report history</h2><span className="note">Reports generated for this project</span></div>
          {history.length === 0 ? <div className="empty">No reports generated yet.</div> : (
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>Reference</th><th>Generated</th><th className="num">Planned</th><th className="num">Actual</th><th>Schedule</th></tr></thead>
                <tbody>{history.map((h) => (
                  <tr key={h.report_ref}><td>{h.report_ref}</td><td>{fmtDate(h.generated_at)} {new Date(h.generated_at).toLocaleTimeString()}</td>
                    <td className="num">{h.planned_pct == null ? '—' : `${Number(h.planned_pct).toFixed(1)}%`}</td><td className="num">{h.actual_pct == null ? '—' : `${Number(h.actual_pct).toFixed(1)}%`}</td><td>{h.schedule_status || '—'}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}
