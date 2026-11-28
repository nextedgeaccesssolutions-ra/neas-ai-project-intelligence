import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => [],
    set: vi.fn(),
  }),
}));

import { handle } from '../lib/cloud/server';

describe('Next.js 16 route context compatibility', () => {
  it('forwards asynchronous route params to the wrapped handler', async () => {
    const route = handle(async (_request, { params }) => {
      const { id } = await params as { id: string };
      return Response.json({ id });
    });

    const response = await route(
      new Request('https://neas.example/api/admin/users/user-123'),
      { params: Promise.resolve({ id: 'user-123' }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: 'user-123' });
  });
});