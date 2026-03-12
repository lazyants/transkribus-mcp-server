import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { transkribusRequest } from '../services/transkribus.js';
import { handleToolRequest } from '../helpers.js';
import { CollIdSchema, IdSchema } from '../schemas/common.js';

export function registerUploadTools(server: McpServer): void {
  // 1. POST /uploads — Create upload from METS
  server.registerTool(
    'transkribus_upload_create_from_mets',
    {
      title: 'Create Upload from METS',
      description: 'Create upload from METS file.',
      inputSchema: z.object({
        collId: CollIdSchema,
        metsUrl: z.string().describe('URL of the METS file'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('POST', '/uploads', params))
  );

  // 2. POST /uploads — Create upload document structure
  server.registerTool(
    'transkribus_upload_create_structure',
    {
      title: 'Create Upload Structure',
      description: 'Create upload document structure.',
      inputSchema: z.object({
        collId: CollIdSchema,
        title: z.string().describe('Document title'),
        nrOfPages: z.number().int().positive().describe('Number of pages'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('POST', '/uploads', params))
  );

  // 3. GET /uploads/metadata/documents
  server.registerTool(
    'transkribus_upload_get_bulk_doc_metadata',
    {
      title: 'Get Bulk Document Metadata',
      description: 'Retrieve bulk document metadata for uploads.',
      inputSchema: z.object({
        collId: z.number().int().positive().optional().describe('Collection ID'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('GET', '/uploads/metadata/documents', undefined, params))
  );

  // 4. POST /uploads/metadata/documents
  server.registerTool(
    'transkribus_upload_bulk_update_doc_metadata',
    {
      title: 'Bulk Update Document Metadata',
      description: 'Bulk update document metadata for uploads.',
      inputSchema: z.object({
        metadata: z.array(z.record(z.unknown())).describe('Array of document metadata objects to update'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('POST', '/uploads/metadata/documents', params.metadata))
  );

  // 5. GET /uploads/metadata/isad
  server.registerTool(
    'transkribus_upload_get_bulk_isad_metadata',
    {
      title: 'Get Bulk ISAD Metadata',
      description: 'Retrieve bulk ISAD(G) metadata for uploads.',
      inputSchema: z.object({
        collId: z.number().int().positive().optional().describe('Collection ID'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('GET', '/uploads/metadata/isad', undefined, params))
  );

  // 6. POST /uploads/metadata/isad
  server.registerTool(
    'transkribus_upload_bulk_update_isad_metadata',
    {
      title: 'Bulk Update ISAD Metadata',
      description: 'Bulk update ISAD(G) metadata for uploads.',
      inputSchema: z.object({
        metadata: z.array(z.record(z.unknown())).describe('Array of ISAD metadata objects to update'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('POST', '/uploads/metadata/isad', params.metadata))
  );

  // 7. POST /uploads/s3
  server.registerTool(
    'transkribus_upload_create_s3',
    {
      title: 'Create S3 Upload',
      description: 'Create an upload from an S3 source.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: z.number().int().optional().describe('Upload ID'),
        s3Bucket: z.string().optional().describe('S3 bucket name'),
        s3Key: z.string().optional().describe('S3 object key'),
        title: z.string().optional().describe('Document title'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { id, ...body } = params;
      return transkribusRequest('POST', '/uploads/s3', body, { id });
    })
  );

  // 8. GET /uploads/{uploadId}
  server.registerTool(
    'transkribus_upload_get_status',
    {
      title: 'Get Upload Status',
      description: 'Get the status of an upload by ID.',
      inputSchema: z.object({
        uploadId: IdSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { uploadId } = params;
      return transkribusRequest('GET', `/uploads/${uploadId}`);
    })
  );

  // 9. PUT /uploads/{uploadId}
  server.registerTool(
    'transkribus_upload_page',
    {
      title: 'Upload Page',
      description: 'Upload a page to an existing upload.',
      inputSchema: z.object({
        uploadId: IdSchema,
        pageData: z.record(z.unknown()).optional().describe('Page upload data'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { uploadId, ...body } = params;
      return transkribusRequest('PUT', `/uploads/${uploadId}`, body.pageData);
    })
  );

  // 10. DELETE /uploads/{uploadId}
  server.registerTool(
    'transkribus_upload_delete',
    {
      title: 'Delete Upload',
      description: 'Delete an upload by ID.',
      inputSchema: z.object({
        uploadId: IdSchema,
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { uploadId } = params;
      return transkribusRequest('DELETE', `/uploads/${uploadId}`);
    })
  );

  // 11. POST /uploads/{uploadId}/metadata
  server.registerTool(
    'transkribus_upload_update_metadata',
    {
      title: 'Update Upload Metadata',
      description: 'Update metadata for an existing upload.',
      inputSchema: z.object({
        uploadId: IdSchema,
        collId: z.number().int().optional().describe('Collection ID'),
        metadata: z.record(z.unknown()).optional().describe('Metadata key-value pairs to update'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { uploadId, collId, ...body } = params;
      return transkribusRequest('POST', `/uploads/${uploadId}/metadata`, body.metadata, { collId });
    })
  );
}
