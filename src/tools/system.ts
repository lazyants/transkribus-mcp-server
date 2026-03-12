import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { transkribusRequest } from '../services/transkribus.js';
import { handleToolRequest } from '../helpers.js';

export function registerSystemTools(server: McpServer): void {
  // 1. GET /system/db
  server.registerTool(
    'transkribus_system_db_status',
    {
      title: 'Database Status',
      description: 'Check the status of the Transkribus database.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async () => {
      return transkribusRequest('GET', '/system/db');
    })
  );

  // 2. GET /system/fimagestore
  server.registerTool(
    'transkribus_system_fimagestore',
    {
      title: 'Image Store Status',
      description: 'Check the status of the Transkribus image store.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async () => {
      return transkribusRequest('GET', '/system/fimagestore');
    })
  );
}
