// Build and save the PDF of one field report. Step-by-step reports list their own photos and signatures;
// for an older report, the photos of the same activity taken on the report date are used.
import { CLOUD } from './cloud/env';
import { getPhoto } from './photos';
import { saveFile } from './fileio';
import { fieldReportPdf, reportNo } from './fieldReportPdf';
import type { Activity, Evidence, FieldReport, Project } from './types';

export async function downloadFieldReportPdf(r: FieldReport, ctx: { project: Project; activities: Activity[]; evidence: Evidence[] }) {
  const { toImage } = await import('./evidenceExport');
  const { loadLogo } = await import('./projectReportPdf');
  const { fetchFromServer } = await import('@/components/PhotoThumb');
  const ids = r.details ? [...r.details.photos.map((p) => p.id), ...r.details.signers.map((s) => s.photoId)] : null;
  const photos = ids
    ? ids.map((id) => ctx.evidence.find((e) => e.id === id)).filter((e): e is Evidence => !!e)
    : ctx.evidence.filter((e) => e.activityId === r.activityId && e.takenAt.slice(0, 10) === r.date && e.kind !== 'Reference');
  const blob = await fieldReportPdf(r, {
    projectName: ctx.project.name, projectCode: ctx.project.code ?? '', client: ctx.project.client,
    activity: ctx.activities.find((a) => a.id === r.activityId)?.name ?? '—', photos, logo: await loadLogo().catch(() => null),
    image: async (e) => {
      const b = (await getPhoto(e.id).catch(() => undefined)) ?? (CLOUD && navigator.onLine ? await fetchFromServer(e.id, e.storagePath ?? `${r.projectId}/${e.id}.jpg`) : null);
      return b ? toImage(b) : null;
    },
  });
  return saveFile(`${reportNo(r)}.pdf`, blob);
}
