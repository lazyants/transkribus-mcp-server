import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { transkribusRequest } from '../services/transkribus.js';
import { handleToolRequest } from '../helpers.js';
import { CollIdSchema } from '../schemas/common.js';

// GOTCHA: WADL nested JAX-RS resources — /{collId}/activity + /recognition = /activity/recognition, NOT /activityrecognition.
export function registerCollectionActivityTools(server: McpServer): void {
  server.registerTool(
    'transkribus_coll_activity_recognition',
    {
      title: 'Get Recognition Activity',
      description: 'Get recognition activity records for a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        from: z.number().optional().describe('Start timestamp (epoch ms)'),
        to: z.number().optional().describe('End timestamp (epoch ms)'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, ...query } = params;
      return transkribusRequest('GET', `/collections/${collId}/activity/recognition`, undefined, query);
    })
  );

  server.registerTool(
    'transkribus_coll_activity_saves',
    {
      title: 'Get Save Activity',
      description: 'Get save activity records for a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        from: z.number().optional().describe('Start timestamp (epoch ms)'),
        to: z.number().optional().describe('End timestamp (epoch ms)'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, ...query } = params;
      return transkribusRequest('GET', `/collections/${collId}/activity/saves`, undefined, query);
    })
  );
}
