import 'server-only';
import { createHmac } from 'node:crypto';

// A 6-digit PIN is never stored or sent to Supabase Auth as the password itself. The password is
// derived on the server from the PIN with a server-only key, so guessing PINs directly against
// Supabase's sign-in endpoint (skipping our lockout) is useless without that key.
// PIN_PEPPER can be set explicitly; otherwise a key is derived (HMAC, domain-separated) from the
// server-only service-role key. Changing either invalidates every PIN (people set a new one with a code).
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const PEPPER = process.env.PIN_PEPPER || (SERVICE_ROLE_KEY ? createHmac('sha256', SERVICE_ROLE_KEY).update('neas:pin-pepper:v1').digest('hex') : '');

export function pinPassword(userId: string, pin: string): string {
  if (!PEPPER) throw new Error('PIN sign-in is not configured on the server');
  return `p1.${createHmac('sha256', PEPPER).update(`neas-pin:v1:${userId}:${pin}`).digest('base64url')}`;
}

/** Answer no sooner than `minMs` (plus jitter), so timing does not reveal which usernames exist. */
export async function padTiming<T>(started: number, value: T, minMs = 700): Promise<T> {
  const wait = minMs + Math.floor(Math.random() * 200) - (Date.now() - started);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  return value;
}
