// Manual smoke for 4.2.0: start the binary from an installed release tarball over
// stdio and drive the three changed tools. No request reaches Transkribus: the
// binary gets HTTPS_PROXY pointing at a local proxy, which accepts the CONNECT
// tunnel for transkribus.eu and terminates its TLS with a throwaway certificate
// that only the child process trusts (NODE_EXTRA_CA_CERTS). The proxy therefore
// sees the exact method, URL, headers and body the release would send, and
// answers with a canned reply. The keyring is pointed at a service name that
// holds no entry, so no real credential is read.
//
// Usage: node smoke-wire.mjs <path-to-installed-bin> <scratch-dir>
import { createServer } from 'node:http';
import { createServer as createTlsServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const [bin, dir] = process.argv.slice(2);
if (!bin || !dir) {
  console.error('usage: node smoke-wire.mjs <bin> <scratch-dir>');
  process.exit(2);
}

const keyPath = join(dir, 'smoke-key.pem');
const certPath = join(dir, 'smoke-cert.pem');
execFileSync('openssl', [
  'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
  '-subj', '/CN=transkribus.eu', '-addext', 'subjectAltName=DNS:transkribus.eu',
  '-keyout', keyPath, '-out', certPath,
], { stdio: 'ignore' });

const requests = [];
const tls = createTlsServer({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, (req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    requests.push({
      method: req.method,
      url: `https://${req.headers.host}${req.url}`,
      contentType: req.headers['content-type'] ?? '',
      body: Buffer.concat(chunks),
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"smoke":true}');
  });
});
const proxy = createServer((req, res) => {
  res.writeHead(502);
  res.end();
});
proxy.on('connect', (req, socket, head) => {
  if (req.url !== 'transkribus.eu:443') {
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    return;
  }
  socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
  if (head.length) socket.unshift(head);
  tls.emit('connection', socket);
});
await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;

const transport = new StdioClientTransport({
  command: bin,
  args: [],
  env: {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    HTTPS_PROXY: proxyUrl,
    https_proxy: proxyUrl,
    NO_PROXY: '',
    no_proxy: '',
    NODE_EXTRA_CA_CERTS: certPath,
    TRANSKRIBUS_SESSION_ID: 'smoke-session',
    TRANSKRIBUS_KEYRING_SERVICE: 'transkribus-mcp-smoke-no-such-service',
  },
});
const client = new Client({ name: 'smoke', version: '0.0.0' });
await client.connect(transport);

let failed = false;
function check(label, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${detail}`);
  if (!ok) failed = true;
}

/** Call a tool and return the requests it produced (session checks excluded). */
async function run(name, args) {
  const before = requests.length;
  const result = await client.callTool({ name, arguments: args });
  return { result, sent: requests.slice(before).filter((r) => !/\/auth\//.test(r.url)) };
}

// 1. Document export: pages in the query, ExportParameters as a JSON body (#94).
{
  const { result, sent } = await run('transkribus_doc_export', {
    collId: 1,
    id: 2,
    pages: '1-2',
    commonPars: { doWritePdf: true },
    pdfPars: { doPdfImagesPlusText: true },
  });
  const req = sent.at(-1);
  const body = req ? JSON.parse(req.body.toString('utf8')) : {};
  check(
    'doc_export',
    !result.isError &&
      req?.method === 'POST' &&
      req.url.endsWith('/TrpServer/rest/collections/1/2/export?pages=1-2') &&
      req.contentType.startsWith('application/json') &&
      body.commonPars?.doWritePdf === true &&
      body.commonPars?.doWriteMets === true &&
      body.pdfPars?.doPdfImagesPlusText === true,
    `${req?.method} ${req?.url} ${req?.contentType} body=${req?.body.toString('utf8')}`,
  );
}

// 2. Model discovery: array filters as repeated keys (#95).
{
  const { result, sent } = await run('transkribus_model_get_by_type', {
    type: 'text',
    isoLanguages: ['de', 'en'],
    releaseLevel: ['public'],
  });
  const req = sent.at(-1);
  check(
    'model_get_by_type',
    !result.isError &&
      req?.method === 'GET' &&
      req.url.includes('isoLanguages=de&isoLanguages=en') &&
      req.url.includes('releaseLevel=public') &&
      !req.url.includes('%5B%5D'),
    `${req?.method} ${req?.url}`,
  );
}

// 3. PDF ingestion: multipart part `file` with the exact bytes (#96).
{
  const pdf = Buffer.from('%PDF-1.4\n% smoke fixture\n%%EOF\n', 'latin1');
  const pdfPath = join(dir, 'smoke.pdf');
  writeFileSync(pdfPath, pdf);
  const { result, sent } = await run('transkribus_coll_create_doc_from_pdf', {
    collId: 1,
    pdfFilePath: pdfPath,
    title: 'Smoke',
  });
  const req = sent.at(-1);
  const raw = req?.body.toString('latin1') ?? '';
  check(
    'coll_create_doc_from_pdf',
    !result.isError &&
      req?.method === 'POST' &&
      req.url.endsWith('/TrpServer/rest/collections/1/createDocFromPdf') &&
      /^multipart\/form-data; boundary=/.test(req.contentType) &&
      raw.includes('name="file"; filename="smoke.pdf"') &&
      raw.includes('Content-Type: application/pdf') &&
      raw.includes(pdf.toString('latin1')) &&
      raw.includes('name="title"'),
    `${req?.method} ${req?.url} ${req?.contentType.split(';')[0]}, parts: ${[...raw.matchAll(/; name="([^"]+)"/g)].map((m) => m[1]).join(', ')}`,
  );
}

// 4. A file that is not a PDF is refused before any request.
{
  const notPdf = join(dir, 'not-a-pdf.pdf');
  writeFileSync(notPdf, 'PRIVATE KEY MATERIAL\n');
  const { result, sent } = await run('transkribus_coll_create_doc_from_pdf', { collId: 1, pdfFilePath: notPdf });
  const text = JSON.stringify(result.content);
  check(
    'non-PDF refused',
    result.isError === true && sent.length === 0 && !text.includes('PRIVATE KEY'),
    `isError=${result.isError}, requests=${sent.length}, message mentions content: ${text.includes('PRIVATE KEY')}`,
  );
}

await client.close();
proxy.close();
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
