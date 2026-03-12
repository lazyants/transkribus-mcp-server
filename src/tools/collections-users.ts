import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { transkribusRequest } from '../services/transkribus.js';
import { handleToolRequest } from '../helpers.js';
import { CollIdSchema } from '../schemas/common.js';

export function registerCollectionUserTools(server: McpServer): void {
  server.registerTool(
    'transkribus_coll_user_add_or_modify',
    {
      title: 'Add or Modify User in Collection',
      description: 'Add a user to a collection or modify their role if they already exist.',
      inputSchema: z.object({
        collId: CollIdSchema,
        userId: z.number().int().positive().describe('User ID to add or modify'),
        role: z.string().describe('Role to assign to the user'),
        userid: z.number().int().optional().describe('User ID (alternative)'),
        sendMail: z.boolean().optional().default(true).describe('Send notification email'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, userid, sendMail, ...body } = params;
      return transkribusRequest('POST', `/collections/${collId}/addOrModifyUserInCollection`, body, { userid, sendMail });
    })
  );

  server.registerTool(
    'transkribus_coll_user_get_list',
    {
      title: 'Get Collection Users',
      description: 'Get the list of users with access to a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        role: z.string().optional().describe('Filter by user role'),
        index: z.number().int().optional().default(0).describe('Start index'),
        nValues: z.number().int().optional().default(-1).describe('Number of values'),
        sortColumn: z.string().optional().describe('Column to sort by'),
        sortDirection: z.string().optional().describe('Sort direction (asc/desc)'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, ...query } = params;
      return transkribusRequest('GET', `/collections/${collId}/users`, undefined, query);
    })
  );

  server.registerTool(
    'transkribus_coll_user_add',
    {
      title: 'Add User to Collection',
      description: 'Add a new user to a collection with an optional role.',
      inputSchema: z.object({
        collId: CollIdSchema,
        userId: z.number().int().positive().describe('User ID to add'),
        role: z.string().optional().describe('Role to assign to the user'),
        sendMail: z.boolean().optional().describe('Send notification email (default false)'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, sendMail, ...body } = params;
      return transkribusRequest('POST', `/collections/${collId}/users`, body, { sendMail });
    })
  );

  server.registerTool(
    'transkribus_coll_user_remove',
    {
      title: 'Remove User from Collection',
      description: 'Remove a user from a collection by their user ID.',
      inputSchema: z.object({
        collId: CollIdSchema,
        userid: z.number().int().positive().describe('User ID to remove'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, userid } = params;
      return transkribusRequest('DELETE', `/collections/${collId}/users/${userid}`);
    })
  );

  server.registerTool(
    'transkribus_coll_user_update_role',
    {
      title: 'Update User Role',
      description: 'Update the role of a user in a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        userid: z.number().int().positive().describe('User ID to update'),
        role: z.string().describe('New role to assign'),
        sendMail: z.boolean().optional().describe('Send notification email (default true)'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, userid, sendMail, ...body } = params;
      return transkribusRequest('POST', `/collections/${collId}/users/${userid}`, body, { sendMail });
    })
  );

  server.registerTool(
    'transkribus_coll_user_list',
    {
      title: 'List Collection Users',
      description: 'List users of a collection with optional pagination.',
      inputSchema: z.object({
        collId: CollIdSchema,
        role: z.string().optional().describe('Filter by user role'),
        index: z.number().int().optional().default(0).describe('Start index'),
        nValues: z.number().int().optional().default(-1).describe('Number of values'),
        sortColumn: z.string().optional().describe('Column to sort by'),
        sortDirection: z.string().optional().describe('Sort direction (asc/desc)'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, ...query } = params;
      return transkribusRequest('GET', `/collections/${collId}/userlist`, undefined, query);
    })
  );

  server.registerTool(
    'transkribus_coll_user_count',
    {
      title: 'Count Collection Users',
      description: 'Get the number of users in a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        role: z.string().optional().describe('Filter by user role'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, ...query } = params;
      return transkribusRequest('GET', `/collections/${collId}/userlist/count`, undefined, query);
    })
  );

  server.registerTool(
    'transkribus_coll_user_stats',
    {
      title: 'Get User Stats',
      description: 'Get user statistics for a collection.',
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
      return transkribusRequest('GET', `/collections/${collId}/userStats`, undefined, query);
    })
  );

  // POST /collections/{collId}/removeUserFromCollection
  server.registerTool(
    'transkribus_coll_remove_user',
    {
      title: 'Remove User from Collection (POST)',
      description: 'Remove a user from a collection using the POST endpoint.',
      inputSchema: z.object({
        collId: CollIdSchema,
        userid: z.number().int().positive().describe('User ID to remove'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, userid } = params;
      return transkribusRequest('POST', `/collections/${collId}/removeUserFromCollection`, undefined, { userid });
    })
  );
}
