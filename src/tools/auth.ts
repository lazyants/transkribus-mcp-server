import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { transkribusRequest } from '../services/transkribus.js';
import { handleToolRequest } from '../helpers.js';

export function registerAuthTools(server: McpServer): void {
  server.registerTool(
    'transkribus_auth_check_session',
    {
      title: 'Check Session',
      description: 'Check if the current Transkribus session is valid.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async () => transkribusRequest('GET', '/auth/checkSession'))
  );

  server.registerTool(
    'transkribus_auth_get_details',
    {
      title: 'Get Auth Details',
      description: 'Get details of the currently authenticated user.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async () => transkribusRequest('GET', '/auth/details'))
  );

  server.registerTool(
    'transkribus_auth_invalidate',
    {
      title: 'Invalidate Session',
      description: 'Invalidate the current authentication session.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async () => transkribusRequest('POST', '/auth/invalidate'))
  );

  server.registerTool(
    'transkribus_auth_logout',
    {
      title: 'Logout',
      description: 'Log out of the current Transkribus session.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async () => transkribusRequest('POST', '/auth/logout'))
  );

  server.registerTool(
    'transkribus_auth_refresh',
    {
      title: 'Refresh Session',
      description: 'Refresh the current authentication session token.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async () => transkribusRequest('POST', '/auth/refresh'))
  );
}
