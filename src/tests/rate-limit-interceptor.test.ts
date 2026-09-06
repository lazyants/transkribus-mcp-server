import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AxiosError } from 'axios';
import { MAX_RETRIES } from '../constants.js';

// First real coverage of the 429 branch of attachRateLimitInterceptor (#31).
//
// GOTCHA (same as interceptor-recursion.test.ts): a vi.fn() mock of the whole
// axios instance makes interceptors.use() a no-op, so the interceptor body never
// runs and the test would certify nothing. Wrap the REAL axios.create instead and
// swap networking out via a test-controlled `adapter`.
//
// GOTCHA (fake timers): the interceptor `await`s a real setTimeout promise inside
// its async rejection handler. With vi.useFakeTimers() that timer only fires when
// the test advances the clock, so the request promise must be STARTED and held —
// awaiting it before advancing deadlocks the test.
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

// An adapter that RESOLVES a 429 response never enters axios's onRejected chain —
// settling is the adapter's job. Reject with a genuine AxiosError carrying
// `.config` and `.response.status` so the interceptor's guards pass. Header keys
// are lowercase because axios normalizes real response headers that way.
function make429(config: Record<string, unknown>, retryAfter?: string): AxiosError {
  const headers: Record<string, string> = {};
  if (retryAfter !== undefined) headers['retry-after'] = retryAfter;
  const response = { status: 429, statusText: 'Too Many Requests', headers, config, data: {} };
  return new AxiosError(
    'Request failed with status code 429',
    'ERR_BAD_REQUEST',
    config as never,
    undefined,
    response as never
  );
}

// Drives the whole scenario for one Retry-After value: a single 429 carrying that
// header, then a 200, with the retry asserted to land at EXACTLY `delayMs`. The
// hit counter is what lets us assert WHEN the retry happened, not merely that it
// happened, and the split advance (delayMs - 1, then 1) is what distinguishes a
// correct wait from the #31 immediate retry.
async function expectRetryFiresAfter(
  retryAfter: string | undefined,
  delayMs: number
): Promise<void> {
  let hits = 0;
  setAdapter(async (config) => {
    hits++;
    if (hits === 1) throw make429(config, retryAfter);
    return { status: 200, statusText: 'OK', headers: {}, config, data: { ok: true } };
  });

  const { transkribusRequest } = await import('../services/transkribus.js');
  // Per the fake-timer GOTCHA above: `pending` is STARTED and held, never awaited
  // until the clock has been advanced past the interceptor's setTimeout.
  const pending = transkribusRequest('GET', '/collections');

  await vi.advanceTimersByTimeAsync(delayMs - 1);
  expect(hits).toBe(1); // still waiting — this is what the bug broke

  await vi.advanceTimersByTimeAsync(1);
  await expect(pending).resolves.toEqual({ ok: true });
  expect(hits).toBe(2);
}

describe('429 rate-limit interceptor (#31) — real adapter, genuine interceptor pipeline', () => {
  const originalEnv = {
    user: process.env.TRANSKRIBUS_USER,
    password: process.env.TRANSKRIBUS_PASSWORD,
    session: process.env.TRANSKRIBUS_SESSION_ID,
  };
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    // A session lets ensureSession() short-circuit, so no login request is
    // involved and every adapter hit below is the protected request itself.
    process.env.TRANSKRIBUS_SESSION_ID = 'test-session-id';
    delete process.env.TRANSKRIBUS_USER;
    delete process.env.TRANSKRIBUS_PASSWORD;
    // A fixed clock so an HTTP-date Retry-After is an exact, assertable offset.
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-01-01T00:00:00Z'));
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
    vi.useRealTimers();
    if (originalEnv.user !== undefined) process.env.TRANSKRIBUS_USER = originalEnv.user;
    else delete process.env.TRANSKRIBUS_USER;
    if (originalEnv.password !== undefined) process.env.TRANSKRIBUS_PASSWORD = originalEnv.password;
    else delete process.env.TRANSKRIBUS_PASSWORD;
    if (originalEnv.session !== undefined) process.env.TRANSKRIBUS_SESSION_ID = originalEnv.session;
    else delete process.env.TRANSKRIBUS_SESSION_ID;
  });

  it('waits the full HTTP-date Retry-After instead of retrying immediately', async () => {
    // THE #31 REGRESSION. 2026-01-01 is a Thursday; the header names an instant
    // 30s after the frozen clock. Pre-fix, parseInt('Thu, ...') was NaN and
    // setTimeout(NaN) fired at once, so the retry landed inside the rate-limit
    // window — hits would already be 2 at t+0.
    await expectRetryFiresAfter('Thu, 01 Jan 2026 00:00:30 GMT', 30_000);
  });

  it('waits exactly the delta-seconds Retry-After', async () => {
    await expectRetryFiresAfter('2', 2_000);
  });

  it('falls back to exponential backoff when Retry-After is unparseable', async () => {
    // An unparseable header must behave exactly like an absent one: 2^0 * 1000ms
    // on the first retry. Pre-fix this was parseInt('soon') → NaN → immediate.
    await expectRetryFiresAfter('soon', 1_000);
  });

  it('falls back to exponential backoff when Retry-After is absent', async () => {
    await expectRetryFiresAfter(undefined, 1_000);
  });

  it('gives up after MAX_RETRIES retries and rejects with the rate-limit error', async () => {
    let hits = 0;
    setAdapter(async (config) => {
      hits++;
      throw make429(config, '1');
    });

    const { transkribusRequest } = await import('../services/transkribus.js');
    const settled = transkribusRequest('GET', '/collections').catch((e: unknown) => e);

    // One second per retry; advance past every scheduled wait.
    await vi.advanceTimersByTimeAsync(1_000 * (MAX_RETRIES + 1));

    const result = await settled;
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe('Rate limit exceeded after maximum retries');
    // The initial attempt plus exactly MAX_RETRIES retries — no more.
    expect(hits).toBe(MAX_RETRIES + 1);
  });
});
