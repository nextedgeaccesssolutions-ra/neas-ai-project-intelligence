// Input validation shared by API routes and forms. Pure functions (unit-tested).

const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/** Common disposable-mailbox providers. Extend from a maintained list (e.g. disposable-email-domains) before go-live. */
export const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'sharklasers.com', '10minutemail.com', '10minutemail.net', 'tempmail.com',
  'temp-mail.org', 'temp-mail.io', 'tempmailo.com', 'throwawaymail.com', 'yopmail.com', 'yopmail.net', 'getnada.com', 'nada.email',
  'trashmail.com', 'trashmail.de', 'dispostable.com', 'maildrop.cc', 'mailnesia.com', 'mintemail.com', 'mohmal.com', 'emailondeck.com',
  'fakeinbox.com', 'spamgourmet.com', 'mailcatch.com', 'tempail.com', 'burnermail.io', 'discard.email', 'moakt.com', 'tmail.ws',
  'mail.tm', 'tempr.email', 'inboxkitten.com', 'getairmail.com', 'mytemp.email', 'emailfake.com', 'tmpmail.org', 'harakirimail.com', 'mailpoof.com',
]);

export function normaliseEmail(e: string): string {
  return e.trim().toLowerCase();
}

export function checkEmail(raw: string): { ok: true; email: string } | { ok: false; error: string } {
  const email = normaliseEmail(raw ?? '');
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return { ok: false, error: 'Enter a valid e-mail address.' };
  const domain = email.split('@')[1];
  if (DISPOSABLE_DOMAINS.has(domain) || [...DISPOSABLE_DOMAINS].some((d) => domain.endsWith('.' + d)))
    return { ok: false, error: 'Use your work or personal e-mail. Temporary inboxes are not accepted.' };
  return { ok: true, email };
}

export function checkName(raw: string): { ok: true; name: string } | { ok: false; error: string } {
  const name = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 120) return { ok: false, error: 'Enter your full name (2–120 characters).' };
  if (/[<>{}\\]/.test(name)) return { ok: false, error: 'Your name contains characters that are not allowed.' };
  return { ok: true, name };
}

/** At least 12 characters with three of: lower, upper, digit, symbol. */
export function checkPassword(pw: string): string[] {
  const problems: string[] = [];
  if ((pw ?? '').length < 12) problems.push('at least 12 characters');
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw ?? '')).length;
  if (classes < 3) problems.push('three of: lowercase, uppercase, number, symbol');
  if (/^(.)\1+$/.test(pw ?? '') || /password|neas|12345/i.test(pw ?? '')) problems.push('no obvious words or repeated characters');
  return problems;
}

/** Usernames: 3–32 lowercase letters, digits, dots or dashes, starting with a letter or digit. */
export const USERNAME_RE = /^[a-z0-9][a-z0-9.-]{2,31}$/;
export const normaliseUsername = (u: string) => (u ?? '').trim().toLowerCase();
export const checkUsername = (u: string) => USERNAME_RE.test(normaliseUsername(u));

/** A PIN is exactly 6 digits; all-same digits and simple runs are refused. */
export function checkPin(pin: string): string | null {
  if (!/^\d{6}$/.test(pin ?? '')) return 'Your PIN must be exactly 6 digits.';
  if (new Set(pin).size === 1 || '0123456789'.includes(pin) || '9876543210'.includes(pin)) return 'Choose a PIN that is not all the same digit or a simple run like 123456.';
  return null;
}

export const PROJECT_CODE_RE = /^[A-Z0-9][A-Z0-9-]{2,39}$/;
export function normaliseProjectCode(c: string): string {
  return (c ?? '').trim().toUpperCase();
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
