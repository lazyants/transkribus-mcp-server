import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { transkribusRequest } from '../services/transkribus.js';
import { handleToolRequest } from '../helpers.js';
import { CollIdSchema } from '../schemas/common.js';

export function registerCollectionEditDeclTools(server: McpServer): void {
  server.registerTool(
    'transkribus_editdecl_list_features',
    {
      title: 'List Edit Declaration Features',
      description: 'List all editorial declaration features for a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId } = params;
      return transkribusRequest('GET', `/collections/${collId}/listEditDeclFeats`);
    })
  );

  server.registerTool(
    'transkribus_editdecl_post_feature',
    {
      title: 'Create Edit Declaration Feature',
      description: 'Store a new editorial declaration feature in a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        title: z.string().describe('Feature title'),
        description: z.string().optional().describe('Feature description'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, ...body } = params;
      return transkribusRequest('POST', `/collections/${collId}/storeEditDeclFeat`, body);
    })
  );

  server.registerTool(
    'transkribus_editdecl_post_option',
    {
      title: 'Create Edit Declaration Option',
      description: 'Store a new option for an editorial declaration feature.',
      inputSchema: z.object({
        collId: CollIdSchema,
        featId: z.number().int().positive().describe('Feature ID to add the option to'),
        option: z.string().describe('Option value'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, ...body } = params;
      return transkribusRequest('POST', `/collections/${collId}/storeEditDeclOption`, body);
    })
  );

  server.registerTool(
    'transkribus_editdecl_delete_feature',
    {
      title: 'Delete Edit Declaration Feature',
      description: 'Delete an editorial declaration feature from a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        featId: z.number().int().positive().describe('Feature ID to delete'),
        id: z.number().int().optional().describe('Feature ID (alternative)'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, ...body } = params;
      return transkribusRequest('POST', `/collections/${collId}/deleteEditDeclFeat`, body);
    })
  );

  server.registerTool(
    'transkribus_editdecl_delete_option',
    {
      title: 'Delete Edit Declaration Option',
      description: 'Delete an option from an editorial declaration feature.',
      inputSchema: z.object({
        collId: CollIdSchema,
        optionId: z.number().int().positive().describe('Option ID to delete'),
        id: z.number().int().optional().describe('Option ID (alternative)'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, ...body } = params;
      return transkribusRequest('POST', `/collections/${collId}/deleteEditDeclOption`, body);
    })
  );
}
