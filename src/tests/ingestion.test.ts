import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Wire-format guard for issue #28.
 *
 * Every one of these tools used to send a JSON body to an endpoint that reads
 * a query param, a multipart part, an XML document or a CSV document — so the
 * assertions here are about what actually leaves the process, not about what
 * the handler intended.
 *
 * GOTCHA: this suite must NOT replace axios's adapter. The multipart boundary
 * is generated inside the real http adapter, so a stubbed adapter would let a
 * boundary-less (i.e. broken) request pass the very assertion meant to catch
 * it. Instead a real HTTP server is started and the API base URL is pointed at
 * it, leaving axios entirely intact. The server has to exist before
 * `constants.js` is first imported, which is why it is created inside the mock
 * factory — those run before the module under test loads.
 */

type Captured = {
  method: string;
  url: string;
  contentType: string | undefined;
  body: Buffer;
};

const rig = vi.hoisted(() => ({
  port: 0,
  server: null as import('node:http').Server | null,
  requests: [] as Captured[],
  respondWith: '{"uploadId":42}',
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
        body: Buffer.concat(chunks),
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(rig.respondWith);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));

  rig.server = server;
  rig.port = (server.address() as import('node:net').AddressInfo).port;

  return { ...actual, TRANSKRIBUS_API_BASE: `http://127.0.0.1:${rig.port}/rest` };
});

const { registerUploadTools, buildUploadDescriptor } = await import('../tools/uploads.js');
const { registerCollectionCoreTools } = await import('../tools/collections-core.js');

type ToolHandler = (args: Record<string, unknown>) => Promise<{ isError?: boolean; content: unknown }>;
type RegisteredTools = Record<string, { inputSchema?: z.ZodTypeAny; handler: ToolHandler }>;

function toolsOf(register: (s: McpServer) => void): RegisteredTools {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  register(server);
  return (server as unknown as { _registeredTools: RegisteredTools })._registeredTools;
}

const uploadTools = toolsOf(registerUploadTools);
const collectionTools = toolsOf(registerCollectionCoreTools);

/** Invoke a tool's handler and fail loudly if it returned an MCP error result —
 *  `handleToolRequest` swallows throws into `{ isError: true }`, so a silent
 *  failure would otherwise look like a passing wire assertion. */
async function call(tools: RegisteredTools, name: string, args: Record<string, unknown>): Promise<void> {
  const tool = tools[name];
  expect(tool, `tool ${name} is not registered`).toBeDefined();
  const result = await tool.handler(args);
  expect(result.isError, `tool ${name} returned an error: ${JSON.stringify(result.content)}`).toBeFalsy();
}

function lastRequest(): Captured {
  const req = rig.requests.at(-1);
  expect(req, 'no request reached the test server').toBeDefined();
  return req as Captured;
}

function requiredOf(tools: RegisteredTools, name: string): string[] {
  const schema = z.toJSONSchema(tools[name].inputSchema!, { io: 'input' }) as { required?: string[] };
  return schema.required ?? [];
}

let fixtureDir: string;
let imagePath: string;
let pageXmlPath: string;
let metsPath: string;
let csvPath: string;
const IMAGE_BYTES = Buffer.from('89504e470d0a1a0a-FAKE-PNG-PAYLOAD', 'latin1');

beforeAll(() => {
  process.env.TRANSKRIBUS_SESSION_ID = 'test-session-id';

  fixtureDir = mkdtempSync(join(tmpdir(), 'transkribus-ingestion-'));
  imagePath = join(fixtureDir, '0001.png');
  pageXmlPath = join(fixtureDir, '0001.xml');
  metsPath = join(fixtureDir, 'mets.xml');
  csvPath = join(fixtureDir, 'docs.csv');
  writeFileSync(imagePath, IMAGE_BYTES);
  writeFileSync(pageXmlPath, '<PcGts>page xml</PcGts>');
  writeFileSync(metsPath, '<mets:mets>from disk</mets:mets>');
  writeFileSync(csvPath, 'docId,title\n7,From Disk\n');
});

afterAll(() => {
  rig.server?.close();
  rmSync(fixtureDir, { recursive: true, force: true });
  delete process.env.TRANSKRIBUS_SESSION_ID;
});

beforeEach(() => {
  rig.requests.length = 0;
});

describe('buildUploadDescriptor — documentUploadDescriptor body shape', () => {
  it('nests pages under a pageList wrapper (not a flat array)', () => {
    const body = buildUploadDescriptor({
      title: 'Codex Vindobonensis',
      pages: [
        { fileName: '0001.jpg', pageNr: 1 },
        { fileName: '0002.jpg', pageNr: 2, pageXmlName: '0002.xml' },
      ],
    }) as { md: Record<string, unknown>; pageList: { pages: unknown[] } };

    expect(body.md).toMatchObject({ title: 'Codex Vindobonensis' });
    expect(Array.isArray(body.pageList.pages)).toBe(true);
    expect(body.pageList.pages).toHaveLength(2);
    expect(body.pageList.pages[1]).toMatchObject({ fileName: '0002.jpg', pageNr: 2, pageXmlName: '0002.xml' });
  });

  it('carries no fabricated nrOfPages and no undefined metadata keys', () => {
    const body = buildUploadDescriptor({ title: 'T', pages: [{ fileName: 'a.jpg', pageNr: 1 }] });
    expect(body).not.toHaveProperty('nrOfPages');
    expect(JSON.stringify(body)).not.toContain('nrOfPages');
    expect(Object.keys((body as { md: Record<string, unknown> }).md)).toEqual(['title']);
  });

  it('includes author, description and relatedUploadId only when supplied', () => {
    const body = buildUploadDescriptor({
      title: 'T',
      author: 'A',
      description: 'D',
      relatedUploadId: 9,
      pages: [{ fileName: 'a.jpg', pageNr: 1 }],
    }) as { md: Record<string, unknown>; relatedUploadId?: number };
    expect(body.md).toMatchObject({ title: 'T', author: 'A', description: 'D' });
    expect(body.relatedUploadId).toBe(9);
  });
});

describe('transkribus_upload_create_structure — collId is a query param', () => {
  it('sends collId in the query string and the descriptor as the body', async () => {
    await call(uploadTools, 'transkribus_upload_create_structure', {
      collId: 5,
      title: 'Codex',
      pages: [{ fileName: '0001.png', pageNr: 1 }],
    });

    const req = lastRequest();
    expect(req.method).toBe('POST');
    expect(req.url).toContain('/uploads?');
    expect(req.url).toContain('collId=5');
    const body = JSON.parse(req.body.toString('utf-8'));
    expect(body).not.toHaveProperty('collId');
    expect(body.pageList.pages[0]).toMatchObject({ fileName: '0001.png', pageNr: 1 });
  });

  it('keeps collId, title and pages in required[]', () => {
    const required = requiredOf(uploadTools, 'transkribus_upload_create_structure');
    expect(required).toEqual(expect.arrayContaining(['collId', 'title', 'pages']));
    expect(required).not.toContain('nrOfPages');
  });
});

describe('transkribus_upload_page — multipart PUT with an img part', () => {
  it('issues PUT with a boundary-carrying multipart content type and the image bytes', async () => {
    await call(uploadTools, 'transkribus_upload_page', { uploadId: 42, imagePath });

    const req = lastRequest();
    expect(req.method).toBe('PUT');
    expect(req.url).toBe('/rest/uploads/42');
    // The boundary is generated inside axios's real http adapter. Its absence
    // is exactly what a stubbed adapter would hide.
    expect(req.contentType).toMatch(/^multipart\/form-data;\s*boundary=/);

    const raw = req.body.toString('latin1');
    expect(raw).toContain('name="img"');
    expect(raw).toContain('filename="0001.png"');
    expect(raw).toContain(IMAGE_BYTES.toString('latin1'));
    // The old bug serialized the FormData to this JSON literal instead.
    expect(raw).not.toContain('{"img":{}}');
  });

  it('adds an xml part only when a PAGE XML path is given', async () => {
    await call(uploadTools, 'transkribus_upload_page', { uploadId: 42, imagePath });
    expect(lastRequest().body.toString('latin1')).not.toContain('name="xml"');

    await call(uploadTools, 'transkribus_upload_page', { uploadId: 42, imagePath, pageXmlPath });
    const raw = lastRequest().body.toString('latin1');
    expect(raw).toContain('name="xml"');
    expect(raw).toContain('page xml');
  });

  it('honours a fileName override for the img part', async () => {
    await call(uploadTools, 'transkribus_upload_page', { uploadId: 42, imagePath, fileName: 'scan_01.png' });
    expect(lastRequest().body.toString('latin1')).toContain('filename="scan_01.png"');
  });

  it('keeps uploadId and imagePath in required[]', () => {
    expect(requiredOf(uploadTools, 'transkribus_upload_page')).toEqual(
      expect.arrayContaining(['uploadId', 'imagePath']),
    );
  });
});

describe('transkribus_upload_create_from_mets — XML body, collId in the query', () => {
  it('sends the METS document as application/xml with collId in the query string', async () => {
    await call(uploadTools, 'transkribus_upload_create_from_mets', {
      collId: 5,
      metsXml: '<mets:mets>inline</mets:mets>',
    });

    const req = lastRequest();
    expect(req.method).toBe('POST');
    expect(req.url).toContain('collId=5');
    expect(req.contentType).toContain('application/xml');
    expect(req.body.toString('utf-8')).toBe('<mets:mets>inline</mets:mets>');
  });

  it('reads the METS document from a local file when given a path', async () => {
    await call(uploadTools, 'transkribus_upload_create_from_mets', { collId: 5, metsFilePath: metsPath });
    expect(lastRequest().body.toString('utf-8')).toBe('<mets:mets>from disk</mets:mets>');
  });

  it('has no fabricated metsUrl parameter', () => {
    const schema = z.toJSONSchema(uploadTools['transkribus_upload_create_from_mets'].inputSchema!, {
      io: 'input',
    }) as { properties?: Record<string, unknown> };
    expect(Object.keys(schema.properties ?? {})).not.toContain('metsUrl');
  });
});

describe('bulk metadata tools — CSV media types, not JSON', () => {
  it('sends text/csv for document metadata', async () => {
    await call(uploadTools, 'transkribus_upload_bulk_update_doc_metadata', { csv: 'docId,title\n1,A\n' });
    const req = lastRequest();
    expect(req.method).toBe('POST');
    expect(req.url).toBe('/rest/uploads/metadata/documents');
    expect(req.contentType).toContain('text/csv');
    expect(req.contentType).not.toContain('application/json');
    expect(req.body.toString('utf-8')).toBe('docId,title\n1,A\n');
  });

  it('sends text/csv+isad for ISAD metadata', async () => {
    await call(uploadTools, 'transkribus_upload_bulk_update_isad_metadata', { csv: 'a,b\n1,2\n' });

    // The test server answers 200 on every route, so asserting the media type
    // alone would also pass for an empty body sent to the wrong endpoint.
    const req = lastRequest();
    expect(req.method).toBe('POST');
    expect(req.url).toBe('/rest/uploads/metadata/isad');
    expect(req.contentType).toContain('text/csv+isad');
    expect(req.body.toString('utf-8')).toBe('a,b\n1,2\n');
  });

  it('reads the CSV from a local file when given a path', async () => {
    await call(uploadTools, 'transkribus_upload_bulk_update_doc_metadata', { csvFilePath: csvPath });
    expect(lastRequest().body.toString('utf-8')).toBe('docId,title\n7,From Disk\n');
  });
});

describe('content-or-path inputs accept exactly one', () => {
  const cases: Array<[RegisteredTools, string, string, string, Record<string, unknown>]> = [
    [uploadTools, 'transkribus_upload_create_from_mets', 'metsXml', 'metsFilePath', { collId: 5 }],
    [uploadTools, 'transkribus_upload_bulk_update_doc_metadata', 'csv', 'csvFilePath', {}],
    [uploadTools, 'transkribus_upload_bulk_update_isad_metadata', 'csv', 'csvFilePath', {}],
    [collectionTools, 'transkribus_coll_create_doc_from_mets', 'metsXml', 'metsFilePath', { collId: 5 }],
  ];

  it.each(cases)('%# %s rejects neither/both and accepts either alone', (tools, name, inline, path, base) => {
    const schema = tools[name].inputSchema!;
    expect(schema.safeParse({ ...base }).success, 'neither should be rejected').toBe(false);
    expect(
      schema.safeParse({ ...base, [inline]: 'x', [path]: '/tmp/x' }).success,
      'both should be rejected',
    ).toBe(false);
    expect(schema.safeParse({ ...base, [inline]: 'x' }).success, 'inline alone should be accepted').toBe(true);
    expect(schema.safeParse({ ...base, [path]: '/tmp/x' }).success, 'path alone should be accepted').toBe(true);
  });
});

describe('URL-ingestion tools — the URL rides in the fileName query param, with no body', () => {
  it('createDocFromIiifUrl puts the manifest URL in fileName and sends no body', async () => {
    await call(collectionTools, 'transkribus_coll_create_doc_from_iiif', {
      collId: 5,
      url: 'https://example.org/iiif/manifest.json',
    });

    const req = lastRequest();
    expect(req.method).toBe('POST');
    expect(req.url).toContain('/collections/5/createDocFromIiifUrl?');
    const query = new URLSearchParams(req.url.split('?')[1]);
    expect(query.get('fileName')).toBe('https://example.org/iiif/manifest.json');
    expect(req.body.length, 'the endpoint declares no request body').toBe(0);
  });

  it('createDocFromIiifUrl forwards canvasFilenameReference', async () => {
    await call(collectionTools, 'transkribus_coll_create_doc_from_iiif', {
      collId: 5,
      url: 'https://example.org/iiif/manifest.json',
      canvasFilenameReference: 'label',
    });
    const query = new URLSearchParams(lastRequest().url.split('?')[1]);
    expect(query.get('canvasFilenameReference')).toBe('label');
  });

  it('createDocFromMetsUrl puts the METS URL in fileName and sends no body', async () => {
    await call(collectionTools, 'transkribus_coll_create_doc_from_mets_url', {
      collId: 5,
      url: 'https://example.org/mets.xml',
    });
    const req = lastRequest();
    const query = new URLSearchParams(req.url.split('?')[1]);
    expect(query.get('fileName')).toBe('https://example.org/mets.xml');
    expect(req.body.length).toBe(0);
  });

  it('preserves percent-escapes already present in the URL after one query decode', async () => {
    const url = 'https://example.org/a%20b/manifest.json?x=1&y=2';
    await call(collectionTools, 'transkribus_coll_create_doc_from_iiif', { collId: 5, url });
    const query = new URLSearchParams(lastRequest().url.split('?')[1]);
    expect(query.get('fileName')).toBe(url);
  });
});

describe('transkribus_coll_create_doc_from_ftp — fileName is a query param', () => {
  it('sends fileName in the query string and no body', async () => {
    await call(collectionTools, 'transkribus_coll_create_doc_from_ftp', {
      collId: 5,
      fileName: 'incoming/scan-batch-7',
      doDeleteImportSource: true,
    });

    const req = lastRequest();
    expect(req.url).toContain('/collections/5/ingest?');
    const query = new URLSearchParams(req.url.split('?')[1]);
    expect(query.get('fileName')).toBe('incoming/scan-batch-7');
    expect(query.get('doDeleteImportSource')).toBe('true');
    expect(req.body.length).toBe(0);
  });
});

describe('transkribus_coll_create_doc_from_mets — multipart with a mets part', () => {
  it('sends the METS document as a multipart part named mets', async () => {
    await call(collectionTools, 'transkribus_coll_create_doc_from_mets', {
      collId: 5,
      metsXml: '<mets:mets>inline</mets:mets>',
    });

    const req = lastRequest();
    expect(req.method).toBe('POST');
    expect(req.url).toBe('/rest/collections/5/createDocFromMets');
    expect(req.contentType).toMatch(/^multipart\/form-data;\s*boundary=/);
    const raw = req.body.toString('latin1');
    expect(raw).toContain('name="mets"');
    expect(raw).toContain('<mets:mets>inline</mets:mets>');
  });

  it('reads the METS document from a local file when given a path', async () => {
    await call(collectionTools, 'transkribus_coll_create_doc_from_mets', { collId: 5, metsFilePath: metsPath });
    const raw = lastRequest().body.toString('latin1');
    expect(raw).toContain('name="mets"');
    expect(raw).toContain('<mets:mets>from disk</mets:mets>');
  });
});

describe('tools that can never succeed are gone', () => {
  it.each([
    'transkribus_coll_create_doc_from_pdf',
    'transkribus_coll_upload_doc',
    'transkribus_coll_upload_doc_multipart',
  ])('%s is no longer registered', (name) => {
    expect(collectionTools[name]).toBeUndefined();
  });
});

describe('readLocalFile surfaces a usable error', () => {
  it('names the unreadable path instead of throwing a bare ENOENT', async () => {
    const tool = uploadTools['transkribus_upload_page'];
    const result = await tool.handler({ uploadId: 42, imagePath: join(fixtureDir, 'missing.png') });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('missing.png');
  });
});
