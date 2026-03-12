import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { transkribusRequest } from '../services/transkribus.js';
import { handleToolRequest } from '../helpers.js';
import { IdSchema, PaginationParams } from '../schemas/common.js';

const LabelIdSchema = z.number().int().positive().describe('Label ID');

export function registerLabelTools(server: McpServer): void {
  // 1. GET /labels
  server.registerTool(
    'transkribus_label_list',
    {
      title: 'List Labels',
      description: 'List all labels.',
      inputSchema: z.object({
        userid: z.number().int().optional().describe('Filter by user ID'),
        type: z.string().optional().describe('Filter by label type'),
        assignedby: z.number().int().optional().describe('Filter by assigner user ID'),
        id: z.number().int().optional().describe('Filter by label ID'),
        collId: z.number().int().optional().describe('Filter by collection ID'),
        labelId: z.number().int().optional().describe('Filter by label ID (alias)'),
        ...PaginationParams,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('GET', '/labels', undefined, params))
  );

  // 2. POST /labels
  server.registerTool(
    'transkribus_label_create',
    {
      title: 'Create Label',
      description: 'Create a new label.',
      inputSchema: z.object({
        name: z.string().describe('Label name'),
        color: z.string().optional().describe('Label color (hex code)'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('POST', '/labels', params))
  );

  // 3. GET /labels/{id}
  server.registerTool(
    'transkribus_label_get',
    {
      title: 'Get Label',
      description: 'Get a label by ID.',
      inputSchema: z.object({
        id: IdSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { id } = params;
      return transkribusRequest('GET', `/labels/${id}`);
    })
  );

  // 4. POST /labels/{id}
  server.registerTool(
    'transkribus_label_update',
    {
      title: 'Update Label',
      description: 'Update an existing label by ID.',
      inputSchema: z.object({
        id: IdSchema,
        name: z.string().optional().describe('Updated label name'),
        color: z.string().optional().describe('Updated label color (hex code)'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { id, ...body } = params;
      return transkribusRequest('POST', `/labels/${id}`, body);
    })
  );

  // 5. DELETE /labels/{id}
  server.registerTool(
    'transkribus_label_delete',
    {
      title: 'Delete Label',
      description: 'Delete a label by ID.',
      inputSchema: z.object({
        id: IdSchema,
        force: z.boolean().optional().describe('Force delete even if in use (default false)'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { id, ...query } = params;
      return transkribusRequest('DELETE', `/labels/${id}`, undefined, query);
    })
  );

  // 6. POST /labels/{labelId}/documents
  server.registerTool(
    'transkribus_label_assign_documents',
    {
      title: 'Assign Documents to Label',
      description: 'Assign documents to a label.',
      inputSchema: z.object({
        labelId: LabelIdSchema,
        documentIds: z.array(z.number().int().positive()).describe('Array of document IDs to assign'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { labelId, ...body } = params;
      return transkribusRequest('POST', `/labels/${labelId}/documents`, body);
    })
  );

  // 7. DELETE /labels/{labelId}/documents
  server.registerTool(
    'transkribus_label_remove_documents',
    {
      title: 'Remove Documents from Label',
      description: 'Remove documents from a label.',
      inputSchema: z.object({
        labelId: LabelIdSchema,
        documentIds: z.array(z.number().int().positive()).describe('Array of document IDs to remove'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { labelId, ...body } = params;
      return transkribusRequest('DELETE', `/labels/${labelId}/documents`, body);
    })
  );

  // 8. DELETE /labels/{labelId}/documents/all
  server.registerTool(
    'transkribus_label_remove_all_documents',
    {
      title: 'Remove All Documents from Label',
      description: 'Remove all documents from a label.',
      inputSchema: z.object({
        labelId: LabelIdSchema,
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { labelId } = params;
      return transkribusRequest('DELETE', `/labels/${labelId}/documents/all`);
    })
  );

  // 9. POST /labels/{labelId}/documents/{id}
  server.registerTool(
    'transkribus_label_replace_document_assignments',
    {
      title: 'Replace Document Label Assignments',
      description: 'Replace label assignments for a specific document.',
      inputSchema: z.object({
        labelId: LabelIdSchema,
        id: IdSchema,
        labelIds: z.array(z.number().int().positive()).optional().describe('Array of label IDs to assign'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { labelId, id, ...body } = params;
      return transkribusRequest('POST', `/labels/${labelId}/documents/${id}`, body);
    })
  );

  // 10. POST /labels/{labelId}/pages
  server.registerTool(
    'transkribus_label_assign_pages',
    {
      title: 'Assign Pages to Label',
      description: 'Assign pages to a label.',
      inputSchema: z.object({
        labelId: LabelIdSchema,
        pageIds: z.array(z.number().int().positive()).describe('Array of page IDs to assign'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { labelId, ...body } = params;
      return transkribusRequest('POST', `/labels/${labelId}/pages`, body);
    })
  );

  // 11. DELETE /labels/{labelId}/pages
  server.registerTool(
    'transkribus_label_remove_pages',
    {
      title: 'Remove Pages from Label',
      description: 'Remove pages from a label.',
      inputSchema: z.object({
        labelId: LabelIdSchema,
        pageIds: z.array(z.number().int().positive()).describe('Array of page IDs to remove'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { labelId, ...body } = params;
      return transkribusRequest('DELETE', `/labels/${labelId}/pages`, body);
    })
  );

  // 12. DELETE /labels/{labelId}/pages/all
  server.registerTool(
    'transkribus_label_remove_all_pages',
    {
      title: 'Remove All Pages from Label',
      description: 'Remove all pages from a label.',
      inputSchema: z.object({
        labelId: LabelIdSchema,
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { labelId } = params;
      return transkribusRequest('DELETE', `/labels/${labelId}/pages/all`);
    })
  );

  // 13. POST /labels/{labelId}/pages/{id}
  server.registerTool(
    'transkribus_label_replace_page_assignments',
    {
      title: 'Replace Page Label Assignments',
      description: 'Replace label assignments for a specific page.',
      inputSchema: z.object({
        labelId: LabelIdSchema,
        id: IdSchema,
        labelIds: z.array(z.number().int().positive()).optional().describe('Array of label IDs to assign'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { labelId, id, ...body } = params;
      return transkribusRequest('POST', `/labels/${labelId}/pages/${id}`, body);
    })
  );
}
