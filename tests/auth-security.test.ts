import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../lib/cloud/server', () => ({
  HttpError: class HttpError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

describe('PIN credential security', () => {
  let pinPassword: (userId: string, pin: string) => string;

  beforeAll(async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-service-role-secret-with-enough-entropy';
    delete process.env.PIN_PEPPER;
    ({ pinPassword } = await import('../lib/cloud/pin'));
  });

  it('derives a non-reversible-looking server credential instead of storing the six digits', () => {
    const pin = '482916';
    const credential = pinPassword('00000000-0000-0000-0000-000000000001', pin);
    expect(credential).toMatch(/^p1\.[A-Za-z0-9_-]{43}$/);
    expect(credential).not.toContain(pin);
    expect(credential).not.toBe(pin);
  });

  it('binds the derived credential to the individual account', () => {
    const pin = '482916';
    expect(pinPassword('user-a', pin)).not.toBe(pinPassword('user-b', pin));
  });

  it('changes the derived credential when the PIN changes', () => {
    const userId = '00000000-0000-0000-0000-000000000001';
    expect(pinPassword(userId, '482916')).not.toBe(pinPassword(userId, '482917'));
  });

  it('refuses to derive a credential without a server-side pepper', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = '';
    process.env.PIN_PEPPER = '';
    vi.resetModules();
    const { pinPassword: withoutPepper } = await import('../lib/cloud/pin');
    expect(() => withoutPepper('user-a', '482916')).toThrow(/not configured/);
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-service-role-secret-with-enough-entropy';
  });
});
