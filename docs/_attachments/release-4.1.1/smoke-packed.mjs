// Manual smoke: start the binary from an installed release tarball over stdio
// and list its tools. No network and no credential lookup: tools/list never
// touches the Transkribus API or the keyring.
//
// Usage: node smoke-packed.mjs <path-to-installed-bin> <expected-version> <expected-tool-count>
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const [bin, expectedVersion, expectedTools] = process.argv.slice(2);
if (!bin || !expectedVersion || !expectedTools) {
  console.error('usage: node smoke-packed.mjs <bin> <expected-version> <expected-tool-count>');
  process.exit(2);
}

const transport = new StdioClientTransport({ command: bin, args: [] });
const client = new Client({ name: 'smoke', version: '0.0.0' });
await client.connect(transport);

const server = client.getServerVersion();
const { tools } = await client.listTools();
const withRequired = tools.filter((t) => (t.inputSchema?.required ?? []).length > 0);
const requiredParams = withRequired.reduce((n, t) => n + t.inputSchema.required.length, 0);
await client.close();

console.log(`server: ${server?.name} ${server?.version}`);
console.log(`tools: ${tools.length}`);
console.log(`tools with required[]: ${withRequired.length}, required params: ${requiredParams}`);

let failed = false;
if (server?.version !== expectedVersion) {
  console.error(`FAIL: server version ${server?.version}, expected ${expectedVersion}`);
  failed = true;
}
if (tools.length !== Number(expectedTools)) {
  console.error(`FAIL: ${tools.length} tools, expected ${expectedTools}`);
  failed = true;
}
// zod 4 once dropped every preprocessed ID from required[] silently; a run with
// no required params at all is that regression, not a pass.
if (requiredParams === 0) {
  console.error('FAIL: no tool advertises a required parameter');
  failed = true;
}
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
