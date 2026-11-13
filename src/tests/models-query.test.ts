import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * Query contract of `GET /models/{type}` (issue #95, TrpServer OpenAPI 4.69.0).
 *
 * The list filters are OpenAPI query arrays with the default form/explode
 * style, which the JAX-RS server reads from repeated keys. The assertions are
 * made on the URL that actually reaches a local HTTP server: axios is NOT
 * stubbed, because its serializer is the thing under test — a checked params
 * object would pass while the wire still carried `key[]=…`. Tool calls go
 * through a real MCP client, so input validation runs exactly as in production.
 */

type CapturedRequest = { method: string; url: string };

const rig = vi.hoisted(() => ({
  server: null as import('node:http').Server | null,
  requests: [] as CapturedRequest[],
  modelList: {
    trpModelMetadata: [{ modelId: 51170, name: 'Model', type: 'text', isoLanguages: ['de'], centuries: [17] }],
    total: 1,
  },
}));

vi.mock('@napi-rs/keyring', () => ({
  AsyncEntry: class {
    async getPassword(): Promise<null> { return null; }
  },
}));

vi.mock('../constants.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../constants.js')>();
  const { createServer } = await import('node:http');
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      rig.requests.push({ method: req.method ?? '', url: req.url ?? '' });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(rig.modelList));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  rig.server = server;
  const { port } = server.address() as import('node:net').AddressInfo;
  return { ...actual, TRANSKRIBUS_API_BASE: `http://127.0.0.1:${port}/rest` };
});

const { registerModelTools } = await import('../tools/models.js');

const TOOL = 'transkribus_model_get_by_type';
const STRING_LISTS = ['releaseLevel', 'dataSetReleaseLevel', 'isoLanguages', 'scriptTypes', 'labels'] as const;
const DEFAULT_QUERY_KEYS = ['facetLimit', 'minFacetCount'];

const server = new McpServer({ name: 'models-query-test', version: '0.0.0' });
registerModelTools(server);
const client = new Client({ name: 'models-query-client', version: '0.0.0' });

async function call(args: Record<string, unknown>): Promise<CallToolResult> {
  return (await client.callTool({ name: TOOL, arguments: { type: 'text', ...args } })) as CallToolResult;
}

/** Call the tool, require success, and return the one URL that reached the server. */
async function sent(args: Record<string, unknown>): Promise<URL> {
  const result = await call(args);
  expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
  expect(rig.requests).toHaveLength(1);
  expect(rig.requests[0].method).toBe('GET');
  return new URL(rig.requests[0].url, 'http://localhost');
}

/** Call the tool and require a validation error with no request on the wire. */
async function rejected(args: Record<string, unknown>): Promise<void> {
  const result = await call(args);
  expect(result.isError, `accepted ${JSON.stringify(args)}`).toBe(true);
  expect(rig.requests).toHaveLength(0);
}

function rawKeys(url: URL): string[] {
  return url.search.slice(1).split('&').map((pair) => decodeURIComponent(pair.split('=')[0]));
}

beforeAll(async () => {
  vi.stubEnv('TRANSKRIBUS_SESSION_ID', 'local-models-query-session');
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
});

afterAll(async () => {
  await client.close();
  await server.close();
  rig.server?.close();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  rig.requests.length = 0;
});

describe('tools/list contract for transkribus_model_get_by_type', () => {
  type JsonSchema = { properties: Record<string, Record<string, unknown>>; required?: string[] };

  async function listedSchema(): Promise<JsonSchema> {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === TOOL);
    expect(tool, `${TOOL} is not listed`).toBeDefined();
    return tool!.inputSchema as unknown as JsonSchema;
  }

  function zodInputSchema(): JsonSchema {
    const tools = (server as unknown as { _registeredTools: Record<string, { inputSchema: z.ZodType }> })._registeredTools;
    return z.toJSONSchema(tools[TOOL].inputSchema, { io: 'input' }) as unknown as JsonSchema;
  }

  it.each([
    ['tools/list', listedSchema],
    ['z.toJSONSchema io:input', async () => zodInputSchema()],
  ])('%s: list filters are arrays and type stays required', async (_label, load) => {
    const schema = await load();
    for (const field of STRING_LISTS) {
      expect(schema.properties[field], field).toMatchObject({ type: 'array', items: { type: 'string' } });
    }
    expect(schema.properties.centuries).toMatchObject({ type: 'array', items: { type: 'integer' } });
    for (const field of ['datasetId', 'datasetVersionId', 'minNrOfTrainGtPages', 'minNrOfValidationGtPages']) {
      expect(schema.properties[field], field).toMatchObject({ type: 'integer' });
    }
    expect(schema.properties.facetLimit).toMatchObject({ type: 'integer', minimum: 10, maximum: 500, default: 10 });
    expect(schema.properties.minFacetCount).toMatchObject({ type: 'integer', minimum: 1, maximum: 10, default: 2 });
    expect(schema.properties.type).toMatchObject({ type: 'string' });
    expect(schema.properties.type).not.toHaveProperty('enum');
    expect(schema.properties.type.description).toContain('smartextract');
    expect(schema.required).toEqual(['type']);
  });
});

describe('GET /models/{type} — query serialization on the wire', () => {
  it('sends each array filter as repeated keys, never bracketed, and keeps values intact', async () => {
    const url = await sent({
      releaseLevel: ['public', 'undisclosed'],
      dataSetReleaseLevel: ['public', 'private'],
      isoLanguages: ['de', 'en', 'la'],
      scriptTypes: ['Kurrent', 'Fraktur'],
      labels: ['a,b', 'with space', 'Grün&Blau'],
    });

    expect(url.search).not.toMatch(/\[|\]|%5B|%5D/i);
    expect(url.searchParams.getAll('releaseLevel')).toEqual(['public', 'undisclosed']);
    expect(url.searchParams.getAll('dataSetReleaseLevel')).toEqual(['public', 'private']);
    expect(url.searchParams.getAll('isoLanguages')).toEqual(['de', 'en', 'la']);
    expect(url.searchParams.getAll('scriptTypes')).toEqual(['Kurrent', 'Fraktur']);
    // A comma, a space and an ampersand stay inside their element: no splitting, no key injection.
    expect(url.searchParams.getAll('labels')).toEqual(['a,b', 'with space', 'Grün&Blau']);
    expect(rawKeys(url).filter((k) => k === 'labels')).toHaveLength(3);
    expect(url.searchParams.has('Blau')).toBe(false);
  });

  it('sends centuries as repeated integer values', async () => {
    const url = await sent({ centuries: [17, '18', 19] });
    expect(url.searchParams.getAll('centuries')).toEqual(['17', '18', '19']);
  });

  it('forwards the dataset and minimum ground-truth page filters', async () => {
    const url = await sent({
      datasetId: 5,
      datasetVersionId: '7',
      minNrOfTrainGtPages: 100,
      minNrOfValidationGtPages: 0,
    });
    expect(url.searchParams.getAll('datasetId')).toEqual(['5']);
    expect(url.searchParams.getAll('datasetVersionId')).toEqual(['7']);
    expect(url.searchParams.getAll('minNrOfTrainGtPages')).toEqual(['100']);
    expect(url.searchParams.getAll('minNrOfValidationGtPages')).toEqual(['0']);
  });

  it('keeps pagination and sorting alongside the filters', async () => {
    const url = await sent({ isoLanguages: ['de'], index: 20, nValues: 10, sortColumn: 'name', sortDirection: 'desc' });
    expect(url.searchParams.get('index')).toBe('20');
    expect(url.searchParams.get('nValues')).toBe('10');
    expect(url.searchParams.get('sortColumn')).toBe('name');
    expect(url.searchParams.get('sortDirection')).toBe('desc');
    expect(url.searchParams.getAll('isoLanguages')).toEqual(['de']);
  });

  it('sends only the facet defaults when no filter is given, on the encoded type path', async () => {
    const url = await sent({ type: 'smartextract' });
    expect(url.pathname).toBe('/rest/models/smartextract');
    expect(rawKeys(url).sort()).toEqual(DEFAULT_QUERY_KEYS);
    expect(url.searchParams.get('facetLimit')).toBe('10');
    expect(url.searchParams.get('minFacetCount')).toBe('2');
  });

  it('drops an empty array instead of sending an empty key', async () => {
    const url = await sent({ isoLanguages: [] });
    expect(rawKeys(url).sort()).toEqual(DEFAULT_QUERY_KEYS);
  });

  it('returns the model list response unchanged', async () => {
    const result = await call({ isoLanguages: ['de'] });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(rig.modelList);
  });
});

describe('GET /models/{type} — scalar backward compatibility', () => {
  it.each([
    ['releaseLevel', 1, ['1']],
    ['releaseLevel', '2', ['2']],
    ['releaseLevel', 'public', ['public']],
    ['dataSetReleaseLevel', 'public', ['public']],
    ['isoLanguages', 'de', ['de']],
    ['scriptTypes', 'Kurrent', ['Kurrent']],
    ['labels', 'a,b', ['a,b']],
    ['centuries', 17, ['17']],
    ['centuries', '18', ['18']],
  ])('%s: %j is sent as a one-element list', async (field, value, expected) => {
    const url = await sent({ [field]: value });
    expect(url.searchParams.getAll(field)).toEqual(expected);
  });
});

describe('GET /models/{type} — rejected inputs never reach the server', () => {
  it.each([
    ['isoLanguages', [1]],
    ['isoLanguages', [null]],
    ['scriptTypes', [{ name: 'Latin' }]],
    ['labels', true],
    ['dataSetReleaseLevel', [false]],
    ['releaseLevel', 1.5],
    ['releaseLevel', [true]],
    ['centuries', ['seventeenth']],
    ['centuries', [17.5]],
    ['centuries', 'seventeenth'],
    ['centuries', '17,18'],
    ['datasetId', 'abc'],
    ['datasetId', 0],
    ['datasetVersionId', -1],
    ['minNrOfTrainGtPages', -1],
    ['minNrOfValidationGtPages', 1.5],
  ])('%s: %j', async (field, value) => {
    await rejected({ [field]: value });
  });

  it.each([
    ['facetLimit', 9],
    ['facetLimit', 501],
    ['facetLimit', '1000'],
    ['minFacetCount', 0],
    ['minFacetCount', 11],
  ])('%s outside its documented bounds: %j', async (field, value) => {
    await rejected({ [field]: value });
  });

  it('rejects a traversal type before any request is built', async () => {
    await rejected({ type: '..' });
  });
});

describe('GET /models/{type} — facet bounds accept their edges', () => {
  it.each([
    [{ facetLimit: 10, minFacetCount: 1 }, '10', '1'],
    [{ facetLimit: '500', minFacetCount: '10' }, '500', '10'],
  ])('%j', async (args, facetLimit, minFacetCount) => {
    const url = await sent(args);
    expect(url.searchParams.get('facetLimit')).toBe(facetLimit);
    expect(url.searchParams.get('minFacetCount')).toBe(minFacetCount);
  });
});
