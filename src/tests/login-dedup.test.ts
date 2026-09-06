import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AxiosError } from 'axios';

// Same harness as interceptor-recursion.test.ts, and for the same reason: a
// vi.fn() mock of the whole axios instance makes interceptors.use() a no-op, so
// it cannot observe how many times the real pipeline reaches /auth/login. Wrap
// the REAL axios.create and swap networking out through a test-controlled
// `adapter` instead.
type StubAdapter = (config: Record<string, unknown>) => Promise<Record<string, unknown>>;

const { getAdapter, setAdapter } = vi.hoisted(() => {
  let current: StubAdapter | null = null;
  return {
    getAdapter: (): StubAdapter | null => current,
    setAdapter: (fn: StubAdapter): void => {
      current = fn;
    },
  };
});

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return {
    ...actual,
    default: {
      ...actual.default,
      create: (config: Record<string, unknown> = {}) =>
        actual.default.create({
          ...config,
          adapter: ((cfg: Record<string, unknown>) => {
            const adapter = getAdapter();
            if (!adapter) return Promise.reject(new Error('test adapter not configured'));
            return adapter(cfg);
          }) as never,
        }),
    },
  };
});

function make401(config: Record<string, unknown>): AxiosError {
  const response = { status: 401, statusText: 'Unauthorized', headers: {}, config, data: {} };
  return new AxiosError(
    'Request failed with status code 401',
    'ERR_BAD_REQUEST',
    config as never,
    undefined,
    response as never
  );
}

function ok(config: Record<string, unknown>, data: unknown): Record<string, unknown> {
  return { status: 200, statusText: 'OK', headers: {}, config, data };
}

describe('in-flight login de-duplication (#39)', () => {
  const originalEnv = {
    user: process.env.TRANSKRIBUS_USER,
    password: process.env.TRANSKRIBUS_PASSWORD,
    session: process.env.TRANSKRIBUS_SESSION_ID,
  };

  beforeEach(() => {
    vi.resetModules();
    process.env.TRANSKRIBUS_USER = 'test-user';
    process.env.TRANSKRIBUS_PASSWORD = 'test-password';
    delete process.env.TRANSKRIBUS_SESSION_ID;
  });

  afterEach(() => {
    if (originalEnv.user !== undefined) process.env.TRANSKRIBUS_USER = originalEnv.user;
    else delete process.env.TRANSKRIBUS_USER;
    if (originalEnv.password !== undefined) process.env.TRANSKRIBUS_PASSWORD = originalEnv.password;
    else delete process.env.TRANSKRIBUS_PASSWORD;
    if (originalEnv.session !== undefined) process.env.TRANSKRIBUS_SESSION_ID = originalEnv.session;
    else delete process.env.TRANSKRIBUS_SESSION_ID;
  });

  it('cold start: five concurrent tool calls share ONE /auth/login', async () => {
    let loginHits = 0;
    let protectedHits = 0;
    let releaseLogin: () => void = () => {};
    const loginGate = new Promise<void>((resolve) => {
      releaseLogin = resolve;
    });

    setAdapter(async (config) => {
      if (config.url === '/auth/login') {
        loginHits++;
        // Hold the login open so every concurrent caller is genuinely in
        // flight at the same time — without this the first one could settle
        // before the others even ask, and the test would pass vacuously.
        await loginGate;
        return ok(config, { sessionId: 'fresh-session-id' });
      }
      protectedHits++;
      return ok(config, { ok: true });
    });

    const { transkribusRequest } = await import('../services/transkribus.js');
    const calls = Promise.all(
      Array.from({ length: 5 }, () => transkribusRequest('GET', '/collections'))
    );
    await vi.waitFor(() => expect(loginHits).toBeGreaterThan(0));
    releaseLogin();

    expect(await calls).toEqual(Array.from({ length: 5 }, () => ({ ok: true })));
    expect(loginHits).toBe(1);
    expect(protectedHits).toBe(5);
  });

  it('three concurrent 401s share ONE re-login', async () => {
    process.env.TRANSKRIBUS_SESSION_ID = 'stale-session-id';
    let loginHits = 0;
    let protectedHits = 0;
    let releaseLogin: () => void = () => {};
    const loginGate = new Promise<void>((resolve) => {
      releaseLogin = resolve;
    });

    setAdapter(async (config) => {
      if (config.url === '/auth/login') {
        loginHits++;
        await loginGate;
        return ok(config, { sessionId: 'fresh-session-id' });
      }
      protectedHits++;
      if (protectedHits <= 3) throw make401(config);
      return ok(config, { ok: true });
    });

    const { transkribusRequest } = await import('../services/transkribus.js');
    const calls = Promise.all(
      Array.from({ length: 3 }, () => transkribusRequest('GET', '/collections'))
    );
    // Hold the re-login pending until all three 401 handlers have entered it,
    // so the overlap the memo is supposed to collapse actually exists.
    await vi.waitFor(() => expect(protectedHits).toBe(3));
    releaseLogin();

    expect(await calls).toEqual(Array.from({ length: 3 }, () => ({ ok: true })));
    expect(loginHits).toBe(1);
    expect(protectedHits).toBe(6);
  });

  it('a failed login rejects the whole burst and does not poison the memo', async () => {
    let loginHits = 0;
    let loginShouldFail = true;
    let releaseLogin: () => void = () => {};
    const loginGate = new Promise<void>((resolve) => {
      releaseLogin = resolve;
    });

    setAdapter(async (config) => {
      if (config.url === '/auth/login') {
        loginHits++;
        if (loginShouldFail) {
          await loginGate;
          throw make401(config);
        }
        return ok(config, { sessionId: 'fresh-session-id' });
      }
      return ok(config, { ok: true });
    });

    const { transkribusRequest } = await import('../services/transkribus.js');
    const burst = Promise.allSettled(
      Array.from({ length: 3 }, () => transkribusRequest('GET', '/collections'))
    );
    await vi.waitFor(() => expect(loginHits).toBeGreaterThan(0));
    releaseLogin();

    const settled = await burst;
    expect(settled.map((r) => r.status)).toEqual(['rejected', 'rejected', 'rejected']);
    // One login for the whole failed burst — not one per caller.
    expect(loginHits).toBe(1);

    // The memo is cleared on failure too, so the next call logs in again
    // instead of re-awaiting a permanently rejected promise.
    loginShouldFail = false;
    expect(await transkribusRequest('GET', '/collections')).toEqual({ ok: true });
    expect(loginHits).toBe(2);
  });
});
