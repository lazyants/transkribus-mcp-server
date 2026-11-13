import { describe, it, expect, afterAll, beforeAll, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Wire-format guard for issue #94: both export endpoints take `pages` as a query
 * parameter and an `ExportParameters` JSON body (TrpServer OpenAPI 4.69.0). The
 * assertions read what actually reaches a real HTTP server — axios is not
 * stubbed — so a flag that leaks into the query string or a body that is not
 * serialized shows up here. Same rig as ingestion.test.ts: the server must exist
 * before `constants.js` loads, so it is created inside the mock factory.
 */

type Captured = { method: string; url: string; contentType: string | undefined; body: string };

const rig = vi.hoisted(() => ({
  port: 0,
  server: null as import('node:http').Server | null,
  requests: [] as Captured[],
}));

vi.mock('../constants.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../constants.js')>();
  const http = await import('node:http');

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      rig.requests.push({
        method: req.method ?? '',
        url: req.url ?? '',
        contentType: req.headers['content-type'],
        body: Buffer.concat(chunks).toString('utf8'),
      });
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('4242');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));

  rig.server = server;
  rig.port = (server.address() as import('node:net').AddressInfo).port;

  return { ...actual, TRANSKRIBUS_API_BASE: `http://127.0.0.1:${rig.port}/rest` };
});

const { registerCollectionDocumentTools } = await import('../tools/collections-documents.js');
const { registerCollectionCoreTools } = await import('../tools/collections-core.js');
const { DEFAULT_COMMON_EXPORT_PARS } = await import('../schemas/export.js');

type ToolHandler = (args: Record<string, unknown>) => Promise<{ isError?: boolean; content: unknown }>;
type RegisteredTools = Record<string, { inputSchema: z.ZodTypeAny; handler: ToolHandler }>;

function toolsOf(register: (s: McpServer) => void): RegisteredTools {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  register(server);
  return (server as unknown as { _registeredTools: RegisteredTools })._registeredTools;
}

const tools: RegisteredTools = {
  ...toolsOf(registerCollectionDocumentTools),
  ...toolsOf(registerCollectionCoreTools),
};

/** Validate the arguments the way the MCP server does, then run the handler.
 *  Fails loudly on an error result, which handleToolRequest would otherwise
 *  swallow into `{ isError: true }`. */
async function call(name: string, args: Record<string, unknown>): Promise<Captured> {
  const tool = tools[name];
  expect(tool, `tool ${name} is not registered`).toBeDefined();
  const result = await tool.handler(tool.inputSchema.parse(args) as Record<string, unknown>);
  expect(result.isError, `tool ${name} returned an error: ${JSON.stringify(result.content)}`).toBeFalsy();
  const req = rig.requests.at(-1);
  expect(req, 'no request reached the test server').toBeDefined();
  return req as Captured;
}

function queryOf(req: Captured): URLSearchParams {
  return new URL(req.url, 'http://x').searchParams;
}

function bodyOf(req: Captured): Record<string, unknown> {
  return JSON.parse(req.body) as Record<string, unknown>;
}

beforeAll(() => {
  process.env.TRANSKRIBUS_SESSION_ID = 'test-session-id';
});

afterAll(() => {
  rig.server?.close();
  delete process.env.TRANSKRIBUS_SESSION_ID;
});

beforeEach(() => {
  rig.requests.length = 0;
});

describe.each([
  { name: 'transkribus_doc_export', ids: { collId: 3, id: 7 }, path: '/rest/collections/3/7/export' },
  { name: 'transkribus_coll_export', ids: { collId: 3 }, path: '/rest/collections/3/export' },
])('$name — ExportParameters body, pages in the query', ({ name, ids, path }) => {
  it('sends only the defaults as a JSON body, and no query, when no option is given', async () => {
    const req = await call(name, ids);
    expect(req.method).toBe('POST');
    expect(req.url).toBe(path);
    expect(req.contentType).toMatch(/^application\/json/);
    expect(bodyOf(req)).toEqual({ commonPars: DEFAULT_COMMON_EXPORT_PARS });
  });

  it('sends the page range in the query and nowhere in the body', async () => {
    const req = await call(name, { ...ids, pages: '1-3,5' });
    expect(req.url.split('?')[0]).toBe(path);
    expect([...queryOf(req).entries()]).toEqual([['pages', '1-3,5']]);
    expect(req.body).not.toContain('1-3,5');
  });

  it('routes a PDF export into commonPars plus pdfPars, with no flag in the query', async () => {
    const req = await call(name, {
      ...ids,
      commonPars: { doWritePdf: true, doWriteImages: false },
      pdfPars: { doPdfImagesPlusText: true, pdfImgQuality: 'view', compressionLevel: '3' },
    });
    expect(req.url).toBe(path);
    expect(bodyOf(req)).toEqual({
      commonPars: { ...DEFAULT_COMMON_EXPORT_PARS, doWritePdf: true, doWriteImages: false },
      pdfPars: { doPdfImagesPlusText: true, pdfImgQuality: 'view', compressionLevel: 3 },
    });
  });

  it('routes a DOCX export into commonPars plus docxPars', async () => {
    const req = await call(name, {
      ...ids,
      commonPars: { doWriteDocx: true },
      docxPars: { doDocxExpandAbbrevs: true, doDocxMarkUnclear: false },
    });
    expect(bodyOf(req)).toEqual({
      commonPars: { ...DEFAULT_COMMON_EXPORT_PARS, doWriteDocx: true },
      docxPars: { doDocxExpandAbbrevs: true, doDocxMarkUnclear: false },
    });
  });

  it('routes TEI and ALTO options into teiPars and altoPars with their 4.69.0 names', async () => {
    const req = await call(name, {
      ...ids,
      commonPars: { doWriteTei: true },
      teiPars: { regionZones: true, lineZones: true, wordZones: false, useXslTransformation: true },
      altoPars: { altoVersion: '4.4', exportTextStyleTags: true },
    });
    expect(bodyOf(req)).toEqual({
      commonPars: { ...DEFAULT_COMMON_EXPORT_PARS, doWriteTei: true },
      teiPars: { regionZones: true, lineZones: true, wordZones: false, useXslTransformation: true },
      altoPars: { altoVersion: '4.4', exportTextStyleTags: true },
    });
  });

  it('lets an explicit false override every default', async () => {
    const off = Object.fromEntries(
      Object.entries(DEFAULT_COMMON_EXPORT_PARS).map(([k, v]) => [k, typeof v === 'boolean' ? false : v]),
    );
    const req = await call(name, { ...ids, commonPars: off });
    expect(bodyOf(req).commonPars).toEqual(off);
  });

  it('does not forward the retired flat format/flag arguments anywhere', async () => {
    const req = await call(name, { ...ids, format: 'pdf', doWritePdf: true, doTeiWithZones: true });
    expect(req.url).toBe(path);
    expect(req.body).not.toMatch(/format|doTeiWithZones/);
    expect(bodyOf(req)).toEqual({ commonPars: DEFAULT_COMMON_EXPORT_PARS });
  });

  it('rejects values outside the documented enums', () => {
    const schema = tools[name].inputSchema;
    expect(schema.safeParse({ ...ids, altoPars: { altoVersion: '3.0' } }).success).toBe(false);
    expect(schema.safeParse({ ...ids, pdfPars: { pdfImgQuality: 'huge' } }).success).toBe(false);
    expect(schema.safeParse({ ...ids, commonPars: { hideUser: 'nobody' } }).success).toBe(false);
  });

  it('advertises the option sections in tools/list and keeps the IDs required', () => {
    const json = z.toJSONSchema(tools[name].inputSchema, { io: 'input' }) as {
      required?: string[];
      properties: Record<string, { properties?: Record<string, unknown> }>;
    };
    expect(json.required?.sort()).toEqual(Object.keys(ids).sort());
    for (const section of ['commonPars', 'altoPars', 'pdfPars', 'teiPars', 'docxPars']) {
      expect(json.properties[section]?.properties, section).toBeDefined();
    }
    expect(json.properties.commonPars.properties).toHaveProperty('doWritePdf');
    expect(json.properties).not.toHaveProperty('format');
  });
});

describe('transkribus_coll_export — document selection', () => {
  it('sends docs as { doc: [...] } with pages wrapped in pageList', async () => {
    const req = await call('transkribus_coll_export', {
      collId: 3,
      docs: [{ docId: 7 }, { docId: '8', pageIds: [101, '102'] }],
    });
    expect(bodyOf(req).docs).toEqual({
      doc: [{ docId: 7 }, { docId: 8, pageList: { pages: [{ pageId: 101 }, { pageId: 102 }] } }],
    });
  });
});
