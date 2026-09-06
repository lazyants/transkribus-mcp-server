// Manual smoke: start the BUILT processing entry over stdio and list its tools.
// No network: tools/list never touches the Transkribus API.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({ command: 'node', args: ['../../../dist/entry-processing.js'] });
const client = new Client({ name: 'smoke', version: '0.0.0' });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`tools: ${tools.length}`);
for (const t of tools) {
  const req = t.inputSchema?.required ?? [];
  console.log(`  ${t.name}  required=[${req.join(', ')}]`);
}
const { resources } = await client.listResources();
console.log(`resources: ${resources.map((r) => r.uri).join(', ')}`);

// Call a tool with a string-encoded id and no credentials: proves the schema
// coerces, the request is attempted, and the error carries no secret.
process.env.TRANSKRIBUS_USER = '';
process.env.TRANSKRIBUS_PASSWORD = '';
const res = await client.callTool({ name: 'transkribus_processing_get_status', arguments: { processId: '3866314' } });
console.log(`isError: ${res.isError} -> ${res.content[0].text}`);

await client.close();
