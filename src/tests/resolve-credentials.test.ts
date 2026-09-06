import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// GOTCHA: vi.mock is hoisted above top-level const declarations. Use vi.hoisted()
// to create the shared state the mock factories read.
//
// The keyring mock supplies an EXPLICIT factory rather than relying on
// automocking: automocking imports the real @napi-rs/keyring, which would read
// the developer's actual credential store and make these tests depend on what is
// in it.
const keyring = vi.hoisted(() => ({
  importFails: false,
  values: new Map<string, string>(),
  rejectAccounts: new Set<string>(),
  hangAccounts: new Set<string>(),
  calls: [] as string[],
}));

vi.mock('@napi-rs/keyring', () => {
  class AsyncEntry {
    constructor(
      private readonly service: string,
      private readonly account: string
    ) {}

    getPassword(_signal?: AbortSignal): Promise<string | undefined> {
      keyring.calls.push(`${this.service}/${this.account}`);
      if (keyring.hangAccounts.has(this.account)) return new Promise<string>(() => {});
      if (keyring.rejectAccounts.has(this.account)) {
        return Promise.reject(new Error('credential store is locked'));
      }
      return Promise.resolve(keyring.values.get(this.account));
    }
  }
  // An unavailable native module is modelled as a throwing binding rather than a
  // throwing factory: the factory runs once per module registry, so a later
  // `importFails` flip would otherwise not be seen.
  return {
    get AsyncEntry() {
      if (keyring.importFails) throw new Error('keyring native module unavailable');
      return AsyncEntry;
    },
  };
});

const { mockPost, mockRequest, mockCreate } = vi.hoisted(() => ({
  mockPost: vi.fn(),
  mockRequest: vi.fn(),
  mockCreate: vi.fn(),
}));

// Same shape as transkribus-client.test.ts: importOriginal keeps the real
// AxiosError/AxiosHeaders exports, only `create` is replaced.
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  const mockInstance = {
    post: mockPost,
    request: mockRequest,
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  };
  mockCreate.mockReturnValue(mockInstance);
  return { ...actual, default: { ...actual.default, create: mockCreate } };
});

const DEFAULT_SERVICE = 'transkribus-mcp';
const ENV_VARS = [
  'TRANSKRIBUS_USER',
  'TRANSKRIBUS_PASSWORD',
  'TRANSKRIBUS_SESSION_ID',
  'TRANSKRIBUS_KEYRING_SERVICE',
] as const;

const originalEnv = new Map(ENV_VARS.map((name) => [name, process.env[name]]));

function clearEnv(): void {
  for (const name of ENV_VARS) delete process.env[name];
}

beforeEach(() => {
  vi.resetModules();
  keyring.importFails = false;
  keyring.values.clear();
  keyring.rejectAccounts.clear();
  keyring.hangAccounts.clear();
  keyring.calls.length = 0;
  mockPost.mockReset();
  mockRequest.mockReset();
  clearEnv();
});

afterEach(() => {
  vi.useRealTimers();
  for (const [name, value] of originalEnv) {
    if (value !== undefined) process.env[name] = value;
    else delete process.env[name];
  }
});

// ---------------------------------------------------------------------------
// The PURE selector. Keeping selection free of keyring/env IO means every branch
// is testable without the native module.
// ---------------------------------------------------------------------------

describe('selectCredentials (pure credential-source selection)', () => {
  async function selector() {
    return (await import('../services/transkribus.js')).selectCredentials;
  }

  it('prefers the keyring value over the environment, per field', async () => {
    const selectCredentials = await selector();
    expect(
      selectCredentials({
        keyring: { user: 'keyring-user', password: 'keyring-password', sessionId: 'keyring-session' },
        env: { user: 'env-user', password: 'env-password', sessionId: 'env-session' },
      })
    ).toEqual({ user: 'keyring-user', password: 'keyring-password', sessionId: 'keyring-session' });
  });

  it('falls back to the environment when a keyring value is absent or empty', async () => {
    const selectCredentials = await selector();
    // Empty string is falsy on purpose: an entry that exists but holds nothing
    // must fall through instead of authenticating as the empty user.
    expect(
      selectCredentials({
        keyring: { user: '', password: null, sessionId: undefined },
        env: { user: 'env-user', password: 'env-password', sessionId: 'env-session' },
      })
    ).toEqual({ user: 'env-user', password: 'env-password', sessionId: 'env-session' });
  });

  it('allows the two sources to be mixed', async () => {
    const selectCredentials = await selector();
    expect(
      selectCredentials({
        keyring: { password: 'keyring-password' },
        env: { user: 'env-user' },
      })
    ).toEqual({ user: 'env-user', password: 'keyring-password', sessionId: null });
  });

  it('accepts a session id alone, with no user or password', async () => {
    const selectCredentials = await selector();
    expect(selectCredentials({ keyring: {}, env: { sessionId: 'env-session' } })).toEqual({
      user: null,
      password: null,
      sessionId: 'env-session',
    });
  });

  it('rejects a half-complete login pair when no session id is available', async () => {
    const selectCredentials = await selector();
    expect(() => selectCredentials({ keyring: { user: 'keyring-user' }, env: {} })).toThrow(
      /No Transkribus credentials found/
    );
    expect(() => selectCredentials({ keyring: {}, env: { password: 'env-password' } })).toThrow(
      /No Transkribus credentials found/
    );
  });

  it('throws a clear, secret-free error when neither source has credentials', async () => {
    const selectCredentials = await selector();
    let message = '';
    try {
      // A user name with no password anywhere, and no session id.
      selectCredentials({
        keyring: { user: 'keyring-user' },
        env: { user: 'env-user' },
      });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message, 'expected selectCredentials to throw').not.toBe('');

    // Actionable: names both sources, all three env vars, and how to change the
    // service name.
    expect(message).toContain('OS keyring');
    expect(message).toContain(DEFAULT_SERVICE);
    expect(message).toContain('TRANSKRIBUS_USER');
    expect(message).toContain('TRANSKRIBUS_PASSWORD');
    expect(message).toContain('TRANSKRIBUS_SESSION_ID');
    expect(message).toContain('TRANSKRIBUS_KEYRING_SERVICE');
    // …and echoes no supplied value. The selector takes no service argument at
    // all, so a TRANSKRIBUS_KEYRING_SERVICE mistakenly set to the password
    // cannot reach the message either.
    expect(message).not.toContain('keyring-user');
    expect(message).not.toContain('env-user');
  });
});

// ---------------------------------------------------------------------------
// The IMPURE resolver: keyring reads plus the environment.
// ---------------------------------------------------------------------------

describe('resolveCredentials (keyring reads with environment fallback)', () => {
  async function resolver() {
    return (await import('../services/transkribus.js')).resolveCredentials;
  }

  it('reads all three accounts under the default service name', async () => {
    keyring.values.set('user', 'keyring-user');
    keyring.values.set('password', 'keyring-password');
    process.env.TRANSKRIBUS_USER = 'env-user';

    const resolveCredentials = await resolver();
    await expect(resolveCredentials()).resolves.toEqual({
      user: 'keyring-user',
      password: 'keyring-password',
      sessionId: null,
    });
    expect(keyring.calls.sort()).toEqual([
      `${DEFAULT_SERVICE}/password`,
      `${DEFAULT_SERVICE}/session-id`,
      `${DEFAULT_SERVICE}/user`,
    ]);
  });

  it('honours TRANSKRIBUS_KEYRING_SERVICE', async () => {
    process.env.TRANSKRIBUS_KEYRING_SERVICE = 'transkribus-account-b';
    process.env.TRANSKRIBUS_SESSION_ID = 'env-session';

    const resolveCredentials = await resolver();
    await resolveCredentials();
    expect(keyring.calls).toContain('transkribus-account-b/user');
  });

  it('falls back to the environment when the native module cannot be imported', async () => {
    keyring.importFails = true;
    process.env.TRANSKRIBUS_USER = 'env-user';
    process.env.TRANSKRIBUS_PASSWORD = 'env-password';

    const resolveCredentials = await resolver();
    await expect(resolveCredentials()).resolves.toEqual({
      user: 'env-user',
      password: 'env-password',
      sessionId: null,
    });
    expect(keyring.calls).toEqual([]);
  });

  it('isolates a failing entry, keeping the ones that were read', async () => {
    keyring.values.set('user', 'keyring-user');
    keyring.rejectAccounts.add('password');
    process.env.TRANSKRIBUS_USER = 'env-user';
    process.env.TRANSKRIBUS_PASSWORD = 'env-password';

    const resolveCredentials = await resolver();
    await expect(resolveCredentials()).resolves.toEqual({
      user: 'keyring-user',
      password: 'env-password',
      sessionId: null,
    });
  });

  it('gives up on a read that never settles and uses the environment', async () => {
    vi.useFakeTimers();
    keyring.hangAccounts.add('user');
    keyring.hangAccounts.add('password');
    keyring.hangAccounts.add('session-id');
    process.env.TRANSKRIBUS_USER = 'env-user';
    process.env.TRANSKRIBUS_PASSWORD = 'env-password';

    const resolveCredentials = await resolver();
    const pending = resolveCredentials();
    // The abort signal alone would not end this — napi-rs cannot cancel a read
    // that has already started, so the deadline is what unblocks the server.
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(pending).resolves.toEqual({
      user: 'env-user',
      password: 'env-password',
      sessionId: null,
    });
  });
});

// ---------------------------------------------------------------------------
// The single-flight cache, exercised through the only path that reaches it.
// ---------------------------------------------------------------------------

describe('credential lookup caching', () => {
  it('performs one lookup for concurrent requests', async () => {
    keyring.values.set('session-id', 'keyring-session');
    mockRequest.mockResolvedValue({ data: { ok: true } });

    const { transkribusRequest } = await import('../services/transkribus.js');
    await Promise.all([
      transkribusRequest('GET', '/collections'),
      transkribusRequest('GET', '/collections'),
    ]);

    // Three accounts, read once — not once per caller.
    expect(keyring.calls).toHaveLength(3);
  });

  it('retries the lookup after a failure instead of caching the rejection', async () => {
    mockRequest.mockResolvedValue({ data: { ok: true } });
    const { transkribusRequest } = await import('../services/transkribus.js');

    // No keyring entries, no env vars: the first call fails.
    await expect(transkribusRequest('GET', '/collections')).rejects.toThrow(
      /No Transkribus credentials found/
    );

    // A credential provided afterwards is picked up without restarting the
    // process — the rejected promise must not have been cached.
    process.env.TRANSKRIBUS_SESSION_ID = 'env-session';
    await expect(transkribusRequest('GET', '/collections')).resolves.toEqual({ ok: true });
  });
});
