import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { transkribusRequest } from '../services/transkribus.js';
import { handleToolRequest } from '../helpers.js';
import { IdSchema, PaginationParams } from '../schemas/common.js';

export function registerKwsTools(server: McpServer): void {
  // 1. GET /kws/queries
  server.registerTool(
    'transkribus_kws_list_queries',
    {
      title: 'List KWS Queries',
      description: 'List keyword spotting queries.',
      inputSchema: z.object({
        ...PaginationParams,
        collId: z.number().int().optional().describe('Filter by collection ID'),
        id: z.number().int().optional().describe('Filter by document ID'),
        status: z.string().optional().describe('Filter by query status'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('GET', '/kws/queries', undefined, params))
  );

  // 2. POST /kws/queries
  server.registerTool(
    'transkribus_kws_create_query',
    {
      title: 'Create KWS Query',
      description: 'Create a new keyword spotting query.',
      inputSchema: z.object({
        collId: z.number().int().positive().describe('Collection ID'),
        query: z.string().describe('Keyword query string'),
        id: z.number().int().positive().optional().describe('Limit to a specific document ID'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('POST', '/kws/queries', params))
  );

  // 3. GET /kws/queries/{id}/hits
  server.registerTool(
    'transkribus_kws_get_hits',
    {
      title: 'Get KWS Query Hits',
      description: 'Get hits for a keyword spotting query.',
      inputSchema: z.object({
        id: IdSchema,
        index: z.number().int().min(0).optional().describe('Start index (0-based)'),
        nValues: z.number().int().optional().describe('Number of results'),
        keyword: z.string().optional().describe('Filter by keyword'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { id, ...query } = params;
      return transkribusRequest('GET', `/kws/queries/${id}/hits`, undefined, query);
    })
  );

  // 4. GET /kws/queries/{id}/keywords
  server.registerTool(
    'transkribus_kws_get_keywords',
    {
      title: 'Get KWS Query Keywords',
      description: 'Get keywords for a keyword spotting query.',
      inputSchema: z.object({
        id: IdSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { id } = params;
      return transkribusRequest('GET', `/kws/queries/${id}/keywords`);
    })
  );

  // 5. GET /kws/queries/{id}/resultData
  server.registerTool(
    'transkribus_kws_get_result_data',
    {
      title: 'Get KWS Result Data',
      description: 'Get result data for a keyword spotting query.',
      inputSchema: z.object({
        id: IdSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { id } = params;
      return transkribusRequest('GET', `/kws/queries/${id}/resultData`);
    })
  );
}
