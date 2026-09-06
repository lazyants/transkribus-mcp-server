import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export function toolError(err: unknown): CallToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
}

export function formatResponse(data: unknown): CallToolResult {
  const result: CallToolResult = {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
  // GOTCHA: structuredContent must be a Record, not an array. Arrays pass typeof === 'object'
  // but cause MCP SDK validation error "expected record, received array".
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    result.structuredContent = data as Record<string, unknown>;
  }
  return result;
}

/** Arguments a tool handler receives. The MCP SDK has already validated them
 *  against the tool's Zod schema, so the wrappers below never inspect them. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToolParams = any;

/** Shared body of the two wrappers below: run the call, format whatever it
 *  resolved to, and turn any throw into a logged isError result. */
function toolHandler<T>(
  fn: (params: ToolParams) => Promise<T>,
  format: (value: T) => CallToolResult
) {
  return async (params: ToolParams): Promise<CallToolResult> => {
    try {
      return format(await fn(params));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[transkribus-mcp] Tool error: ${message}`);
      return toolError(err);
    }
  };
}

export function handleToolRequest(fn: (params: ToolParams) => Promise<unknown>) {
  return toolHandler(fn, formatResponse);
}

/**
 * Wrapper for a tool whose upstream response is raw text, not JSON — the
 * Metagrapho PAGE/ALTO endpoints return `application/xml`. `formatResponse`
 * would `JSON.stringify` the XML into an escaped quoted blob and, since a
 * string is not a Record, would set no `structuredContent` either. This emits
 * the text verbatim.
 */
export function handleTextToolRequest(fn: (params: ToolParams) => Promise<string>) {
  return toolHandler(fn, (text) => ({ content: [{ type: 'text', text }] }));
}
