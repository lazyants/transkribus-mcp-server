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

// A login the test holds open, so several callers are provably in flight at the
// same time before any of them settles.
function loginGate(): { wait: Promise<void>; release: () => void } {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, release };
}

describe('in-flight login de-duplication (#39)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('TRANSKRIBUS_USER', 'test-user');
    vi.stubEnv('TRANSKRIBUS_PASSWORD', 'test-password');
    // Undefined removes the key outright, so ensureSession() cannot short-circuit.
    vi.stubEnv('TRANSKRIBUS_SESSION_ID', undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('cold start: five concurrent tool calls share ONE /auth/login', async () => {
    let loginHits = 0;
    let protectedHits = 0;
    const gate = loginGate();

    setAdapter(async (config) => {
      if (config.url === '/auth/login') {
        loginHits++;
        // All five callers reach loginOnce() in the same synchronous turn — the
        // gate is not what creates the overlap here, it just keeps the overlap
        // from depending on that scheduling detail.
        await gate.wait;
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
    gate.release();

    expect(await calls).toEqual(Array.from({ length: 5 }, () => ({ ok: true })));
    expect(loginHits).toBe(1);
    expect(protectedHits).toBe(5);
  });

  it('three concurrent 401s share ONE re-login', async () => {
    vi.stubEnv('TRANSKRIBUS_SESSION_ID', 'stale-session-id');
    let loginHits = 0;
    let protectedHits = 0;
    const gate = loginGate();

    setAdapter(async (config) => {
      if (config.url === '/auth/login') {
        loginHits++;
        // Here the gate IS load-bearing: the three 401s arrive asynchronously,
        // so without it the memo could clear between them.
        await gate.wait;
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
    gate.release();

    expect(await calls).toEqual(Array.from({ length: 3 }, () => ({ ok: true })));
    expect(loginHits).toBe(1);
    expect(protectedHits).toBe(6);
  });

  it('a failed login rejects the whole burst and does not poison the memo', async () => {
    let loginHits = 0;
    let loginShouldFail = true;
    const gate = loginGate();

    setAdapter(async (config) => {
      if (config.url === '/auth/login') {
        loginHits++;
        if (loginShouldFail) {
          await gate.wait;
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
    gate.release();

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
