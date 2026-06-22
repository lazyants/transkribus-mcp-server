import { describe, it, expect } from 'vitest';
import util from 'node:util';
import { z } from 'zod';
import { AxiosError, AxiosHeaders } from 'axios';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { formatResponse } from '../helpers.js';
import { sanitizeAxiosError, sessionExpiredError, wrapAxiosError } from '../services/transkribus.js';
import { registerCollectionActivityTools } from '../tools/collections-activity.js';

// Internal McpServer shape — same access pattern the smoke test uses.
type RegisteredTools = Record<string, { inputSchema?: z.ZodTypeAny }>;
function getRegisteredTools(server: McpServer): RegisteredTools {
  return (server as unknown as { _registeredTools: RegisteredTools })._registeredTools;
}

describe('formatResponse contract (CallToolResult shape)', () => {
  it('omits structuredContent when data is an array', () => {
    // GOTCHA guard: MCP SDK rejects arrays in `structuredContent` ("expected
    // record, received array"). Arrays must surface only via `content` text.
    const result = formatResponse([1, 2, 3]);
    expect(result.structuredContent).toBeUndefined();
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify([1, 2, 3], null, 2) },
    ]);
  });

  it('sets structuredContent when data is a plain object (happy path)', () => {
    const data = { foo: 'bar', n: 1 };
    const result = formatResponse(data);
    expect(result.structuredContent).toEqual(data);
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify(data, null, 2) },
    ]);
  });

  it('omits structuredContent for null and primitives', () => {
    expect(formatResponse(null).structuredContent).toBeUndefined();
    expect(formatResponse('hello').structuredContent).toBeUndefined();
    expect(formatResponse(42).structuredContent).toBeUndefined();
  });
});

describe('wrapAxiosError — no session-cookie leak', () => {
  // Regression guard for `gotcha_axios_cause_walk_cookie_leak.md` + issue #23.
  // The wrapped Error chains the original AxiosError via { cause: err };
  // `sanitizeAxiosError` must strip JSESSIONID from every place axios stashes it
  // (request Cookie header, raw request._header block, response Set-Cookie) so
  // that NO serialization path — default inspect, depth:null inspect, or toJSON —
  // surfaces the session cookie.

  // The sentinel cookie value; if it survives anywhere in a chained/serialized
  // error, the session cookie has leaked into a logger walking the cause.
  const COOKIE_VALUE = 'session-secret-cookie-value';
  // A second sentinel proving scrubConfig(err.response?.config) does real work
  // when response.config is a DISTINCT object (not the same ref as err.config).
  const RESPONSE_CONFIG_VALUE = 'distinct-response-config-secret';

  // Build a fake AxiosError seeded with the cookie in every location axios stashes
  // it: request config Cookie header (plus a case-variant key), the raw
  // request._header block, a DISTINCT response.config carrying its own Cookie, and
  // a real AxiosHeaders response carrying Set-Cookie (exercises the .delete branch).
  function makeSeededAxiosError(): AxiosError {
    const fake = new AxiosError(
      'Request failed with status code 500',
      'ERR_BAD_RESPONSE',
    );
    (fake as unknown as { config: unknown }).config = {
      url: '/collections/1/activity/recognition',
      method: 'GET',
      headers: {
        Cookie: `JSESSIONID=${COOKIE_VALUE}`,
        COOKIE: `JSESSIONID=${COOKIE_VALUE}`, // case-variant key locks case-insensitivity
      },
    };
    (fake as unknown as { request: unknown }).request = {
      _header: `GET /collections/1/activity/recognition HTTP/1.1\r\nCookie: JSESSIONID=${COOKIE_VALUE}\r\n\r\n`,
    };
    const responseHeaders = new AxiosHeaders();
    responseHeaders.set('set-cookie', [`JSESSIONID=${COOKIE_VALUE}; Path=/; HttpOnly`]);
    (fake as unknown as { response: unknown }).response = {
      status: 500,
      statusText: 'Internal Server Error',
      data: 'something broke',
      headers: responseHeaders,
      // Distinct config object (NOT the err.config ref) with its own cookie.
      config: {
        url: '/collections/1/activity/recognition',
        method: 'GET',
        headers: { Cookie: `JSESSIONID=${RESPONSE_CONFIG_VALUE}` },
      },
      request: {
        _header: `GET /collections/1/activity/recognition HTTP/1.1\r\nCookie: JSESSIONID=${COOKIE_VALUE}\r\n\r\n`,
      },
    };
    return fake;
  }

  // The cookie/JSESSIONID must appear in NEITHER a deep inspect NOR a toJSON-based
  // JSON serialization. axios toJSON() embeds config/code/status but not
  // response.headers, so the Set-Cookie leak is caught by the depth:null inspect —
  // both assertions are kept.
  function assertNoCookieLeak(x: unknown): void {
    const inspected = util.inspect(x, { depth: null });
    expect(inspected).not.toContain('JSESSIONID');
    expect(inspected).not.toContain(COOKIE_VALUE);
    expect(inspected).not.toContain(RESPONSE_CONFIG_VALUE);

    const cause = (x as { cause?: { toJSON?: () => unknown } }).cause;
    const self = x as { toJSON?: () => unknown };
    const serialized = JSON.stringify(cause?.toJSON?.() ?? self.toJSON?.() ?? x);
    expect(serialized).not.toContain('JSESSIONID');
    expect(serialized).not.toContain(COOKIE_VALUE);
    expect(serialized).not.toContain(RESPONSE_CONFIG_VALUE);
  }

  it('sanitizeAxiosError scrubs every cookie location (direct unit)', () => {
    const fake = makeSeededAxiosError();
    sanitizeAxiosError(fake);
    assertNoCookieLeak(fake);
  });

  it('wrapAxiosError leaks no cookie via inspect/toJSON and keeps the message (regression #23)', () => {
    const wrapped = wrapAxiosError(makeSeededAxiosError());
    expect(wrapped).toBeInstanceOf(Error);
    expect((wrapped as Error).message).toBe('Transkribus API error 500: something broke');
    assertNoCookieLeak(wrapped);
  });

  it('sessionExpiredError leaks no cookie and keeps the re-auth message', () => {
    const result = sessionExpiredError(makeSeededAxiosError());
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe('Session expired and re-authentication failed');
    assertNoCookieLeak(result);
  });

  it('default util.inspect does not surface request cookies', () => {
    const wrapped = wrapAxiosError(makeSeededAxiosError());
    const rendered = util.inspect(wrapped);
    expect(rendered).not.toContain(COOKIE_VALUE);
    expect(rendered).not.toContain('JSESSIONID');
  });

  it('returns non-Axios errors unchanged', () => {
    const plain = new Error('not an axios error');
    expect(wrapAxiosError(plain)).toBe(plain);
  });
});

describe('tools/list required[] — optional filters stay non-required', () => {
  // Regression guard for the Zod 4 `optin: "optional"` silent-drop bug
  // (memory: gotcha_zod4_preprocess_optin_required_drop.md). A tool with a
  // required intCoerce-wrapped ID + optional filter params must surface the
  // ID in JSON Schema `required[]` while the filters are absent.
  it('transkribus_coll_activity_recognition requires collId but not from/to', () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerCollectionActivityTools(server);

    const registered = getRegisteredTools(server);
    const tool = registered['transkribus_coll_activity_recognition'];
    expect(tool, 'tool registration missing').toBeDefined();
    expect(tool.inputSchema, 'inputSchema missing').toBeDefined();

    const schema = z.toJSONSchema(tool.inputSchema!, { io: 'input' }) as {
      required?: string[];
      properties?: Record<string, unknown>;
    };

    expect(schema.required).toContain('collId');
    expect(schema.required ?? []).not.toContain('from');
    expect(schema.required ?? []).not.toContain('to');

    // Sanity: the optional fields are still present as properties (not pruned).
    expect(schema.properties).toBeDefined();
    expect(schema.properties).toHaveProperty('from');
    expect(schema.properties).toHaveProperty('to');
  });
});
