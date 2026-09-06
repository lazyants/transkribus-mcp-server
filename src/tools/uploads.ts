import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { transkribusRequest, transkribusUpload } from '../services/transkribus.js';
import { handleToolRequest } from '../helpers.js';
import { CollIdSchema, IdSchema } from '../schemas/common.js';
import { resolveTextPayload, exactlyOneOf, appendFilePart } from '../uploads-io.js';

export interface UploadDescriptorPageInput {
  fileName: string;
  pageNr: number;
  pageXmlName?: string;
}

export interface UploadDescriptorInput {
  title: string;
  author?: string;
  description?: string;
  relatedUploadId?: number;
  pages: UploadDescriptorPageInput[];
}

/**
 * Build the `documentUploadDescriptor` body for `POST /uploads` (create upload
 * document structure). Pure: no I/O, no schema validation.
 *
 * GOTCHA: `pageList` is a WRAPPER object around `pages` (JAXB
 * `@XmlElementWrapper(name="pageList")`), not a flat array — see
 * `TrpServerConn.java`'s `createUploadDocStructure`. `md` and `relatedUploadId`
 * keys that were not supplied are omitted entirely rather than emitted as
 * `undefined`.
 */
export function buildUploadDescriptor(params: UploadDescriptorInput): Record<string, unknown> {
  const { title, author, description, relatedUploadId, pages } = params;

  const md: Record<string, unknown> = { title };
  if (author !== undefined) md.author = author;
  if (description !== undefined) md.description = description;

  const body: Record<string, unknown> = {
    md,
    pageList: {
      pages: pages.map((page) => {
        const entry: Record<string, unknown> = { fileName: page.fileName, pageNr: page.pageNr };
        if (page.pageXmlName !== undefined) entry.pageXmlName = page.pageXmlName;
        return entry;
      }),
    },
  };
  if (relatedUploadId !== undefined) body.relatedUploadId = relatedUploadId;
  return body;
}

export function registerUploadTools(server: McpServer): void {
  // 1. POST /uploads — Create upload from METS
  server.registerTool(
    'transkribus_upload_create_from_mets',
    {
      title: 'Create Upload from METS',
      description: 'Create an upload from a METS XML document.',
      inputSchema: z.object({
        collId: CollIdSchema,
        metsXml: z.string().optional().describe(
          'Inline METS XML document content. Exactly one of "metsXml" or "metsFilePath" is required.'
        ),
        metsFilePath: z.string().optional().describe(
          'Absolute path to a local METS XML file. Exactly one of "metsXml" or "metsFilePath" is required.'
        ),
      }).refine((v) => exactlyOneOf(v.metsXml, v.metsFilePath), {
        message: 'Provide exactly one of "metsXml" or "metsFilePath".',
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, metsXml, metsFilePath } = params;
      const xml = resolveTextPayload(metsXml, metsFilePath, 'metsXml', 'metsFilePath');
      return transkribusRequest('POST', '/uploads', xml, { collId }, { 'Content-Type': 'application/xml' });
    })
  );

  // 2. POST /uploads — Create upload document structure
  server.registerTool(
    'transkribus_upload_create_structure',
    {
      title: 'Create Upload Structure',
      description: 'Create an upload document structure describing pages to be uploaded.',
      inputSchema: z.object({
        collId: CollIdSchema,
        title: z.string().describe('Document title'),
        author: z.string().optional().describe('Document author'),
        description: z.string().optional().describe('Document description'),
        relatedUploadId: IdSchema.optional().describe('ID of a related upload'),
        pages: z.array(z.object({
          fileName: z.string().describe('Page image file name (e.g. "0001.jpg")'),
          pageNr: z.number().int().positive().describe('Page number (1-based)'),
          pageXmlName: z.string().optional().describe('PAGE XML file name for this page'),
        })).min(1).describe('Ordered list of pages in this upload structure'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, ...descriptor } = params;
      const body = buildUploadDescriptor(descriptor);
      return transkribusRequest('POST', '/uploads', body, { collId });
    })
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
      description: 'Bulk update document metadata for uploads from a CSV payload.',
      inputSchema: z.object({
        csv: z.string().optional().describe(
          'Inline CSV content. Exactly one of "csv" or "csvFilePath" is required.'
        ),
        csvFilePath: z.string().optional().describe(
          'Absolute path to a local CSV file. Exactly one of "csv" or "csvFilePath" is required.'
        ),
      }).refine((v) => exactlyOneOf(v.csv, v.csvFilePath), {
        message: 'Provide exactly one of "csv" or "csvFilePath".',
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const csv = resolveTextPayload(params.csv, params.csvFilePath, 'csv', 'csvFilePath');
      return transkribusRequest('POST', '/uploads/metadata/documents', csv, undefined, { 'Content-Type': 'text/csv' });
    })
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
      description: 'Bulk update ISAD(G) metadata for uploads from a CSV payload.',
      inputSchema: z.object({
        csv: z.string().optional().describe(
          'Inline CSV content. Exactly one of "csv" or "csvFilePath" is required.'
        ),
        csvFilePath: z.string().optional().describe(
          'Absolute path to a local CSV file. Exactly one of "csv" or "csvFilePath" is required.'
        ),
      }).refine((v) => exactlyOneOf(v.csv, v.csvFilePath), {
        message: 'Provide exactly one of "csv" or "csvFilePath".',
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const csv = resolveTextPayload(params.csv, params.csvFilePath, 'csv', 'csvFilePath');
      return transkribusRequest('POST', '/uploads/metadata/isad', csv, undefined, { 'Content-Type': 'text/csv+isad' });
    })
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
      description: 'Upload a page image (and optional PAGE XML) to an existing upload.',
      inputSchema: z.object({
        uploadId: IdSchema,
        imagePath: z.string().describe('Absolute local path to the page image file'),
        pageXmlPath: z.string().optional().describe('Absolute local path to a PAGE XML file for this page'),
        fileName: z.string().optional().describe('File name for the image part, overriding the local file\'s basename'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { uploadId, imagePath, pageXmlPath, fileName } = params;
      const form = new FormData();
      appendFilePart(form, 'img', imagePath, fileName);
      if (pageXmlPath) appendFilePart(form, 'xml', pageXmlPath);
      return transkribusUpload(`/uploads/${uploadId}`, form, undefined, 'PUT');
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
        metadata: z.record(z.string(), z.unknown()).optional().describe('Metadata key-value pairs to update'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { uploadId, collId, ...body } = params;
      return transkribusRequest('POST', `/uploads/${uploadId}/metadata`, body.metadata, { collId });
    })
  );
}
