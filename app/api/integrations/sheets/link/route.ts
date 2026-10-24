import { handle, requireSuperAdmin } from '@/lib/cloud/server';
import { sheetUrl } from '@/lib/cloud/sheetLink';

export const dynamic = 'force-dynamic';

// Link to the master Google Sheet, for Super Admins only.
export const GET = handle(async () => {
  await requireSuperAdmin();
  return Response.json({ url: sheetUrl() }, { headers: { 'Cache-Control': 'private, no-store' } });
});
