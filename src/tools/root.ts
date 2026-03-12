import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { transkribusRequest } from '../services/transkribus.js';
import { handleToolRequest } from '../helpers.js';

export function registerRootTools(server: McpServer): void {
  // 1. GET /availableClientFiles
  server.registerTool(
    'transkribus_server_available_files',
    {
      title: 'Available Client Files',
      description: 'List available client files on the server.',
      inputSchema: z.object({ isRelease: z.boolean().optional().default(true).describe('Filter release files') }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      return transkribusRequest('GET', '/availableClientFiles', undefined, params);
    })
  );

  // 2. POST /bugReport
  server.registerTool(
    'transkribus_server_bug_report',
    {
      title: 'Submit Bug Report',
      description: 'Submit a bug report to the Transkribus server.',
      inputSchema: z.object({
        subject: z.string().describe('Bug report subject'),
        description: z.string().describe('Detailed description of the bug'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      return transkribusRequest('POST', '/bugReport', params);
    })
  );

  // 3. GET /clientVersion
  server.registerTool(
    'transkribus_server_client_version',
    {
      title: 'Get Client Version',
      description: 'Get the current Transkribus client version.',
      inputSchema: z.object({ isRelease: z.boolean().optional().default(true).describe('Filter release version'), packageType: z.string().optional().describe('Package type') }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      return transkribusRequest('GET', '/clientVersion', undefined, params);
    })
  );

  // 4. GET /downloadClientFile
  server.registerTool(
    'transkribus_server_download_client_file',
    {
      title: 'Download Client File',
      description: 'Download a specific client file by name.',
      inputSchema: z.object({
        fileName: z.string().describe('Name of the file to download'),
        isRelease: z.boolean().optional().default(true).describe('Filter release files'),
        libsMap: z.string().optional().describe('Libraries map'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      return transkribusRequest('GET', '/downloadClientFile', undefined, params);
    })
  );

  // 5. POST /downloadClientFileNew
  server.registerTool(
    'transkribus_server_download_client_file_new',
    {
      title: 'Download Client File (New)',
      description: 'Download a specific client file using the new endpoint.',
      inputSchema: z.object({
        fileName: z.string().describe('Name of the file to download'),
        isRelease: z.boolean().optional().default(true).describe('Filter release files'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { isRelease, ...body } = params;
      return transkribusRequest('POST', '/downloadClientFileNew', body, { isRelease });
    })
  );

  // 6. GET /downloadLatestGui
  server.registerTool(
    'transkribus_server_download_gui',
    {
      title: 'Download Latest GUI',
      description: 'Download the latest Transkribus GUI version.',
      inputSchema: z.object({
        isRelease: z.boolean().optional().describe('Download release version'),
        packageType: z.string().optional().describe('Package type to download'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      return transkribusRequest('GET', '/downloadLatestGui', undefined, params);
    })
  );

  // 7. GET /events
  server.registerTool(
    'transkribus_server_get_events',
    {
      title: 'Get Events',
      description: 'Retrieve server events and notifications.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async () => {
      return transkribusRequest('GET', '/events');
    })
  );

  // 8. GET /serverVersion
  server.registerTool(
    'transkribus_server_version',
    {
      title: 'Get Server Version',
      description: 'Get the current Transkribus server version.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async () => {
      return transkribusRequest('GET', '/serverVersion');
    })
  );
}
