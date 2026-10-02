import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';

type CapturedRequest = {
  method: string;
  url: string;
  contentType: string | undefined;
  accept: string | undefined;
  body: Buffer;
};

// Keep axios's real Node adapter: checking a stubbed request config misses
// axios's fallback Content-Type and multipart boundary generation on the wire.
const rig = vi.hoisted(() => ({
  server: null as import('node:http').Server | null,
  requests: [] as CapturedRequest[],
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
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      rig.requests.push({
        method: req.method ?? '',
        url: req.url ?? '',
        contentType: req.headers['content-type'],
        accept: req.headers.accept,
        body: Buffer.concat(chunks),
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"jobId":42}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  rig.server = server;
  const { port } = server.address() as import('node:net').AddressInfo;
  return { ...actual, TRANSKRIBUS_API_BASE: `http://127.0.0.1:${port}/rest` };
});

const { transkribusRequest, transkribusUpload } = await import('../services/transkribus.js');
const { registerRecognitionTools } = await import('../tools/recognition.js');
const { registerPylaiaTools } = await import('../tools/pylaia.js');

type RegisteredTool = {
  inputSchema: z.ZodType;
  handler: (args: unknown) => Promise<CallToolResult>;
};

const server = new McpServer({ name: 'legacy-wire-test', version: '0.0.0' });
registerRecognitionTools(server);
registerPylaiaTools(server);
const tools = (server as unknown as { _registeredTools: Record<string, RegisteredTool> })._registeredTools;

async function call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const tool = tools[name];
  return tool.handler(tool.inputSchema.parse(args));
}

async function callSuccessfully(name: string, args: Record<string, unknown>): Promise<void> {
  const result = await call(name, args);
  expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
}

function lastRequest(): CapturedRequest {
  expect(rig.requests).toHaveLength(1);
  return rig.requests[0];
}

function requestUrl(request: CapturedRequest): URL {
  return new URL(request.url, 'http://localhost');
}

beforeAll(() => {
  vi.stubEnv('TRANSKRIBUS_SESSION_ID', 'local-wire-test-session');
});

beforeEach(() => {
  rig.requests.length = 0;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await new Promise<void>((resolve, reject) => {
    rig.server!.close((error) => error ? reject(error) : resolve());
  });
});

describe('legacy requests on the wire', () => {
  it.each(['POST', 'PUT', 'PATCH', 'GET', 'DELETE'] as const)(
    'omits Content-Type for a bodiless %s, including axios fallbacks (#71)',
    async (method) => {
      await transkribusRequest(method, '/query-only', undefined, { id: 456, optional: undefined });
      const request = lastRequest();
      expect(request.method).toBe(method);
      expect(request.contentType).toBeUndefined();
      expect(request.body.length).toBe(0);
      expect(requestUrl(request).searchParams.get('id')).toBe('456');
      expect(requestUrl(request).searchParams.has('optional')).toBe(false);
    },
  );

  it('suppresses a caller Content-Type case-insensitively for a bodiless POST', async () => {
    await transkribusRequest('POST', '/query-only', undefined, undefined, {
      'content-type': 'application/xml',
      Accept: 'text/plain',
    });
    expect(lastRequest().contentType).toBeUndefined();
    expect(lastRequest().accept).toBe('text/plain');
  });

  it('preserves application/json for requests with a JSON body', async () => {
    await transkribusRequest('POST', '/body', { name: 'test model' });
    const request = lastRequest();
    expect(request.contentType).toBe('application/json');
    expect(JSON.parse(request.body.toString())).toEqual({ name: 'test model' });
  });

  it('preserves explicit content types and bytes for non-JSON bodies', async () => {
    const xml = '<PcGts>page xml</PcGts>';
    await transkribusRequest('PUT', '/body', xml, undefined, { 'Content-Type': 'application/xml' });
    expect(lastRequest().contentType).toBe('application/xml');
    expect(lastRequest().body.toString()).toBe(xml);
  });

  it('preserves real multipart encoding, the boundary, and uploaded bytes', async () => {
    const form = new FormData();
    form.append('img', new Blob(['image payload'], { type: 'image/png' }), 'page.png');
    await transkribusUpload('/uploads/42', form, undefined, 'PUT');
    const request = lastRequest();
    expect(request.contentType).toMatch(/^multipart\/form-data; boundary=.+/);
    const boundary = request.contentType!.split('boundary=')[1];
    expect(request.body.toString()).toContain(`--${boundary}`);
    expect(request.body.toString()).toContain('name="img"; filename="page.png"');
    expect(request.body.toString()).toContain('image payload');
  });

  it('sends PyLaia selection as a bodiless POST without Content-Type (#71)', async () => {
    await callSuccessfully('transkribus_pylaia_recognize', {
      collId: 123, docId: 456, modelId: 789, pages: '6',
      credits: 'AUTO', allowConcurrentExecution: false, useExistingLinePolygons: false,
    });
    const request = lastRequest();
    const url = requestUrl(request);
    expect(url.pathname).toBe('/rest/pylaia/123/789/recognition');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      id: '456', pages: '6', credits: 'AUTO',
      allowConcurrentExecution: 'false', useExistingLinePolygons: 'false',
    });
    expect(request.contentType).toBeUndefined();
    expect(request.body.length).toBe(0);
  });
});

describe('legacy recognition endpoint contracts', () => {
  it('maps ATR collection and a single page to colId/pageStr (#72)', async () => {
    await callSuccessfully('transkribus_recog_run_atr', {
      collId: '123', docId: '456', pageNr: '6', modelId: '789',
    });
    const request = lastRequest();
    expect(request.method).toBe('POST');
    expect(requestUrl(request).pathname).toBe('/rest/recognition/atr');
    expect(request.contentType).toBe('application/json');
    expect(JSON.parse(request.body.toString())).toEqual({
      colId: 123, docId: 456, pageStr: '6', modelId: 789,
    });
  });

  it('retains explicit whole-document ATR behavior when pageNr is omitted', async () => {
    await callSuccessfully('transkribus_recog_run_atr', { collId: 123, docId: 456 });
    expect(JSON.parse(lastRequest().body.toString())).toEqual({ colId: 123, docId: 456 });
  });

  it('sends OCR document selection and options in the query without a body (#76)', async () => {
    await callSuccessfully('transkribus_recog_run_ocr', {
      collId: 123, docId: 456, pages: '1-3,5', typeFace: 'Gothic',
      language: 'German', doBlockSegOnly: false, ocrType: 'Legacy',
    });
    const request = lastRequest();
    const url = requestUrl(request);
    expect(request.method).toBe('POST');
    expect(url.pathname).toBe('/rest/recognition/ocr');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      collId: '123', id: '456', pages: '1-3,5', typeFace: 'Gothic',
      language: 'German', doBlockSegOnly: 'false', type: 'Legacy',
    });
    expect(request.contentType).toBeUndefined();
    expect(request.body.length).toBe(0);
  });

  it.each([{}, { id: '456' }])(
    'omits unspecified OCR options and accepts a matching deprecated id: %j',
    async (extra) => {
      await callSuccessfully('transkribus_recog_run_ocr', { collId: '123', docId: '456', ...extra });
      expect(Object.fromEntries(requestUrl(lastRequest()).searchParams)).toEqual({ collId: '123', id: '456' });
    },
  );

  it('rejects a conflicting formerly-model OCR id before any HTTP request', async () => {
    const result = await call('transkribus_recog_run_ocr', { collId: 123, docId: 456, id: 789 });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('id must match docId');
    expect(rig.requests).toHaveLength(0);
  });

  it('sends the destination collection in the model-add query without a body (#77)', async () => {
    await callSuccessfully('transkribus_recog_add_to_collection', {
      collId: '123', id: '456', targetCollId: '789',
    });
    const request = lastRequest();
    const url = requestUrl(request);
    expect(request.method).toBe('POST');
    expect(url.pathname).toBe('/rest/recognition/123/456/add');
    expect(Object.fromEntries(url.searchParams)).toEqual({ collId: '789' });
    expect(request.contentType).toBeUndefined();
    expect(request.body.length).toBe(0);
  });
});
