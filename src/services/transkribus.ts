import axios, { AxiosInstance, AxiosError, Method } from 'axios';
import { TRANSKRIBUS_API_BASE, MAX_RETRIES, REQUEST_TIMEOUT } from '../constants.js';

let sessionId: string | null = null;
let clientInstance: AxiosInstance | null = null;

function getCredentials(): { user: string; password: string } | null {
  const user = process.env.TRANSKRIBUS_USER;
  const password = process.env.TRANSKRIBUS_PASSWORD;
  if (user && password) return { user, password };
  return null;
}

function getSessionFromEnv(): string | null {
  return process.env.TRANSKRIBUS_SESSION_ID || null;
}

async function login(client: AxiosInstance): Promise<string> {
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
    response = await client.post('/auth/login', params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  } catch (err) {
    if (err instanceof AxiosError) sanitizeAxiosError(err); // strip JSESSIONID; password (config.data) → follow-up issue
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

function createClient(): AxiosInstance {
  const client = axios.create({
    baseURL: TRANSKRIBUS_API_BASE,
    timeout: REQUEST_TIMEOUT,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });

  // Attach session cookie
  client.interceptors.request.use((config) => {
    if (sessionId) {
      config.headers['Cookie'] = `JSESSIONID=${sessionId}`;
    }
    return config;
  });

  // Handle 401 (re-login) and 429 (rate limit)
  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const config = error.config;
      if (!config) return Promise.reject(error);

      // Re-login on 401
      if (error.response?.status === 401) {
        const retried = (config as unknown as Record<string, unknown>).__authRetried as boolean;
        if (!retried) {
          (config as unknown as Record<string, unknown>).__authRetried = true;
          try {
            sessionId = await login(client);
            console.error('[transkribus-mcp] Re-authenticated after 401');
            return client.request(config);
          } catch (loginErr) {
            return Promise.reject(sessionExpiredError(loginErr));
          }
        }
      }

      // Rate limit retry with exponential backoff
      if (error.response?.status === 429) {
        const retryCount = ((config as unknown as Record<string, unknown>).__retryCount as number) || 0;
        if (retryCount >= MAX_RETRIES) {
          return Promise.reject(new Error('Rate limit exceeded after maximum retries'));
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

      return Promise.reject(error);
    }
  );

  return client;
}

function getClient(): AxiosInstance {
  if (!clientInstance) {
    clientInstance = createClient();
  }
  return clientInstance;
}

async function ensureSession(): Promise<void> {
  if (sessionId) return;

  const envSession = getSessionFromEnv();
  if (envSession) {
    sessionId = envSession;
    return;
  }

  const client = getClient();
  sessionId = await login(client);
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

// Scrub credential-bearing fields on a request/response config: headers + auth + proxy.auth.
function scrubConfig(config: unknown): void {
  if (!config || typeof config !== 'object') return;
  const c = config as { headers?: unknown; auth?: unknown; proxy?: { auth?: unknown } | null };
  scrubAuth(c.headers);
  delete c.auth;
  if (c.proxy && typeof c.proxy === 'object') delete c.proxy.auth;
}

// Void mutator: strip the JSESSIONID session cookie (request Cookie header,
// response Set-Cookie header, the raw `request._header` block) plus auth headers
// from an AxiosError before it is chained via `{ cause: err }`. Mutating in place
// (vs building a fresh cause) keeps the literal caught binding available for
// `{ cause: err }`, satisfying eslint preserve-caught-error.
export function sanitizeAxiosError(err: AxiosError): void {
  scrubConfig(err.config);
  scrubConfig(err.response?.config); // may be a distinct ref depending on the adapter
  scrubAuth(err.response?.headers); // response Set-Cookie can carry JSESSIONID
  delete (err as { request?: unknown }).request; // carries request._header raw block
  if (err.response) delete (err.response as { request?: unknown }).request;
  const e = err as { cause?: unknown };
  if (e.cause && typeof e.cause === 'object') delete e.cause;
}

/** Build the 401 re-auth failure error, sanitizing the login AxiosError (it carries
 *  the stale JSESSIONID cookie) before chaining it as `cause`. Exported for the
 *  cookie-leak regression test of this plain-Error re-auth path. Defense-in-depth:
 *  login() also sanitizes, so this is idempotent. */
export function sessionExpiredError(loginErr: unknown): Error {
  if (loginErr instanceof AxiosError) sanitizeAxiosError(loginErr);
  return new Error('Session expired and re-authentication failed', { cause: loginErr });
}

/**
 * Convert an AxiosError to a plain Error with a Transkribus-flavored message,
 * preserving the original via `cause`. Non-axios errors are returned unchanged
 * so the caller can rethrow them as-is.
 *
 * Exported for test access. Before chaining, `sanitizeAxiosError` strips the
 * session cookie (`cookie` / `set-cookie` headers) plus `authorization` /
 * `proxy-authorization` headers, `config.auth` / `proxy.auth`, and the raw
 * `request` blocks (`request._header`) in place — so deep-walk logging
 * (`util.inspect(err, { depth: null })`, `AxiosError.toJSON()`, `JSON.stringify`)
 * cannot surface `JSESSIONID`. See contracts.test.ts and
 * `gotcha_axios_cause_walk_cookie_leak.md`.
 */
export function wrapAxiosError(err: unknown): unknown {
  if (!(err instanceof AxiosError)) return err;
  sanitizeAxiosError(err);

  if (err.response) {
    const { status, statusText, data: body } = err.response;
    if (typeof body === 'string' && body.length > 0) {
      return new Error(`Transkribus API error ${status}: ${body}`, { cause: err });
    }
    if (body?.message) {
      return new Error(`Transkribus API error ${status}: ${body.message}`, { cause: err });
    }
    return new Error(`Transkribus API error: ${status} ${statusText}`, { cause: err });
  }

  if (err.code) {
    return new Error(`Network error: ${err.message}`, { cause: err });
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
