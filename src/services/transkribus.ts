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

  const response = await client.post('/auth/login', params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

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
            return Promise.reject(new Error('Session expired and re-authentication failed', { cause: loginErr }));
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

/**
 * Convert an AxiosError to a plain Error with a Transkribus-flavored message,
 * preserving the original via `cause`. Non-axios errors are returned unchanged
 * so the caller can rethrow them as-is.
 */
function wrapAxiosError(err: unknown): unknown {
  if (!(err instanceof AxiosError)) return err;

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
