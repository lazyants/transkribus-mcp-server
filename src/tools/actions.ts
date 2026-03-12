import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { transkribusRequest } from '../services/transkribus.js';
import { handleToolRequest } from '../helpers.js';
import { IdSchema, PaginationParams } from '../schemas/common.js';

export function registerActionTools(server: McpServer): void {
  // 1. GET /actions/count
  server.registerTool(
    'transkribus_action_count',
    {
      title: 'Count Actions',
      description: 'Get the total count of actions, optionally filtered by collection or type.',
      inputSchema: z.object({
        collId: z.number().int().optional().describe('Filter by collection ID'),
        type: z.string().optional().describe('Filter by action type'),
        typeId: z.string().optional().describe('Filter by action type ID'),
        userid: z.number().int().optional().describe('Filter by user ID'),
        id: z.number().int().optional().describe('Filter by action ID'),
        pageId: z.number().int().optional().describe('Filter by page ID'),
        page: z.number().int().optional().describe('Filter by page number'),
        clientId: z.number().int().optional().describe('Filter by client ID'),
        start: z.number().optional().describe('Start timestamp'),
        end: z.number().optional().describe('End timestamp'),
        isDeleted: z.boolean().optional().describe('Include deleted actions'),
        mostRecentBy: z.string().optional().describe('Most recent by filter'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      return transkribusRequest('GET', '/actions/count', undefined, params);
    })
  );

  // 2. GET /actions/info
  server.registerTool(
    'transkribus_action_info',
    {
      title: 'Get Action Info',
      description: 'Retrieve detailed information about a specific action.',
      inputSchema: z.object({
        id: IdSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      return transkribusRequest('GET', '/actions/info', undefined, params);
    })
  );

  // 3. GET /actions/list
  server.registerTool(
    'transkribus_action_list',
    {
      title: 'List Actions',
      description: 'List actions with optional filtering by collection, type, and pagination.',
      inputSchema: z.object({
        collId: z.number().int().optional().describe('Filter by collection ID'),
        type: z.string().optional().describe('Filter by action type'),
        typeId: z.string().optional().describe('Filter by action type ID'),
        userid: z.number().int().optional().describe('Filter by user ID'),
        id: z.number().int().optional().describe('Filter by action ID'),
        pageId: z.number().int().optional().describe('Filter by page ID'),
        page: z.number().int().optional().describe('Filter by page number'),
        clientId: z.number().int().optional().describe('Filter by client ID'),
        start: z.number().optional().describe('Start timestamp'),
        end: z.number().optional().describe('End timestamp'),
        isDeleted: z.boolean().optional().describe('Include deleted actions'),
        mostRecentBy: z.string().optional().describe('Most recent by filter'),
        pagingWrapper: z.boolean().optional().default(false).describe('Use paging wrapper'),
        ...PaginationParams,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      return transkribusRequest('GET', '/actions/list', undefined, params);
    })
  );
}
