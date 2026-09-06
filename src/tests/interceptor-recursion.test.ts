import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AxiosError } from 'axios';

// GOTCHA: a vi.fn() mock of the whole axios instance (as
// transkribus-client.test.ts uses) makes interceptors.use() a no-op — the
// interceptor pipeline never runs, so it CANNOT reproduce interceptor
// recursion; a test built on that mock would observe a bounded failure and
// falsely certify the #30 bug as absent. Instead, wrap the REAL axios.create
// so every instance the service module builds (both the main client and the
// dedicated login client) runs the genuine interceptor pipeline, with
// networking swapped out via a test-controlled `adapter`.
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

// The service module reads the OS keyring before the environment. Stub the
// native module so these env-driven tests never touch a real credential store —
// a developer with entries stored under the default service name would
// otherwise see them override the env vars set below.
vi.mock('@napi-rs/keyring', () => ({
  AsyncEntry: class {
    getPassword(): Promise<string | undefined> {
      return Promise.resolve(undefined);
    }
  },
}));

// GOTCHA: an adapter that RESOLVES a response with status 401 never enters
// axios's onRejected chain — settling status/rejection is the adapter's own
// job. Reject with a genuine AxiosError carrying `.config` (so the
// interceptor's `error.config` guard passes) and a `.response.status`.
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

describe('interceptor recursion (#30) — real adapter, genuine interceptor pipeline', () => {
  const originalEnv = {
    user: process.env.TRANSKRIBUS_USER,
    password: process.env.TRANSKRIBUS_PASSWORD,
    session: process.env.TRANSKRIBUS_SESSION_ID,
  };

  beforeEach(() => {
    vi.resetModules();
    // Session lets ensureSession() short-circuit so the protected request is
    // actually reached; credentials are required for login() to get as far as
    // POSTing /auth/login (without them it throws before any network call).
    process.env.TRANSKRIBUS_SESSION_ID = 'stale-session-id';
    process.env.TRANSKRIBUS_USER = 'test-user';
    process.env.TRANSKRIBUS_PASSWORD = 'test-password';
  });

  afterEach(() => {
    if (originalEnv.user !== undefined) process.env.TRANSKRIBUS_USER = originalEnv.user;
    else delete process.env.TRANSKRIBUS_USER;
    if (originalEnv.password !== undefined) process.env.TRANSKRIBUS_PASSWORD = originalEnv.password;
    else delete process.env.TRANSKRIBUS_PASSWORD;
    if (originalEnv.session !== undefined) process.env.TRANSKRIBUS_SESSION_ID = originalEnv.session;
    else delete process.env.TRANSKRIBUS_SESSION_ID;
  });

  it('Test A — a 401 from /auth/login itself does not recurse unboundedly', async () => {
    // Hard-kill so the UNFIXED run terminates instead of hanging: pre-fix,
    // login() reuses the main client, so a 401 from /auth/login re-enters the
    // same 401 handler with a fresh (unflagged) config and recurses.
    const HARD_KILL = 10;
    let protectedHits = 0;
    let loginHits = 0;

    setAdapter(async (config) => {
      const url = config.url as string;
      if (url === '/auth/login') {
        loginHits++;
        if (loginHits > HARD_KILL) throw new Error('hard-kill: login recursion did not stop');
        throw make401(config);
      }
      protectedHits++;
      if (protectedHits > HARD_KILL) throw new Error('hard-kill: protected retries did not stop');
      throw make401(config);
    });

    const { transkribusRequest } = await import('../services/transkribus.js');
    const result = await transkribusRequest('GET', '/collections').catch((e: unknown) => e);

    expect(result).toBeInstanceOf(Error);
    // Post-fix: loginClient has no 401 branch, so it rejects immediately;
    // login() rethrows; the main client's catch(loginErr) returns
    // sessionExpiredError without ever retrying the original request.
    expect(protectedHits).toBe(1);
    expect(loginHits).toBe(1);
  });

  it('Test B — a successful re-login retries the original request exactly once (regression guard)', async () => {
    let protectedHits = 0;
    let loginHits = 0;

    setAdapter(async (config) => {
      const url = config.url as string;
      if (url === '/auth/login') {
        loginHits++;
        return { status: 200, statusText: 'OK', headers: {}, config, data: { sessionId: 'fresh-session-id' } };
      }
      protectedHits++;
      if (protectedHits === 1) throw make401(config);
      return { status: 200, statusText: 'OK', headers: {}, config, data: { ok: true } };
    });

    const { transkribusRequest } = await import('../services/transkribus.js');
    const result = await transkribusRequest('GET', '/collections');

    expect(result).toEqual({ ok: true });
    // Proves the loginClient split did not break stale-session re-auth: the
    // main client's request interceptor attaches the newly-assigned sessionId
    // on the retried request.
    expect(protectedHits).toBe(2);
    expect(loginHits).toBe(1);
  });
});
