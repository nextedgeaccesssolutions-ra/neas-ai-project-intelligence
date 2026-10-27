import { createHash } from 'node:crypto';
import { assertSameOrigin, handle, HttpError, requireUser, supabaseService } from '@/lib/cloud/server';
import { FILES_BUCKET } from '@/lib/cloud/env';
import { UUID_RE } from '@/lib/cloud/validate';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 40 * 1024 * 1024;

// A project manager (or Super Admin) sends one generated report PDF to the project's clients.
// The database records the file's fixed path and SHA-256 first (and checks the sender's rights);
// only then is the file stored, so the client approves exactly these bytes.
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
  const path = `client-reviews/${exp.project_id}/${exportId}.pdf`;
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const { error } = await sb.rpc('send_report_for_review', { p_export: exportId, p_path: path, p_sha256: sha256 });
  if (error) throw new HttpError(error.code === '42501' ? 403 : 400, error.message);

  const { error: upErr } = await supabaseService().storage.from(FILES_BUCKET).upload(path, bytes, { contentType: 'application/pdf', upsert: true });
  if (upErr) throw new HttpError(502, `The report was marked for review but the file could not be stored (${upErr.message}). Send it again.`);
  return Response.json({ ok: true, reference: exp.report_ref });
});
