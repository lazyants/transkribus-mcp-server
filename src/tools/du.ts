import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { transkribusRequest } from '../services/transkribus.js';
import { handleToolRequest } from '../helpers.js';
import { CollIdSchema, ModelIdSchema } from '../schemas/common.js';

export function registerDuTools(server: McpServer): void {
  // 1. POST /du/{collId}/{modelId}/recognition
  server.registerTool(
    'transkribus_du_recognize',
    {
      title: 'Run DU Recognition',
      description: 'Run Document Understanding recognition on a document using a specific model.',
      inputSchema: z.object({
        collId: CollIdSchema,
        modelId: ModelIdSchema,
        docId: z.number().int().positive().describe('Document ID'),
        pages: z.string().optional().describe('Page range (e.g. "1-5")'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, modelId, docId, pages } = params;
      return transkribusRequest('POST', `/du/${collId}/${modelId}/recognition`, undefined, { id: docId, pages });
    })
  );
}
