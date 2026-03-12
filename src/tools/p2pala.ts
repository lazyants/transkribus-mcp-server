import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { transkribusRequest } from '../services/transkribus.js';
import { handleToolRequest } from '../helpers.js';
import { CollIdSchema } from '../schemas/common.js';

export function registerP2palaTools(server: McpServer): void {
  // 1. POST /p2pala/{collId}/train
  server.registerTool(
    'transkribus_p2pala_train',
    {
      title: 'Train P2PaLA Model',
      description: 'Start P2PaLA layout analysis model training for a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        modelName: z.string().optional().describe('Name for the new model'),
        description: z.string().optional().describe('Description of the model'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, ...body } = params;
      return transkribusRequest('POST', `/p2pala/${collId}/train`, body);
    })
  );
}
