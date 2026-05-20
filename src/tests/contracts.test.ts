import { describe, it, expect } from 'vitest';
import util from 'node:util';
import { z } from 'zod';
import { AxiosError } from 'axios';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { formatResponse } from '../helpers.js';
import { wrapAxiosError } from '../services/transkribus.js';
import { registerCollectionActivityTools } from '../tools/collections-activity.js';

// Internal McpServer shape — same access pattern the smoke test uses.
type RegisteredTools = Record<string, { inputSchema?: z.ZodTypeAny }>;
function getRegisteredTools(server: McpServer): RegisteredTools {
  return (server as unknown as { _registeredTools: RegisteredTools })._registeredTools;
}

describe('formatResponse contract (CallToolResult shape)', () => {
  it('omits structuredContent when data is an array', () => {
    // GOTCHA guard: MCP SDK rejects arrays in `structuredContent` ("expected
    // record, received array"). Arrays must surface only via `content` text.
    const result = formatResponse([1, 2, 3]);
    expect(result.structuredContent).toBeUndefined();
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify([1, 2, 3], null, 2) },
    ]);
  });

  it('sets structuredContent when data is a plain object (happy path)', () => {
    const data = { foo: 'bar', n: 1 };
    const result = formatResponse(data);
    expect(result.structuredContent).toEqual(data);
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify(data, null, 2) },
    ]);
  });

  it('omits structuredContent for null and primitives', () => {
    expect(formatResponse(null).structuredContent).toBeUndefined();
    expect(formatResponse('hello').structuredContent).toBeUndefined();
    expect(formatResponse(42).structuredContent).toBeUndefined();
  });
});

describe('wrapAxiosError — no session-cookie leak via util.inspect', () => {
  // Regression guard for `gotcha_axios_cause_walk_cookie_leak.md`. The
  // wrapped Error chains the original AxiosError via { cause: err }; if a
  // caller ever logs it through default-depth util.inspect, the
  // JSESSIONID-bearing `config.headers` must not appear in the rendered text.
  it('default util.inspect does not surface request cookies', () => {
    const fake = new AxiosError(
      'Request failed with status code 500',
      'ERR_BAD_RESPONSE',
    );
    // Cast through unknown — AxiosError.config is a typed shape, but for
    // leak testing we just need the runtime properties present.
    (fake as unknown as { config: unknown }).config = {
      url: '/collections/1/activity/recognition',
      method: 'GET',
      headers: { Cookie: 'JSESSIONID=session-secret-cookie-value' },
    };
    (fake as unknown as { response: unknown }).response = {
      status: 500,
      statusText: 'Internal Server Error',
      data: 'something broke',
      headers: {},
    };

    const wrapped = wrapAxiosError(fake);
    expect(wrapped).toBeInstanceOf(Error);

    const rendered = util.inspect(wrapped);
    expect(rendered).not.toContain('session-secret-cookie-value');
    expect(rendered).not.toContain('JSESSIONID');
  });

  it('returns non-Axios errors unchanged', () => {
    const plain = new Error('not an axios error');
    expect(wrapAxiosError(plain)).toBe(plain);
  });
});

describe('tools/list required[] — optional filters stay non-required', () => {
  // Regression guard for the Zod 4 `optin: "optional"` silent-drop bug
  // (memory: gotcha_zod4_preprocess_optin_required_drop.md). A tool with a
  // required intCoerce-wrapped ID + optional filter params must surface the
  // ID in JSON Schema `required[]` while the filters are absent.
  it('transkribus_coll_activity_recognition requires collId but not from/to', () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerCollectionActivityTools(server);

    const registered = getRegisteredTools(server);
    const tool = registered['transkribus_coll_activity_recognition'];
    expect(tool, 'tool registration missing').toBeDefined();
    expect(tool.inputSchema, 'inputSchema missing').toBeDefined();

    const schema = z.toJSONSchema(tool.inputSchema!, { io: 'input' }) as {
      required?: string[];
      properties?: Record<string, unknown>;
    };

    expect(schema.required).toContain('collId');
    expect(schema.required ?? []).not.toContain('from');
    expect(schema.required ?? []).not.toContain('to');

    // Sanity: the optional fields are still present as properties (not pruned).
    expect(schema.properties).toBeDefined();
    expect(schema.properties).toHaveProperty('from');
    expect(schema.properties).toHaveProperty('to');
  });
});
