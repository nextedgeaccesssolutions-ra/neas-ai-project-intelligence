'use client';
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CLOUD, DB_SCHEMA, SUPABASE_ANON_KEY, SUPABASE_URL } from './env';

let client: SupabaseClient | null = null;

/** Browser Supabase client (anon key + the signed-in user's session). Null in device mode. */
export function supabaseBrowser(): SupabaseClient | null {
  if (!CLOUD) return null;
  if (!client) client = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY, { db: { schema: DB_SCHEMA } }) as unknown as SupabaseClient;
  return client;
}
