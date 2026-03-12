import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { transkribusRequest } from '../services/transkribus.js';
import { handleToolRequest } from '../helpers.js';
import { IdSchema } from '../schemas/common.js';

export function registerAdminTools(server: McpServer): void {
  // 1. POST /admin/index/models
  server.registerTool(
    'transkribus_admin_rebuild_models_index',
    {
      title: 'Rebuild Models Index',
      description: 'Rebuild the search index for all recognition models.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async () => {
      return transkribusRequest('POST', '/admin/index/models');
    })
  );

  // 2. GET /admin/listActiveSessions
  server.registerTool(
    'transkribus_admin_list_sessions',
    {
      title: 'List Active Sessions',
      description: 'List all currently active user sessions.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async () => {
      return transkribusRequest('GET', '/admin/listActiveSessions');
    })
  );

  // 3. POST /admin/moveFieldModel
  server.registerTool(
    'transkribus_admin_move_field_model',
    {
      title: 'Move Field Model',
      description: 'Move a field recognition model to a different directory.',
      inputSchema: z.object({
        modelName: z.string().describe('Field model name to move'),
        path: z.string().optional().describe('Target directory path'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      return transkribusRequest('POST', '/admin/moveFieldModel', undefined, params);
    })
  );

  // 4. POST /admin/moveTableModel
  server.registerTool(
    'transkribus_admin_move_table_model',
    {
      title: 'Move Table Model',
      description: 'Move a table recognition model to a different directory.',
      inputSchema: z.object({
        modelName: z.string().describe('Table model name to move'),
        path: z.string().optional().describe('Target directory path'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      return transkribusRequest('POST', '/admin/moveTableModel', undefined, params);
    })
  );

  // GOTCHA: WADL nested JAX-RS resources — @Path("/admin") + @Path("jobLog/{id}") = /admin/jobLog/{id}, NOT /adminjobLog/{id}.
  // 5. GET /admin/jobLog/{id}
  server.registerTool(
    'transkribus_admin_get_job_log',
    {
      title: 'Get Job Log',
      description: 'Retrieve the log output for a specific job.',
      inputSchema: z.object({
        id: IdSchema,
        db: z.string().optional().describe('Database identifier'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { id, ...query } = params;
      return transkribusRequest('GET', `/admin/jobLog/${id}`, undefined, query);
    })
  );

  // 6. GET /admin/reports/{reportType}/{reportTime}
  server.registerTool(
    'transkribus_admin_get_reports',
    {
      title: 'Get Admin Reports',
      description: 'Retrieve administrative reports by type and time period.',
      inputSchema: z.object({
        reportType: z.string().describe('Type of report to retrieve'),
        reportTime: z.string().describe('Time period for the report'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { reportType, reportTime } = params;
      return transkribusRequest('GET', `/admin/reports/${reportType}/${reportTime}`);
    })
  );

  // 7. POST /admin/user/auth/{jobImpl}
  server.registerTool(
    'transkribus_admin_authorize_users_for_job',
    {
      title: 'Authorize Users for Job',
      description: 'Authorize specific users to run a job implementation.',
      inputSchema: z.object({
        jobImpl: z.string().describe('Job implementation identifier'),
        userIds: z.array(z.number().int().positive()).describe('List of user IDs to authorize'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { jobImpl, userIds } = params;
      return transkribusRequest('POST', `/admin/user/auth/${jobImpl}`, { userIds });
    })
  );

  // 8. GET /admin/user/auth/{jobImpl}/list
  server.registerTool(
    'transkribus_admin_get_job_users',
    {
      title: 'Get Job Authorized Users',
      description: 'List users authorized to run a specific job implementation.',
      inputSchema: z.object({
        jobImpl: z.string().describe('Job implementation identifier'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { jobImpl } = params;
      return transkribusRequest('GET', `/admin/user/auth/${jobImpl}/list`);
    })
  );
}
