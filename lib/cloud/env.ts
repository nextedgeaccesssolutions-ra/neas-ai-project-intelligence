// Public configuration (safe in the browser). Secrets live only in lib/cloud/server.ts.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
/** Cloud mode = Supabase configured. Without it the app runs in device mode (local storage only). */
export const CLOUD = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
export const DB_SCHEMA = 'neas';
export const FILES_BUCKET = 'neas-project-files';
/** How long an already-signed-in user may keep working offline before signing in again. */
export const OFFLINE_GRACE_HOURS = Number(process.env.NEXT_PUBLIC_OFFLINE_GRACE_HOURS ?? 72);
