import axios, { AxiosInstance, AxiosError, Method } from 'axios';
import { TRANSKRIBUS_API_BASE, MAX_RETRIES, REQUEST_TIMEOUT } from '../constants.js';

let sessionId: string | null = null;
let clientInstance: AxiosInstance | null = null;
let loginClientInstance: AxiosInstance | null = null;

function getCredentials(): { user: string; password: string } | null {
  const user = process.env.TRANSKRIBUS_USER;
  const password = process.env.TRANSKRIBUS_PASSWORD;
  if (user && password) return { user, password };
  return null;
}

function getSessionFromEnv(): string | null {
  return process.env.TRANSKRIBUS_SESSION_ID || null;
}

async function login(): Promise<string> {
  const creds = getCredentials();
  if (!creds) {
    throw new Error(
      'TRANSKRIBUS_USER and TRANSKRIBUS_PASSWORD environment variables are required, ' +
      'or set TRANSKRIBUS_SESSION_ID directly.'
    );
  }

  const params = new URLSearchParams();
  params.append('user', creds.user);
  params.append('pw', creds.password);

  let response;
  try {
    // #30: always through the dedicated login client — never the main client —
    // so a 401 from /auth/login itself cannot re-enter the main client's 401
    // handler. Recursion is impossible by construction, not by a guard flag.
    response = await getLoginClient().post('/auth/login', params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  } catch (err) {
    // This propagates directly out of ensureSession() to the tool caller —
    // it does NOT go through wrapAxiosError. Apply the same fail-closed rule
    // here: if sanitizeAxiosError can't guarantee full coverage, don't
    // rethrow the (possibly still-hostile) AxiosError itself.
    if (err instanceof AxiosError) {
      const fullySanitized = sanitizeAxiosError(err); // strip JSESSIONID + config.data (#26)
      if (!fullySanitized) {
        // Deliberate: chaining `err` here is exactly the leak this fail-closed path exists to prevent.
        // eslint-disable-next-line preserve-caught-error
        throw new Error('Login failed: response redacted — could not be fully sanitized');
      }
    }
    throw err; // rethrow caught binding (preserve-caught-error ok)
  }

  const cookies = response.headers['set-cookie'];
  if (cookies) {
    for (const cookie of cookies) {
      const match = cookie.match(/JSESSIONID=([^;]+)/);
      if (match) return match[1];
    }
  }

  // Some Transkribus deployments return session in the body
  if (response.data?.sessionId) return response.data.sessionId;

  throw new Error('Login succeeded but no JSESSIONID found in response');
}

function baseClientConfig(): Record<string, unknown> {
  return {
    baseURL: TRANSKRIBUS_API_BASE,
    timeout: REQUEST_TIMEOUT,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  };
}

/** Shared 429 rate-limit retry interceptor, bound to whichever `client` instance
 *  it is attached to (the main client OR the login client) — it retries THROUGH
 *  that same parameter, never a closed-over module-scope client, so reusing it
 *  on a second instance cannot reintroduce cross-client recursion. Logic is
 *  unchanged from the pre-existing (already-bounded) 429 behavior; only the
 *  exhausted-retries error now chains its cause instead of discarding it. */
function attachRateLimitInterceptor(client: AxiosInstance): void {
  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const config = error.config;
      if (!config || error.response?.status !== 429) return Promise.reject(error);

      const retryCount = ((config as unknown as Record<string, unknown>).__retryCount as number) || 0;
      if (retryCount >= MAX_RETRIES) {
        return Promise.reject(chainSanitizedCause('Rate limit exceeded after maximum retries', error));
      }

      const retryAfter = error.response.headers['retry-after'];
      let delay: number;
      if (retryAfter) {
        delay = parseInt(retryAfter, 10) * 1000;
      } else {
        delay = Math.pow(2, retryCount) * 1000;
      }

      (config as unknown as Record<string, unknown>).__retryCount = retryCount + 1;
      console.error(`[transkribus-mcp] Rate limited. Retrying in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);

      await new Promise((resolve) => setTimeout(resolve, delay));
      return client.request(config);
    }
  );
}

function createClient(): AxiosInstance {
  const client = axios.create(baseClientConfig());

  // Attach session cookie
  client.interceptors.request.use((config) => {
    if (sessionId) {
      config.headers['Cookie'] = `JSESSIONID=${sessionId}`;
    }
    return config;
  });

  // Re-login on 401. login() always goes through the dedicated loginClient
  // (see below), so a failed re-login can never loop back into this handler.
  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const config = error.config;
      if (!config || error.response?.status !== 401) return Promise.reject(error);

      const retried = (config as unknown as Record<string, unknown>).__authRetried as boolean;
      if (retried) return Promise.reject(error);
      (config as unknown as Record<string, unknown>).__authRetried = true;

      try {
        sessionId = await login();
        console.error('[transkribus-mcp] Re-authenticated after 401');
        return client.request(config);
      } catch (loginErr) {
        return Promise.reject(sessionExpiredError(loginErr));
      }
    }
  );

  attachRateLimitInterceptor(client);

  return client;
}

/** A dedicated axios instance for /auth/login. It carries the same 429-retry
 *  behavior as the main client (so login-on-429 stays a bounded delayed retry,
 *  not an immediate failure) but deliberately has NO 401 branch and NO request
 *  interceptor: there is no session to attach yet, and a stale one is exactly
 *  what login() is replacing. This is the #30 fix — recursion through the 401
 *  handler is structurally impossible because login() never touches it. */
function createLoginClient(): AxiosInstance {
  const client = axios.create(baseClientConfig());
  attachRateLimitInterceptor(client);
  return client;
}

function getClient(): AxiosInstance {
  if (!clientInstance) {
    clientInstance = createClient();
  }
  return clientInstance;
}

function getLoginClient(): AxiosInstance {
  if (!loginClientInstance) {
    loginClientInstance = createLoginClient();
  }
  return loginClientInstance;
}

async function ensureSession(): Promise<void> {
  if (sessionId) return;

  const envSession = getSessionFromEnv();
  if (envSession) {
    sessionId = envSession;
    return;
  }

  sessionId = await login();
  console.error('[transkribus-mcp] Authenticated successfully');
}

function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

// Headers that must never survive on an AxiosError we chain as `{ cause: err }`.
// `set-cookie` is transkribus-specific: the /auth/login response carries
// JSESSIONID there, and the server may re-issue it on any response.
const SENSITIVE_HEADERS = new Set([
  'authorization', 'proxy-authorization', 'cookie', 'set-cookie',
]);

// Remove auth-bearing headers case-insensitively from an AxiosHeaders instance
// (which exposes .delete) OR a plain object. A fixed-case delete would miss a
// plain key like `COOKIE`, so iterate the actual keys. Type-guard `.delete`
// because a plain object whose own key is literally "delete" would otherwise throw.
function scrubAuth(headers: unknown): void {
  if (!headers || typeof headers !== 'object') return;
  const h = headers as Record<string, unknown> & { delete?: unknown };
  const del = typeof h.delete === 'function' ? (h.delete as (k: string) => void) : null;
  for (const key of Object.keys(h)) {
    if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
      del?.call(h, key); // AxiosHeaders removes its normalized entry
      delete h[key]; // plain-object / belt-and-suspenders
    }
  }
}

// #32b: config.params (axios' parsed query object) and any query string baked
// directly into config.url are a broad-spectrum PII/credential surface — user
// search terms and filters on the other ~300 tools, not just auth. Scrub both
// the same way as config.data: the caller already has what it sent, so there
// is no diagnostic cost to dropping it from a chained error.
function scrubQueryParams(config: { params?: unknown; url?: unknown }): void {
  delete config.params;
  if (typeof config.url === 'string') {
    const qIndex = config.url.indexOf('?');
    if (qIndex !== -1) config.url = config.url.slice(0, qIndex) + '?[REDACTED]';
  }
}

// Scrub credential-bearing fields on a request/response config: headers, auth,
// proxy.auth, the request body (#26 — broad, every request, not just login),
// and query strings (#32b). config.data is what the caller already sent, so
// dropping it costs nothing; the RESPONSE body is the diagnostic worth keeping.
function scrubConfig(config: unknown): void {
  if (!config || typeof config !== 'object') return;
  const c = config as { headers?: unknown; auth?: unknown; proxy?: { auth?: unknown } | null; data?: unknown; params?: unknown; url?: unknown };
  scrubAuth(c.headers);
  delete c.auth;
  if (c.proxy && typeof c.proxy === 'object') delete c.proxy.auth;
  delete c.data;
  scrubQueryParams(c);
}

// Field names (any case, underscore/hyphen variant) that carry a session token
// in a Transkribus response body: sessionId, SessionID, session_id, JSESSIONID.
function isSessionFieldName(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[_-]/g, '');
  return normalized === 'sessionid' || normalized === 'jsessionid';
}

// A plain data object — own-enumerable-property lookup (Object.entries,
// `in`, property access) reflects exactly what's THERE, nothing inherited or
// hidden behind custom get/has semantics. `Object.create(customProto)` (own
// properties empty, but `.message` resolves via the prototype chain) and
// class instances with a non-Object prototype are excluded on purpose. A
// null-prototype object (`Object.create(null)`) is ALSO excluded — it's
// technically walkable via Object.entries, but axios always parses response
// bodies with `JSON.parse`, which never produces a null-proto object, so this
// never over-fires on a real response; excluding it keeps the guard simple
// (one check: is the prototype EXACTLY Object.prototype) instead of carrying
// a second allowed shape whose safety would need its own justification.
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.getPrototypeOf(value) === Object.prototype;
}

// A plain array or plain object — the only two container shapes
// collectSessionValues's Object.entries()/Array.isArray-based walk can
// actually see everything in. A `Map`, `Set`, `Date`, or any exotic/class
// object either has no own-enumerable properties Object.entries can read
// (its data lives elsewhere internally) or exposes properties through a
// prototype the walk never inspects — either way, walking it silently finds
// NOTHING even if it carries a secret, and the walk would incorrectly report
// success. See collectSessionValues's use of this guard.
//
// For arrays specifically: the walk only ever visits INDEXED elements
// (`for (const item of value)`), so an array carrying an extra named
// property (`const a = ['x']; a.sessionId = 'secret'`) OR a HOLE
// (`const a = new Array(1); a.sessionId = 'secret'` — index 0 is a hole, so
// `Object.keys` reports only the named prop, and a length check ALONE
// (`keys.length === arr.length`) would pass since both equal 1) would
// silently hide that property from the walk the same way a Map hides its
// entries. Requiring every own-enumerable key to be EXACTLY the dense index
// sequence (`'0'`, `'1'`, …) rejects both shapes at once: a clean JSON-parsed
// array (JSON.parse never produces sparse arrays or extra properties either)
// always has exactly that key set.
function isPlainContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  if (Array.isArray(value)) {
    const keys = Object.keys(value);
    return keys.length === value.length && keys.every((k, i) => k === String(i));
  }
  return isPlainObject(value);
}

// Detects a session-token KEY pattern (jsessionid / session[_-]?id followed
// by `=`, `:`, or `%3d`) appearing ANYWHERE inside a response-body string
// leaf. Precisely bounding a token's VALUE from such a match by charset is
// unsolvable in general: Tomcat/JBoss's jvmRoute cluster-routing suffix uses
// a literal `.` inside the token itself, arbitrary prose can use
// `+`/`/`/`=`/anything else, and no fixed allowlist or blacklist can tell
// "part of the token" from "text that happens to follow it" in free-flowing
// text (verified: a positive allowlist excluding `.` under-captured
// `JSESSIONID=abc.node1` down to just `abc`, silently leaking `.node1`).
// Rather than guess, the body walk (collectSessionValues) treats ANY match of
// this pattern as "this response body cannot be trusted at all" and fails
// the WHOLE response closed — see redactSessionTokensCore / sanitizeAxiosError.
// Deliberate, safe-direction trade-off: a body that merely MENTIONS
// "sessionId" in unrelated prose immediately followed by `:`/`=` (e.g.
// `{"error":"invalid sessionId: xyz-format"}`) also trips this and gets
// replaced with a placeholder instead of shown to the caller — accepted, not
// a surprise.
const SESSION_KEY_PATTERN_RE = /(?:jsessionid|session[_-]?id)['"]?\s*(?:=|:|%3d)/i;

// Same cookie-attribute parsing login() uses (stop at the first `;`) applied
// to Set-Cookie / Cookie header values specifically, so a JSESSIONID riding in
// a header is captured as exactly the token — not the whole
// "JSESSIONID=x; Path=/; HttpOnly" string. MUST run before scrubAuth deletes
// these headers (see sanitizeAxiosError's call order): a freshly-minted
// session that rides ONLY in Set-Cookie (and is echoed elsewhere via a
// non-denylisted header like `x-debug-session`) would otherwise never be
// discovered at all, since collectSessionValues only walks the response body.
// Global flag: a single Cookie header can legally carry MULTIPLE cookies in
// one string (`JSESSIONID=first; JSESSIONID=second`, or unrelated cookies
// interspersed) — matchAll (below) finds every occurrence, not just the
// first. A non-global `.match()` would silently stop after the first
// JSESSIONID, leaving a second one un-discovered and free to leak elsewhere.
const COOKIE_SESSION_RE = /JSESSIONID=([^;]+)/gi;

// A cookie-value is legally DQUOTE-wrapped per RFC 6265 (`JSESSIONID="abc"`);
// COOKIE_SESSION_RE's `[^;]+` capture includes the quotes verbatim. Strip a
// single matched leading+trailing pair so the collected secret is the BARE
// token — otherwise it only value-matches another quoted echo of the same
// string, not a bare echo elsewhere (e.g. a JSON body's `"session abc
// rejected"`), and the bare form survives unredacted.
function stripCookieQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

function collectSessionValuesFromHeaders(headers: unknown, out: Set<string>): boolean {
  if (!headers || typeof headers !== 'object') return true;
  const h = headers as Record<string, unknown>;
  for (const key of Object.keys(h)) {
    const lower = key.toLowerCase();
    const values = Array.isArray(h[key]) ? (h[key] as unknown[]) : [h[key]];
    for (const v of values) {
      if (typeof v !== 'string') continue;
      if (lower === 'set-cookie' || lower === 'cookie') {
        // Authoritative: cookie-attribute parsing stops at the first LITERAL
        // `;` — the protocol-correct value boundary per RFC 6265, not a
        // charset guess — so it correctly captures `+`/`/`/`=`/`.` and
        // anything else that's genuinely part of the value. matchAll (not
        // match) collects EVERY JSESSIONID in the string, not just the first.
        for (const match of v.matchAll(COOKIE_SESSION_RE)) {
          out.add(stripCookieQuotes(match[1]));
          if (out.size > MAX_SECRETS) return false;
        }
        continue;
      }
      // Any OTHER header can carry free-flowing prose too, same as the body
      // (verified: `x-debug: JSESSIONID=abc+def` under-captured to `abc`
      // with a charset-limited allowlist, leaking `+def`). Same fix as the
      // body: don't try to bound a value from it — a bare key-pattern match
      // fails the whole response closed instead of guessing a boundary.
      if (SESSION_KEY_PATTERN_RE.test(v)) return false;
    }
  }
  return true;
}

// Total number of stack items a single collect-or-redact walk will pop before
// giving up. Unlike a depth cap, this bounds worst-case work while still
// reaching every leaf regardless of NESTING DEPTH — only a genuinely huge/wide
// body can exhaust it. Tripping this (or either cap below) makes the
// discovered secret set untrustworthy; see sanitizeAxiosError's fail-closed
// handling.
const MAX_WALK_NODES = 5000;

// Cap on distinct candidate secrets: redactValue's cost is O(secrets × text
// length) per string surface it touches, so an unbounded secret count turns a
// single hostile body into a quadratic blowup across every surface
// redactSessionTokensCore redacts. Tripping this aborts the walk the same way
// an exhausted node budget does.
const MAX_SECRETS = 256;

// Cap on total string content (chars) the collect walk will scan — bounds a
// single giant string (which counts as only one stack pop against
// MAX_WALK_NODES) from making the scan itself expensive.
const MAX_BYTES_SCANNED = 64 * 1024;

// Placeholder for a response body deemed untrustworthy — either an inline
// session-key pattern that can't be precisely bounded by charset (see
// SESSION_KEY_PATTERN_RE), or a budget/byte/secret-count cap tripped during
// the walk. Best-effort only: the caller (sanitizeAxiosError returning false)
// never exposes `err` at all once this path is taken, so this replacement is
// defense-in-depth, not the primary guarantee.
const BODY_UNTRUSTED_PLACEHOLDER = '[REDACTED: response body could not be safely sanitized]';

// Iterative, cycle-safe walk (explicit stack + a WeakSet of visited
// containers, so a circular response.data can't hang this) that collects
// candidate session-token VALUES from a response body: any string found under
// a sessionId/JSESSIONID-shaped key at ANY nesting depth (field-form — no
// charset ambiguity, the whole string value is captured verbatim). Returns
// false — meaning "this body cannot be trusted" — if the node/byte budget was
// exhausted, if the distinct-secret cap was tripped, OR if any string leaf
// contains an INLINE session-key pattern (see SESSION_KEY_PATTERN_RE): unlike
// the field form, an inline prose match has no reliable value boundary, so
// the walk refuses to guess and fails the whole body closed instead of
// extracting a possibly-wrong substring.
function collectSessionValues(root: unknown, out: Set<string>): boolean {
  if (root == null) return true;
  const stack: unknown[] = [root];
  const visited = new WeakSet<object>();
  let budget = MAX_WALK_NODES;
  let bytesScanned = 0;

  while (stack.length > 0) {
    if (budget-- <= 0) return false;
    const value = stack.pop();
    if (value == null) continue;
    if (typeof value === 'string') {
      bytesScanned += value.length;
      if (bytesScanned > MAX_BYTES_SCANNED) return false;
      if (SESSION_KEY_PATTERN_RE.test(value)) return false;
      continue;
    }
    if (typeof value !== 'object') continue;
    // A Map/Set/Date/class-instance/Object.create(customProto) either hides
    // its data from Object.entries entirely or exposes it only via an
    // inherited property this walk never inspects — either way, walking it
    // finds NOTHING even if it carries a secret, and would incorrectly
    // report the walk as complete. Fail closed instead of guessing.
    if (!isPlainContainer(value)) return false;
    if (visited.has(value)) continue;
    visited.add(value);

    if (Array.isArray(value)) {
      for (const item of value) stack.push(item);
    } else {
      for (const [key, v] of Object.entries(value)) {
        if (isSessionFieldName(key)) {
          if (typeof v === 'string') {
            if (v.length > 0) {
              out.add(v);
              if (out.size > MAX_SECRETS) return false;
            }
            // empty string: nothing to collect, not suspicious — skip silently
          } else if (v !== null && v !== undefined) {
            // A session-field key with a non-string value (a number, a
            // nested object, an array, a boolean) can't be safely
            // bounded/redacted the way a string can — collecting
            // `String(v)` risks a wrong/incomplete representation, and the
            // real secret (e.g. hiding inside a nested object) might not
            // even be reachable by stringifying the outer value. Fail
            // closed rather than guess. (Residual, accepted: a session
            // value split across MULTIPLE non-session-named keys, e.g.
            // `{JSESSION:{ID:secret}}`, has no key that matches
            // isSessionFieldName at all and is not reliably catchable by
            // key-name detection — only covered if the value also overlaps
            // an authoritative secret found elsewhere. Detecting an
            // arbitrary secret in an arbitrary adversarial structure with no
            // such overlap is not decidable.)
            return false;
          }
        }
        stack.push(v);
      }
    }
  }
  return true;
}

// Secrets MUST be pre-sorted longest-first (see redactSessionTokens): a
// shorter collected value (e.g. a truncated inline match) can otherwise
// pre-empt and fragment a longer one that contains it as a prefix, leaving
// the longer value's suffix exposed after the shorter replacement already
// consumed part of the text.
function redactValue(input: string, secretsLongestFirst: readonly string[]): string {
  let result = input;
  for (const secret of secretsLongestFirst) {
    if (secret) result = result.split(secret).join('[REDACTED]');
  }
  return result;
}

// Iterative, cycle-safe, node-budget-bounded twin of collectSessionValues:
// mutates every string leaf reachable from an object/array container in
// place. A bare top-level string can't be mutated through a reference, so
// callers handle that case themselves before/instead of calling this. Returns
// false if the budget was exhausted before the walk finished — same contract
// as collectSessionValues, so neither phase can silently stop short of the
// other and leave a gap. Can throw (e.g. assigning into a frozen response
// body) — callers must not assume this never throws; see sanitizeAxiosError's
// fail-closed try/catch, which is what actually contains this.
function redactStringsInPlace(root: unknown, secretsLongestFirst: readonly string[]): boolean {
  if (root == null || typeof root !== 'object') return true;
  const stack: (Record<string, unknown> | unknown[])[] = [root as Record<string, unknown> | unknown[]];
  const visited = new WeakSet<object>();
  let budget = MAX_WALK_NODES;

  while (stack.length > 0) {
    if (budget-- <= 0) return false;
    const container = stack.pop()!;
    if (visited.has(container)) continue;
    visited.add(container);

    if (Array.isArray(container)) {
      for (let i = 0; i < container.length; i++) {
        const v = container[i];
        if (typeof v === 'string') container[i] = redactValue(v, secretsLongestFirst);
        else if (v != null && typeof v === 'object') stack.push(v as Record<string, unknown> | unknown[]);
      }
    } else {
      for (const key of Object.keys(container)) {
        const v = container[key];
        if (typeof v === 'string') container[key] = redactValue(v, secretsLongestFirst);
        else if (v != null && typeof v === 'object') stack.push(v as Record<string, unknown> | unknown[]);
      }
    }
  }
  return true;
}

// Discover session-token values riding in the response body (any nesting,
// budget-bounded) AND the response's Set-Cookie/Cookie headers (collected
// BEFORE scrubAuth deletes them — see sanitizeAxiosError), plus the live
// module session, then value-redact every collected token — LONGEST first
// (see redactValue) — across EVERY surviving string-bearing surface:
// response.data (recursively), response.headers (every value — not just the
// SENSITIVE_HEADERS denylist, which only catches 4 specific header NAMES and
// would miss e.g. a custom `x-debug-session` header echoing the same value),
// response.statusText, and the Error's own message/stack. Both message AND
// stack are redacted independently because V8 bakes `message` into `stack` at
// construction time — scrubbing only one leaves the secret in the other.
//
// Returns false whenever the discovered secret set cannot be trusted to be
// complete (a walk exhausted its node/byte/secret-count budget). Deliberately
// does NOT try to neutralize individual surfaces in that case — enumerating
// every surface correctly is exactly the class of bug this once had (a
// "safe" header allowlist that wasn't, message/stack left unredacted because
// nothing was ever collected to redact them against). Instead, the caller
// (sanitizeAxiosError → wrapAxiosError) drops the entire AxiosError rather
// than exposing any part of it — see the module-level comment on
// sanitizeAxiosError.
function redactSessionTokensCore(err: AxiosError): boolean {
  const secrets = new Set<string>();
  let bodyWalkComplete = true;
  if (err.response) {
    const bodyOk = collectSessionValues(err.response.data, secrets);
    const headersOk = collectSessionValuesFromHeaders(err.response.headers, secrets);
    bodyWalkComplete = bodyOk && headersOk;
  }
  if (sessionId) secrets.add(sessionId);

  if (!bodyWalkComplete) {
    // Best-effort only: the caller (wrapAxiosError / sessionExpiredError /
    // the 429-exhausted branch) never exposes `err` at all once this
    // returns false, so this replacement is defense-in-depth, not the
    // primary guarantee.
    if (err.response) err.response.data = BODY_UNTRUSTED_PLACEHOLDER;
    return false;
  }
  if (secrets.size === 0) return true;

  const secretsLongestFirst = [...secrets].sort((a, b) => b.length - a.length);

  if (err.response) {
    const body = err.response.data;
    if (typeof body === 'string') {
      err.response.data = redactValue(body, secretsLongestFirst);
    } else if (!redactStringsInPlace(body, secretsLongestFirst)) {
      err.response.data = BODY_UNTRUSTED_PLACEHOLDER;
      return false;
    }

    if (typeof err.response.statusText === 'string') {
      err.response.statusText = redactValue(err.response.statusText, secretsLongestFirst);
    }
    const headers = err.response.headers as unknown;
    if (headers && typeof headers === 'object') {
      const h = headers as Record<string, unknown>;
      for (const key of Object.keys(h)) {
        const v = h[key];
        if (typeof v === 'string') {
          h[key] = redactValue(v, secretsLongestFirst);
        } else if (Array.isArray(v)) {
          h[key] = v.map((item) => (typeof item === 'string' ? redactValue(item, secretsLongestFirst) : item));
        }
      }
    }
  }

  if (typeof err.message === 'string') {
    err.message = redactValue(err.message, secretsLongestFirst);
  }
  if (typeof err.stack === 'string') {
    err.stack = redactValue(err.stack, secretsLongestFirst);
  }

  return true;
}

/**
 * Mutates `err` in place to strip every credential/secret surface this
 * module knows about (config headers/auth/data/params/url, the raw
 * `request._header` block, response headers, and any session token
 * DISCOVERED in the response body — see redactSessionTokensCore), and
 * returns whether that redaction can be trusted to be COMPLETE.
 *
 * Fail-closed by design: the whole body (scrubConfig ×2, the redaction pass,
 * scrubAuth, and the request/cause cleanup) runs inside one try/catch. A
 * frozen/non-writable response — whether just `response.data`, or the whole
 * response object, or a frozen AxiosHeaders instance that makes `.delete()`
 * throw — can make ANY of these steps throw; rather than chase every
 * possible mutation site, a single catch here reports `false` and lets the
 * caller (wrapAxiosError) decide not to expose `err` AT ALL. That is also why
 * an incomplete walk (budget/byte/secret-count cap tripped) reports `false`
 * instead of attempting a "best-effort" partial redaction: this function's
 * caller must be able to tell "fully sanitized" from "uncertain" and refuse
 * to chain `err` as a cause in the uncertain case — see
 * `gotcha_axios_cause_walk_cookie_leak.md` and contracts.test.ts.
 */
export function sanitizeAxiosError(err: AxiosError): boolean {
  try {
    scrubConfig(err.config);
    scrubConfig(err.response?.config); // may be a distinct ref depending on the adapter
    // #26: discover + value-redact BEFORE scrubAuth deletes Set-Cookie/Cookie —
    // a freshly-minted session riding ONLY in Set-Cookie must be discovered
    // from that header while it still exists, or it survives in any OTHER
    // header that echoes the same value (e.g. a custom x-debug-session).
    const fullyRedacted = redactSessionTokensCore(err);
    scrubAuth(err.response?.headers); // final deletion of the 4 named sensitive headers
    delete (err as { request?: unknown }).request; // carries request._header raw block
    if (err.response) delete (err.response as { request?: unknown }).request;
    const e = err as { cause?: unknown };
    if (e.cause && typeof e.cause === 'object') delete e.cause;
    return fullyRedacted;
  } catch {
    return false;
  }
}

/** Build a plain Error carrying `message`, chaining the sanitized AxiosError as
 *  `cause` ONLY when sanitizeAxiosError reports the redaction as fully
 *  trustworthy — the shared fail-closed shape of the 429-exhausted and
 *  session-expired paths. sanitizeAxiosError(err) runs first (mutating `err` in
 *  place); an uncertain redaction drops the cause entirely rather than risk
 *  leaking it. */
function chainSanitizedCause(message: string, err: AxiosError): Error {
  return sanitizeAxiosError(err)
    ? new Error(message, { cause: err })
    : new Error(message);
}

/** Build the 401 re-auth failure error, sanitizing the login AxiosError (it carries
 *  the stale JSESSIONID cookie) before chaining it as `cause`. Exported for the
 *  cookie-leak regression test of this plain-Error re-auth path. Defense-in-depth:
 *  login() also sanitizes, so this is idempotent. Fail-closed like wrapAxiosError:
 *  if sanitizeAxiosError can't guarantee full coverage, `loginErr` is never
 *  chained as `cause` at all. */
export function sessionExpiredError(loginErr: unknown): Error {
  if (loginErr instanceof AxiosError) {
    return chainSanitizedCause('Session expired and re-authentication failed', loginErr);
  }
  return new Error('Session expired and re-authentication failed', { cause: loginErr });
}

// Cap on the variable (server-supplied) portion of a wrapped error message —
// an unbounded response body (e.g. a multi-MB HTML error page) would otherwise
// become the message verbatim.
const MAX_ERROR_MESSAGE_LENGTH = 512;

function capMessage(msg: string): string {
  return msg.length > MAX_ERROR_MESSAGE_LENGTH
    ? msg.slice(0, MAX_ERROR_MESSAGE_LENGTH) + '…'
    : msg;
}

// Message for the fail-closed path: sanitizeAxiosError could not guarantee
// every secret was accounted for (an incomplete/capped walk, or an exception
// during scrubbing — e.g. a frozen response). Rather than try to neutralize
// the untrusted AxiosError surface-by-surface, `err` is never referenced at
// all beyond its already-known, non-sensitive status code: nothing hostile
// can survive if nothing hostile is included.
const UNCERTAIN_SANITIZATION_MESSAGE = 'response redacted — could not be fully sanitized';

/**
 * Convert an AxiosError to a plain Error with a Transkribus-flavored message,
 * preserving the original via `cause` — but ONLY when `sanitizeAxiosError`
 * reports the redaction as fully trustworthy. Non-axios errors are returned
 * unchanged so the caller can rethrow them as-is.
 *
 * Exported for test access. Before chaining, `sanitizeAxiosError` strips the
 * session cookie (`cookie` / `set-cookie` headers) plus `authorization` /
 * `proxy-authorization` headers, `config.auth` / `proxy.auth`, request bodies,
 * query strings, and any session token discovered in the response body (#26 +
 * #32b) — in place, so deep-walk logging (`util.inspect(err, { depth: null })`,
 * `AxiosError.toJSON()`, `JSON.stringify`) cannot surface a secret. The
 * server-supplied message portion is capped at 512 chars.
 *
 * Fail-closed: if sanitizeAxiosError returns false (an incomplete/capped
 * walk, or any exception while scrubbing — see its doc comment), `err` is
 * NOT chained as `cause` and none of its fields are read. See
 * contracts.test.ts and `gotcha_axios_cause_walk_cookie_leak.md`.
 */
export function wrapAxiosError(err: unknown): unknown {
  if (!(err instanceof AxiosError)) return err;
  const fullySanitized = sanitizeAxiosError(err);

  if (!fullySanitized) {
    const status = err.response?.status;
    const label = status !== undefined ? ` ${status}` : '';
    return new Error(`Transkribus API error${label}: [${UNCERTAIN_SANITIZATION_MESSAGE}]`);
  }

  if (err.response) {
    const { status, statusText, data: body } = err.response;
    if (typeof body === 'string' && body.length > 0) {
      return new Error(`Transkribus API error ${status}: ${capMessage(body)}`, { cause: err });
    }
    // Only read `.message` off a body we actually WALKED (a plain object —
    // see isPlainObject / collectSessionValues) AND only if it's an OWN
    // ENUMERABLE property. By this point fullySanitized being true already
    // implies the walk covered every plain container reachable from
    // response.data — but Object.entries (what the walk uses) only ever
    // visits own-ENUMERABLE properties, so a non-enumerable `.message`
    // (`Object.defineProperty(body, 'message', { value: '...', enumerable:
    // false })`) is invisible to the walk yet still readable via plain
    // property access. This guard is defense-in-depth against BOTH gaps: a
    // value inherited via a prototype chain (e.g. Object.create({ message:
    // '...' })) or a non-enumerable own property — neither is "actually
    // present" in the sense the walk checks.
    if (isPlainObject(body) && Object.prototype.propertyIsEnumerable.call(body, 'message') && body.message) {
      return new Error(`Transkribus API error ${status}: ${capMessage(String(body.message))}`, { cause: err });
    }
    return new Error(`Transkribus API error: ${status} ${statusText}`, { cause: err });
  }

  if (err.code) {
    return new Error(`Network error: ${capMessage(err.message)}`, { cause: err });
  }

  return err;
}

export async function transkribusRequest<T = unknown>(
  method: Method,
  path: string,
  data?: unknown,
  params?: Record<string, unknown>
): Promise<T> {
  await ensureSession();
  try {
    const client = getClient();
    const response = await client.request<T>({
      method,
      url: path,
      data,
      params: params ? stripUndefined(params) : undefined,
    });
    return response.data;
  } catch (err) {
    throw wrapAxiosError(err);
  }
}

export async function transkribusUpload<T = unknown>(
  path: string,
  formData: FormData,
  params?: Record<string, unknown>
): Promise<T> {
  await ensureSession();
  try {
    const client = getClient();
    const response = await client.post<T>(path, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      params: params ? stripUndefined(params) : undefined,
    });
    return response.data;
  } catch (err) {
    throw wrapAxiosError(err);
  }
}
