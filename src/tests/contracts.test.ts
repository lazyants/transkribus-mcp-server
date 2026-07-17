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

describe('secret redaction — request bodies, query strings, session echoes (#26 + #32b)', () => {
  // Regression guard for #26 (broad config.data/response.data secret redaction)
  // and #32b (config.params + config.url query-string scrubbing). Every case
  // here proves a DIFFERENT surface from the cookie-leak suite above: request
  // bodies (not just headers), query strings, and a session token DISCOVERED
  // from the response body rather than known in advance.
  const PASSWORD_VALUE = 'super-secret-pw-value';
  const SESSION_ECHO = 'freshly-minted-session-token';

  function makeError(opts: {
    configData?: unknown;
    configParams?: unknown;
    configUrl?: string;
    responseConfigData?: unknown;
    responseData?: unknown;
    extraHeaders?: Record<string, string>;
    message?: string;
  }): AxiosError {
    const fake = new AxiosError(opts.message ?? 'Request failed with status code 500', 'ERR_BAD_RESPONSE');
    const url = opts.configUrl ?? '/some/path';
    (fake as unknown as { config: unknown }).config = {
      url,
      method: 'POST',
      data: opts.configData,
      params: opts.configParams,
    };
    const responseHeaders = new AxiosHeaders();
    if (opts.extraHeaders) {
      for (const [k, v] of Object.entries(opts.extraHeaders)) responseHeaders.set(k, v);
    }
    (fake as unknown as { response: unknown }).response = {
      status: 500,
      statusText: 'Internal Server Error',
      data: opts.responseData ?? 'something broke',
      headers: responseHeaders,
      config: {
        url,
        method: 'POST',
        data: opts.responseConfigData,
      },
    };
    return fake;
  }

  it('scrubs config.data (request body) unconditionally, not only for login', () => {
    const err = makeError({ configData: `user=alice&pw=${PASSWORD_VALUE}` });
    sanitizeAxiosError(err);
    expect(util.inspect(err, { depth: null })).not.toContain(PASSWORD_VALUE);
  });

  it('scrubs response.config.data (a possibly-distinct ref)', () => {
    const err = makeError({ responseConfigData: `pw=${PASSWORD_VALUE}` });
    sanitizeAxiosError(err);
    expect(util.inspect(err, { depth: null })).not.toContain(PASSWORD_VALUE);
  });

  it('scrubs config.params and a config.url query string (#32b)', () => {
    const err = makeError({
      configUrl: `/search?token=${PASSWORD_VALUE}`,
      configParams: { token: PASSWORD_VALUE },
    });
    sanitizeAxiosError(err);
    expect(util.inspect(err, { depth: null })).not.toContain(PASSWORD_VALUE);
  });

  it('treats an inline session-key echo in response.data as untrusted — fails closed with no cause, regardless of what else the response carries', () => {
    // Precisely bounding a token's value from free-flowing body prose is
    // unsolvable by charset (see SESSION_KEY_PATTERN_RE) — so an inline
    // "JSESSIONID=..." match anywhere in the body fails the WHOLE response
    // closed instead. This must hold even when the token is ALSO echoed in a
    // header and in the AxiosError's own message — the fail-closed path
    // drops `err` entirely, so none of those surfaces matter.
    const err = makeError({
      responseData: `login ok, JSESSIONID=${SESSION_ECHO}`,
      extraHeaders: { 'x-debug-session': SESSION_ECHO },
      message: `debug token ${SESSION_ECHO}`,
    });
    const wrapped = wrapAxiosError(err) as Error;
    const inspected = util.inspect(wrapped, { depth: null });
    expect(inspected).not.toContain(SESSION_ECHO);
    expect((wrapped as { cause?: unknown }).cause).toBeUndefined();
  });

  it('discovers a freshly-minted session token in response.data (nested object form — no charset ambiguity, stays on the normal path)', () => {
    const err = makeError({
      responseData: { nested: { sessionId: SESSION_ECHO } },
      extraHeaders: { 'x-debug-session': SESSION_ECHO },
    });
    sanitizeAxiosError(err);
    expect(util.inspect(err, { depth: null })).not.toContain(SESSION_ECHO);
  });

  it('recognizes case/delimiter variants of the session-key pattern: SessionID field stays on the normal path; spaced JSESSIONID=, JSON-colon form, and URL-encoded JSESSIONID%3D all fail closed as inline body echoes', () => {
    // Object-field form has NO charset ambiguity (the whole string value is
    // captured verbatim, no regex boundary to get wrong) — stays on the
    // NORMAL path with full diagnostics preserved.
    const fieldErr = makeError({ responseData: { SessionID: SESSION_ECHO } });
    sanitizeAxiosError(fieldErr);
    expect(util.inspect(fieldErr, { depth: null })).not.toContain(SESSION_ECHO);

    // Inline (prose) forms all trip SESSION_KEY_PATTERN_RE — the value is
    // never precisely extracted from free text, so the whole response fails
    // closed instead, regardless of the key/delimiter spelling variant.
    const inlineCases = [
      `JSESSIONID = ${SESSION_ECHO}`,
      `"JSESSIONID": "${SESSION_ECHO}"`,
      `JSESSIONID%3D${SESSION_ECHO}`,
    ];
    for (const responseData of inlineCases) {
      const err = makeError({ responseData });
      const wrapped = wrapAxiosError(err) as Error;
      expect(util.inspect(wrapped, { depth: null }), `case: ${JSON.stringify(responseData)}`).not.toContain(SESSION_ECHO);
      expect((wrapped as { cause?: unknown }).cause, `case: ${JSON.stringify(responseData)}`).toBeUndefined();
    }
  });

  it('redacts a session token repeated OUTSIDE its named field (proves discover-then-redact, not field-blanking)', () => {
    const err = makeError({
      responseData: { sessionId: SESSION_ECHO, message: `debug token ${SESSION_ECHO}` },
    });
    sanitizeAxiosError(err);
    const body = (err.response as { data: { message: string; sessionId: string } }).data;
    expect(body.message).not.toContain(SESSION_ECHO);
    expect(body.sessionId).not.toContain(SESSION_ECHO);
  });

  it('redacts err.stack in addition to err.message (V8 bakes message into stack at construction)', () => {
    const err = makeError({
      responseData: { sessionId: SESSION_ECHO },
      message: `token ${SESSION_ECHO} leaked`,
    });
    sanitizeAxiosError(err);
    expect(err.message).not.toContain(SESSION_ECHO);
    expect(err.stack ?? '').not.toContain(SESSION_ECHO);
  });

  it('redacts a session token nested ~10 objects deep — no depth cap (BLOCKER 1 regression)', () => {
    // Build { child: { child: { ... 10 times ... { sessionId: SESSION_ECHO } } } }.
    // A depth-8 recursion cutoff never reaches the innermost object, so the
    // field is neither discovered nor redacted and survives verbatim.
    let deep: unknown = { sessionId: SESSION_ECHO };
    for (let i = 0; i < 10; i++) {
      deep = { child: deep };
    }
    const err = makeError({ responseData: deep });
    const wrapped = wrapAxiosError(err) as Error;
    expect(util.inspect(wrapped, { depth: null })).not.toContain(SESSION_ECHO);
  });

  it('discovers a session token from Set-Cookie (not response.data) and redacts it from a non-denylisted header (BLOCKER 2 regression)', () => {
    // The token rides ONLY in Set-Cookie + a custom echo header; response.data
    // is generic prose. If discovery only ever looks at response.data (or if
    // scrubAuth deletes Set-Cookie before discovery runs), the token is never
    // learned and survives untouched in x-debug-session.
    const responseHeaders = new AxiosHeaders();
    responseHeaders.set('set-cookie', [`JSESSIONID=${SESSION_ECHO}; Path=/; HttpOnly`]);
    responseHeaders.set('x-debug-session', SESSION_ECHO);
    const fake = new AxiosError('Request failed with status code 401', 'ERR_BAD_REQUEST');
    (fake as unknown as { response: unknown }).response = {
      status: 401,
      statusText: 'Unauthorized',
      data: 'authentication failed',
      headers: responseHeaders,
    };
    const wrapped = wrapAxiosError(fake) as Error;
    expect(util.inspect(wrapped, { depth: null })).not.toContain(SESSION_ECHO);
  });

  it('drops the cause entirely (fail-closed) when the collect walk cannot fully cover the body — no leak via message, statusText, or the vary/server allowlist (BLOCKER regression)', () => {
    // The token sits at index 0 of a 5001-element array. collect's stack is
    // LIFO and pushes array items in order, so the LAST-pushed (highest
    // index) item is popped FIRST — index 0 is popped LAST. With exactly
    // 5000 filler items ahead of it (indices 1..5000) and a 5000-node
    // budget, the walk exhausts before ever reaching index 0: the token is
    // never discovered. It's ALSO echoed in a non-denylisted header, in a
    // header that a surface-by-surface "safe allowlist" would have left
    // alone (vary), in statusText, AND in the AxiosError's own message. A
    // surface-by-surface neutralization approach has to enumerate every
    // surface correctly (and did not, historically); dropping the cause
    // entirely makes the enumeration question moot — nothing on `err` is
    // reachable from the returned value at all.
    const TOKEN = 'uncollected-secret-token';
    const filler = Array.from({ length: 5000 }, (_, i) => `filler-${i}`);
    const responseData: unknown[] = [{ sessionId: TOKEN }, ...filler];

    const responseHeaders = new AxiosHeaders();
    responseHeaders.set('x-debug-session', TOKEN);
    responseHeaders.set('vary', `Accept, ${TOKEN}`);
    const fake = new AxiosError(`hostile message carrying ${TOKEN}`, 'ERR_BAD_RESPONSE');
    (fake as unknown as { response: unknown }).response = {
      status: 500,
      statusText: `session ${TOKEN} expired`,
      data: responseData,
      headers: responseHeaders,
    };
    const wrapped = wrapAxiosError(fake) as Error;
    const inspected = util.inspect(wrapped, { depth: null });
    expect(inspected).not.toContain(TOKEN);
    expect((wrapped as { cause?: unknown }).cause).toBeUndefined();
  });

  it('does not throw when the WHOLE response and its AxiosHeaders are frozen, and drops the cause (MAJOR regression)', () => {
    // Assigning into a frozen response.data throws a TypeError in strict/ESM
    // mode; a fallback that then tries to WRITE a placeholder onto the
    // (also frozen) response, or calls AxiosHeaders.delete on frozen
    // headers, throws AGAIN. Sanitization must never throw regardless of
    // how thoroughly the hostile response resists mutation — the fail-closed
    // design never attempts a write in its failure path, so this is safe
    // by construction rather than by chasing every mutation site.
    const TOKEN = 'frozen-secret-token';
    const responseHeaders = new AxiosHeaders();
    responseHeaders.set('set-cookie', [`JSESSIONID=${TOKEN}; Path=/; HttpOnly`]);
    Object.freeze(responseHeaders);
    const response = Object.freeze({
      status: 500,
      statusText: 'Internal Server Error',
      data: Object.freeze({ sessionId: TOKEN }),
      headers: responseHeaders,
    });
    const fake = new AxiosError('Request failed with status code 500', 'ERR_BAD_RESPONSE');
    (fake as unknown as { response: unknown }).response = response;

    const wrapped = wrapAxiosError(fake) as Error; // must not throw

    const inspected = util.inspect(wrapped, { depth: null });
    expect(inspected).not.toContain(TOKEN);
    expect(inspected).not.toContain('JSESSIONID');
    expect((wrapped as { cause?: unknown }).cause).toBeUndefined();
  });

  it('caps the collected-secret count on a body with 257 STRUCTURED session-id fields, taking the fail-closed path (MAJOR regression — DoS)', () => {
    // redactValue's cost is O(secrets × text length) per string surface — an
    // unbounded secret count turns a single hostile body into a quadratic
    // blowup across every surface redactSessionTokensCore touches. A cap on
    // the number of distinct candidate secrets bounds that multiplier.
    // Structured `{sessionId: ...}` fields (not inline body prose) are used
    // here deliberately: an inline-prose body now fails closed on the FIRST
    // "sessionid=" match (see SESSION_KEY_PATTERN_RE), so it would never
    // reach the MAX_SECRETS counter at all — this test needs the precise,
    // field-form accumulation path to genuinely exercise the cap.
    const parts: unknown[] = [];
    for (let i = 0; i < 257; i++) parts.push({ sessionId: `secret-${i}` });
    const fake = new AxiosError('Request failed with status code 500', 'ERR_BAD_RESPONSE');
    (fake as unknown as { response: unknown }).response = {
      status: 500,
      statusText: 'Internal Server Error',
      data: parts,
      headers: new AxiosHeaders(),
    };

    const start = Date.now();
    const wrapped = wrapAxiosError(fake) as Error;
    const elapsed = Date.now() - start;

    const inspected = util.inspect(wrapped, { depth: null });
    expect(inspected).not.toContain('secret-0');
    expect(inspected).not.toContain('secret-256');
    expect((wrapped as { cause?: unknown }).cause).toBeUndefined();
    expect(elapsed).toBeLessThan(2000);
  });

  it('a body with exactly 256 structured session-id fields (at the cap, not over it) still takes the normal path', () => {
    const parts: unknown[] = [];
    for (let i = 0; i < 256; i++) parts.push({ sessionId: `secret-${i}` });
    const fake = new AxiosError('Request failed with status code 500', 'ERR_BAD_RESPONSE');
    (fake as unknown as { response: unknown }).response = {
      status: 500,
      statusText: 'Internal Server Error',
      data: parts,
      headers: new AxiosHeaders(),
    };
    const wrapped = wrapAxiosError(fake) as Error;
    expect((wrapped as { cause?: unknown }).cause).toBeDefined();
  });

  it('redacts the longest collected secret first, avoiding prefix-shadowing (MAJOR regression)', () => {
    // login()'s cookie parsing (Set-Cookie's COOKIE_SESSION_RE branch) stops
    // only at a literal `;`, so a token that happens to contain "%3B" as
    // part of its own value (not as an encoded delimiter) is captured whole
    // from Set-Cookie. A SHORTER secret ("node") comes from a clean
    // STRUCTURED field in the body — a `{sessionId: "node"}` object, which
    // has no session-key PROSE pattern and so stays on the normal path (a
    // generic header carrying "JSESSIONID=..." inline would now fail the
    // whole response closed instead — see the MAJOR-2 fix — so this can no
    // longer be reproduced via a header echo). If the shorter secret is
    // redacted first, it fragments the longer one and leaves its suffix
    // exposed.
    const TOKEN = 'node%3Bsecret-suffix';
    const responseHeaders = new AxiosHeaders();
    responseHeaders.set('set-cookie', [`JSESSIONID=${TOKEN}; Path=/; HttpOnly`]);
    responseHeaders.set('x-debug-session', TOKEN);
    const fake = new AxiosError('Request failed with status code 500', 'ERR_BAD_RESPONSE');
    (fake as unknown as { response: unknown }).response = {
      status: 500,
      statusText: 'Internal Server Error',
      data: { sessionId: 'node' }, // clean structured field — stays on the normal path
      headers: responseHeaders,
    };
    const wrapped = wrapAxiosError(fake) as Error;
    const inspected = util.inspect(wrapped, { depth: null });
    expect(inspected).not.toContain('secret-suffix');
    expect(inspected).not.toContain(TOKEN);
    expect((wrapped as { cause?: unknown }).cause).toBeDefined();
  });

  it('fails closed when response.data is a non-plain container — a Map, or an object with an inherited (not own) message property (MAJOR regression — exotic container skipped)', () => {
    // The body walker only traverses plain arrays + Object.entries() (own
    // enumerable properties). A Map's data lives internally, not as own
    // properties Object.entries can see; Object.create(proto) has EMPTY own
    // properties but resolves `.message` via the prototype chain. Either way
    // the walk finds nothing, incorrectly reports success, and
    // wrapAxiosError's `body?.message` read (before this fix) picks up the
    // INHERITED value and puts it in the user-facing message.
    const SECRET = 'exotic-secret-token';
    const cases: { label: string; data: unknown }[] = [
      { label: 'Map', data: new Map([['k', `JSESSIONID=${SECRET}`]]) },
      { label: 'Object.create with inherited message', data: Object.create({ message: `JSESSIONID=${SECRET}` }) },
    ];
    for (const { label, data } of cases) {
      const fake = new AxiosError('Request failed with status code 500', 'ERR_BAD_RESPONSE');
      (fake as unknown as { response: unknown }).response = {
        status: 500,
        statusText: 'Internal Server Error',
        data,
        headers: new AxiosHeaders(),
      };
      const wrapped = wrapAxiosError(fake) as Error;
      const inspected = util.inspect(wrapped, { depth: null });
      expect(inspected, label).not.toContain(SECRET);
      expect(wrapped.message, label).toBe('Transkribus API error 500: [response redacted — could not be fully sanitized]');
      expect((wrapped as { cause?: unknown }).cause, label).toBeUndefined();
    }
  });

  it('fails closed when a GENERIC (non-cookie) header contains a session-key pattern (MAJOR regression — charset under-capture on +//=)', () => {
    // A charset allowlist for generic-header inline extraction excluded `+`,
    // so `x-debug: JSESSIONID=abc+def` collected only `abc`, leaking `+def`
    // in the cause. Same fix as the body: a bare key-pattern match in a
    // non-cookie header fails the whole response closed instead of guessing
    // a value boundary.
    const err = makeError({
      responseData: 'something broke',
      extraHeaders: { 'x-debug': 'JSESSIONID=abc+def' },
    });
    const wrapped = wrapAxiosError(err) as Error;
    const inspected = util.inspect(wrapped, { depth: null });
    expect(inspected).not.toContain('abc+def');
    expect(inspected).not.toContain('+def');
    expect((wrapped as { cause?: unknown }).cause).toBeUndefined();
  });

  it('captures an authoritative Set-Cookie value containing +/./= IN FULL — COOKIE_SESSION_RE is protocol-correct (stops at the first literal `;`), not a charset guess', () => {
    const TOKEN = 'abc+def.node1';
    const responseHeaders = new AxiosHeaders();
    responseHeaders.set('set-cookie', [`JSESSIONID=${TOKEN}; Path=/; HttpOnly`]);
    responseHeaders.set('x-debug-session', TOKEN);
    const fake = new AxiosError('Request failed with status code 500', 'ERR_BAD_RESPONSE');
    (fake as unknown as { response: unknown }).response = {
      status: 500,
      statusText: 'Internal Server Error',
      data: 'something broke',
      headers: responseHeaders,
    };
    const wrapped = wrapAxiosError(fake) as Error;
    const inspected = util.inspect(wrapped, { depth: null });
    expect(inspected).not.toContain(TOKEN);
    expect((wrapped as { cause?: unknown }).cause).toBeDefined();
  });

  it('a normal small PLAIN OBJECT body with no session-key pattern still takes the normal path (no over-fire regression)', () => {
    const err = makeError({ responseData: { status: 'ok', detail: 'nothing sensitive here' } });
    const wrapped = wrapAxiosError(err) as Error;
    expect((wrapped as { cause?: unknown }).cause).toBeDefined();
  });

  it('a normal body with a STRING session-id field still takes the precise-capture normal path (no over-fire regression)', () => {
    const err = makeError({ responseData: { sessionId: 'abc' }, extraHeaders: { 'x-debug-session': 'abc' } });
    const wrapped = wrapAxiosError(err) as Error;
    const inspected = util.inspect(wrapped, { depth: null });
    expect(inspected).not.toContain('abc');
    expect((wrapped as { cause?: unknown }).cause).toBeDefined();
  });

  it('collects EVERY JSESSIONID in a single Cookie header string, not just the first (regression — cookie extraction stopped at the first match)', () => {
    // Cookie: header can legally carry multiple cookies in one string.
    // COOKIE_SESSION_RE previously used .match() (first match only), so
    // "JSESSIONID=first; JSESSIONID=second" only ever learned "first" — a
    // "second" echoed elsewhere would survive unredacted.
    const responseHeaders = new AxiosHeaders();
    responseHeaders.set('set-cookie', ['JSESSIONID=first-secret; JSESSIONID=second-secret; Path=/']);
    responseHeaders.set('x-debug-session', 'second-secret');
    const fake = new AxiosError('Request failed with status code 500', 'ERR_BAD_RESPONSE');
    (fake as unknown as { response: unknown }).response = {
      status: 500,
      statusText: 'Internal Server Error',
      data: 'something broke',
      headers: responseHeaders,
    };
    const wrapped = wrapAxiosError(fake) as Error;
    const inspected = util.inspect(wrapped, { depth: null });
    expect(inspected).not.toContain('first-secret');
    expect(inspected).not.toContain('second-secret');
    expect((wrapped as { cause?: unknown }).cause).toBeDefined();
  });

  it('strips a single balanced pair of surrounding double quotes from a Set-Cookie value (regression — RFC 6265 quoted cookie under-redacted)', () => {
    // JSESSIONID="abc" is a legal RFC-6265 DQUOTE-wrapped cookie value.
    // COOKIE_SESSION_RE's `[^;]+` capture keeps the quotes, so the collected
    // secret was `"abc"` — that only value-matches another QUOTED echo, not
    // a bare `abc` echoed elsewhere (e.g. a normal JSON error message).
    const responseHeaders = new AxiosHeaders();
    responseHeaders.set('set-cookie', ['JSESSIONID="abc"; Path=/; HttpOnly']);
    const fake = new AxiosError('Request failed with status code 500', 'ERR_BAD_RESPONSE');
    (fake as unknown as { response: unknown }).response = {
      status: 500,
      statusText: 'Internal Server Error',
      data: { message: 'session abc rejected' },
      headers: responseHeaders,
    };
    const wrapped = wrapAxiosError(fake) as Error;
    const inspected = util.inspect(wrapped, { depth: null });
    expect(inspected).not.toContain('abc');
    expect((wrapped as { cause?: unknown }).cause).toBeDefined();
  });

  it('defense-in-depth: a sparse array with an extra property, and a non-enumerable message property, still fail closed / do not leak (adversarial, non-JSON bodies only)', () => {
    // (a) `new Array(1)` has a HOLE at index 0 (not an own-enumerable
    // property), so Object.keys reports only the later-added `.sessionId` —
    // a length-only check (keys.length === arr.length, both 1) would wrongly
    // accept this as a clean array; the walk then only visits the hole and
    // never sees `.sessionId`.
    const SECRET_A = 'sparse-array-secret';
    const dataA = new Array(1) as unknown[] & { sessionId?: string };
    dataA.sessionId = SECRET_A;
    const fakeA = new AxiosError('Request failed with status code 500', 'ERR_BAD_RESPONSE');
    (fakeA as unknown as { response: unknown }).response = {
      status: 500,
      statusText: 'Internal Server Error',
      data: dataA,
      headers: new AxiosHeaders(),
    };
    const wrappedA = wrapAxiosError(fakeA) as Error;
    expect(util.inspect(wrappedA, { depth: null })).not.toContain(SECRET_A);
    expect((wrappedA as { cause?: unknown }).cause).toBeUndefined();

    // (b) a non-enumerable `message` is invisible to Object.entries (the
    // walk correctly finds nothing, and — since axios always builds bodies
    // via JSON.parse, which never produces non-enumerable properties — this
    // can only happen via a hand-crafted, non-JSON body), but wrapAxiosError
    // used to read `body.message` via plain property access regardless of
    // enumerability, exposing it in the wrapped error's own message/stack.
    const SECRET_B = 'non-enumerable-message-secret';
    const dataB: Record<string, unknown> = {};
    Object.defineProperty(dataB, 'message', { value: `token ${SECRET_B}`, enumerable: false });
    const fakeB = new AxiosError('Request failed with status code 500', 'ERR_BAD_RESPONSE');
    (fakeB as unknown as { response: unknown }).response = {
      status: 500,
      statusText: 'Internal Server Error',
      data: dataB,
      headers: new AxiosHeaders(),
    };
    const wrappedB = wrapAxiosError(fakeB) as Error;
    expect(wrappedB.message).not.toContain(SECRET_B);
    expect(util.inspect(wrappedB, { depth: null })).not.toContain(SECRET_B);
  });

  it('fails closed when an array body carries an extra named property beyond its indexed elements (regression — array walk only visits indices)', () => {
    // The walk only visits indexed elements (`for (const item of value)`),
    // so a named property attached directly to an array is invisible to it
    // — the exact same blind spot a Map/Object.create has, just on a shape
    // that otherwise looks like a perfectly ordinary plain array.
    const SECRET = 'array-extra-prop-secret';
    const data: string[] & { sessionId?: string } = ['safe'];
    data.sessionId = SECRET;
    const fake = new AxiosError('Request failed with status code 500', 'ERR_BAD_RESPONSE');
    (fake as unknown as { response: unknown }).response = {
      status: 500,
      statusText: 'Internal Server Error',
      data,
      headers: new AxiosHeaders(),
    };
    const wrapped = wrapAxiosError(fake) as Error;
    const inspected = util.inspect(wrapped, { depth: null });
    expect(inspected).not.toContain(SECRET);
    expect((wrapped as { cause?: unknown }).cause).toBeUndefined();
  });

  it('fails closed when a session-field key holds a non-string value — a number or a nested object (regression — non-string session values ignored)', () => {
    // isSessionFieldName's collection previously required `typeof v ===
    // 'string'`, so {sessionId: 7319440021} (a number) and
    // {sessionId: {token: S}} (a nested object) were silently skipped: the
    // walk reported success with nothing collected, even though the field
    // is unambiguously a session identifier.
    const cases: { label: string; data: unknown }[] = [
      { label: 'numeric sessionId', data: { sessionId: 7319440021 } },
      { label: 'nested-object sessionId', data: { sessionId: { token: 'nested-secret-token' } } },
    ];
    for (const { label, data } of cases) {
      const fake = new AxiosError('Request failed with status code 500', 'ERR_BAD_RESPONSE');
      (fake as unknown as { response: unknown }).response = {
        status: 500,
        statusText: 'Internal Server Error',
        data,
        headers: new AxiosHeaders(),
      };
      const wrapped = wrapAxiosError(fake) as Error;
      const inspected = util.inspect(wrapped, { depth: null });
      expect(inspected, label).not.toContain('7319440021');
      expect(inspected, label).not.toContain('nested-secret-token');
      expect((wrapped as { cause?: unknown }).cause, label).toBeUndefined();
    }
  });

  it('treats a dotted (jvmRoute-style) inline session-key echo in the body as untrusted — fails closed even when only the body carries it (regression — charset under-capture)', () => {
    // The OLD positive allowlist `[A-Za-z0-9_%-]+` excludes `.`, so
    // `JSESSIONID=abc.node1` (Tomcat's cluster-routing jvmRoute suffix, a
    // legitimate real-world token shape) only captured "abc" — the ".node1"
    // remainder then leaked via the wrapped message/body since sanitize
    // could still report success. No charset (allowlist OR blacklist) can
    // safely bound an arbitrary token in free text, so the body no longer
    // tries: presence of the session-key PATTERN alone is enough to fail the
    // whole response closed, dotted or not.
    const TOKEN = 'abc.node1';
    const err = makeError({ responseData: `login failed: JSESSIONID=${TOKEN}` });
    const wrapped = wrapAxiosError(err) as Error;
    const inspected = util.inspect(wrapped, { depth: null });
    expect(inspected).not.toContain(TOKEN);
    expect(inspected).not.toContain('.node1');
    expect(wrapped.message).toBe('Transkribus API error 500: [response redacted — could not be fully sanitized]');
    expect((wrapped as { cause?: unknown }).cause).toBeUndefined();
  });

  it('a normal small body with no session-key pattern still takes the normal path — full diagnostics + cause preserved (no over-fire regression)', () => {
    const err = makeError({ responseData: 'something broke' });
    const wrapped = wrapAxiosError(err) as Error;
    expect(wrapped.message).toBe('Transkribus API error 500: something broke');
    expect((wrapped as { cause?: unknown }).cause).toBeDefined();
  });

  it('the existing exact-message contract (no sessionId in play) still passes unchanged', () => {
    // Sanity: this suite's redaction pass must be a no-op when there is
    // nothing to discover — locks that the 500/"something broke" contract
    // above (contracts.test.ts) is unaffected by these additions.
    const err = makeError({ responseData: 'something broke' });
    const wrapped = wrapAxiosError(err) as Error;
    expect(wrapped.message).toBe('Transkribus API error 500: something broke');
  });
});

describe('wrapAxiosError — message length cap (#26)', () => {
  function makeBodyError(body: string): AxiosError {
    const fake = new AxiosError('Request failed with status code 500', 'ERR_BAD_RESPONSE');
    (fake as unknown as { response: unknown }).response = {
      status: 500,
      statusText: 'Internal Server Error',
      data: body,
      headers: new AxiosHeaders(),
    };
    return fake;
  }

  it('leaves a 511-char body untouched (below the cap)', () => {
    const body = 'x'.repeat(511);
    const wrapped = wrapAxiosError(makeBodyError(body)) as Error;
    expect(wrapped.message).toBe(`Transkribus API error 500: ${body}`);
  });

  it('leaves a 512-char body untouched (exact boundary)', () => {
    const body = 'x'.repeat(512);
    const wrapped = wrapAxiosError(makeBodyError(body)) as Error;
    expect(wrapped.message).toBe(`Transkribus API error 500: ${body}`);
  });

  it('truncates a 513-char body to 512 chars + ellipsis', () => {
    const body = 'x'.repeat(513);
    const wrapped = wrapAxiosError(makeBodyError(body)) as Error;
    expect(wrapped.message).toBe(`Transkribus API error 500: ${'x'.repeat(512)}…`);
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
