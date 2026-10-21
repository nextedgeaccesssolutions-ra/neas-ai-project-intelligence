'use client';
import { createBrowserClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { CLOUD, DB_SCHEMA, SUPABASE_ANON_KEY, SUPABASE_URL } from './env';

let client: SupabaseClient | null = null;

/** Browser Supabase client (anon key + the signed-in user's session). Null in device mode. */
export function supabaseBrowser(): SupabaseClient | null {
  if (!CLOUD) return null;
  if (!client) client = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY, { db: { schema: DB_SCHEMA } }) as unknown as SupabaseClient;
  return client;
}

let linkClient: SupabaseClient | null = null;
/**
 * Client used only to REQUEST e-mailed links (sign-in link, password reset). It uses the implicit
 * flow so the link works in any browser or device, not only the one that asked for it. The session
 * it produces is stored by /auth/callback through the normal cookie client above.
 */
export function supabaseLinkClient(): SupabaseClient | null {
  if (!CLOUD) return null;
  if (!linkClient) linkClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { flowType: 'implicit', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return linkClient;
}
