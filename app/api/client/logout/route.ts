import { cookies } from 'next/headers';
import { assertSameOrigin, handle, supabaseService } from '@/lib/cloud/server';

export const dynamic = 'force-dynamic';

export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const raw = cookies().get('neas_client')?.value ?? '';
  const token = raw.split('.')[1];
  if (token) await supabaseService().rpc('client_logout', { p_token: token });
  cookies().delete('neas_client');
  return Response.json({ ok: true });
});
