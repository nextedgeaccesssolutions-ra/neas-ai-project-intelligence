import { createHash } from 'node:crypto';
import { assertSameOrigin, handle, HttpError, readJson, requireUser, supabaseService } from '@/lib/cloud/server';
import { FILES_BUCKET } from '@/lib/cloud/env';
import { UUID_RE } from '@/lib/cloud/validate';

export const dynamic = 'force-dynamic';
// reading back and fingerprinting a large photo report can take a while
export const maxDuration = 60;

const MAX_BYTES = 80 * 1024 * 1024;

// A project manager (or Super Admin) sends one generated report PDF to the project's clients.
// Reports with many photos are larger than a server request may be, so the browser uploads the file
// straight to storage with a one-time upload link (step "start"). Then (step "finish") the server reads
// the stored file back, checks its SHA-256 against what the browser announced, and only then switches
// the report to that file, so the client always sees and approves exactly the bytes that were recorded.
// The path is named by the fingerprint, so a stored review file is never replaced.
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const { sb } = await requireUser();
  const b = await readJson<{ step?: 'start' | 'finish'; exportId?: string; sha256?: string; size?: number }>(req, 1024);
  const exportId = String(b.exportId ?? '');
  const sha256 = String(b.sha256 ?? '').toLowerCase();
  if (!UUID_RE.test(exportId)) throw new HttpError(400, 'Invalid report');
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new HttpError(400, 'Invalid file fingerprint');

  const { data: exp } = await sb.from('project_report_exports').select('project_id, report_ref, approval_status').eq('id', exportId).maybeSingle();
  if (!exp) throw new HttpError(404, 'Report not found');
  if (exp.approval_status === 'approved') throw new HttpError(400, 'This report is already approved by the client. Generate a new report for further changes.');
  // only managers / Super Admin may send (the database repeats this check when the report is switched)
  const { data: allowed } = await sb.rpc('is_manager', { p_project: exp.project_id });
  const { data: admin } = await sb.rpc('is_super_admin');
  if (!allowed && !admin) throw new HttpError(403, 'Only a project manager or Super Admin can send a report to the client');
  const path = `client-reviews/${exp.project_id}/${exportId}/${sha256}.pdf`;
  const svc = supabaseService();

  if (b.step === 'start') {
    if (!Number.isFinite(b.size) || (b.size as number) < 5 || (b.size as number) > MAX_BYTES) throw new HttpError(400, 'The report file is missing or too large (80 MB at most).');
    const { data, error } = await svc.storage.from(FILES_BUCKET).createSignedUploadUrl(path);
    if (error) {
      // the same file was stored by an earlier attempt: go straight to "finish"
      if (/exists|duplicate/i.test(error.message)) return Response.json({ ok: true, already: true, path });
      throw new HttpError(502, `Upload could not be prepared (${error.message}).`);
    }
    return Response.json({ ok: true, path, token: data.token });
  }

  // finish: the stored file must be a PDF with exactly the announced fingerprint
  const { data: file, error: dlErr } = await svc.storage.from(FILES_BUCKET).download(path);
  if (dlErr || !file) throw new HttpError(400, 'The report file was not uploaded. Try sending it again.');
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-' || createHash('sha256').update(bytes).digest('hex') !== sha256) {
    await svc.storage.from(FILES_BUCKET).remove([path]);
    throw new HttpError(400, 'The uploaded file does not match the report. Try sending it again.');
  }
  const { error } = await sb.rpc('send_report_for_review', { p_export: exportId, p_path: path, p_sha256: sha256 });
  if (error) throw new HttpError(error.code === '42501' ? 403 : 400, error.message);
  return Response.json({ ok: true, reference: exp.report_ref });
});
