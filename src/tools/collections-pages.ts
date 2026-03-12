import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { transkribusRequest } from '../services/transkribus.js';
import { handleToolRequest } from '../helpers.js';
import { CollIdSchema, DocIdSchema, PageNrSchema } from '../schemas/common.js';

export function registerCollectionPageTools(server: McpServer): void {
  // 1. DELETE /collections/{collId}/{id}/{page}
  server.registerTool(
    'transkribus_page_delete',
    {
      title: 'Delete Page',
      description: 'Delete a page from a document.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
        page: PageNrSchema,
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, page } = params;
      return transkribusRequest('DELETE', `/collections/${collId}/${id}/${page}`);
    })
  );

  // 2. GET /collections/{collId}/{id}/{page}
  server.registerTool(
    'transkribus_page_get',
    {
      title: 'Get Page',
      description: 'Get details of a specific page in a document.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
        page: PageNrSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, page } = params;
      return transkribusRequest('GET', `/collections/${collId}/${id}/${page}`);
    })
  );

  // 3. POST /collections/{collId}/{id}/{page}
  server.registerTool(
    'transkribus_page_move',
    {
      title: 'Move Page',
      description: 'Move a page to a different position within the document or to another document.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
        page: PageNrSchema,
        moveTo: z.number().int().describe('Target position to move the page to'),
        moveToDocId: z.number().int().optional().describe('Target document ID to move the page to'),
        nrIsPageId: z.boolean().optional().describe('Treat page nr as page ID (default false)'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, page, ...body } = params;
      return transkribusRequest('POST', `/collections/${collId}/${id}/${page}`, body);
    })
  );

  // 4. POST /collections/{collId}/{id}/{page}/add
  server.registerTool(
    'transkribus_page_add',
    {
      title: 'Add Page',
      description: 'Add a new page to a document at the specified position.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
        page: PageNrSchema,
        imgUrl: z.string().optional().describe('URL of the image to add'),
        fileName: z.string().optional().describe('File name for the page'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, page, fileName, ...body } = params;
      return transkribusRequest('POST', `/collections/${collId}/${id}/${page}/add`, body, { fileName });
    })
  );

  // 5. GET /collections/{collId}/{id}/{page}/count
  server.registerTool(
    'transkribus_page_count_transcripts',
    {
      title: 'Count Page Transcripts',
      description: 'Get the number of transcripts for a page.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
        page: PageNrSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, page } = params;
      return transkribusRequest('GET', `/collections/${collId}/${id}/${page}/count`);
    })
  );

  // 6. GET /collections/{collId}/{id}/{page}/curr
  server.registerTool(
    'transkribus_page_get_curr_transcript',
    {
      title: 'Get Current Transcript',
      description: 'Get the current transcript for a page.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
        page: PageNrSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, page } = params;
      return transkribusRequest('GET', `/collections/${collId}/${id}/${page}/curr`);
    })
  );

  // 7. POST /collections/{collId}/{id}/{page}/delete
  server.registerTool(
    'transkribus_page_delete_transcript',
    {
      title: 'Delete Page Transcript',
      description: 'Delete a specific transcript version from a page.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
        page: PageNrSchema,
        key: z.string().describe('Transcript key to delete'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, page, key } = params;
      return transkribusRequest('POST', `/collections/${collId}/${id}/${page}/delete`, undefined, { key });
    })
  );

  // 8. POST /collections/{collId}/{id}/{page}/hideOnSites
  server.registerTool(
    'transkribus_page_update_hide_on_sites',
    {
      title: 'Update Page Visibility',
      description: 'Set whether a page is hidden on public sites.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
        page: PageNrSchema,
        hide: z.boolean().describe('Whether to hide the page on sites'),
        hideOnSites: z.boolean().optional().describe('Whether to hide on sites'),
        nrIsPageId: z.boolean().optional().default(false).describe('Treat page nr as page ID'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, page, hide, hideOnSites, nrIsPageId } = params;
      return transkribusRequest('POST', `/collections/${collId}/${id}/${page}/hideOnSites`, { hide }, { hideOnSites, nrIsPageId });
    })
  );

  // 9. GET /collections/{collId}/{id}/{page}/isLocked
  server.registerTool(
    'transkribus_page_is_locked',
    {
      title: 'Check Page Lock',
      description: 'Check if a page is currently locked.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
        page: PageNrSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, page } = params;
      return transkribusRequest('GET', `/collections/${collId}/${id}/${page}/isLocked`);
    })
  );

  // 10. GET /collections/{collId}/{id}/{page}/list
  server.registerTool(
    'transkribus_page_list_transcripts',
    {
      title: 'List Page Transcripts',
      description: 'List all transcript versions for a page.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
        page: PageNrSchema,
        index: z.number().int().optional().default(0).describe('Start index'),
        nValues: z.number().int().optional().default(-1).describe('Number of values'),
        sortColumn: z.string().optional().describe('Column to sort by'),
        sortDirection: z.string().optional().describe('Sort direction (asc/desc)'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, page, ...query } = params;
      return transkribusRequest('GET', `/collections/${collId}/${id}/${page}/list`, undefined, query);
    })
  );

  // 11. GET /collections/{collId}/{id}/{page}/listLocks
  server.registerTool(
    'transkribus_page_list_locks',
    {
      title: 'List Page Locks',
      description: 'List all locks on a page.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
        page: PageNrSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, page } = params;
      return transkribusRequest('GET', `/collections/${collId}/${id}/${page}/listLocks`);
    })
  );

  // 12. POST /collections/{collId}/{id}/{page}/lock
  server.registerTool(
    'transkribus_page_lock',
    {
      title: 'Lock/Unlock Page',
      description: 'Lock or unlock a page for editing.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
        page: PageNrSchema,
        type: z.boolean().optional().describe('Whether to lock (true) or unlock (false) the page'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, page, type } = params;
      return transkribusRequest('POST', `/collections/${collId}/${id}/${page}/lock`, undefined, { type });
    })
  );

  // 13. GET /collections/{collId}/{id}/{page}/metadata
  server.registerTool(
    'transkribus_page_get_metadata',
    {
      title: 'Get Page Metadata',
      description: 'Get metadata for a specific page.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
        page: PageNrSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, page } = params;
      return transkribusRequest('GET', `/collections/${collId}/${id}/${page}/metadata`);
    })
  );

  // 14. GET /collections/{collId}/{id}/{page}/plaintext
  server.registerTool(
    'transkribus_page_get_plaintext',
    {
      title: 'Get Page Plaintext',
      description: 'Get the plain text content of a page transcript.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
        page: PageNrSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, page } = params;
      return transkribusRequest('GET', `/collections/${collId}/${id}/${page}/plaintext`);
    })
  );

  // 15. POST /collections/{collId}/{id}/{page}/plaintext
  server.registerTool(
    'transkribus_page_assign_plaintext',
    {
      title: 'Assign Plaintext to Page',
      description: 'Assign plain text content to a page as a new transcript.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
        page: PageNrSchema,
        text: z.string().describe('Plain text content to assign'),
        status: z.string().optional().describe('Transcript status'),
        note: z.string().optional().describe('Note for the transcript'),
        parent: z.number().int().optional().default(-1).describe('Parent transcript ID'),
        nrIsPageId: z.boolean().optional().default(false).describe('Treat page nr as page ID'),
        toolName: z.string().optional().describe('Tool name that created the transcript'),
        useExistingLayout: z.boolean().optional().default(false).describe('Use existing layout'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, page, text, status, note, parent, nrIsPageId, toolName, useExistingLayout } = params;
      return transkribusRequest('POST', `/collections/${collId}/${id}/${page}/plaintext`, { text }, { status, note, parent, nrIsPageId, toolName, useExistingLayout });
    })
  );

  // 16. POST /collections/{collId}/{id}/{page}/replacePage
  server.registerTool(
    'transkribus_page_replace',
    {
      title: 'Replace Page',
      description: 'Replace a page image in a document.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
        page: PageNrSchema,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, page } = params;
      return transkribusRequest('POST', `/collections/${collId}/${id}/${page}/replacePage`);
    })
  );

  // 17. POST /collections/{collId}/{id}/{page}/text
  server.registerTool(
    'transkribus_page_post_transcript',
    {
      title: 'Post Page Transcript',
      description: 'Post a new transcript for a page.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
        page: PageNrSchema,
        body: z.record(z.unknown()).optional().describe('Transcript data'),
        status: z.string().optional().describe('Transcript status'),
        note: z.string().optional().describe('Note for the transcript'),
        parent: z.number().int().optional().default(-1).describe('Parent transcript ID'),
        nrIsPageId: z.boolean().optional().default(false).describe('Treat page nr as page ID'),
        toolName: z.string().optional().describe('Tool name that created the transcript'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, page, body, status, note, parent, nrIsPageId, toolName } = params;
      return transkribusRequest('POST', `/collections/${collId}/${id}/${page}/text`, body, { status, note, parent, nrIsPageId, toolName });
    })
  );

  // 18. GET /collections/{collId}/{id}/{page}/{transcriptId}
  server.registerTool(
    'transkribus_page_get_transcript',
    {
      title: 'Get Page Transcript',
      description: 'Get a specific transcript version for a page.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
        page: PageNrSchema,
        transcriptId: z.number().int().positive().describe('Transcript ID'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, page, transcriptId } = params;
      return transkribusRequest('GET', `/collections/${collId}/${id}/${page}/${transcriptId}`);
    })
  );

  // 19. POST /collections/{collId}/{id}/{page}/{transcriptId}/status
  server.registerTool(
    'transkribus_page_update_transcript_status',
    {
      title: 'Update Transcript Status',
      description: 'Update the status of a specific transcript version.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
        page: PageNrSchema,
        transcriptId: z.number().int().positive().describe('Transcript ID'),
        status: z.string().describe('New transcript status'),
        note: z.string().optional().describe('Status note'),
        nrIsPageId: z.boolean().optional().default(false).describe('Treat page nr as page ID'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, page, transcriptId, status, note, nrIsPageId } = params;
      return transkribusRequest('POST', `/collections/${collId}/${id}/${page}/${transcriptId}/status`, { status }, { note, nrIsPageId });
    })
  );

  // 20. GET /collections/{collId}/{id}/{page}/text
  server.registerTool(
    'transkribus_page_get_text',
    {
      title: 'Get Page Text (Transcript)',
      description: 'Get the transcript text for a specific page.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
        page: PageNrSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, page } = params;
      return transkribusRequest('GET', `/collections/${collId}/${id}/${page}/text`);
    })
  );

  // 21. POST /collections/{collId}/{id}/{page}/{transcriptId}
  server.registerTool(
    'transkribus_page_update_status_v2',
    {
      title: 'Update Page Status v2',
      description: 'Update page status using transcript ID (alternative endpoint).',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
        page: PageNrSchema,
        transcriptId: z.number().int().positive().describe('Transcript ID'),
        body: z.record(z.unknown()).optional().describe('Status update data'),
        status: z.string().optional().describe('New status'),
        note: z.string().optional().describe('Status note'),
        nrIsPageId: z.boolean().optional().default(false).describe('Treat page nr as page ID'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, page, transcriptId, body, status, note, nrIsPageId } = params;
      return transkribusRequest('POST', `/collections/${collId}/${id}/${page}/${transcriptId}`, body, { status, note, nrIsPageId });
    })
  );
}
