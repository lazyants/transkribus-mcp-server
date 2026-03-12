import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { transkribusRequest } from '../services/transkribus.js';
import { handleToolRequest } from '../helpers.js';
import { CollIdSchema, DocIdSchema, PaginationParams } from '../schemas/common.js';

export function registerCollectionDocumentTools(server: McpServer): void {
  // 1. DELETE /collections/{collId}/{id}
  server.registerTool(
    'transkribus_doc_delete',
    {
      title: 'Delete Document',
      description: 'Delete a document from a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
        // GOTCHA: `delete` is a JS reserved word — must use quoted key syntax here.
        'delete': z.boolean().optional().describe('Confirm deletion (default false)'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, ...query } = params;
      return transkribusRequest('DELETE', `/collections/${collId}/${id}`, undefined, query);
    })
  );

  // 2. GET /collections/{collId}/{id}/collections
  server.registerTool(
    'transkribus_doc_list_collections',
    {
      title: 'List Document Collections',
      description: 'List all collections a document belongs to.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
        ...PaginationParams,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, ...query } = params;
      return transkribusRequest('GET', `/collections/${collId}/${id}/collections`, undefined, query);
    })
  );

  // 3. GET /collections/{collId}/{id}/collections/list
  server.registerTool(
    'transkribus_doc_list_collections_paged',
    {
      title: 'List Document Collections (Paged)',
      description: 'List all collections a document belongs to with pagination.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
        ...PaginationParams,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, ...query } = params;
      return transkribusRequest('GET', `/collections/${collId}/${id}/collections/list`, undefined, query);
    })
  );

  // 4. GET /collections/{collId}/{id}/costs
  server.registerTool(
    'transkribus_doc_get_costs',
    {
      title: 'Get Document Costs',
      description: 'Get the processing costs for a document.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id } = params;
      return transkribusRequest('GET', `/collections/${collId}/${id}/costs`);
    })
  );

  // 5. GET /collections/{collId}/{id}/docStat
  server.registerTool(
    'transkribus_doc_get_stat',
    {
      title: 'Get Document Stat',
      description: 'Get document statistics summary.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id } = params;
      return transkribusRequest('GET', `/collections/${collId}/${id}/docStat`);
    })
  );

  // 6. GET /collections/{collId}/{id}/editorialDeclaration
  server.registerTool(
    'transkribus_doc_get_editorial_declaration',
    {
      title: 'Get Editorial Declaration',
      description: 'Get the editorial declaration for a document.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id } = params;
      return transkribusRequest('GET', `/collections/${collId}/${id}/editorialDeclaration`);
    })
  );

  // 7. POST /collections/{collId}/{id}/editorialDeclaration
  server.registerTool(
    'transkribus_doc_post_editorial_declaration',
    {
      title: 'Post Editorial Declaration',
      description: 'Create or update the editorial declaration for a document.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
        body: z.record(z.unknown()).optional().describe('Editorial declaration data'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, body } = params;
      return transkribusRequest('POST', `/collections/${collId}/${id}/editorialDeclaration`, body);
    })
  );

  // 8. POST /collections/{collId}/{id}/export
  server.registerTool(
    'transkribus_doc_export',
    {
      title: 'Export Document',
      description: 'Export a document in the specified format.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
        pages: z.string().optional().describe('Page range to export (e.g. "1-5")'),
        format: z.string().optional().describe('Export format'),
        doWriteMets: z.boolean().optional().default(true).describe('Write METS file'),
        doWriteImages: z.boolean().optional().default(true).describe('Write image files'),
        doExportPageXml: z.boolean().optional().default(true).describe('Export PAGE XML'),
        doExportAltoXml: z.boolean().optional().default(true).describe('Export ALTO XML'),
        splitIntoWordsInAltoXml: z.boolean().optional().default(true).describe('Split into words in ALTO XML'),
        doWritePdf: z.boolean().optional().default(false).describe('Write PDF'),
        doWriteTei: z.boolean().optional().default(false).describe('Write TEI'),
        doWriteDocx: z.boolean().optional().default(false).describe('Write DOCX'),
        doWriteTagsXlsx: z.boolean().optional().default(false).describe('Write tags XLSX'),
        doWriteTablesXlsx: z.boolean().optional().default(false).describe('Write tables XLSX'),
        doPdfImagesOnly: z.boolean().optional().default(false).describe('PDF with images only'),
        doPdfImagesPlusText: z.boolean().optional().default(false).describe('PDF with images plus text'),
        doPdfWithTextPages: z.boolean().optional().default(false).describe('PDF with text pages'),
        doPdfWithTags: z.boolean().optional().default(false).describe('PDF with tags'),
        doTeiWithNoZones: z.boolean().optional().default(false).describe('TEI without zones'),
        doTeiWithZones: z.boolean().optional().default(false).describe('TEI with zones'),
        doSingleClassColorTei: z.boolean().optional().default(false).describe('Single class color TEI'),
        doBlackening: z.boolean().optional().default(false).describe('Apply blackening'),
        doCreateTitle: z.boolean().optional().default(false).describe('Create title page'),
        doWordBased: z.boolean().optional().default(false).describe('Word-based export'),
        doDocxExpandAbbrevs: z.boolean().optional().default(false).describe('Expand abbreviations in DOCX'),
        doDocxSubstituteAbbrevs: z.boolean().optional().default(false).describe('Substitute abbreviations in DOCX'),
        doTeiWithZonePerRegion: z.boolean().optional().default(false).describe('TEI with zone per region'),
        doTeiWithZonePerLine: z.boolean().optional().default(false).describe('TEI with zone per line'),
        doTeiWithZonePerWord: z.boolean().optional().default(false).describe('TEI with zone per word'),
        doTeiWithLineTags: z.boolean().optional().default(false).describe('TEI with line tags'),
        doTeiWithLineBreaks: z.boolean().optional().default(false).describe('TEI with line breaks'),
        doDocxWithTags: z.boolean().optional().default(false).describe('DOCX with tags'),
        doDocxPreserveLineBreaks: z.boolean().optional().default(false).describe('Preserve line breaks in DOCX'),
        doDocxForcePageBreaks: z.boolean().optional().default(false).describe('Force page breaks in DOCX'),
        doDocxMarkUnclear: z.boolean().optional().default(false).describe('Mark unclear text in DOCX'),
        doDocxKeepAbbrevs: z.boolean().optional().default(false).describe('Keep abbreviations in DOCX'),
        useVersionStatus: z.string().optional().default('Latest').describe('Version status to use'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, ...query } = params;
      return transkribusRequest('POST', `/collections/${collId}/${id}/export`, undefined, query);
    })
  );

  // 9. GET /collections/{collId}/{id}/fulldoc
  server.registerTool(
    'transkribus_doc_get_fulldoc',
    {
      title: 'Get Full Document',
      description: 'Get the full document including all pages and transcripts.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
        nrOfTranscripts: z.number().int().optional().default(-1).describe('Number of transcripts to include'),
        status: z.string().optional().describe('Filter by status'),
        stats: z.boolean().optional().default(true).describe('Include statistics'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, ...query } = params;
      return transkribusRequest('GET', `/collections/${collId}/${id}/fulldoc`, undefined, query);
    })
  );

  // 10. GET /collections/{collId}/{id}/fulldoc.xml
  server.registerTool(
    'transkribus_doc_get_fulldoc_xml',
    {
      title: 'Get Full Document XML',
      description: 'Get the full document in XML format.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
        nrOfTranscripts: z.number().int().optional().default(-1).describe('Number of transcripts to include'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, ...query } = params;
      return transkribusRequest('GET', `/collections/${collId}/${id}/fulldoc.xml`, undefined, query);
    })
  );

  // 11. GET /collections/{collId}/{id}/hasAffiliation
  server.registerTool(
    'transkribus_doc_has_affiliation',
    {
      title: 'Check Document Affiliation',
      description: 'Check if a document has an affiliation.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id } = params;
      return transkribusRequest('GET', `/collections/${collId}/${id}/hasAffiliation`);
    })
  );

  // 12. GET /collections/{collId}/{id}/imageNames
  server.registerTool(
    'transkribus_doc_get_image_names',
    {
      title: 'Get Image Names',
      description: 'Get the image file names for all pages in a document.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id } = params;
      return transkribusRequest('GET', `/collections/${collId}/${id}/imageNames`);
    })
  );

  // GOTCHA: WADL declares kwsSearch as POST (not GET) — query goes in body, not query string.
  // 13. POST /collections/{collId}/{id}/kwsSearch
  server.registerTool(
    'transkribus_doc_kws_search',
    {
      title: 'Keyword Search in Document',
      description: 'Search for keywords within a document.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
        query: z.string().describe('Search query string'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, ...body } = params;
      return transkribusRequest('POST', `/collections/${collId}/${id}/kwsSearch`, body);
    })
  );

  // 14. GET /collections/{collId}/{id}/list
  server.registerTool(
    'transkribus_doc_list_pages',
    {
      title: 'List Document Pages',
      description: 'List pages in a document with pagination.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
        ...PaginationParams,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, ...query } = params;
      return transkribusRequest('GET', `/collections/${collId}/${id}/list`, undefined, query);
    })
  );

  // 15. GET /collections/{collId}/{id}/metadata
  server.registerTool(
    'transkribus_doc_get_metadata',
    {
      title: 'Get Document Metadata',
      description: 'Get metadata for a document.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id } = params;
      return transkribusRequest('GET', `/collections/${collId}/${id}/metadata`);
    })
  );

  // 16. POST /collections/{collId}/{id}/metadata
  server.registerTool(
    'transkribus_doc_update_metadata',
    {
      title: 'Update Document Metadata',
      description: 'Update metadata for a document.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
        title: z.string().optional().describe('Document title'),
        author: z.string().optional().describe('Document author'),
        description: z.string().optional().describe('Document description'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, ...body } = params;
      return transkribusRequest('POST', `/collections/${collId}/${id}/metadata`, body);
    })
  );

  // 17. GET /collections/{collId}/{id}/mets
  server.registerTool(
    'transkribus_doc_get_mets',
    {
      title: 'Get Document METS',
      description: 'Get the METS metadata for a document.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id } = params;
      return transkribusRequest('GET', `/collections/${collId}/${id}/mets`);
    })
  );

  // 18. GET /collections/{collId}/{id}/pageIds
  server.registerTool(
    'transkribus_doc_get_page_ids',
    {
      title: 'Get Page IDs',
      description: 'Get the page IDs for all pages in a document.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
        pages: z.string().optional().describe('Page range filter (e.g. "1-5")'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, ...query } = params;
      return transkribusRequest('GET', `/collections/${collId}/${id}/pageIds`, undefined, query);
    })
  );

  // 19. GET /collections/{collId}/{id}/pages
  server.registerTool(
    'transkribus_doc_get_pages',
    {
      title: 'Get Document Pages',
      description: 'Get all pages for a document.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
        pages: z.string().optional().describe('Page range filter'),
        status: z.string().optional().describe('Filter by status'),
        ctStatus: z.string().optional().describe('Filter by CT status'),
        fileName: z.string().optional().describe('Filter by file name'),
        modelUserId: z.number().int().optional().describe('Filter by model user ID'),
        modelUserName: z.string().optional().describe('Filter by model user name'),
        modelId: z.string().optional().describe('Filter by model ID'),
        modelName: z.string().optional().describe('Filter by model name'),
        recognitionType: z.string().optional().describe('Filter by recognition type'),
        clientId: z.number().int().optional().describe('Filter by client ID'),
        clientName: z.string().optional().describe('Filter by client name'),
        modelType: z.string().optional().describe('Filter by model type'),
        labelId: z.string().optional().describe('Filter by label ID'),
        hideOnSites: z.number().int().optional().describe('Filter by hide on sites flag'),
        index: z.number().int().optional().default(0).describe('Start index'),
        nValues: z.number().int().optional().default(-1).describe('Number of values (-1 for all)'),
        sortColumn: z.string().optional().describe('Column to sort by'),
        sortDirection: z.string().optional().describe('Sort direction (asc/desc)'),
        pagingWrapper: z.boolean().optional().default(false).describe('Use paging wrapper'),
        skipPagesWithMissingStatus: z.boolean().optional().default(false).describe('Skip pages with missing status'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, ...query } = params;
      return transkribusRequest('GET', `/collections/${collId}/${id}/pages`, undefined, query);
    })
  );

  // 20. DELETE /collections/{collId}/{id}/remove
  server.registerTool(
    'transkribus_doc_remove_from_collection',
    {
      title: 'Remove Document from Collection',
      description: 'Remove a document from a collection without deleting it.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id } = params;
      return transkribusRequest('DELETE', `/collections/${collId}/${id}/remove`);
    })
  );

  // 21. GET /collections/{collId}/{id}/stats
  server.registerTool(
    'transkribus_doc_get_stats',
    {
      title: 'Get Document Stats',
      description: 'Get detailed statistics for a document.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id } = params;
      return transkribusRequest('GET', `/collections/${collId}/${id}/stats`);
    })
  );

  // 22. GET /collections/{collId}/{id}/testSet
  server.registerTool(
    'transkribus_doc_get_test_set',
    {
      title: 'Get Test Set',
      description: 'Get the test set data for a document.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id } = params;
      return transkribusRequest('GET', `/collections/${collId}/${id}/testSet`);
    })
  );

  // 23. GET /collections/{collId}/{id}/trainData
  server.registerTool(
    'transkribus_doc_get_train_data',
    {
      title: 'Get Training Data',
      description: 'Get the training data for a document.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id } = params;
      return transkribusRequest('GET', `/collections/${collId}/${id}/trainData`);
    })
  );

  // 24. GET /collections/{collId}/{id}/transcriptIds
  server.registerTool(
    'transkribus_doc_get_transcript_ids',
    {
      title: 'Get Transcript IDs',
      description: 'Get all transcript IDs for a document.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
        pages: z.string().optional().describe('Page range filter'),
        index: z.number().int().optional().default(0).describe('Start index'),
        nValues: z.number().int().optional().default(-1).describe('Number of values'),
        status: z.string().optional().describe('Filter by transcript status'),
        skipPagesWithMissingStatus: z.boolean().optional().default(false).describe('Skip pages with missing status'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, ...query } = params;
      return transkribusRequest('GET', `/collections/${collId}/${id}/transcriptIds`, undefined, query);
    })
  );

  // GOTCHA: POST with mixed body+query params — destructure query params (e.g. fileName) before `...body` spread, or they get sent as body instead of query string.
  // 25. POST /collections/{collId}/{id}/updateTranscript
  server.registerTool(
    'transkribus_doc_update_transcript',
    {
      title: 'Update Document Transcript',
      description: 'Update a transcript for a specific page in a document.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
        page: z.number().int().min(1).describe('Page number'),
        status: z.string().optional().describe('Transcript status'),
        fileName: z.string().optional().describe('File name for transcript sync'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, fileName, ...body } = params;
      return transkribusRequest('POST', `/collections/${collId}/${id}/updateTranscript`, body, { fileName });
    })
  );

  // 26. GET /collections/{collId}/{id}/validationData
  server.registerTool(
    'transkribus_doc_get_validation_data',
    {
      title: 'Get Validation Data',
      description: 'Get the validation data for a document.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id } = params;
      return transkribusRequest('GET', `/collections/${collId}/${id}/validationData`);
    })
  );

  // 27. POST /collections/{collId}/{id}/imageNames
  server.registerTool(
    'transkribus_doc_move_pages_by_image_names',
    {
      title: 'Move Pages by Image Names',
      description: 'Move pages within a document based on image names.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
        body: z.record(z.unknown()).describe('Image name mapping data'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, body } = params;
      return transkribusRequest('POST', `/collections/${collId}/${id}/imageNames`, body);
    })
  );

  // 28. POST /collections/{collId}/{id}/list
  server.registerTool(
    'transkribus_doc_update_metadata_v2',
    {
      title: 'Update Document Metadata v2',
      description: 'Update document metadata using the v2 endpoint.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
        body: z.record(z.unknown()).describe('Document metadata v2 data'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, body } = params;
      return transkribusRequest('POST', `/collections/${collId}/${id}/list`, body);
    })
  );
}
