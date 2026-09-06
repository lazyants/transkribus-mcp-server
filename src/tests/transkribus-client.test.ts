import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import util from 'node:util';
import { AxiosError, AxiosHeaders } from 'axios';

// GOTCHA: vi.mock is hoisted above top-level const declarations. Use vi.hoisted()
// to create mock fns that are accessible inside the vi.mock factory.
const { mockPost, mockRequest, mockCreate } = vi.hoisted(() => ({
  mockPost: vi.fn(),
  mockRequest: vi.fn(),
  mockCreate: vi.fn(),
}));

// GOTCHA: Must use importOriginal to preserve the real AxiosError/AxiosHeaders
// classes — a plain mock factory that only returns { default: ... } drops all
// named exports. transkribus registers BOTH a request and a response interceptor
// (createClient), unlike lexware which has only a response interceptor.
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
  return {
    ...actual,
    default: {
      ...actual.default,
      create: mockCreate,
    },
  };
});

// Sentinel cookie value; if it survives anywhere in a chained/serialized error,
// the session cookie has leaked out of the initial-login failure path.
const COOKIE_VALUE = 'session-secret-cookie-value';

// Sentinel password, used BOTH as TRANSKRIBUS_PASSWORD and in the seeded config
// below, so the value asserted on is the one login() actually sent.
const PASSWORD_VALUE = 'login-secret-password-value';

// Build a fake login AxiosError seeded with JSESSIONID everywhere axios stashes
// it: request config Cookie header, the raw request._header block, and the
// /auth/login response Set-Cookie header (real AxiosHeaders → exercises .delete).
// The password is seeded alongside it on config.data and config.params — the two
// request-side credential surfaces scrubConfig drops (#26 body, #32b query).
function makeSeededLoginAxiosError(): AxiosError {
  const err = new AxiosError('Request failed with status code 500', 'ERR_BAD_RESPONSE');
  const config = {
    url: '/auth/login',
    method: 'POST',
    headers: { Cookie: `JSESSIONID=${COOKIE_VALUE}` },
    data: `user=test-user&pw=${PASSWORD_VALUE}`,
    params: { pw: PASSWORD_VALUE },
  } as unknown as AxiosError['config'];
  err.config = config;
  (err as { request?: unknown }).request = {
    _header: `POST /auth/login HTTP/1.1\r\nCookie: JSESSIONID=${COOKIE_VALUE}\r\n\r\n`,
  };
  const responseHeaders = new AxiosHeaders();
  responseHeaders.set('set-cookie', [`JSESSIONID=${COOKIE_VALUE}; Path=/; HttpOnly`]);
  err.response = {
    status: 500,
    statusText: 'Internal Server Error',
    data: 'login failed',
    headers: responseHeaders,
    config,
    request: {
      _header: `POST /auth/login HTTP/1.1\r\nCookie: JSESSIONID=${COOKIE_VALUE}\r\n\r\n`,
    },
  } as unknown as AxiosError['response'];
  return err;
}

describe('transkribus client — initial login failure cookie redaction', () => {
  const originalUser = process.env.TRANSKRIBUS_USER;
  const originalPassword = process.env.TRANSKRIBUS_PASSWORD;
  const originalSession = process.env.TRANSKRIBUS_SESSION_ID;

  beforeEach(() => {
    vi.resetModules();
    process.env.TRANSKRIBUS_USER = 'test-user';
    process.env.TRANSKRIBUS_PASSWORD = PASSWORD_VALUE;
    // Must be unset, else ensureSession short-circuits and never calls login().
    delete process.env.TRANSKRIBUS_SESSION_ID;
    mockPost.mockReset();
    mockRequest.mockReset();
    mockCreate.mockClear();
    const mockInstance = {
      post: mockPost,
      request: mockRequest,
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
      },
    };
    mockCreate.mockReturnValue(mockInstance);
  });

  afterEach(() => {
    if (originalUser !== undefined) process.env.TRANSKRIBUS_USER = originalUser;
    else delete process.env.TRANSKRIBUS_USER;
    if (originalPassword !== undefined) process.env.TRANSKRIBUS_PASSWORD = originalPassword;
    else delete process.env.TRANSKRIBUS_PASSWORD;
    if (originalSession !== undefined) process.env.TRANSKRIBUS_SESSION_ID = originalSession;
    else delete process.env.TRANSKRIBUS_SESSION_ID;
  });

  it('does not leak JSESSIONID or the login password when the initial /auth/login POST fails', async () => {
    // ensureSession() calls login() OUTSIDE transkribusRequest's try/catch, so a
    // failed /auth/login AxiosError propagates raw — proving login()'s own
    // try/catch sanitized it before it escaped.
    mockPost.mockRejectedValueOnce(makeSeededLoginAxiosError());

    const { transkribusRequest } = await import('../services/transkribus.js');
    const thrown = await transkribusRequest('GET', '/collections').catch((e: unknown) => e);

    expect(thrown).toBeInstanceOf(AxiosError);
    expect(mockPost).toHaveBeenCalledWith('/auth/login', expect.any(String), expect.any(Object));

    // Non-vacuity guard for the password assertions below: the sentinel really is
    // the credential login() sent, so a clean error is redaction, not absence.
    expect(mockPost.mock.calls[0][1]).toContain(PASSWORD_VALUE);

    const inspected = util.inspect(thrown, { depth: null });
    expect(inspected).not.toContain('JSESSIONID');
    expect(inspected).not.toContain(COOKIE_VALUE);
    expect(inspected).not.toContain(PASSWORD_VALUE);

    const self = thrown as { toJSON?: () => unknown };
    const serialized = JSON.stringify(self.toJSON?.() ?? thrown);
    expect(serialized).not.toContain('JSESSIONID');
    expect(serialized).not.toContain(COOKIE_VALUE);
    expect(serialized).not.toContain(PASSWORD_VALUE);
  });
});
