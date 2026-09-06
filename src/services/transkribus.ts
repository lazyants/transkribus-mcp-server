import axios, { AxiosInstance, AxiosError, Method } from 'axios';
import { TRANSKRIBUS_API_BASE, MAX_RETRIES, REQUEST_TIMEOUT } from '../constants.js';

let sessionId: string | null = null;
let clientInstance: AxiosInstance | null = null;
let loginClientInstance: AxiosInstance | null = null;

// Credentials are read from the OS keyring first and fall back to the
// environment, so an MCP client config file need not carry a long-lived
// Transkribus account password in clear text. One entry per value under a
// shared service name: `user`, `password` and `session-id`. The service name is
// configurable so several server instances can point at different accounts.
const KEYRING_SERVICE_DEFAULT = 'transkribus-mcp';
const KEYRING_ACCOUNT_USER = 'user';
const KEYRING_ACCOUNT_PASSWORD = 'password';
const KEYRING_ACCOUNT_SESSION = 'session-id';

// A locked or unresponsive credential store must not stall the MCP stdio
// handshake — that is the worst failure shape here, because the client sees
// only a server that never answers. Two independent bounds are used, and the
// second one is the one that actually holds: napi-rs can only cancel work that
// has NOT started, so an AbortSignal does not interrupt a native read already
// waiting on a locked keychain. The signal is still passed (it stops queued
// work early), but each read is also raced against this deadline, after which
// that value is treated as absent and the environment fallback applies.
const KEYRING_TIMEOUT_MS = 5_000;

export interface ResolvedCredentials {
  sessionId: string | null;
  user: string | null;
  password: string | null;
}

// Each source supplies whichever of the three values it happens to hold.
interface CredentialSources {
  keyring: Partial<ResolvedCredentials>;
  env: Partial<ResolvedCredentials>;
}

/**
 * Pure credential-source selection: per value, the keyring wins and the
 * environment is the fallback (mixing sources is allowed — e.g. the user name
 * in the config, the password in the keyring). Throws a clear, secret-free
 * error when neither a session id nor a complete user+password pair is
 * available. Kept pure (no keyring/env IO) so every branch is unit-testable
 * without the native module; the impure reads live in resolveCredentials().
 */
export function selectCredentials({ keyring, env }: CredentialSources): ResolvedCredentials {
  // An entry that exists but holds an empty string falls through to the
  // environment rather than authenticating as the empty user.
  const resolved: ResolvedCredentials = {
    sessionId: keyring.sessionId || env.sessionId || null,
    user: keyring.user || env.user || null,
    password: keyring.password || env.password || null,
  };

  if (resolved.sessionId) return resolved;
  if (resolved.user && resolved.password) return resolved;

  // Never interpolate the runtime TRANSKRIBUS_KEYRING_SERVICE value into this
  // message: a user who mis-set it to their password would otherwise see the
  // secret echoed back. Name the env var and show only the default constant.
  throw new Error(
    [
      'No Transkribus credentials found. Provide them via one of:',
      `  • OS keyring: service "${KEYRING_SERVICE_DEFAULT}" (override with TRANSKRIBUS_KEYRING_SERVICE), ` +
        `accounts "${KEYRING_ACCOUNT_USER}" + "${KEYRING_ACCOUNT_PASSWORD}", or "${KEYRING_ACCOUNT_SESSION}"`,
      '  • Environment variables: TRANSKRIBUS_USER + TRANSKRIBUS_PASSWORD, or TRANSKRIBUS_SESSION_ID',
    ].join('\n')
  );
}

type AsyncEntryConstructor = typeof import('@napi-rs/keyring').AsyncEntry;

/** Resolve `work` normally, or `null` once `ms` has elapsed — the bound that
 *  actually holds when a native keyring read ignores its abort signal. The
 *  timer is unref'd so a pending deadline never keeps the process alive. */
async function withDeadline(work: Promise<string | null>, ms: number): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
    timer.unref?.();
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** Read one keyring entry, resolving to null on ANY failure: no such entry, a
 *  store that cannot be read, or a read that outlives KEYRING_TIMEOUT_MS. Each
 *  entry is isolated, so a missing password cannot discard a present user. */
function readKeyringEntry(
  AsyncEntry: AsyncEntryConstructor,
  service: string,
  account: string,
  signal: AbortSignal
): Promise<string | null> {
  const read = (async () => {
    try {
      return (await new AsyncEntry(service, account).getPassword(signal)) ?? null;
    } catch {
      return null;
    }
  })();
  return withDeadline(read, KEYRING_TIMEOUT_MS);
}

/** Read all three entries in parallel. AsyncEntry, not the sync Entry: the sync
 *  API blocks the event loop. An unavailable keyring — headless Linux without
 *  libsecret, an unsupported platform, `npm install --omit=optional` — throws on
 *  import and degrades to the environment, which is why the module is an
 *  optionalDependency loaded lazily rather than a hard import. */
async function readKeyring(service: string): Promise<ResolvedCredentials> {
  let AsyncEntry: AsyncEntryConstructor;
  try {
    ({ AsyncEntry } = await import('@napi-rs/keyring'));
  } catch {
    return { user: null, password: null, sessionId: null };
  }

  const signal = AbortSignal.timeout(KEYRING_TIMEOUT_MS);
  const [user, password, keyringSessionId] = await Promise.all([
    readKeyringEntry(AsyncEntry, service, KEYRING_ACCOUNT_USER, signal),
    readKeyringEntry(AsyncEntry, service, KEYRING_ACCOUNT_PASSWORD, signal),
    readKeyringEntry(AsyncEntry, service, KEYRING_ACCOUNT_SESSION, signal),
  ]);
  return { user, password, sessionId: keyringSessionId };
}

/** Impure counterpart of selectCredentials: reads the keyring and the
 *  environment, then delegates the choice. Exported for tests. */
export async function resolveCredentials(): Promise<ResolvedCredentials> {
  const service = process.env.TRANSKRIBUS_KEYRING_SERVICE || KEYRING_SERVICE_DEFAULT;
  const keyring = await readKeyring(service);

  return selectCredentials({
    keyring,
    env: {
      user: process.env.TRANSKRIBUS_USER,
      password: process.env.TRANSKRIBUS_PASSWORD,
      sessionId: process.env.TRANSKRIBUS_SESSION_ID,
    },
  });
}

let credentialsPromise: Promise<ResolvedCredentials> | null = null;

/** Single-flight: concurrent callers (ensureSession on the first requests, and
 *  login() on a 401 re-auth) share one keyring lookup, but the cached promise is
 *  cleared on rejection so a transient keyring failure or a credential set after
 *  startup can be retried without restarting the process. */
function getCredentials(): Promise<ResolvedCredentials> {
  if (credentialsPromise) return credentialsPromise;
  const pending = resolveCredentials().catch((err: unknown) => {
    if (credentialsPromise === pending) credentialsPromise = null;
    throw err;
  });
  credentialsPromise = pending;
  return pending;
}

async function login(): Promise<string> {
  const creds = await getCredentials();
  if (!creds.user || !creds.password) {
    // Reachable when only a session id was configured and it has expired: the
    // 401 handler needs a user and password to mint a new session.
    throw new Error(
      'Transkribus login requires a user name and password. Provide them via the OS keyring ' +
      `(service "${KEYRING_SERVICE_DEFAULT}", override with TRANSKRIBUS_KEYRING_SERVICE; accounts ` +
      `"${KEYRING_ACCOUNT_USER}" and "${KEYRING_ACCOUNT_PASSWORD}") or the TRANSKRIBUS_USER and ` +
      'TRANSKRIBUS_PASSWORD environment variables.'
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

// setTimeout coerces its delay to a 32-bit signed int, so a value above this
// ceiling silently wraps and can fire immediately. Clamp every computed delay.
const MAX_RETRY_DELAY_MS = 2_147_483_647;

// RFC 7231 §7.1.1.1 IMF-fixdate, e.g. "Wed, 21 Oct 2015 07:28:00 GMT" — the only
// HTTP-date form a server is permitted to SEND. We parse its fields explicitly
// rather than via Date.parse: Date.parse is a permissive PARSER, not a validator,
// so it silently mishandles the obsolete forms (RFC 850 two-digit years → 19xx,
// asctime → local time) AND normalizes invalid IMF-fixdate values ("31 Feb" →
// Mar 3, hour "25" → next day), any of which would yield a WRONG delay instead of
// a clean reject. Capturing the fields and round-tripping through Date.UTC rejects
// every such value so the caller can fall back to exponential backoff.
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const IMF_FIXDATE = /^([A-Za-z]{3}), (\d{2}) ([A-Za-z]{3}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/;

// Parse a strict IMF-fixdate to a UTC epoch-ms, or null if any field is invalid or
// the value was normalized (Date.UTC silently rolls over out-of-range fields and
// maps a 0-99 year to 19xx, so the exact round-trip below is the real validation).
// The day-name is redundant with the date but a conforming sender always sets it
// correctly, so a mismatch means a corrupt header → reject (→ exponential backoff).
function parseImfFixdate(value: string): number | null {
  const m = IMF_FIXDATE.exec(value);
  if (!m) return null;
  const month = MONTHS.indexOf(m[3]);
  if (month < 0) return null;
  const day = Number(m[2]);
  const year = Number(m[4]);
  const hour = Number(m[5]);
  const minute = Number(m[6]);
  const second = Number(m[7]);
  const ms = Date.UTC(year, month, day, hour, minute, second);
  const d = new Date(ms);
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month ||
    d.getUTCDate() !== day ||
    d.getUTCHours() !== hour ||
    d.getUTCMinutes() !== minute ||
    d.getUTCSeconds() !== second ||
    DAYS[d.getUTCDay()] !== m[1]
  ) {
    return null;
  }
  return ms;
}

/**
 * Parse an RFC 7231 `Retry-After` header into a non-negative millisecond delay.
 * The header is either delta-seconds (a bare integer) OR an HTTP-date — a bare
 * `parseInt` turned a date into `NaN`, so `setTimeout(NaN)` fired immediately and
 * defeated the 429 backoff (#31). Returns null when absent or unparseable (including
 * the obsolete non-IMF-fixdate forms) so the caller falls back to exponential
 * backoff; clamps to a finite, non-negative delay.
 */
export function parseRetryAfterMs(
  retryAfter: string | undefined,
  now: number = Date.now()
): number | null {
  if (!retryAfter) return null;
  const trimmed = retryAfter.trim();

  // delta-seconds: a bare non-negative integer count of seconds.
  if (/^\d+$/.test(trimmed)) {
    return Math.min(Number(trimmed) * 1000, MAX_RETRY_DELAY_MS);
  }

  // HTTP-date (strict IMF-fixdate): delay until that instant, never into the past.
  const dateMs = parseImfFixdate(trimmed);
  if (dateMs === null) return null;
  return Math.min(Math.max(dateMs - now, 0), MAX_RETRY_DELAY_MS);
}

/** Shared 429 rate-limit retry interceptor, bound to whichever `client` instance
 *  it is attached to (the main client OR the login client) — it retries THROUGH
 *  that same parameter, never a closed-over module-scope client, so reusing it
 *  on a second instance cannot reintroduce cross-client recursion. The retry
 *  bound itself is the pre-existing (already-bounded) 429 behavior; the
 *  exhausted-retries error chains its cause instead of discarding it (#30), and
 *  the delay now comes from parseRetryAfterMs rather than a bare parseInt (#31). */
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

      const retryAfterMs = parseRetryAfterMs(error.response.headers['retry-after']);
      const delay = retryAfterMs ?? Math.pow(2, retryCount) * 1000;

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
  // Live session first: the 401 handler mints a fresh one, and re-reading the
  // configured (by then stale) session id here would overwrite it.
  if (sessionId) return;

  const creds = await getCredentials();
  if (creds.sessionId) {
    sessionId = creds.sessionId;
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

// Escapes a string for literal use inside a RegExp pattern (the standard
// idiom: escape every regex metacharacter with a backslash).
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Secrets MUST be pre-sorted longest-first (see redactSessionTokens): regex
// alternation matches the FIRST alternative that succeeds at a given
// position (not POSIX leftmost-longest), so ordering longest-first means a
// longer secret always wins over a shorter one that happens to be its
// prefix — preserving the same prefix-shadowing guarantee a naive
// longest-first loop would have, but without looping.
//
// Redacts every secret in ONE linear pass via a single combined regex,
// rather than looping `.split(secret).join(...)` per secret. The sequential
// approach re-scans the ENTIRE string on each pass — INCLUDING the
// `[REDACTED]` markers earlier passes just inserted. If a discovered
// "secret" happens to be a substring of the marker text itself (e.g. an
// adversarial body with single-char session-shaped fields collecting `R`,
// `E`, `D`, `A`, `C`, `T`, `[`, `]`), each subsequent pass re-redacts the
// markers its OWN prior passes inserted, multiplicatively ballooning the
// string (verified: a 1000-char string amplified to ~2.6M chars under the
// sequential approach — ~166MiB for one field at the 64KiB body scan cap).
// A single combined regex never re-scans its own output — no re-scan, no
// amplification. The alternatives are escaped LITERAL strings (no
// quantifiers/repetition), so matching is linear — no ReDoS.
function redactValue(input: string, secretsLongestFirst: readonly string[]): string {
  const nonEmpty = secretsLongestFirst.filter((s) => s.length > 0);
  if (nonEmpty.length === 0) return input;
  const combined = new RegExp(nonEmpty.map(escapeRegExp).join('|'), 'g');
  return input.replace(combined, '[REDACTED]');
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
