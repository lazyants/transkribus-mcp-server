import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { transkribusRequest } from '../services/transkribus.js';
import { handleToolRequest } from '../helpers.js';
import { CollIdSchema, PaginationParams } from '../schemas/common.js';

export function registerCollectionLabelTools(server: McpServer): void {
  server.registerTool(
    'transkribus_coll_label_list',
    {
      title: 'List Collection Labels',
      description: 'List all labels associated with a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        ...PaginationParams,
        isDeleted: z.string().optional().describe('Filter by deleted status (default "false")'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, ...query } = params;
      return transkribusRequest('GET', `/collections/${collId}/labels`, undefined, query);
    })
  );
}
