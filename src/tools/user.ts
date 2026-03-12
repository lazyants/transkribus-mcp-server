import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { transkribusRequest } from '../services/transkribus.js';
import { handleToolRequest } from '../helpers.js';
import { IdSchema, PaginationParams } from '../schemas/common.js';

export function registerUserTools(server: McpServer): void {
  // 1. GET /user/countMyDocs
  server.registerTool(
    'transkribus_user_count_my_docs',
    {
      title: 'Count My Documents',
      description: 'Get the total number of documents owned by the current user.',
      inputSchema: z.object({
        index: z.number().int().optional().default(0).describe('Start index'),
        nValues: z.number().int().optional().default(0).describe('Number of values'),
        getAllDocsIfAdmin: z.boolean().optional().default(false).describe('Get all docs if admin'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('GET', '/user/countMyDocs', undefined, params))
  );

  // 2. GET /user/findUser
  server.registerTool(
    'transkribus_user_find',
    {
      title: 'Find User',
      description: 'Search for users by username/email.',
      inputSchema: z.object({
        user: z.string().optional().describe('Username or email to search for'),
        firstName: z.string().optional().describe('Filter by first name'),
        lastName: z.string().optional().describe('Filter by last name'),
        exactMatch: z.boolean().optional().describe('Require exact match (default true)'),
        caseSensitive: z.boolean().optional().describe('Case sensitive search (default false)'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('GET', '/user/findUser', undefined, params))
  );

  // 3. GET /user/isUserAllowedForJob
  server.registerTool(
    'transkribus_user_is_allowed_for_job',
    {
      title: 'Is User Allowed for Job',
      description: 'Check if the current user is allowed to run a specific job type.',
      inputSchema: z.object({
        jobImpl: z.string().describe('Job implementation class name'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('GET', '/user/isUserAllowedForJob', undefined, params))
  );

  // 4. GET /user/jobAcl
  server.registerTool(
    'transkribus_user_get_job_acl',
    {
      title: 'Get Job ACL',
      description: 'Get the job access control list for the current user.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async () => transkribusRequest('GET', '/user/jobAcl'))
  );

  // 5. GET /user/list
  server.registerTool(
    'transkribus_user_list',
    {
      title: 'List Users',
      description: 'List all users with pagination.',
      inputSchema: z.object({
        user: z.string().optional().describe('Username or email to search for'),
        firstName: z.string().optional().describe('Filter by first name'),
        lastName: z.string().optional().describe('Filter by last name'),
        exactMatch: z.boolean().optional().default(true).describe('Require exact match'),
        caseSensitive: z.boolean().optional().default(false).describe('Case sensitive search'),
        onlyActive: z.boolean().optional().default(true).describe('Only return active users'),
        ...PaginationParams,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('GET', '/user/list', undefined, params))
  );

  // 6. GET /user/listMyDocs
  server.registerTool(
    'transkribus_user_list_my_docs',
    {
      title: 'List My Documents',
      description: 'List documents owned by the current user with pagination.',
      inputSchema: z.object({
        ...PaginationParams,
        collId: z.number().int().optional().describe('Filter by collection ID'),
        getAllDocsIfAdmin: z.boolean().optional().default(false).describe('Get all docs if admin'),
        filter: z.string().optional().describe('Filter string'),
        isDeleted: z.boolean().optional().default(false).describe('Include deleted documents'),
        caseSensitive: z.boolean().optional().default(false).describe('Case sensitive filter'),
        setColls: z.boolean().optional().describe('Set collection info on results'),
        isStray: z.boolean().optional().describe('Filter stray documents'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('GET', '/user/listMyDocs', undefined, params))
  );

  // 7. GET /user/listTagDefs
  server.registerTool(
    'transkribus_user_list_tag_defs',
    {
      title: 'List Tag Definitions',
      description: 'List all tag definitions for the current user.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async () => transkribusRequest('GET', '/user/listTagDefs'))
  );

  // 8. GET /user/stats
  server.registerTool(
    'transkribus_user_get_stats',
    {
      title: 'Get User Stats',
      description: 'Get usage statistics for the current user.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async () => transkribusRequest('GET', '/user/stats'))
  );

  // 9. POST /user/tagDefs
  server.registerTool(
    'transkribus_user_update_tag_defs',
    {
      title: 'Update Tag Definitions',
      description: 'Create or update tag definitions for the current user.',
      inputSchema: z.object({
        tagDefs: z.array(z.object({
          tagName: z.string().optional().describe('Tag name'),
          type: z.string().optional().describe('Tag type'),
          color: z.string().optional().describe('Tag color'),
        })).optional().describe('Array of tag definitions to update'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('POST', '/user/tagDefs', params))
  );

  // 10. DELETE /user/{id}
  server.registerTool(
    'transkribus_user_delete',
    {
      title: 'Delete User',
      description: 'Delete a user by ID.',
      inputSchema: z.object({
        id: IdSchema,
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('DELETE', `/user/${params.id}`))
  );

  // 11. GET /user/{id}
  server.registerTool(
    'transkribus_user_get',
    {
      title: 'Get User',
      description: 'Get details of a specific user by ID.',
      inputSchema: z.object({
        id: IdSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('GET', `/user/${params.id}`))
  );

  // 12. PUT /user/{id}
  server.registerTool(
    'transkribus_user_init',
    {
      title: 'Initialize User',
      description: 'Initialize or set up a user account by ID.',
      inputSchema: z.object({
        id: IdSchema,
        username: z.string().optional().describe('Username'),
        email: z.string().optional().describe('Email address'),
        firstName: z.string().optional().describe('First name'),
        lastName: z.string().optional().describe('Last name'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { id, ...body } = params;
      return transkribusRequest('PUT', `/user/${id}`, body);
    })
  );

  // 13. GET /user/{id}/activity/recognition
  server.registerTool(
    'transkribus_user_activity_recognition',
    {
      title: 'Get User Recognition Activity',
      description: 'Get recognition activity history for a specific user.',
      inputSchema: z.object({
        id: IdSchema,
        from: z.number().optional().describe('Start timestamp (epoch ms)'),
        to: z.number().optional().describe('End timestamp (epoch ms)'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { id, ...query } = params;
      return transkribusRequest('GET', `/user/${id}/activity/recognition`, undefined, query);
    })
  );

  // 14. GET /user/{id}/activity/saves
  server.registerTool(
    'transkribus_user_activity_saves',
    {
      title: 'Get User Save Activity',
      description: 'Get save activity history for a specific user.',
      inputSchema: z.object({
        id: IdSchema,
        from: z.number().optional().describe('Start timestamp (epoch ms)'),
        to: z.number().optional().describe('End timestamp (epoch ms)'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { id, ...query } = params;
      return transkribusRequest('GET', `/user/${id}/activity/saves`, undefined, query);
    })
  );

  // 15. GET /user/{id}/storage
  server.registerTool(
    'transkribus_user_get_storage',
    {
      title: 'Get User Storage',
      description: 'Get storage usage information for a specific user.',
      inputSchema: z.object({
        id: IdSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('GET', `/user/${params.id}/storage`))
  );
}
