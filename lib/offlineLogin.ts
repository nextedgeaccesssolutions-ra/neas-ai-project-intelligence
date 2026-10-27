// Offline sign-in on a device where the person signed in online before.
// After each successful online sign-in the device keeps a slow salted hash (PBKDF2, 310k rounds)
// of the username + passcode, never the passcode itself. Offline, the sign-in page checks the
// passcode against it and opens the work already saved on this device. Server data still needs a
// fresh online sign-in, and a suspended account stops working the next time the device is online.
// 5 wrong passcodes offline lock offline sign-in on this device until the next online sign-in.

const KEY = 'neas-offline-logins';
const MAX_TRIES = 5;

export interface OfflineLogin { username: string; salt: string; hash: string; target: string; savedAt: string; tries: number }

const enc = new TextEncoder();
const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(username: string, pin: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(`${username}:${pin}`), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 310_000 }, key, 256));
}

function readAll(): OfflineLogin[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as OfflineLogin[]; } catch { return []; }
}
function writeAll(list: OfflineLogin[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage blocked: offline sign-in stays off */ }
}

/** Remember this device for offline sign-in. `target` is where the person lands: "/" or "/client/CODE". */
export async function rememberOfflineLogin(username: string, pin: string, target: string): Promise<void> {
  if (!globalThis.crypto?.subtle) return;
  const u = username.trim().toLowerCase();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const entry: OfflineLogin = { username: u, salt: b64(salt), hash: await derive(u, pin, salt), target, savedAt: new Date().toISOString(), tries: 0 };
  writeAll([...readAll().filter((e) => e.username !== u), entry]);
}

export function forgetOfflineLogin(username: string) {
  writeAll(readAll().filter((e) => e.username !== username.trim().toLowerCase()));
}

/** Check a passcode offline. Returns where to go, or an error message. */
export async function checkOfflineLogin(username: string, pin: string): Promise<{ target: string } | { error: string }> {
  const u = username.trim().toLowerCase();
  const list = readAll();
  const e = list.find((x) => x.username === u);
  if (!e || !globalThis.crypto?.subtle) return { error: 'This device has not signed in with this username before. The first sign-in on a device needs an internet connection.' };
  if (e.tries >= MAX_TRIES) return { error: 'Offline sign-in is locked on this device after 5 wrong passcodes. Connect to the internet and sign in.' };
  const ok = (await derive(u, pin, unb64(e.salt))) === e.hash;
  e.tries = ok ? 0 : e.tries + 1;
  writeAll(list);
  if (ok) return { target: e.target };
  return { error: e.tries >= MAX_TRIES ? 'Offline sign-in is now locked on this device. Connect to the internet and sign in.' : `Username or passcode is not correct (${MAX_TRIES - e.tries} offline tries left).` };
}
