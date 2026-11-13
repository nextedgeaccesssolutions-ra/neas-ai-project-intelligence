import { assertSameOrigin, handle, requireUser, supabaseService } from '@/lib/cloud/server';
import { mirror } from '@/lib/cloud/sheetsMirror';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Event-driven Sheet update after a change (report generated, records synced). Any signed-in member
// may ask; updates are coalesced to at most one every 2 minutes, and unchanged data is skipped.
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  await requireUser();
  if (!process.env.SHEETS_WEBHOOK_URL || !process.env.SHEETS_WEBHOOK_SECRET) return Response.json({ status: 'not_configured' });
  const { data: last } = await supabaseService().from('integration_sync_log').select('at').order('at', { ascending: false }).limit(1).maybeSingle();
  if (last?.at && Date.now() - Date.parse(last.at) < 120_000) return Response.json({ status: 'debounced' });
  return Response.json(await mirror());
});
