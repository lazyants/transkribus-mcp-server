import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError } from 'axios';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

// Retain the real Axios interceptor/serialization pipeline; replace only I/O.
type WireConfig = Record<string, unknown>;
type Adapter = (config: WireConfig) => Promise<Record<string, unknown>>;
const { getAdapter, setAdapter } = vi.hoisted(() => {
  let current: Adapter;
  return { getAdapter: () => current, setAdapter: (adapter: Adapter) => { current = adapter; } };
});
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return {
    ...actual,
    default: {
      ...actual.default,
      create: (config: WireConfig = {}) => actual.default.create({
        ...config,
        adapter: ((cfg: WireConfig) => getAdapter()(cfg)) as never,
      }),
    },
  };
});

const UUID = '01927669-f207-7550-ba9f-05a14a5cb899';
const V1 = 'https://transkribus.eu/processing/v1';
const V2 = 'https://api-staging.transkribus.org/v2';
const TOKEN_URL = 'https://account.readcoop.eu/auth/realms/readcoop/protocol/openid-connect/token';
const ZIP = Buffer.from('504b0506000000000000000000000000000000000000', 'hex');
let seen: WireConfig[];
const clients: Client[] = [];
const servers: McpServer[] = [];

function ok(config: WireConfig, data: unknown, contentType = 'application/json') {
  return { config, data, status: 200, statusText: 'OK', headers: { 'content-type': contentType } };
}

function fail(config: WireConfig, status: number, data: unknown = {}) {
  return Promise.reject(new AxiosError('upstream secret detail', 'ERR_BAD_REQUEST', config as never,
    undefined, { config, status, statusText: 'secret', data, headers: {} } as never));
}

function adapter(fn: Adapter) {
  setAdapter(async (config) => { seen.push(config); return fn(config); });
}

function headers(config: WireConfig): Record<string, unknown> {
  return config.headers as Record<string, unknown>;
}

async function service() {
  return import('../services/metagrapho.js');
}

async function connect(): Promise<Client> {
  const { registerProcessingTools } = await import('../tools/processing.js');
  const server = new McpServer({ name: 'processing-contract', version: '0.0.0' });
  registerProcessingTools(server);
  const client = new Client({ name: 'processing-contract-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  clients.push(client);
  servers.push(server);
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('TRANSKRIBUS_PROCESSING_BACKEND', 'v2');
  vi.stubEnv('TRANSKRIBUS_ACCESS_TOKEN', 'test-bearer');
  vi.stubEnv('TRANSKRIBUS_USER', 'test@example.invalid');
  vi.stubEnv('TRANSKRIBUS_PASSWORD', 'test-password');
  vi.stubEnv('TRANSKRIBUS_PROCESSING_CLIENT_ID', undefined);
  seen = [];
  adapter(async (config) => ok(config, { processId: 123, status: 'RUNNING' }));
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(servers.splice(0).map((server) => server.close()));
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('Processing backend selection and MCP discovery', () => {
  it('defaults to v1 and preserves its four tools and numeric-ID contract', async () => {
    vi.stubEnv('TRANSKRIBUS_PROCESSING_BACKEND', undefined);
    expect((await service()).getProcessingBackend()).toBe('v1');
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(4);
    expect(tools.map((tool) => tool.name)).not.toContain('transkribus_processing_longpoll');
    expect(tools.map((tool) => tool.name)).not.toContain('transkribus_processing_get_result_zip');
    expect(tools.find((tool) => tool.name.endsWith('get_status'))?.description).toContain('two days');
    const rejected = await client.callTool({ name: 'transkribus_processing_get_status', arguments: { processId: UUID } });
    expect(rejected.isError).toBe(true);
    expect(seen).toHaveLength(0);
  });

  it.each(['', 'v3', 'V2', 'https://example.invalid'])('rejects invalid selection %j without network I/O', async (backend) => {
    vi.stubEnv('TRANSKRIBUS_PROCESSING_BACKEND', backend);
    const { registerProcessingTools } = await import('../tools/processing.js');
    expect(() => registerProcessingTools(new McpServer({ name: 'test', version: '0.0.0' })))
      .toThrow('TRANSKRIBUS_PROCESSING_BACKEND must be v1 or v2');
    expect(seen).toHaveLength(0);
  });

  it('publishes six v2 tools, required IDs, UUIDs and optional interval', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(6);
    for (const tool of tools.filter((tool) => !tool.name.endsWith('submit_image'))) {
      expect(tool.inputSchema.required, tool.name).toContain('processId');
      type Branch = { type?: string; format?: string; pattern?: string; anyOf?: Branch[] };
      const alternatives = (branch: Branch): Branch[] => branch.anyOf
        ? branch.anyOf.flatMap(alternatives)
        : [branch];
      const branches = alternatives(tool.inputSchema.properties?.processId as Branch);
      expect(branches, tool.name).toHaveLength(3);
      expect(branches, tool.name).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'integer' }),
        expect.objectContaining({ type: 'string', pattern: '^-?\\d+$' }),
        expect.objectContaining({ type: 'string', format: 'uuid' }),
      ]));
      expect(branches.every((branch) => branch.type !== undefined), tool.name).toBe(true);
    }
    const poll = tools.find((tool) => tool.name === 'transkribus_processing_longpoll')!;
    expect(poll.inputSchema.required).not.toContain('interval');
    expect(poll.inputSchema.properties?.interval).toMatchObject({ description: expect.stringContaining('milliseconds') });
    const status = tools.find((tool) => tool.name.endsWith('get_status'))!;
    expect(status.description).toContain('CANCELLED');
    expect(status.description).toContain('24 hours');
    expect(status.description).not.toContain('two days');
  });

  it.each([123, '123', UUID])('accepts documented v2 identifier %j through MCP', async (processId) => {
    const client = await connect();
    const result = await client.callTool({ name: 'transkribus_processing_get_status', arguments: { processId } });
    expect(result.isError).not.toBe(true);
    expect(`${seen[0].baseURL}${seen[0].url}`).toBe(`${V2}/processes/${processId}`);
  });

  it.each([0, -1, 1.5, true, '', '../processes', 'not-a-uuid', '9007199254740993'])(
    'rejects unsafe or malformed ID %j before I/O', async (processId) => {
      const client = await connect();
      const result = await client.callTool({ name: 'transkribus_processing_get_status', arguments: { processId } });
      expect(result.isError).toBe(true);
      expect(seen).toHaveLength(0);
    });

  it.each([1.5, -2147483649, 2147483648, 'bad'])('rejects invalid longpoll interval %j before I/O', async (interval) => {
    const client = await connect();
    const result = await client.callTool({ name: 'transkribus_processing_longpoll', arguments: { processId: UUID, interval } });
    expect(result.isError).toBe(true);
    expect(seen).toHaveLength(0);
  });

  it.each([0, -1, -2147483648, 2147483647])('accepts published int32 longpoll interval %j', async (interval) => {
    const client = await connect();
    const result = await client.callTool({ name: 'transkribus_processing_longpoll', arguments: { processId: UUID, interval } });
    expect(result.isError).not.toBe(true);
    expect(seen[0].params).toEqual({ interval });
  });
});

describe.each([['v1', V1], ['v2', V2]])('%s preserved wire contracts', (backend, baseURL) => {
  beforeEach(() => vi.stubEnv('TRANSKRIBUS_PROCESSING_BACKEND', backend));

  it('submits the compatible single-image JSON body using OIDC, without legacy cookies', async () => {
    vi.stubEnv('TRANSKRIBUS_ACCESS_TOKEN', undefined);
    adapter(async (config) => config.url === TOKEN_URL
      ? ok(config, { access_token: 'fresh-access', refresh_token: 'fresh-refresh', expires_in: 300 })
      : ok(config, { processId: 123, status: 'CREATED' }));
    const client = await connect();
    const body = { config: { textRecognition: { htrId: 38230 } }, image: { base64: 'AAAA' } };
    const result = await client.callTool({ name: 'transkribus_processing_submit_image', arguments: body });
    expect(result.isError).not.toBe(true);
    const grant = new URLSearchParams(String(seen[0].data));
    expect(seen[0].url).toBe(TOKEN_URL);
    expect(grant.get('grant_type')).toBe('password');
    expect(grant.get('client_id')).toBe('processing-api-client');
    expect(grant.get('username')).toBe('test@example.invalid');
    expect(grant.get('password')).toBe('test-password');
    expect(`${seen[1].baseURL}${seen[1].url}`).toBe(`${baseURL}/processes`);
    expect(seen[1].method).toBe('post');
    expect(JSON.parse(String(seen[1].data))).toEqual(body);
    expect(headers(seen[1]).Authorization).toBe('Bearer fresh-access');
    expect(headers(seen[1]).Cookie).toBeUndefined();
  });

  it.each(['page', 'alto'])('returns raw %s XML with the existing MIME contract', async (format) => {
    adapter(async (config) => ok(config, `<?xml version="1.0"?><${format}/>`, 'application/xml'));
    const client = await connect();
    const processId = backend === 'v2' ? UUID : '123';
    const result = await client.callTool({ name: `transkribus_processing_get_${format}_xml`, arguments: { processId } });
    expect(result.content).toEqual([{ type: 'text', text: `<?xml version="1.0"?><${format}/>` }]);
    expect(result.structuredContent).toBeUndefined();
    expect(`${seen[0].baseURL}${seen[0].url}`).toBe(`${baseURL}/processes/${processId}/${format}`);
    expect(seen[0].responseType).toBe('text');
    expect(headers(seen[0]).Accept).toBe('application/xml');
    expect(headers(seen[0]).Authorization).toBe('Bearer test-bearer');
  });

  it('refreshes a rejected access token using the same OIDC refresh grant', async () => {
    vi.stubEnv('TRANSKRIBUS_ACCESS_TOKEN', undefined);
    let grants = 0;
    let calls = 0;
    adapter(async (config) => {
      if (config.url === TOKEN_URL) {
        grants += 1;
        return ok(config, { access_token: `access-${grants}`, refresh_token: 'held-refresh', expires_in: 300 });
      }
      calls += 1;
      return calls === 1 ? fail(config, 401) : ok(config, { processId: 123, status: 'FINISHED' });
    });
    await (await service()).metagraphoRequest('GET', '/processes/123');
    const tokenCalls = seen.filter((config) => config.url === TOKEN_URL);
    expect(tokenCalls).toHaveLength(2);
    const refresh = new URLSearchParams(String(tokenCalls[1].data));
    expect(refresh.get('grant_type')).toBe('refresh_token');
    expect(refresh.get('refresh_token')).toBe('held-refresh');
    const requests = seen.filter((config) => config.url !== TOKEN_URL);
    expect(requests.map((config) => headers(config).Authorization)).toEqual(['Bearer access-1', 'Bearer access-2']);
    expect(requests.every((config) => config.baseURL === baseURL)).toBe(true);
  });

  it('does not turn an ordinary HTTP408 into a longpoll timeout result', async () => {
    adapter((config) => fail(config, 408, { message: 'test-bearer secret' }));
    const client = await connect();
    const result = await client.callTool({ name: 'transkribus_processing_get_status', arguments: { processId: 123 } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('HTTP 408');
    expect(JSON.stringify(result)).not.toContain('test-bearer');
    expect(result.structuredContent).toBeUndefined();
  });
});

describe('v2 lifecycle and stable link relations', () => {
  it.each(['CREATED', 'WAITING', 'RUNNING', 'FINISHED', 'FAILED', 'CANCELLED'])(
    'reports the %s state independently of an HTTP200 longpoll response', async (status) => {
      const links = [
        { rel: 'self', href: `${V2}/processes/${UUID}`, title: 'Changed title' },
        { rel: 'longpoll', href: 'https://untrusted.invalid/ignored', title: 'Result' },
        { rel: 'result', href: `${V2}/processes/${UUID}/result`, title: 'Status Longpoll' },
      ];
      adapter(async (config) => ok(config, { processId: 123, status, links, content: { text: 'recognized' } }));
      const client = await connect();
      const result = await client.callTool({ name: 'transkribus_processing_longpoll', arguments: { processId: UUID, interval: '500' } });
      const terminal = ['FINISHED', 'FAILED', 'CANCELLED'].includes(status);
      expect(result.structuredContent).toMatchObject({
        processId: 123, status, terminal, pollingAvailable: !terminal, timedOut: false,
        content: { text: 'recognized' }, links,
        linksByRel: { self: links[0], longpoll: links[1], result: links[2] },
      });
      expect(seen).toHaveLength(1);
      expect(`${seen[0].baseURL}${seen[0].url}`).toBe(`${V2}/processes/longpoll/${UUID}`);
      expect(seen[0].params).toEqual({ interval: 500 });
    });

  it('uses absence of rel=longpoll to stop polling without inventing a terminal status', async () => {
    const { describeProcessingJob } = await service();
    expect(describeProcessingJob({ processId: UUID, status: 'RUNNING', links: [
      { rel: 'self', href: 'https://example.invalid', title: 'Status Longpoll' },
    ] })).toMatchObject({ terminal: false, pollingAvailable: false });
  });

  it('indexes unusual rel names without mutating object prototypes', async () => {
    const { describeProcessingJob } = await service();
    const link = { rel: '__proto__', href: 'https://example.invalid', title: 'ignored' };
    const result = describeProcessingJob({ processId: UUID, status: 'RUNNING', links: [link] });
    const index = result.linksByRel as Record<string, unknown>;
    expect(Object.getPrototypeOf(index)).toBe(Object.prototype);
    expect(Object.hasOwn(index, '__proto__')).toBe(true);
    expect(index.__proto__).toEqual(link);
  });

  it('preserves the exact v1 response shape', async () => {
    vi.stubEnv('TRANSKRIBUS_PROCESSING_BACKEND', 'v1');
    const upstream = { processId: 123, status: 'FINISHED', config: {}, content: { text: 'old result' } };
    adapter(async (config) => ok(config, upstream));
    const client = await connect();
    expect((await client.callTool({ name: 'transkribus_processing_get_status', arguments: { processId: '123' } })).structuredContent)
      .toEqual(upstream);
  });
});

describe('v2 longpoll timeouts', () => {
  it('omits interval when absent and reports HTTP408 as a successful timeout with unknown state', async () => {
    adapter((config) => fail(config, 408, { message: 'test-bearer secret', status: 'FINISHED' }));
    const client = await connect();
    const result = await client.callTool({ name: 'transkribus_processing_longpoll', arguments: { processId: UUID } });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({ processId: UUID, timedOut: true, terminal: null });
    expect(seen[0].params).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(result)).not.toContain('FINISHED');
  });

  it.each(['ECONNABORTED', 'ETIMEDOUT'])('reports Axios timeout %s with unknown state', async (code) => {
    adapter((config) => Promise.reject(new AxiosError('secret', code, config as never)));
    expect(await (await service()).metagraphoLongpoll(123)).toEqual({ processId: 123, timedOut: true, terminal: null });
  });

  it('keeps HTTP404 and transport failures as errors', async () => {
    const { metagraphoLongpoll } = await service();
    adapter((config) => fail(config, 404, { message: 'test-bearer' }));
    await expect(metagraphoLongpoll(UUID)).rejects.toThrow('HTTP 404');
    adapter((config) => Promise.reject(new AxiosError('test-bearer', 'ENOTFOUND', config as never)));
    await expect(metagraphoLongpoll(UUID)).rejects.toThrow('no response from the server');
  });

  it('enforces the 45-second wall deadline even while token acquisition is stalled', async () => {
    vi.useFakeTimers();
    vi.stubEnv('TRANSKRIBUS_ACCESS_TOKEN', undefined);
    let finishGrant: (() => void) | undefined;
    adapter((config) => new Promise((resolve) => {
      finishGrant = () => resolve(ok(config, { access_token: 'late-access', expires_in: 300 }));
    }));
    const poll = (await service()).metagraphoLongpoll(UUID);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(await poll).toEqual({ processId: UUID, timedOut: true, terminal: null });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe(TOKEN_URL);
    finishGrant!();
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toHaveLength(1); // Aborted before the pending request can reach I/O.
  });

  it('guards v2-only operations when called directly on v1', async () => {
    vi.stubEnv('TRANSKRIBUS_PROCESSING_BACKEND', 'v1');
    const { metagraphoLongpoll, metagraphoResultZip } = await service();
    await expect(metagraphoLongpoll(123)).rejects.toThrow('requires TRANSKRIBUS_PROCESSING_BACKEND=v2');
    await expect(metagraphoResultZip(123)).rejects.toThrow('requires TRANSKRIBUS_PROCESSING_BACKEND=v2');
    expect(seen).toHaveLength(0);
  });
});

describe('v2 ZIP result downloads', () => {
  it.each([123, UUID])('downloads identifier %j as a usable bounded base64 MCP result', async (processId) => {
    adapter(async (config) => ok(config, ZIP, 'Application/ZIP; charset=binary'));
    const client = await connect();
    const result = await client.callTool({ name: 'transkribus_processing_get_result_zip', arguments: { processId } });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      filename: `processing-${processId}.zip`, mimeType: 'application/zip',
      encoding: 'base64', byteLength: ZIP.length, data: ZIP.toString('base64'),
    });
    const download = result.structuredContent as Record<string, unknown>;
    expect(Buffer.from(String(download.data), 'base64')).toEqual(ZIP);
    expect(`${seen[0].baseURL}${seen[0].url}`).toBe(`${V2}/processes/${processId}/result`);
    expect(seen[0]).toMatchObject({ responseType: 'arraybuffer', maxContentLength: 20 * 1024 * 1024, maxRedirects: 0 });
    expect(headers(seen[0]).Accept).toBe('application/zip');
    expect(headers(seen[0]).Authorization).toBe('Bearer test-bearer');
  });

  it('accepts an ArrayBuffer from an adapter without corrupting bytes', async () => {
    adapter(async (config) => ok(config, Uint8Array.from(ZIP).buffer, 'application/zip'));
    expect((await (await service()).metagraphoResultZip(UUID)).data).toBe(ZIP.toString('base64'));
  });

  it('rejects content that is not a ZIP without surfacing its body', async () => {
    const { metagraphoResultZip } = await service();
    for (const [body, mimeType, message] of [
      [Buffer.from('test-bearer'), 'application/json', 'not application/zip'],
      ['test-bearer', 'application/zip', 'not binary ZIP data'],
      [Buffer.from('test-bearer'), 'application/zip', 'no ZIP signature'],
    ] as const) {
      adapter(async (config) => ok(config, body, mimeType));
      await expect(metagraphoResultZip(UUID)).rejects.toThrow(message);
    }
  });

  it('rejects oversized archives even when an adapter bypasses Axios maxContentLength', async () => {
    const body = Buffer.alloc(20 * 1024 * 1024 + 1);
    ZIP.copy(body);
    adapter(async (config) => ok(config, body, 'application/zip'));
    await expect((await service()).metagraphoResultZip(UUID)).rejects.toThrow('20 MiB download limit');
  });

  it.each([302, 404, 408, 500])('reports ZIP HTTP%s as an error with upstream secrets discarded', async (status) => {
    adapter((config) => fail(config, status, Buffer.from('test-bearer echoed secret')));
    const client = await connect();
    const result = await client.callTool({ name: 'transkribus_processing_get_result_zip', arguments: { processId: UUID } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain(`HTTP ${status}`);
    expect(JSON.stringify(result)).not.toContain('test-bearer');
    expect(result.structuredContent).toBeUndefined();
  });
});
