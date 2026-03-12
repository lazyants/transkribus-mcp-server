import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { transkribusRequest } from '../services/transkribus.js';
import { handleToolRequest } from '../helpers.js';
import { CollIdSchema, PaginationParams } from '../schemas/common.js';

export function registerCollectionStatsTools(server: McpServer): void {
  server.registerTool(
    'transkribus_stat_get_coll',
    {
      title: 'Get Collection Statistics',
      description: 'Get statistics for a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId } = params;
      return transkribusRequest('GET', `/collections/${collId}/collStat`);
    })
  );

  server.registerTool(
    'transkribus_stat_get_storage_usage',
    {
      title: 'Get Storage Usage Details',
      description: 'Get storage usage details for a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId } = params;
      return transkribusRequest('GET', `/collections/${collId}/details`);
    })
  );

  server.registerTool(
    'transkribus_stat_get_page_status',
    {
      title: 'Get Page Status',
      description: 'Get the page status overview for a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        ...PaginationParams,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, ...query } = params;
      return transkribusRequest('GET', `/collections/${collId}/pages`, undefined, query);
    })
  );

  server.registerTool(
    'transkribus_stat_update_page_status',
    {
      title: 'Update Page Status',
      description: 'Update the status of pages in a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        status: z.string().describe('New page status value'),
        pageId: z.number().int().positive().optional().describe('Specific page ID to update'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, ...body } = params;
      return transkribusRequest('POST', `/collections/${collId}/updatePageStatus`, body);
    })
  );

  // GET /collections/{collId}/stats
  server.registerTool(
    'transkribus_stat_get_coll_stats',
    {
      title: 'Get Collection Stats (New)',
      description: 'Get collection statistics using the new stats endpoint.',
      inputSchema: z.object({
        collId: CollIdSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId } = params;
      return transkribusRequest('GET', `/collections/${collId}/stats`);
    })
  );

  // POST /collections/{collId}/pages
  server.registerTool(
    'transkribus_stat_get_pages_filtered',
    {
      title: 'Get Collection Pages (Filtered)',
      description: 'Get collection pages with filtering via POST body.',
      inputSchema: z.object({
        collId: CollIdSchema,
        body: z.record(z.unknown()).optional().describe('Filter criteria for pages'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, body } = params;
      return transkribusRequest('POST', `/collections/${collId}/pages`, body);
    })
  );
}
