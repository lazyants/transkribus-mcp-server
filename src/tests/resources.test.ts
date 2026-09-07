import { describe, it, expect, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { registerAuthTools } from '../tools/auth.js';
import {
  registerReferenceResource,
  REFERENCE_MD,
  REFERENCE_URI,
} from '../resources/transkribus-reference.js';

// Track every client/server we spin up so each test tears its pair down.
const openClients: Client[] = [];
const openServers: McpServer[] = [];

afterEach(async () => {
  await Promise.all(openClients.splice(0).map((c) => c.close()));
  await Promise.all(openServers.splice(0).map((s) => s.close()));
});

/** Wire an McpServer to a Client over a linked in-memory transport pair. */
async function connect(configure: (server: McpServer) => void): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  configure(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  openServers.push(server);
  openClients.push(client);
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

describe('reference resource — module content', () => {
  it('REFERENCE_MD is non-empty markdown carrying the legacy-only scope note', () => {
    expect(typeof REFERENCE_MD).toBe('string');
    expect(REFERENCE_MD.length).toBeGreaterThan(0);
    expect(REFERENCE_MD).toContain('# Transkribus MCP');
    // Known reference token + the two-API scope note. The Processing API is no
    // longer out of scope (issue #22); the reference now has to name both APIs
    // and the CORRECT Processing version, since /processing/v2 does not exist.
    expect(REFERENCE_MD).toContain('TrpServer');
    expect(REFERENCE_MD).toContain('Metagrapho Processing API');
    expect(REFERENCE_MD).toContain('/processing/v1');
    expect(REFERENCE_MD).not.toContain('out of scope');
  });

  it('REFERENCE_URI is the stable reference scheme', () => {
    expect(REFERENCE_URI).toBe('reference://transkribus/api');
  });
});

describe('reference resource — list & read over the protocol', () => {
  it('lists reference://transkribus/api with name and text/markdown mimeType', async () => {
    const client = await connect(registerReferenceResource);
    const { resources } = await client.listResources();
    const ref = resources.find((r) => r.uri === REFERENCE_URI);
    expect(ref, 'reference resource not listed').toBeDefined();
    expect(ref?.name).toBe('transkribus-api-reference');
    expect(ref?.mimeType).toBe('text/markdown');
  });

  it('reads non-empty markdown and returns uri as the exact registered string', async () => {
    const client = await connect(registerReferenceResource);
    const { contents } = await client.readResource({ uri: REFERENCE_URI });
    expect(contents).toHaveLength(1);
    const [entry] = contents;
    // ReadResourceResult.contents[].uri MUST be a string, not a URL object.
    expect(typeof entry.uri).toBe('string');
    expect(entry.uri).toBe(REFERENCE_URI);
    expect(entry.mimeType).toBe('text/markdown');
    // contents[] is a text|blob union — assert we got the text variant.
    expect('text' in entry).toBe(true);
    const { text } = entry as { text: string };
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain('TrpServer');
  });
});

describe('reference resource — additive capability', () => {
  it('does not regress tool registration when resources are added', async () => {
    const client = await connect((s) => {
      registerAuthTools(s); // 5 tools
      registerReferenceResource(s);
    });

    const { tools } = await client.listTools();
    expect(tools).toHaveLength(5);

    const { resources } = await client.listResources();
    expect(resources.some((r) => r.uri === REFERENCE_URI)).toBe(true);
  });
});
