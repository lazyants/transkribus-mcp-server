import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { transkribusRequest } from '../services/transkribus.js';
import { handleToolRequest } from '../helpers.js';
import { CollIdSchema } from '../schemas/common.js';

export function registerCollectionCrowdTools(server: McpServer): void {
  server.registerTool(
    'transkribus_crowd_get_project',
    {
      title: 'Get Crowd Project',
      description: 'Get the crowd project details for a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId } = params;
      return transkribusRequest('GET', `/collections/${collId}/crowdProject`);
    })
  );

  server.registerTool(
    'transkribus_crowd_post_project',
    {
      title: 'Create or Update Crowd Project',
      description: 'Create or update the crowd project configuration for a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        body: z.record(z.unknown()).describe('Crowd project data'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, body } = params;
      return transkribusRequest('POST', `/collections/${collId}/storeCrowdProject`, body);
    })
  );

  server.registerTool(
    'transkribus_crowd_delete_messages',
    {
      title: 'Delete Crowd Project Messages',
      description: 'Delete messages from the crowd project of a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: z.number().int().optional().describe('Specific message ID to delete'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, ...query } = params;
      return transkribusRequest('DELETE', `/collections/${collId}/deleteProjectMessages`, undefined, query);
    })
  );

  server.registerTool(
    'transkribus_crowd_delete_milestones',
    {
      title: 'Delete Crowd Project Milestones',
      description: 'Delete milestones from the crowd project of a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: z.number().int().optional().describe('Specific milestone ID to delete'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, ...query } = params;
      return transkribusRequest('DELETE', `/collections/${collId}/deleteProjectMilestones`, undefined, query);
    })
  );

  server.registerTool(
    'transkribus_crowd_post_message',
    {
      title: 'Post Crowd Project Message',
      description: 'Store a new message in the crowd project of a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        message: z.string().describe('Message content to store'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, ...body } = params;
      return transkribusRequest('POST', `/collections/${collId}/storeCrowdProjectMessage`, body);
    })
  );

  server.registerTool(
    'transkribus_crowd_post_milestone',
    {
      title: 'Post Crowd Project Milestone',
      description: 'Store a new milestone in the crowd project of a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        title: z.string().describe('Milestone title'),
        date: z.string().optional().describe('Milestone date'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, ...body } = params;
      return transkribusRequest('POST', `/collections/${collId}/storeCrowdProjectMilestone`, body);
    })
  );
}
