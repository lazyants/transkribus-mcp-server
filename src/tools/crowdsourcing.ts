import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { transkribusRequest } from '../services/transkribus.js';
import { handleToolRequest } from '../helpers.js';
import { CollIdSchema, PaginationParams } from '../schemas/common.js';

export function registerCrowdsourcingTools(server: McpServer): void {
  // 1. GET /crowdsourcing/count
  server.registerTool(
    'transkribus_crowdsource_count',
    {
      title: 'Count Crowdsourcing Projects',
      description: 'Get the total count of crowdsourcing projects.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async () => transkribusRequest('GET', '/crowdsourcing/count'))
  );

  // 2. GET /crowdsourcing/list
  server.registerTool(
    'transkribus_crowdsource_list',
    {
      title: 'List Crowdsourcing Projects',
      description: 'List available crowdsourcing projects.',
      inputSchema: z.object({
        ...PaginationParams,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('GET', '/crowdsourcing/list', undefined, params))
  );

  // 3. GET /crowdsourcing/{collId}/subscribe
  server.registerTool(
    'transkribus_crowdsource_get_details',
    {
      title: 'Get Crowdsourcing Details',
      description: 'Get crowdsourcing details for a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId } = params;
      return transkribusRequest('GET', `/crowdsourcing/${collId}/subscribe`);
    })
  );

  // 4. POST /crowdsourcing/{collId}/subscribe
  server.registerTool(
    'transkribus_crowdsource_subscribe',
    {
      title: 'Subscribe to Crowdsourcing',
      description: 'Subscribe to a crowdsourcing project for a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId } = params;
      return transkribusRequest('POST', `/crowdsourcing/${collId}/subscribe`);
    })
  );

  // 5. POST /crowdsourcing/{collId}/unsubscribe
  server.registerTool(
    'transkribus_crowdsource_unsubscribe',
    {
      title: 'Unsubscribe from Crowdsourcing',
      description: 'Unsubscribe from a crowdsourcing project for a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId } = params;
      return transkribusRequest('POST', `/crowdsourcing/${collId}/unsubscribe`);
    })
  );
}
