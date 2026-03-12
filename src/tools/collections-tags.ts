import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { transkribusRequest } from '../services/transkribus.js';
import { handleToolRequest } from '../helpers.js';
import { CollIdSchema } from '../schemas/common.js';

export function registerCollectionTagTools(server: McpServer): void {
  server.registerTool(
    'transkribus_coll_update_default_tag_defs',
    {
      title: 'Update Default Tag Definitions',
      description: 'Update the default tag definitions across all collections.',
      inputSchema: z.object({
        body: z.record(z.unknown()).describe('Tag definitions data'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { body } = params;
      return transkribusRequest('POST', '/collections/tagDefs', body);
    })
  );

  server.registerTool(
    'transkribus_coll_get_tag_defs',
    {
      title: 'Get Collection Tag Definitions',
      description: 'List tag definitions for a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        legacy: z.boolean().optional().default(false).describe('Use legacy tag definitions'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, ...query } = params;
      return transkribusRequest('GET', `/collections/${collId}/listTagDefs`, undefined, query);
    })
  );

  server.registerTool(
    'transkribus_coll_update_tag_defs',
    {
      title: 'Update Collection Tag Definitions',
      description: 'Update tag definitions for a specific collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        body: z.record(z.unknown()).describe('Tag definitions data'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, body } = params;
      return transkribusRequest('POST', `/collections/${collId}/tagDefs`, body);
    })
  );

  server.registerTool(
    'transkribus_coll_subscribe_get',
    {
      title: 'Get Collection Subscription',
      description: 'Get the subscription status for a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId } = params;
      return transkribusRequest('GET', `/collections/${collId}/subscribe`);
    })
  );
}
