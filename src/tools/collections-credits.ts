import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { transkribusRequest } from '../services/transkribus.js';
import { handleToolRequest } from '../helpers.js';
import { CollIdSchema, IdSchema } from '../schemas/common.js';

export function registerCollectionCreditTools(server: McpServer): void {
  server.registerTool(
    'transkribus_coll_credit_list',
    {
      title: 'List Collection Credits',
      description: 'List credit packages associated with a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        minBalance: z.number().optional().describe('Minimum balance filter'),
        includeExpired: z.boolean().optional().default(true).describe('Include expired credits'),
        onlyActive: z.boolean().optional().default(true).describe('Only active credits'),
        index: z.number().int().optional().default(0).describe('Start index'),
        nValues: z.number().int().optional().default(0).describe('Number of values'),
        sortColumn: z.string().optional().describe('Column to sort by'),
        sortDirection: z.string().optional().describe('Sort direction (asc/desc)'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, ...query } = params;
      return transkribusRequest('GET', `/collections/${collId}/credits`, undefined, query);
    })
  );

  server.registerTool(
    'transkribus_coll_credit_transactions',
    {
      title: 'Get Credit Transactions',
      description: 'Get credit transaction records for a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        index: z.number().int().optional().default(0).describe('Start index'),
        nValues: z.number().int().optional().default(-1).describe('Number of values'),
        sortColumn: z.string().optional().describe('Column to sort by'),
        sortDirection: z.string().optional().describe('Sort direction (asc/desc)'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, ...query } = params;
      return transkribusRequest('GET', `/collections/${collId}/credits/creditTransactions`, undefined, query);
    })
  );

  server.registerTool(
    'transkribus_coll_credit_history',
    {
      title: 'Get Credit History',
      description: 'Get the credit usage history for a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        index: z.number().int().optional().default(0).describe('Start index'),
        nValues: z.number().int().optional().default(-1).describe('Number of values'),
        sortColumn: z.string().optional().describe('Column to sort by'),
        sortDirection: z.string().optional().describe('Sort direction (asc/desc)'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, ...query } = params;
      return transkribusRequest('GET', `/collections/${collId}/credits/history`, undefined, query);
    })
  );

  server.registerTool(
    'transkribus_coll_credit_add_package',
    {
      title: 'Add Credit Package',
      description: 'Add a credit package to a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: IdSchema.describe('Credit package ID to add'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id } = params;
      return transkribusRequest('POST', `/collections/${collId}/credits/${id}`);
    })
  );

  server.registerTool(
    'transkribus_coll_credit_remove_package',
    {
      title: 'Remove Credit Package',
      description: 'Remove a credit package from a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: IdSchema.describe('Credit package ID to remove'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id } = params;
      return transkribusRequest('DELETE', `/collections/${collId}/credits/${id}`);
    })
  );
}
