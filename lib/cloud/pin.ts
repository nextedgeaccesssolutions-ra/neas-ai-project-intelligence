import 'server-only';
import { createHmac } from 'node:crypto';
import { HttpError } from './server';

// A 6-digit PIN is never stored or sent to Supabase Auth as the password itself. The password is
// derived on the server from the PIN with a server-only key, so guessing PINs directly against
// Supabase's sign-in endpoint (skipping our lockout) is useless without that key.
// Set PIN_PEPPER (32+ random characters) in the server environment before PINs are issued. Without it a
// key is derived from the service-role key, so ROTATING THAT KEY WOULD INVALIDATE EVERY PIN. Changing
// PIN_PEPPER also invalidates every PIN: everyone then sets a new one with a one-time code.
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const PEPPER = process.env.PIN_PEPPER || (SERVICE_ROLE_KEY ? createHmac('sha256', SERVICE_ROLE_KEY).update('neas:pin-pepper:v1').digest('hex') : '');

export function pinPassword(userId: string, pin: string): string {
  if (!PEPPER) throw new HttpError(503, 'PIN sign-in is not configured on the server. Ask your NEAS administrator.');
  return `p1.${createHmac('sha256', PEPPER).update(`neas-pin:v1:${userId}:${pin}`).digest('base64url')}`;
}

/** Answer no sooner than `minMs` (plus jitter), so timing does not reveal which usernames exist. */
export async function padTiming<T>(started: number, value: T, minMs = 700): Promise<T> {
  const wait = minMs + Math.floor(Math.random() * 200) - (Date.now() - started);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  return value;
}
