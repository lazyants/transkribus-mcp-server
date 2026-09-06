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

/**
 * For a tool whose callback builds the CallToolResult itself — an image content
 * block cannot come out of formatResponse's JSON path.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function handleRawToolRequest(fn: (params: any) => Promise<CallToolResult>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (params: any) => {
    try {
      return await fn(params);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[transkribus-mcp] Tool error: ${message}`);
      return toolError(err);
    }
  };
}

/**
 * The usual wrapper: run the tool and JSON-format whatever it returns. Built on
 * handleRawToolRequest so the two share one error path by construction rather
 * than by two copies that have to be kept in step. formatResponse stays inside
 * the try, so a stringify failure is still reported as a tool error.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function handleToolRequest(fn: (params: any) => Promise<unknown>) {
  return handleRawToolRequest(async (params) => formatResponse(await fn(params)));
}
