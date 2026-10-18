import 'server-only';
import { createHmac, createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { DB_SCHEMA, SUPABASE_ANON_KEY, SUPABASE_URL } from './env';

/** Server secrets. Never imported by client components ('server-only' enforces this at build time). */
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CLIENT_PORTAL_SECRET = process.env.CLIENT_PORTAL_SECRET ?? '';

export function requireEnv() {
  const missing = [
    ['NEXT_PUBLIC_SUPABASE_URL', SUPABASE_URL],
    ['NEXT_PUBLIC_SUPABASE_ANON_KEY', SUPABASE_ANON_KEY],
    ['SUPABASE_SERVICE_ROLE_KEY', SERVICE_ROLE_KEY],
    ['CLIENT_PORTAL_SECRET', CLIENT_PORTAL_SECRET],
  ].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new HttpError(503, `Server is not configured: ${missing.join(', ')}`);
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Supabase client acting as the signed-in user (RLS applies). */
export function supabaseAsUser(): SupabaseClient {
  const store = cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    db: { schema: DB_SCHEMA },
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          /* called from a server component: cookies are read-only there */
        }
      },
    },
  }) as unknown as SupabaseClient;
}

/** Service-role client. Bypasses RLS: use only after an explicit authorization check. */
export function supabaseService(): SupabaseClient {
  requireEnv();
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { db: { schema: DB_SCHEMA }, auth: { persistSession: false, autoRefreshToken: false } }) as unknown as SupabaseClient;
}

/** The signed-in, active user, or a 401/403. Authorization itself is enforced again by RLS. */
export async function requireUser() {
  const sb = supabaseAsUser();
  const { data, error } = await sb.auth.getUser();
  if (error || !data.user) throw new HttpError(401, 'Sign in required');
  const { data: active } = await sb.rpc('is_active_user');
  if (!active) throw new HttpError(403, 'Your account is not active');
  return { sb, user: data.user };
}

export async function requireSuperAdmin() {
  const ctx = await requireUser();
  const { data: admin } = await ctx.sb.rpc('is_super_admin');
  if (!admin) throw new HttpError(403, 'Super Admin only');
  return ctx;
}

/** Keyed hash of the caller's IP for throttling without storing raw addresses. */
export function ipHash(req: Request): string {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
  return createHmac('sha256', CLIENT_PORTAL_SECRET || 'unset').update(ip).digest('hex');
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function appUrl(req: Request): string {
  return process.env.APP_URL || new URL(req.url).origin;
}

/** Uniform JSON responses; internal error details are never sent to the browser. */
export function handle(fn: (req: Request, ctx: { params: Record<string, string> }) => Promise<Response>) {
  return async (req: Request, ctx: { params: Record<string, string> }) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
      console.error('[api]', (e as Error)?.message);
      return Response.json({ error: 'Something went wrong. Try again.' }, { status: 500 });
    }
  };
}

export async function readJson<T>(req: Request, max = 64 * 1024): Promise<T> {
  const text = await req.text();
  if (text.length > max) throw new HttpError(413, 'Request too large');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

/** Same-origin check for state-changing requests (CSRF defence in depth alongside SameSite cookies). */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin && origin !== process.env.APP_URL) throw new HttpError(403, 'Cross-site request refused');
}
