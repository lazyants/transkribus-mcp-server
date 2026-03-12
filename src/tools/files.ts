import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { transkribusRequest } from '../services/transkribus.js';
import { handleToolRequest } from '../helpers.js';

export function registerFileTools(server: McpServer): void {
  // 1. GET /files/check
  server.registerTool(
    'transkribus_file_check',
    {
      title: 'Check File',
      description: 'Check the status or existence of a file at a given path.',
      inputSchema: z.object({
        path: z.string().optional().describe('File path to check'),
        fileName: z.string().optional().describe('File name to check'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      return transkribusRequest('GET', '/files/check', undefined, params);
    })
  );

  // 2. GET /files/filelist
  server.registerTool(
    'transkribus_file_list_files',
    {
      title: 'List Files',
      description: 'List files at a given path on the server.',
      inputSchema: z.object({
        path: z.string().optional().describe('Directory path to list files from'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      return transkribusRequest('GET', '/files/filelist', undefined, params);
    })
  );

  // 3. GET /files/list
  server.registerTool(
    'transkribus_file_list_dirs',
    {
      title: 'List Directories',
      description: 'List directories at a given path on the server.',
      inputSchema: z.object({
        path: z.string().optional().describe('Directory path to list subdirectories from'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      return transkribusRequest('GET', '/files/list', undefined, params);
    })
  );
}
