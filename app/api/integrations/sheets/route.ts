import { timingSafeEqual } from 'node:crypto';
import { handle, HttpError, requireSuperAdmin, assertSameOrigin } from '@/lib/cloud/server';
import { mirror } from '@/lib/cloud/sheetsMirror';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const bearerOk = (req: Request) => {
  const want = process.env.CRON_SECRET;
  const got = (req.headers.get('authorization') ?? '').replace(/^Bearer /, '');
  if (!want || !got || want.length !== got.length) return false;
  return timingSafeEqual(Buffer.from(want), Buffer.from(got));
};

export const GET = handle(async (req) => {
  if (!bearerOk(req)) throw new HttpError(401, 'Unauthorized');
  return Response.json(await mirror());
});

export const POST = handle(async (req) => {
  assertSameOrigin(req);
  await requireSuperAdmin();
  const r = await mirror();
  return Response.json({ ...r, message: r.status === 'skipped' ? 'Google Sheet already up to date.' : `Google Sheet updated (${r.rows} rows).` });
});
