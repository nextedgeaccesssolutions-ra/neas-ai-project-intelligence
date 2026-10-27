import { createHash } from 'node:crypto';
import { assertSameOrigin, handle, HttpError, requireUser, supabaseService } from '@/lib/cloud/server';
import { FILES_BUCKET } from '@/lib/cloud/env';
import { UUID_RE } from '@/lib/cloud/validate';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 40 * 1024 * 1024;

// A project manager (or Super Admin) sends one generated report PDF to the project's clients.
// The file is stored first under a path named by its own SHA-256 (never overwritten); only then does
// the database switch the report to that file (checking the sender's rights), so the client always
// sees and approves exactly the bytes that were recorded.
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const { sb } = await requireUser();
  const form = await req.formData();
  const exportId = String(form.get('exportId') ?? '');
  const file = form.get('file');
  if (!UUID_RE.test(exportId)) throw new HttpError(400, 'Invalid report');
  if (!(file instanceof Blob) || file.size < 5 || file.size > MAX_BYTES) throw new HttpError(400, 'The report file is missing or too large.');
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new HttpError(400, 'Only the generated PDF can be sent.');

  const { data: exp } = await sb.from('project_report_exports').select('project_id, report_ref').eq('id', exportId).maybeSingle();
  if (!exp) throw new HttpError(404, 'Report not found');
  // only managers / Super Admin may send (the database repeats this check below)
  const { data: allowed } = await sb.rpc('is_manager', { p_project: exp.project_id });
  const { data: admin } = await sb.rpc('is_super_admin');
  if (!allowed && !admin) throw new HttpError(403, 'Only a project manager or Super Admin can send a report to the client');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const path = `client-reviews/${exp.project_id}/${exportId}/${sha256}.pdf`;
  const { error: upErr } = await supabaseService().storage.from(FILES_BUCKET).upload(path, bytes, { contentType: 'application/pdf', upsert: false });
  if (upErr && !/exists|duplicate/i.test(upErr.message)) throw new HttpError(502, `The report file could not be stored (${upErr.message}). Nothing was sent; try again.`);
  const { error } = await sb.rpc('send_report_for_review', { p_export: exportId, p_path: path, p_sha256: sha256 });
  if (error) throw new HttpError(error.code === '42501' ? 403 : 400, error.message);
  return Response.json({ ok: true, reference: exp.report_ref });
});
