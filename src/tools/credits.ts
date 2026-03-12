import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { transkribusRequest } from '../services/transkribus.js';
import { handleToolRequest } from '../helpers.js';
import { IdSchema, PaginationParams } from '../schemas/common.js';

export function registerCreditTools(server: McpServer): void {
  // 1. GET /credits
  server.registerTool(
    'transkribus_credit_list_by_user',
    {
      title: 'List Credits by User',
      description: 'List credit packages for the current user.',
      inputSchema: z.object({
        ...PaginationParams,
        minBalance: z.number().optional().describe('Minimum balance filter'),
        onlyActive: z.boolean().optional().default(true).describe('Only active credits'),
        includeExpired: z.boolean().optional().default(true).describe('Include expired credits'),
        userid: z.number().int().optional().describe('Filter by user ID'),
        isShared: z.boolean().optional().describe('Filter shared credits'),
        shareable: z.boolean().optional().describe('Filter shareable credits'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('GET', '/credits', undefined, params))
  );

  // 2. POST /credits
  server.registerTool(
    'transkribus_credit_create',
    {
      title: 'Create Credit Package',
      description: 'Create a new credit package.',
      inputSchema: z.object({
        type: z.string().optional().describe('Credit package type'),
        amount: z.number().optional().describe('Credit amount'),
        label: z.string().optional().describe('Label for the credit package'),
        sourcePackageId: z.number().int().optional().describe('Source credit package ID'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { sourcePackageId, ...body } = params;
      return transkribusRequest('POST', '/credits', body, { sourcePackageId });
    })
  );

  // 3. GET /credits/costs
  server.registerTool(
    'transkribus_credit_get_costs',
    {
      title: 'Get Credit Costs',
      description: 'Get the credit cost information, optionally filtered by type.',
      inputSchema: z.object({
        type: z.string().optional().describe('Filter by cost type'),
        time: z.number().optional().describe('Time filter'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('GET', '/credits/costs', undefined, params))
  );

  // 4. GET /credits/creditTransactions
  server.registerTool(
    'transkribus_credit_get_transactions',
    {
      title: 'Get Credit Transactions',
      description: 'List credit transactions with pagination.',
      inputSchema: z.object({
        ...PaginationParams,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('GET', '/credits/creditTransactions', undefined, params))
  );

  // 5. GET /credits/history
  server.registerTool(
    'transkribus_credit_get_history',
    {
      title: 'Get Credit History',
      description: 'Get the credit usage history with pagination.',
      inputSchema: z.object({
        ...PaginationParams,
        userid: z.number().int().optional().describe('Filter by user ID'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('GET', '/credits/history', undefined, params))
  );

  // 6. POST /credits/history
  server.registerTool(
    'transkribus_credit_manage',
    {
      title: 'Manage Credit History',
      description: 'Create or update credit history entries.',
      inputSchema: z.object({
        ...PaginationParams,
        sourceUserId: z.number().int().optional().describe('Source user ID'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { sourceUserId, ...body } = params;
      return transkribusRequest('POST', '/credits/history', body, { sourceUserId });
    })
  );

  // 7. POST /credits/orders/{id}
  server.registerTool(
    'transkribus_credit_handle_order',
    {
      title: 'Handle Credit Order',
      description: 'Process a credit order by ID.',
      inputSchema: z.object({
        id: IdSchema,
        status: z.string().optional().describe('Order status'),
        paymentMethod: z.string().optional().describe('Payment method'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { id, ...body } = params;
      return transkribusRequest('POST', `/credits/orders/${id}`, body);
    })
  );

  // 8. GET /credits/products
  server.registerTool(
    'transkribus_credit_get_products',
    {
      title: 'Get Credit Products',
      description: 'List available credit products for purchase.',
      inputSchema: z.object({
        index: z.number().int().optional().default(0).describe('Start index'),
        nValues: z.number().int().optional().default(-1).describe('Number of values'),
        sortColumn: z.string().optional().describe('Column to sort by'),
        sortDirection: z.string().optional().describe('Sort direction (asc/desc)'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('GET', '/credits/products', undefined, params))
  );

  // 9. GET /credits/{id}
  server.registerTool(
    'transkribus_credit_get',
    {
      title: 'Get Credit Package',
      description: 'Get details of a specific credit package by ID.',
      inputSchema: z.object({
        id: IdSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('GET', `/credits/${params.id}`))
  );

  // 10. POST /credits/{id}
  server.registerTool(
    'transkribus_credit_update',
    {
      title: 'Update Credit Package',
      description: 'Update an existing credit package by ID.',
      inputSchema: z.object({
        id: IdSchema,
        label: z.string().optional().describe('Updated label'),
        amount: z.number().optional().describe('Updated amount'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { id, ...body } = params;
      return transkribusRequest('POST', `/credits/${id}`, body);
    })
  );

  // 11. GET /credits/{id}/collections
  server.registerTool(
    'transkribus_credit_get_collections',
    {
      title: 'Get Credit Package Collections',
      description: 'List collections associated with a specific credit package.',
      inputSchema: z.object({
        id: IdSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('GET', `/credits/${params.id}/collections`))
  );

  // 12. GET /credits/{id}/creditTransactions
  server.registerTool(
    'transkribus_credit_get_package_transactions',
    {
      title: 'Get Credit Package Transactions',
      description: 'List credit transactions for a specific credit package.',
      inputSchema: z.object({
        id: IdSchema,
        ...PaginationParams,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { id, ...query } = params;
      return transkribusRequest('GET', `/credits/${id}/creditTransactions`, undefined, query);
    })
  );
}
