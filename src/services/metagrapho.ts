import axios, { AxiosError, AxiosInstance, Method } from 'axios';
import {
  MAX_RETRIES,
  METAGRAPHO_API_BASE,
  METAGRAPHO_CLIENT_ID,
  READCOOP_TOKEN_URL,
  REQUEST_TIMEOUT,
  TOKEN_EXPIRY_SKEW_MS,
} from '../constants.js';

/**
 * Client for the Transkribus Metagrapho ("Processing") API.
 *
 * Deliberately independent of services/transkribus.ts. That module speaks to a
 * different service with a different auth scheme (a JSESSIONID cookie), and its
 * error path is built around discovering session tokens that were echoed back in
 * a response. See `metagraphoError` below for why this module must NOT borrow it.
 */

/** OIDC token response fields this module reads. Everything else is ignored. */
interface TokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
}

let accessToken: string | null = null;
let refreshToken: string | null = null;
let expiresAt = 0;

/**
 * The single in-flight token exchange. Concurrent tool calls that all find the
 * token missing or expired await THIS promise instead of each starting their own
 * exchange — one network round trip, one set of stored tokens, no interleaved
 * writes to the module state above. Cleared in a `finally` so a failed exchange
 * does not poison the next attempt.
 */
let tokenInFlight: Promise<string> | null = null;

let clientInstance: AxiosInstance | null = null;
let tokenClientInstance: AxiosInstance | null = null;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Build the error for a failed Metagrapho call.
 *
 * FIXED STRINGS AND A NUMERIC STATUS ONLY — never the response body, the status
 * text, a header, or the AxiosError as `cause`.
 *
 * Why this module does not reuse `wrapAxiosError` from services/transkribus.ts:
 * that sanitizer strips secrets from where they were SENT (it deletes
 * `config.data`, `config.params`, the query string and the `authorization`
 * header). It has no way to find a secret the server ECHOED BACK, because its
 * discovery walk only recognises `sessionId` / `JSESSIONID`-shaped fields. It
 * knows nothing about a password, an `access_token`, or a `refresh_token`. So a
 * token-endpoint body like `{"error_description":"Rejected <password>"}` would
 * survive inside the chained `cause`, and a Processing body like
 * `{"message":"Rejected <access token>"}` would be copied verbatim into the
 * public error message and from there into the MCP tool result and stderr.
 * (Verified against the real sanitizer with synthetic secrets: ordinary errors
 * were clean, echoed secrets survived, and `JSON.stringify(cause)` did not even
 * reveal the response-body leak — only a deep inspect did.)
 *
 * Teaching that 600-line redactor three more secret vocabularies would be the
 * larger and more fragile change. Refusing to carry upstream detail at all is
 * smaller, and it cannot leak a secret shape nobody thought of.
 *
 * The cost is accepted deliberately: a caller sees "…error 400" rather than the
 * server's wording. The status plus the failing tool is enough to act on.
 */
function metagraphoError(context: string, err: unknown): Error {
  // Already one of ours — every non-Axios error reaching here was built from
  // fixed strings in this module (a token failure, a missing-credentials
  // message, retry exhaustion). Re-wrapping would throw away the more specific
  // message it already carries, e.g. turning "authentication failed: HTTP 400"
  // back into a bare "request failed".
  if (err instanceof Error && !(err instanceof AxiosError)) return err;

  if (err instanceof AxiosError) {
    const status = err.response?.status;
    // Number.isInteger, not a truthiness check: a status is either a real
    // integer from the response line or it is absent. Nothing else is copied.
    if (Number.isInteger(status)) {
      return new Error(`${context} failed: HTTP ${status}`);
    }
    // No response at all — a transport failure. `err.code` is an axios-defined
    // constant (ECONNABORTED, ENOTFOUND, …), never server-controlled text, but
    // it is still not needed to act on the failure, so it is not included.
    return new Error(`${context} failed: no response from the server`);
  }
  return new Error(`${context} failed`);
}

// ---------------------------------------------------------------------------
// Credentials and tokens
// ---------------------------------------------------------------------------

function getCredentials(): { user: string; password: string } | null {
  const user = process.env.TRANSKRIBUS_USER;
  const password = process.env.TRANSKRIBUS_PASSWORD;
  if (user && password) return { user, password };
  return null;
}

/** Escape hatch mirroring TRANSKRIBUS_SESSION_ID on the legacy client: use a
 *  token minted elsewhere and skip the grant entirely. */
function getTokenFromEnv(): string | null {
  return process.env.TRANSKRIBUS_ACCESS_TOKEN || null;
}

function getClientId(): string {
  return process.env.TRANSKRIBUS_PROCESSING_CLIENT_ID || METAGRAPHO_CLIENT_ID;
}

/** A dedicated instance for the token endpoint: absolute URL, no auth header,
 *  and NO 401 interceptor. The API client's 401 handler calls back into token
 *  acquisition, so the exchange must never travel through that handler —
 *  recursion is impossible by construction rather than by a guard flag. */
function getTokenClient(): AxiosInstance {
  if (!tokenClientInstance) {
    tokenClientInstance = axios.create({ timeout: REQUEST_TIMEOUT });
  }
  return tokenClientInstance;
}

function storeTokens(data: unknown, context: string): string {
  const body = (data ?? {}) as TokenResponse;
  const token = body.access_token;
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error(`${context} failed: the token response contained no access_token`);
  }
  accessToken = token;
  refreshToken = typeof body.refresh_token === 'string' ? body.refresh_token : null;
  // A non-numeric or absent expires_in leaves expiresAt at 0, which means "no
  // known expiry": the token is used until the server rejects it, and the 401
  // branch then re-acquires. Re-acquiring on EVERY call instead would spend a
  // token exchange per request to avoid a failure the 401 path already handles
  // for free. (Keycloak always sends expires_in, so this is the unreachable-in-
  // practice branch either way.)
  const lifetime = typeof body.expires_in === 'number' ? body.expires_in : 0;
  expiresAt = lifetime > 0 ? Date.now() + lifetime * 1000 - TOKEN_EXPIRY_SKEW_MS : 0;
  return token;
}

async function postTokenRequest(params: URLSearchParams, context: string): Promise<string> {
  let response;
  try {
    response = await getTokenClient().post(READCOOP_TOKEN_URL, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  } catch (err) {
    throw metagraphoError(context, err);
  }
  return storeTokens(response.data, context);
}

async function passwordGrant(): Promise<string> {
  const creds = getCredentials();
  if (!creds) {
    throw new Error(
      'TRANSKRIBUS_USER and TRANSKRIBUS_PASSWORD environment variables are required ' +
      'for the Transkribus Processing API, or set TRANSKRIBUS_ACCESS_TOKEN directly.'
    );
  }
  const params = new URLSearchParams();
  params.append('grant_type', 'password');
  params.append('client_id', getClientId());
  params.append('username', creds.user);
  params.append('password', creds.password);
  return postTokenRequest(params, 'Processing API authentication');
}

async function refreshGrant(token: string): Promise<string> {
  const params = new URLSearchParams();
  params.append('grant_type', 'refresh_token');
  params.append('client_id', getClientId());
  params.append('refresh_token', token);
  return postTokenRequest(params, 'Processing API token refresh');
}

/** Acquire a token: refresh when a refresh token is held, otherwise a password
 *  grant. A failed refresh is not fatal while credentials are available — the
 *  refresh token may simply have expired or been rotated away. */
async function acquireToken(): Promise<string> {
  const held = refreshToken;
  if (held) {
    try {
      return await refreshGrant(held);
    } catch {
      // Deliberate: the catch takes no binding at all, so nothing upstream can
      // be carried forward. The refresh failure holds no information the
      // password grant's own error will not also carry.
      refreshToken = null;
    }
  }
  return passwordGrant();
}

/** Return a usable bearer token, performing at most one token exchange even
 *  when several callers arrive at once. */
async function ensureToken(): Promise<string> {
  const envToken = getTokenFromEnv();
  if (envToken) return envToken;

  if (accessToken && (expiresAt === 0 || Date.now() < expiresAt)) return accessToken;

  if (!tokenInFlight) {
    tokenInFlight = acquireToken().finally(() => {
      tokenInFlight = null;
    });
  }
  return tokenInFlight;
}

/**
 * Drop the cached access token so the next call re-acquires one, but ONLY if the
 * token that just got rejected is still the cached one. The refresh token is
 * kept: a 401 on the API means the ACCESS token is stale, which is exactly what
 * a refresh is for.
 *
 * The `staleToken` guard matters under concurrency. Two requests go out with
 * token A; the first gets a 401 and refreshes to B; the second's 401 — for the
 * same dead token A — arrives afterwards. Invalidating unconditionally would
 * throw away the perfectly good B and force a third exchange, and with enough
 * in-flight requests that turns into refresh thrash. Comparing first makes the
 * late 401 a no-op, which is what it is.
 */
function invalidateAccessToken(staleToken: string | null): void {
  if (staleToken !== null && staleToken !== accessToken) return;
  accessToken = null;
  expiresAt = 0;
}

/** The bearer value a request actually carried, for the staleness comparison
 *  above. Absent or malformed header means "cannot tell" — the caller then
 *  invalidates unconditionally, the previous behaviour. */
function bearerOf(headers: unknown): string | null {
  if (!headers || typeof headers !== 'object') return null;
  const value = (headers as Record<string, unknown>)['Authorization'];
  if (typeof value !== 'string' || !value.startsWith('Bearer ')) return null;
  return value.slice('Bearer '.length);
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

/** Longest a 429 retry will wait. A server is free to send `Retry-After: 86400`,
 *  and honouring that would hang a tool call for a day; values beyond Node's
 *  32-bit timer range fire IMMEDIATELY instead, which is the opposite of
 *  backing off. Capping handles both. */
const MAX_RETRY_DELAY_MS = 60_000;

/**
 * Milliseconds to wait before retrying a 429. RFC 9110 allows `Retry-After` to
 * be either delta-seconds or an HTTP-date; `parseInt` on a date string yields
 * NaN (or, worse, the leading day number of a date like "Wed, 21 Oct 2015…"),
 * so both forms are parsed explicitly. Anything unusable falls back to
 * exponential backoff. The result is always clamped to MAX_RETRY_DELAY_MS.
 */
function retryDelayMs(header: unknown, retryCount: number): number {
  const fallback = Math.pow(2, retryCount) * 1000;
  let delay = fallback;

  if (typeof header === 'string') {
    const trimmed = header.trim();
    if (/^\d+$/.test(trimmed)) {
      delay = Number(trimmed) * 1000;
    } else {
      const at = Date.parse(trimmed);
      if (Number.isFinite(at)) delay = Math.max(0, at - Date.now());
    }
  }

  return Math.min(delay, MAX_RETRY_DELAY_MS);
}

/** Bounded 429 retry, local to this module. The legacy client's equivalent
 *  rejects by chaining the sanitized AxiosError as `cause`, which is exactly
 *  what metagraphoError forbids here — so this one rejects with the same
 *  detail-free error as every other failure path. */
function attachRateLimitRetry(client: AxiosInstance): void {
  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const config = error.config;
      if (!config || error.response?.status !== 429) return Promise.reject(error);

      const state = config as unknown as Record<string, unknown>;
      const retryCount = (state.__retryCount as number) || 0;
      if (retryCount >= MAX_RETRIES) {
        return Promise.reject(new Error('Processing API request failed: rate limited after maximum retries'));
      }

      const delay = retryDelayMs(error.response.headers['retry-after'], retryCount);

      state.__retryCount = retryCount + 1;
      console.error(
        `[transkribus-mcp] Processing API rate limited. Retrying in ${delay}ms ` +
        `(attempt ${retryCount + 1}/${MAX_RETRIES})`
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
      return client.request(config);
    }
  );
}

function createClient(): AxiosInstance {
  const client = axios.create({
    baseURL: METAGRAPHO_API_BASE,
    timeout: REQUEST_TIMEOUT,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  });

  // Attach a fresh bearer on every request rather than baking one into the
  // instance, so a token replaced after a 401 is picked up by the replay.
  client.interceptors.request.use(async (config) => {
    config.headers['Authorization'] = `Bearer ${await ensureToken()}`;
    return config;
  });

  // 401 → drop the access token, re-acquire, replay ONCE. The marker lives on
  // the request config, so a second 401 for the same request rejects instead of
  // looping. Token acquisition goes through getTokenClient(), which has no 401
  // handler, so re-entry into this branch is structurally impossible.
  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const config = error.config;
      if (!config || error.response?.status !== 401) return Promise.reject(error);

      const state = config as unknown as Record<string, unknown>;
      if (state.__authRetried) return Promise.reject(error);
      state.__authRetried = true;

      invalidateAccessToken(bearerOf(config.headers));
      try {
        await ensureToken();
      } catch (authErr) {
        return Promise.reject(authErr);
      }
      console.error('[transkribus-mcp] Processing API re-authenticated after 401');
      return client.request(config);
    }
  );

  attachRateLimitRetry(client);

  return client;
}

function getClient(): AxiosInstance {
  if (!clientInstance) {
    clientInstance = createClient();
  }
  return clientInstance;
}

/** JSON request against the Metagrapho API. */
export async function metagraphoRequest<T = unknown>(
  method: Method,
  path: string,
  data?: unknown
): Promise<T> {
  try {
    const response = await getClient().request<T>({ method, url: path, data });
    return response.data;
  } catch (err) {
    throw metagraphoError('Processing API request', err);
  }
}

/** XML request against the Metagrapho API. The PAGE and ALTO endpoints return
 *  `application/xml`, so both the Accept header and axios' response parsing have
 *  to be overridden — the client defaults ask for and expect JSON. */
export async function metagraphoRequestText(path: string): Promise<string> {
  try {
    const response = await getClient().request<string>({
      method: 'GET',
      url: path,
      responseType: 'text',
      headers: { Accept: 'application/xml' },
    });
    return typeof response.data === 'string' ? response.data : String(response.data);
  } catch (err) {
    throw metagraphoError('Processing API request', err);
  }
}

/** Test-only surface for the pure helpers that have no other seam. Exported as
 *  a single namespace so it is obvious at a glance that nothing here is API. */
export const __testing = { retryDelayMs };

/** Test-only: drop every cached token and client so each test starts clean. */
export function resetMetagraphoStateForTests(): void {
  accessToken = null;
  refreshToken = null;
  expiresAt = 0;
  tokenInFlight = null;
  clientInstance = null;
  tokenClientInstance = null;
}
