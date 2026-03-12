import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { transkribusRequest } from '../services/transkribus.js';
import { handleToolRequest } from '../helpers.js';
import { CollIdSchema, PaginationParams } from '../schemas/common.js';

export function registerElearningTools(server: McpServer): void {
  // 1. GET /eLearning/count
  server.registerTool(
    'transkribus_elearning_count',
    {
      title: 'Count E-Learning Courses',
      description: 'Get the total count of e-learning courses.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async () => transkribusRequest('GET', '/eLearning/count'))
  );

  // 2. GET /eLearning/list
  server.registerTool(
    'transkribus_elearning_list',
    {
      title: 'List E-Learning Courses',
      description: 'List available e-learning courses.',
      inputSchema: z.object({
        ...PaginationParams,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('GET', '/eLearning/list', undefined, params))
  );

  // 3. POST /eLearning/{collId}/subscribe
  server.registerTool(
    'transkribus_elearning_subscribe',
    {
      title: 'Subscribe to E-Learning',
      description: 'Subscribe to an e-learning course for a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId } = params;
      return transkribusRequest('POST', `/eLearning/${collId}/subscribe`);
    })
  );

  // 4. POST /eLearning/{collId}/unsubscribe
  server.registerTool(
    'transkribus_elearning_unsubscribe',
    {
      title: 'Unsubscribe from E-Learning',
      description: 'Unsubscribe from an e-learning course for a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId } = params;
      return transkribusRequest('POST', `/eLearning/${collId}/unsubscribe`);
    })
  );
}
