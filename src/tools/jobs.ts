import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { transkribusRequest } from '../services/transkribus.js';
import { handleToolRequest } from '../helpers.js';
import { IdSchema, PaginationParams } from '../schemas/common.js';

export function registerJobTools(server: McpServer): void {
  // 1. POST /jobs
  server.registerTool(
    'transkribus_job_create',
    {
      title: 'Create Job',
      description: 'Create a new processing job.',
      inputSchema: z.object({
        type: z.string().describe('Job type'),
        docId: z.number().int().optional().describe('Document ID to process'),
        collId: z.number().int().optional().describe('Collection ID to process'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('POST', '/jobs', params))
  );

  // 2. GET /jobs/count
  server.registerTool(
    'transkribus_job_count',
    {
      title: 'Count Jobs',
      description: 'Get the total number of jobs, optionally filtered by status or type.',
      inputSchema: z.object({
        status: z.string().optional().describe('Filter by job status'),
        type: z.string().optional().describe('Filter by job type'),
        userid: z.number().int().optional().describe('Filter by user ID'),
        filterByUser: z.boolean().optional().describe('Filter jobs by current user'),
        jobImpl: z.string().optional().describe('Filter by job implementation class'),
        collId: z.number().int().optional().describe('Filter by collection ID'),
        id: z.number().int().optional().describe('Filter by job ID'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('GET', '/jobs/count', undefined, params))
  );

  // 3. GET /jobs/list
  server.registerTool(
    'transkribus_job_list',
    {
      title: 'List Jobs',
      description: 'List jobs with pagination, optionally filtered by status or type.',
      inputSchema: z.object({
        ...PaginationParams,
        status: z.string().optional().describe('Filter by job status'),
        type: z.string().optional().describe('Filter by job type'),
        userid: z.number().int().optional().describe('Filter by user ID'),
        filterByUser: z.boolean().optional().describe('Filter jobs by current user'),
        collId: z.number().int().optional().describe('Filter by collection ID'),
        id: z.number().int().optional().describe('Filter by job ID'),
        jobImpl: z.string().optional().describe('Filter by job implementation class'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('GET', '/jobs/list', undefined, params))
  );

  // 4. POST /jobs/restartAllJobsOfUser/{userid}
  server.registerTool(
    'transkribus_job_restart_all_by_user',
    {
      title: 'Restart All Jobs by User',
      description: 'Restart all jobs for a specific user.',
      inputSchema: z.object({
        userid: z.number().int().positive().describe('User ID whose jobs to restart'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('POST', `/jobs/restartAllJobsOfUser/${params.userid}`))
  );

  // 5. GET /jobs/{id}
  server.registerTool(
    'transkribus_job_get',
    {
      title: 'Get Job',
      description: 'Get details of a specific job by ID.',
      inputSchema: z.object({
        id: IdSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('GET', `/jobs/${params.id}`))
  );

  // 6. POST /jobs/{id}
  server.registerTool(
    'transkribus_job_update',
    {
      title: 'Update Job',
      description: 'Update properties of an existing job.',
      inputSchema: z.object({
        id: IdSchema,
        status: z.string().optional().describe('New job status'),
        description: z.string().optional().describe('Updated job description'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { id, ...body } = params;
      return transkribusRequest('POST', `/jobs/${id}`, body);
    })
  );

  // 7. GET /jobs/{id}/errors
  server.registerTool(
    'transkribus_job_get_errors',
    {
      title: 'Get Job Errors',
      description: 'Get error details for a specific job.',
      inputSchema: z.object({
        id: IdSchema,
        ...PaginationParams,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { id, ...query } = params;
      return transkribusRequest('GET', `/jobs/${id}/errors`, undefined, query);
    })
  );

  // 8. POST /jobs/{id}/kill
  server.registerTool(
    'transkribus_job_kill',
    {
      title: 'Kill Job',
      description: 'Kill a running job by ID.',
      inputSchema: z.object({
        id: IdSchema,
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('POST', `/jobs/${params.id}/kill`))
  );

  // 9. POST /jobs/{jobId}/undo
  server.registerTool(
    'transkribus_job_undo',
    {
      title: 'Undo Job',
      description: 'Undo the results of a completed job.',
      inputSchema: z.object({
        jobId: IdSchema,
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('POST', `/jobs/${params.jobId}/undo`))
  );

  // 10. GET /jobs/{jobId}/creditTransactions
  server.registerTool(
    'transkribus_job_get_credit_transactions',
    {
      title: 'Get Job Credit Transactions',
      description: 'Get credit transactions associated with a specific job.',
      inputSchema: z.object({
        jobId: IdSchema,
        index: z.number().int().optional().default(0).describe('Start index'),
        nValues: z.number().int().optional().default(-1).describe('Number of values'),
        sortColumn: z.string().optional().describe('Column to sort by'),
        sortDirection: z.string().optional().describe('Sort direction (asc/desc)'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { jobId, ...query } = params;
      return transkribusRequest('GET', `/jobs/${jobId}/creditTransactions`, undefined, query);
    })
  );
}
