import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AxiosError } from 'axios';
import { inspect } from 'util';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// GOTCHA (copied deliberately from interceptor-recursion.test.ts): mocking the
// whole axios instance makes interceptors.use() a no-op, so the interceptor
// pipeline never runs and a test built on it cannot observe re-auth, retry, or
// recursion behaviour at all. Wrap the REAL axios.create instead and swap only
// the network adapter.
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

const TOKEN_URL = 'https://account.readcoop.eu/auth/realms/readcoop/protocol/openid-connect/token';

function ok(config: Record<string, unknown>, data: unknown, status = 200): Record<string, unknown> {
  return { data, status, statusText: 'OK', headers: {}, config };
}

/** Reject the way a real adapter does: an AxiosError carrying `.config` (so the
 *  interceptor guards pass) and a `.response`. Resolving a 4xx would never enter
 *  axios's onRejected chain at all. */
function fail(config: Record<string, unknown>, status: number, data: unknown): Promise<never> {
  const response = { status, statusText: 'Error', headers: {}, config, data };
  return Promise.reject(
    new AxiosError(
      `Request failed with status code ${status}`,
      'ERR_BAD_REQUEST',
      config as never,
      undefined,
      response as never
    )
  );
}

function isTokenRequest(cfg: Record<string, unknown>): boolean {
  return String(cfg.url ?? '').startsWith(TOKEN_URL);
}

/** Full request URL as axios assembles it, for asserting the API path. */
function fullUrl(cfg: Record<string, unknown>): string {
  return `${String(cfg.baseURL ?? '')}${String(cfg.url ?? '')}`;
}

const TOKEN_OK = { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 300 };

async function importService(): Promise<typeof import('../services/metagrapho.js')> {
  return import('../services/metagrapho.js');
}

describe('Metagrapho (Processing API) client', () => {
  const originalEnv = {
    user: process.env.TRANSKRIBUS_USER,
    password: process.env.TRANSKRIBUS_PASSWORD,
    token: process.env.TRANSKRIBUS_ACCESS_TOKEN,
    clientId: process.env.TRANSKRIBUS_PROCESSING_CLIENT_ID,
  };

  beforeEach(() => {
    vi.resetModules();
    process.env.TRANSKRIBUS_USER = 'probe@example.invalid';
    process.env.TRANSKRIBUS_PASSWORD = 'sup3r-s3cret-pw';
    delete process.env.TRANSKRIBUS_ACCESS_TOKEN;
    delete process.env.TRANSKRIBUS_PROCESSING_CLIENT_ID;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries({
      TRANSKRIBUS_USER: originalEnv.user,
      TRANSKRIBUS_PASSWORD: originalEnv.password,
      TRANSKRIBUS_ACCESS_TOKEN: originalEnv.token,
      TRANSKRIBUS_PROCESSING_CLIENT_ID: originalEnv.clientId,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('exchanges username/password for a bearer token with the documented grant', async () => {
    const seen: Record<string, unknown>[] = [];
    setAdapter(async (cfg) => {
      seen.push(cfg);
      if (isTokenRequest(cfg)) return ok(cfg, TOKEN_OK);
      return ok(cfg, { processId: 1, status: 'CREATED' });
    });

    const { metagraphoRequest } = await importService();
    await metagraphoRequest('GET', '/processes/1');

    const tokenCall = seen.find(isTokenRequest);
    expect(tokenCall, 'no token request was made').toBeDefined();
    const body = new URLSearchParams(String(tokenCall!.data));
    expect(body.get('grant_type')).toBe('password');
    expect(body.get('client_id')).toBe('processing-api-client');
    expect(body.get('username')).toBe('probe@example.invalid');
    expect(body.get('password')).toBe('sup3r-s3cret-pw');

    const apiCall = seen.find((c) => !isTokenRequest(c))!;
    const headers = apiCall.headers as Record<string, unknown>;
    expect(headers['Authorization']).toBe('Bearer access-1');
    expect(fullUrl(apiCall)).toBe('https://transkribus.eu/processing/v1/processes/1');
  });

  it('honours TRANSKRIBUS_ACCESS_TOKEN and performs no token exchange', async () => {
    process.env.TRANSKRIBUS_ACCESS_TOKEN = 'preminted-token';
    const seen: Record<string, unknown>[] = [];
    setAdapter(async (cfg) => {
      seen.push(cfg);
      return ok(cfg, { processId: 2, status: 'FINISHED' });
    });

    const { metagraphoRequest } = await importService();
    await metagraphoRequest('GET', '/processes/2');

    expect(seen.filter(isTokenRequest)).toHaveLength(0);
    const headers = seen[0].headers as Record<string, unknown>;
    expect(headers['Authorization']).toBe('Bearer preminted-token');
  });

  it('performs ONE token exchange for concurrent callers', async () => {
    let tokenCalls = 0;
    setAdapter(async (cfg) => {
      if (isTokenRequest(cfg)) {
        tokenCalls += 1;
        // Yield so both callers are inside ensureToken() before either resolves.
        await new Promise((r) => setTimeout(r, 5));
        return ok(cfg, TOKEN_OK);
      }
      return ok(cfg, { processId: 3, status: 'RUNNING' });
    });

    const { metagraphoRequest } = await importService();
    await Promise.all([
      metagraphoRequest('GET', '/processes/3'),
      metagraphoRequest('GET', '/processes/3'),
      metagraphoRequest('GET', '/processes/3'),
    ]);

    expect(tokenCalls).toBe(1);
  });

  it('refreshes with the refresh grant and replays a 401 exactly once', async () => {
    const grants: string[] = [];
    let apiCalls = 0;
    setAdapter(async (cfg) => {
      if (isTokenRequest(cfg)) {
        const body = new URLSearchParams(String(cfg.data));
        grants.push(String(body.get('grant_type')));
        return ok(cfg, { access_token: `access-${grants.length}`, refresh_token: 'refresh-1', expires_in: 300 });
      }
      apiCalls += 1;
      if (apiCalls === 1) return fail(cfg, 401, { error: 'expired' });
      return ok(cfg, { processId: 4, status: 'FINISHED' });
    });

    const { metagraphoRequest } = await importService();
    const result = await metagraphoRequest<{ processId: number }>('GET', '/processes/4');

    expect(result.processId).toBe(4);
    expect(grants).toEqual(['password', 'refresh_token']);
    expect(apiCalls).toBe(2);
  });

  it('does not loop on a persistent 401', async () => {
    let apiCalls = 0;
    setAdapter(async (cfg) => {
      if (isTokenRequest(cfg)) return ok(cfg, TOKEN_OK);
      apiCalls += 1;
      return fail(cfg, 401, { error: 'nope' });
    });

    const { metagraphoRequest } = await importService();
    await expect(metagraphoRequest('GET', '/processes/5')).rejects.toThrow('HTTP 401');
    expect(apiCalls).toBe(2); // original + one replay, then it gives up
  });

  it('falls back to the password grant when a refresh fails', async () => {
    const grants: string[] = [];
    let apiCalls = 0;
    setAdapter(async (cfg) => {
      if (isTokenRequest(cfg)) {
        const body = new URLSearchParams(String(cfg.data));
        const grant = String(body.get('grant_type'));
        grants.push(grant);
        if (grant === 'refresh_token') return fail(cfg, 400, { error: 'invalid_grant' });
        return ok(cfg, TOKEN_OK);
      }
      apiCalls += 1;
      if (apiCalls === 1) return fail(cfg, 401, { error: 'expired' });
      return ok(cfg, { processId: 6, status: 'FINISHED' });
    });

    const { metagraphoRequest } = await importService();
    await metagraphoRequest('GET', '/processes/6');

    expect(grants).toEqual(['password', 'refresh_token', 'password']);
  });

  it('requests XML with Accept: application/xml and returns it verbatim', async () => {
    const xml = '<?xml version="1.0"?><PcGts><Page/></PcGts>';
    let apiCfg: Record<string, unknown> | null = null;
    setAdapter(async (cfg) => {
      if (isTokenRequest(cfg)) return ok(cfg, TOKEN_OK);
      apiCfg = cfg;
      return ok(cfg, xml);
    });

    const { metagraphoRequestText } = await importService();
    const out = await metagraphoRequestText('/processes/7/page');

    expect(out).toBe(xml);
    const headers = apiCfg!.headers as Record<string, unknown>;
    expect(headers['Accept']).toBe('application/xml');
    expect(apiCfg!.responseType).toBe('text');
  });
});

// ---------------------------------------------------------------------------
// Credential-echo regression (the reason this client has its own error boundary)
// ---------------------------------------------------------------------------

describe('Metagrapho errors never carry credentials', () => {
  const PASSWORD = 'sup3r-s3cret-pw';
  const originalEnv = {
    user: process.env.TRANSKRIBUS_USER,
    password: process.env.TRANSKRIBUS_PASSWORD,
    token: process.env.TRANSKRIBUS_ACCESS_TOKEN,
  };

  beforeEach(() => {
    vi.resetModules();
    process.env.TRANSKRIBUS_USER = 'probe@example.invalid';
    process.env.TRANSKRIBUS_PASSWORD = PASSWORD;
    delete process.env.TRANSKRIBUS_ACCESS_TOKEN;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries({
      TRANSKRIBUS_USER: originalEnv.user,
      TRANSKRIBUS_PASSWORD: originalEnv.password,
      TRANSKRIBUS_ACCESS_TOKEN: originalEnv.token,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  /** Both surfaces matter and they are NOT equivalent: a secret sitting in
   *  `cause.response.data` is invisible to JSON.stringify of the outer Error
   *  (Error fields are non-enumerable) but plainly visible to a deep inspect,
   *  which is how a debug log or a crash reporter would print it. */
  function assertAbsent(err: unknown, secret: string, label: string): void {
    expect(inspect(err, { depth: null }), `${label} leaked via inspect`).not.toContain(secret);
    expect(JSON.stringify(err), `${label} leaked via JSON.stringify`).not.toContain(secret);
    expect(String((err as Error).message), `${label} leaked via message`).not.toContain(secret);
    // Nothing upstream is retained at all, so there is no surface left to walk.
    expect((err as { cause?: unknown }).cause, `${label}: error retained a cause`).toBeUndefined();
  }

  it('drops a password echoed back by the token endpoint', async () => {
    setAdapter(async (cfg) =>
      fail(cfg, 400, { error: 'invalid_grant', error_description: `Rejected ${PASSWORD}` })
    );

    const { metagraphoRequest } = await importService();
    const err = await metagraphoRequest('GET', '/processes/1').then(
      () => { throw new Error('expected a rejection'); },
      (e: unknown) => e
    );

    assertAbsent(err, PASSWORD, 'password');
    expect((err as Error).message).toContain('HTTP 400');
  });

  it('drops a refresh token echoed back by the token endpoint', async () => {
    const REFRESH = 'refresh-token-value-abc';
    let tokenCalls = 0;
    setAdapter(async (cfg) => {
      if (isTokenRequest(cfg)) {
        tokenCalls += 1;
        if (tokenCalls === 1) return ok(cfg, { access_token: 'a1', refresh_token: REFRESH, expires_in: 300 });
        // The refresh attempt echoes the refresh token, and so does the
        // password-grant fallback, so BOTH token failures are covered.
        return fail(cfg, 400, { error: 'invalid_grant', error_description: `Rejected ${REFRESH}` });
      }
      return fail(cfg, 401, { error: 'expired' });
    });

    const { metagraphoRequest } = await importService();
    const err = await metagraphoRequest('GET', '/processes/1').then(
      () => { throw new Error('expected a rejection'); },
      (e: unknown) => e
    );

    assertAbsent(err, REFRESH, 'refresh token');
  });

  it('drops an access token echoed back by the Processing API', async () => {
    const ACCESS = 'access-token-value-xyz';
    setAdapter(async (cfg) => {
      if (isTokenRequest(cfg)) return ok(cfg, { access_token: ACCESS, refresh_token: 'r', expires_in: 300 });
      return fail(cfg, 400, { message: `Rejected ${ACCESS}` });
    });

    const { metagraphoRequest } = await importService();
    const err = await metagraphoRequest('GET', '/processes/1').then(
      () => { throw new Error('expected a rejection'); },
      (e: unknown) => e
    );

    assertAbsent(err, ACCESS, 'access token');
    expect((err as Error).message).toContain('HTTP 400');
  });

  it('drops an access token echoed back by an XML endpoint', async () => {
    const ACCESS = 'access-token-value-xyz';
    setAdapter(async (cfg) => {
      if (isTokenRequest(cfg)) return ok(cfg, { access_token: ACCESS, refresh_token: 'r', expires_in: 300 });
      return fail(cfg, 500, `<error>Rejected ${ACCESS}</error>`);
    });

    const { metagraphoRequestText } = await importService();
    const err = await metagraphoRequestText('/processes/1/alto').then(
      () => { throw new Error('expected a rejection'); },
      (e: unknown) => e
    );

    assertAbsent(err, ACCESS, 'access token (xml)');
  });
});

// ---------------------------------------------------------------------------
// Tool schemas
// ---------------------------------------------------------------------------

describe('Processing tool schemas', () => {
  type RegisteredTools = Record<string, { inputSchema?: z.ZodTypeAny }>;

  async function registeredTools(): Promise<RegisteredTools> {
    const { registerProcessingTools } = await import('../tools/processing.js');
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerProcessingTools(server);
    return (server as any)._registeredTools as RegisteredTools;
  }

  it('keeps intCoerce-wrapped processId in JSON Schema required[]', async () => {
    // The zod-4 z.preprocess `optin` trap: without clearOptinMarker these
    // required IDs silently vanish from tools/list required[], clients omit
    // them, and every call fails opaquely.
    const tools = await registeredTools();
    for (const name of [
      'transkribus_processing_get_status',
      'transkribus_processing_get_page_xml',
      'transkribus_processing_get_alto_xml',
    ]) {
      const schema = z.toJSONSchema(tools[name].inputSchema!, { io: 'input' }) as {
        required?: string[];
      };
      expect(schema.required, `${name} required[]`).toContain('processId');
    }
  });

  it('marks config and image required on submit, and htrId inside config', async () => {
    const tools = await registeredTools();
    const schema = z.toJSONSchema(tools['transkribus_processing_submit_image'].inputSchema!, {
      io: 'input',
    }) as { required?: string[]; properties?: Record<string, any> };

    expect(schema.required).toContain('config');
    expect(schema.required).toContain('image');
    expect(schema.required ?? []).not.toContain('content');
    expect(schema.properties!.config.required).toContain('textRecognition');
    expect(schema.properties!.config.properties.textRecognition.required).toContain('htrId');
  });

  it('accepts exactly one of imageUrl or base64, and rejects both or neither', async () => {
    const tools = await registeredTools();
    const schema = tools['transkribus_processing_submit_image'].inputSchema!;
    const base = { config: { textRecognition: { htrId: 38230 } } };

    expect(schema.safeParse({ ...base, image: { imageUrl: 'https://x.invalid/a.jpg' } }).success).toBe(true);
    expect(schema.safeParse({ ...base, image: { base64: 'AAAA' } }).success).toBe(true);
    expect(schema.safeParse({ ...base, image: {} }).success).toBe(false);
    expect(
      schema.safeParse({ ...base, image: { imageUrl: 'https://x.invalid/a.jpg', base64: 'AAAA' } }).success
    ).toBe(false);
  });

  it('coerces string-encoded IDs the way MCP clients send them', async () => {
    const tools = await registeredTools();
    const parsed = tools['transkribus_processing_get_status'].inputSchema!.safeParse({
      processId: '3866314',
    });
    expect(parsed.success).toBe(true);
    expect((parsed as { data: { processId: number } }).data.processId).toBe(3866314);
  });
});

// ---------------------------------------------------------------------------
// Text tool result shape
// ---------------------------------------------------------------------------

describe('handleTextToolRequest', () => {
  it('returns raw text with no structuredContent', async () => {
    const { handleTextToolRequest } = await import('../helpers.js');
    const handler = handleTextToolRequest(async () => '<?xml version="1.0"?><alto/>');
    const result = await handler({});
    expect(result.content).toEqual([{ type: 'text', text: '<?xml version="1.0"?><alto/>' }]);
    expect('structuredContent' in result).toBe(false);
  });

  it('surfaces an error as an isError result', async () => {
    const { handleTextToolRequest } = await import('../helpers.js');
    const handler = handleTextToolRequest(async () => {
      throw new Error('Processing API request failed: HTTP 404');
    });
    const result = await handler({});
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('HTTP 404');
  });
});
