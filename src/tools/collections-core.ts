import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { transkribusRequest } from '../services/transkribus.js';
import { handleToolRequest } from '../helpers.js';
import { CollIdSchema, DocIdSchema, PaginationParams } from '../schemas/common.js';

export function registerCollectionCoreTools(server: McpServer): void {
  // 1. GET /collections
  server.registerTool(
    'transkribus_coll_list',
    {
      title: 'List Collections',
      description: 'List all collections accessible to the current user.',
      inputSchema: z.object({
        excludeEmpty: z.boolean().optional().describe('Exclude empty collections'),
        filter: z.string().optional().describe('Filter string'),
        role: z.string().optional().describe('Filter by user role'),
        userid: z.number().int().optional().describe('Filter by user ID'),
        index: z.number().int().optional().default(0).describe('Start index'),
        nValues: z.number().int().optional().default(0).describe('Number of values'),
        sortColumn: z.string().optional().describe('Column to sort by'),
        sortDirection: z.string().optional().describe('Sort direction (asc/desc)'),
        favorites: z.boolean().optional().describe('Filter favorites only'),
        collId: z.string().optional().describe('Filter by collection ID'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('GET', '/collections', undefined, params))
  );

  // 2. GET /collections/count
  server.registerTool(
    'transkribus_coll_count',
    {
      title: 'Count Collections',
      description: 'Get the total number of collections accessible to the current user.',
      inputSchema: z.object({
        empty: z.boolean().optional().default(false).describe('Include empty collections'),
        filter: z.string().optional().describe('Filter string'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('GET', '/collections/count', undefined, params))
  );

  // 3. GET /collections/countFindDocuments
  server.registerTool(
    'transkribus_coll_count_find_documents',
    {
      title: 'Count Found Documents',
      description: 'Count documents matching the given search criteria.',
      inputSchema: z.object({
        title: z.string().optional().describe('Filter by document title'),
        author: z.string().optional().describe('Filter by author'),
        collId: z.number().int().optional().describe('Filter by collection ID'),
        docId: z.number().int().optional().describe('Filter by document ID'),
        exactMatch: z.boolean().optional().describe('Require exact match'),
        descr: z.string().optional().describe('Filter by description'),
        writer: z.string().optional().describe('Filter by writer'),
        id: z.number().int().optional().describe('Filter by ID'),
        userid: z.number().int().optional().describe('Filter by user ID'),
        uploaderId: z.number().int().optional().describe('Filter by uploader ID'),
        labelId: z.string().optional().describe('Filter by label ID'),
        isDeleted: z.boolean().optional().default(false).describe('Include deleted documents'),
        caseSensitive: z.boolean().optional().default(false).describe('Case sensitive search'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('GET', '/collections/countFindDocuments', undefined, params))
  );

  // 4. POST /collections/createCollection
  server.registerTool(
    'transkribus_coll_create',
    {
      title: 'Create Collection',
      description: 'Create a new collection with the given name.',
      inputSchema: z.object({
        collName: z.string().describe('Name for the new collection'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('POST', '/collections/createCollection', undefined, params))
  );

  // 5. GET /collections/findDocuments
  server.registerTool(
    'transkribus_coll_find_documents',
    {
      title: 'Find Documents',
      description: 'Search for documents across collections using filters.',
      inputSchema: z.object({
        title: z.string().optional().describe('Filter by document title'),
        author: z.string().optional().describe('Filter by author'),
        writer: z.string().optional().describe('Filter by writer'),
        collId: z.number().int().optional().describe('Filter by collection ID'),
        docId: z.number().int().optional().describe('Filter by document ID'),
        exactMatch: z.boolean().optional().describe('Require exact match'),
        userid: z.number().int().optional().describe('Filter by user ID'),
        labelId: z.string().optional().describe('Filter by label ID'),
        uploaderId: z.number().int().optional().describe('Filter by uploader ID'),
        uploader: z.string().optional().describe('Filter by uploader name'),
        descr: z.string().optional().describe('Filter by description'),
        id: z.number().int().optional().describe('Filter by ID'),
        genre: z.string().optional().describe('Filter by genre'),
        language: z.string().optional().describe('Filter by language'),
        hierarchy: z.string().optional().describe('Filter by hierarchy'),
        authority: z.string().optional().describe('Filter by authority'),
        extId: z.string().optional().describe('Filter by external ID'),
        scriptType: z.string().optional().describe('Filter by script type'),
        createdfrom: z.number().optional().describe('Created from timestamp'),
        createdto: z.number().optional().describe('Created to timestamp'),
        ultimestamp: z.number().optional().describe('Last modified timestamp'),
        includeNulls: z.boolean().optional().describe('Include null values'),
        isDeleted: z.boolean().optional().default(false).describe('Include deleted documents'),
        caseSensitive: z.boolean().optional().default(false).describe('Case sensitive search'),
        pagingWrapper: z.boolean().optional().default(false).describe('Use paging wrapper'),
        ...PaginationParams,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('GET', '/collections/findDocuments', undefined, params))
  );

  // 6. POST /collections/findDocuments
  server.registerTool(
    'transkribus_coll_find_documents_post',
    {
      title: 'Find Documents (POST)',
      description: 'Search for documents across collections using a POST request body.',
      inputSchema: z.object({
        title: z.string().optional().describe('Filter by document title'),
        author: z.string().optional().describe('Filter by author'),
        collId: z.number().int().optional().describe('Filter by collection ID'),
        docId: z.number().int().optional().describe('Filter by document ID'),
        exactMatch: z.boolean().optional().describe('Require exact match'),
        ...PaginationParams,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('POST', '/collections/findDocuments', params))
  );

  // 7. GET /collections/findDocuments_old
  server.registerTool(
    'transkribus_coll_find_documents_old',
    {
      title: 'Find Documents (Legacy)',
      description: 'Search for documents using the legacy endpoint.',
      inputSchema: z.object({
        title: z.string().optional().describe('Filter by document title'),
        author: z.string().optional().describe('Filter by author'),
        collId: z.number().int().optional().describe('Filter by collection ID'),
        docId: z.number().int().optional().describe('Filter by document ID'),
        exactMatch: z.boolean().optional().describe('Require exact match'),
        descr: z.string().optional().describe('Filter by description'),
        writer: z.string().optional().describe('Filter by writer'),
        id: z.number().int().optional().describe('Filter by ID'),
        uploaderId: z.number().int().optional().describe('Filter by uploader ID'),
        caseSensitive: z.boolean().optional().default(false).describe('Case sensitive search'),
        ...PaginationParams,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('GET', '/collections/findDocuments_old', undefined, params))
  );

  // 8. POST /collections/iob
  server.registerTool(
    'transkribus_coll_create_iob_import',
    {
      title: 'IOB Import',
      description: 'Create documents from an IOB import.',
      inputSchema: z.object({
        collId: CollIdSchema.optional().describe('Target collection ID'),
        fileName: z.string().optional().describe('IOB file name'),
        id: z.number().int().optional().describe('Document ID'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('POST', '/collections/iob', params))
  );

  // 9. GET /collections/list
  server.registerTool(
    'transkribus_coll_list_paged',
    {
      title: 'List Collections (Paged)',
      description: 'List collections with pagination support.',
      inputSchema: z.object({
        ...PaginationParams,
        empty: z.boolean().optional().describe('Include empty collections (default false)'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('GET', '/collections/list', undefined, params))
  );

  // 10. GET /collections/list.xml
  server.registerTool(
    'transkribus_coll_list_xml',
    {
      title: 'List Collections (XML)',
      description: 'List all collections in XML format.',
      inputSchema: z.object({
        index: z.number().int().optional().default(0).describe('Start index'),
        nValues: z.number().int().optional().default(0).describe('Number of values'),
        sortColumn: z.string().optional().describe('Column to sort by'),
        sortDirection: z.string().optional().describe('Sort direction (asc/desc)'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('GET', '/collections/list.xml', undefined, params))
  );

  // 11. GET /collections/listByName
  server.registerTool(
    'transkribus_coll_list_by_name',
    {
      title: 'List Collections By Name',
      description: 'Search for collections by name.',
      inputSchema: z.object({
        name: z.string().describe('Collection name to search for'),
        exactMatch: z.boolean().optional().describe('Require exact name match'),
        ...PaginationParams,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('GET', '/collections/listByName', undefined, params))
  );

  // 12. GET /collections/recent/collections
  server.registerTool(
    'transkribus_coll_get_recent_collections',
    {
      title: 'Get Recent Collections',
      description: 'Get recently accessed collections.',
      inputSchema: z.object({
        ...PaginationParams,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('GET', '/collections/recent/collections', undefined, params))
  );

  // 13. GET /collections/recent/documents
  server.registerTool(
    'transkribus_coll_get_recent_documents',
    {
      title: 'Get Recent Documents',
      description: 'Get recently accessed documents.',
      inputSchema: z.object({
        ...PaginationParams,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('GET', '/collections/recent/documents', undefined, params))
  );

  // 14. DELETE /collections/{collId}
  server.registerTool(
    'transkribus_coll_delete',
    {
      title: 'Delete Collection',
      description: 'Delete a collection by ID.',
      inputSchema: z.object({
        collId: CollIdSchema,
        force: z.boolean().optional().describe('Force delete even if not empty (default false)'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, ...query } = params;
      return transkribusRequest('DELETE', `/collections/${collId}`, undefined, query);
    })
  );

  // 15. POST /collections/{collId}/addDocToCollection
  server.registerTool(
    'transkribus_coll_add_doc',
    {
      title: 'Add Document to Collection',
      description: 'Add an existing document to a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        docId: DocIdSchema,
        moveTo: z.boolean().optional().describe('Move instead of copy (default false)'),
        id: z.number().int().optional().describe('Document ID'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, ...body } = params;
      return transkribusRequest('POST', `/collections/${collId}/addDocToCollection`, body, { id });
    })
  );

  // 16. POST /collections/{collId}/addDocsToCollection
  server.registerTool(
    'transkribus_coll_add_docs',
    {
      title: 'Add Documents to Collection',
      description: 'Add multiple existing documents to a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        docIds: z.array(DocIdSchema).describe('Array of document IDs to add'),
        moveTo: z.boolean().optional().describe('Move instead of copy (default false)'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, ...body } = params;
      return transkribusRequest('POST', `/collections/${collId}/addDocsToCollection`, body);
    })
  );

  // 17. GET /collections/{collId}/canManage
  server.registerTool(
    'transkribus_coll_can_manage',
    {
      title: 'Can Manage Collection',
      description: 'Check if the current user can manage the specified collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('GET', `/collections/${params.collId}/canManage`))
  );

  // 18. GET /collections/{collId}/count
  server.registerTool(
    'transkribus_coll_count_docs',
    {
      title: 'Count Documents in Collection',
      description: 'Get the number of documents in a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        uploaderId: z.number().int().optional().describe('Filter by uploader ID'),
        labelId: z.string().optional().describe('Filter by label ID'),
        isDeleted: z.boolean().optional().default(false).describe('Include deleted documents'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, ...query } = params;
      return transkribusRequest('GET', `/collections/${collId}/count`, undefined, query);
    })
  );

  // 19. POST /collections/{collId}/createDocFromIiifUrl
  server.registerTool(
    'transkribus_coll_create_doc_from_iiif',
    {
      title: 'Create Document from IIIF URL',
      description: 'Create a document in a collection from an IIIF manifest URL.',
      inputSchema: z.object({
        collId: CollIdSchema,
        url: z.string().url().describe('IIIF manifest URL'),
        title: z.string().optional().describe('Document title'),
        fileName: z.string().optional().describe('File name for the document'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, fileName, ...body } = params;
      return transkribusRequest('POST', `/collections/${collId}/createDocFromIiifUrl`, body, { fileName });
    })
  );

  // 20. POST /collections/{collId}/createDocFromMets
  server.registerTool(
    'transkribus_coll_create_doc_from_mets',
    {
      title: 'Create Document from METS',
      description: 'Create a document in a collection from METS metadata.',
      inputSchema: z.object({
        collId: CollIdSchema,
        title: z.string().optional().describe('Document title'),
        fileName: z.string().optional().describe('METS file name'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, ...body } = params;
      return transkribusRequest('POST', `/collections/${collId}/createDocFromMets`, body);
    })
  );

  // 21. POST /collections/{collId}/createDocFromMetsUrl
  server.registerTool(
    'transkribus_coll_create_doc_from_mets_url',
    {
      title: 'Create Document from METS URL',
      description: 'Create a document in a collection from a METS URL.',
      inputSchema: z.object({
        collId: CollIdSchema,
        url: z.string().url().describe('METS URL'),
        title: z.string().optional().describe('Document title'),
        fileName: z.string().optional().describe('File name for the document'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, fileName, ...body } = params;
      return transkribusRequest('POST', `/collections/${collId}/createDocFromMetsUrl`, body, { fileName });
    })
  );

  // 22. POST /collections/{collId}/createDocFromPdf
  server.registerTool(
    'transkribus_coll_create_doc_from_pdf',
    {
      title: 'Create Document from PDF',
      description: 'Create a document in a collection from a PDF file.',
      inputSchema: z.object({
        collId: CollIdSchema,
        title: z.string().optional().describe('Document title'),
        fileName: z.string().optional().describe('PDF file name'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, ...body } = params;
      return transkribusRequest('POST', `/collections/${collId}/createDocFromPdf`, body);
    })
  );

  // 23. POST /collections/{collId}/deleteEmptyCollection
  server.registerTool(
    'transkribus_coll_delete_empty',
    {
      title: 'Delete Empty Collection',
      description: 'Delete a collection only if it is empty.',
      inputSchema: z.object({
        collId: CollIdSchema,
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('POST', `/collections/${params.collId}/deleteEmptyCollection`))
  );

  // 24. POST /collections/{collId}/duplicate
  server.registerTool(
    'transkribus_coll_duplicate',
    {
      title: 'Duplicate Collection',
      description: 'Duplicate an entire collection.',
      inputSchema: z.object({ collId: CollIdSchema }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) =>
      transkribusRequest('POST', `/collections/${params.collId}/duplicate`))
  );

  // 25. POST /collections/{collId}/{id}/duplicate
  server.registerTool(
    'transkribus_coll_duplicate_doc',
    {
      title: 'Duplicate Document',
      description: 'Duplicate a document within a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        docId: DocIdSchema,
        name: z.string().optional().describe('Name for the duplicated document'),
        targetCollId: z.number().int().optional().describe('Target collection ID for the copy'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    // GOTCHA: WADL path is /{collId}/{id}/duplicate — docId is a path param, not body.
    // Query param `collId` here means TARGET collection, not the source.
    handleToolRequest(async (params) => {
      const { collId, docId, name, targetCollId } = params;
      return transkribusRequest('POST', `/collections/${collId}/${docId}/duplicate`, undefined,
        { name, collId: targetCollId });
    })
  );

  // 25. POST /collections/{collId}/ead
  server.registerTool(
    'transkribus_coll_ead_metadata_import',
    {
      title: 'EAD Metadata Import',
      description: 'Import EAD metadata into a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        fileName: z.string().optional().describe('EAD file name'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, ...body } = params;
      return transkribusRequest('POST', `/collections/${collId}/ead`, body);
    })
  );

  // 26. POST /collections/{collId}/export
  server.registerTool(
    'transkribus_coll_export',
    {
      title: 'Export Collection',
      description: 'Export documents from a collection in the specified format.',
      inputSchema: z.object({
        collId: CollIdSchema,
        pages: z.string().optional().describe('Page range to export (e.g. "1-10")'),
        format: z.string().optional().describe('Export format (e.g. "pdf", "docx", "tei")'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, ...body } = params;
      return transkribusRequest('POST', `/collections/${collId}/export`, body);
    })
  );

  // 27. POST /collections/{collId}/ingest
  server.registerTool(
    'transkribus_coll_create_doc_from_ftp',
    {
      title: 'Create Document from FTP',
      description: 'Ingest a document into a collection from an FTP source.',
      inputSchema: z.object({
        collId: CollIdSchema,
        title: z.string().optional().describe('Document title'),
        fileName: z.string().optional().describe('File name on FTP'),
        checkForDuplicateTitle: z.boolean().optional().default(true).describe('Check for duplicate title'),
        doDeleteImportSource: z.boolean().optional().describe('Delete import source after ingest'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, checkForDuplicateTitle, doDeleteImportSource, ...body } = params;
      return transkribusRequest('POST', `/collections/${collId}/ingest`, body, { checkForDuplicateTitle, doDeleteImportSource });
    })
  );

  // 28. GET /collections/{collId}/list
  server.registerTool(
    'transkribus_coll_list_docs',
    {
      title: 'List Documents in Collection',
      description: 'List all documents in a collection with pagination.',
      inputSchema: z.object({
        collId: CollIdSchema,
        uploaderId: z.number().int().optional().describe('Filter by uploader ID'),
        uploader: z.string().optional().describe('Filter by uploader name'),
        labelId: z.string().optional().describe('Filter by label ID'),
        title: z.string().optional().describe('Filter by document title'),
        author: z.string().optional().describe('Filter by author'),
        writer: z.string().optional().describe('Filter by writer'),
        description: z.string().optional().describe('Filter by description'),
        genre: z.string().optional().describe('Filter by genre'),
        language: z.string().optional().describe('Filter by language'),
        hierarchy: z.string().optional().describe('Filter by hierarchy'),
        authority: z.string().optional().describe('Filter by authority'),
        extId: z.string().optional().describe('Filter by external ID'),
        scriptType: z.string().optional().describe('Filter by script type'),
        createdfrom: z.number().optional().describe('Created from timestamp'),
        createdto: z.number().optional().describe('Created to timestamp'),
        ultimestamp: z.number().optional().describe('Last modified timestamp'),
        includeNulls: z.boolean().optional().describe('Include null values'),
        isDeleted: z.string().optional().default('false').describe('Include deleted documents'),
        pagingWrapper: z.boolean().optional().default(false).describe('Use paging wrapper'),
        ...PaginationParams,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, ...query } = params;
      return transkribusRequest('GET', `/collections/${collId}/list`, undefined, query);
    })
  );

  // 29. GET /collections/{collId}/list.xml
  server.registerTool(
    'transkribus_coll_list_docs_xml',
    {
      title: 'List Documents in Collection (XML)',
      description: 'List all documents in a collection in XML format.',
      inputSchema: z.object({
        collId: CollIdSchema,
        index: z.number().int().optional().default(0).describe('Start index'),
        nValues: z.number().int().optional().default(0).describe('Number of values'),
        sortColumn: z.string().optional().describe('Column to sort by'),
        sortDirection: z.string().optional().describe('Sort direction (asc/desc)'),
        isDeleted: z.string().optional().default('false').describe('Include deleted documents'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, ...query } = params;
      return transkribusRequest('GET', `/collections/${collId}/list.xml`, undefined, query);
    })
  );

  // 30. GET /collections/{collId}/metadata
  server.registerTool(
    'transkribus_coll_get_metadata',
    {
      title: 'Get Collection Metadata',
      description: 'Get metadata for a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        stats: z.boolean().optional().default(false).describe('Include statistics'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, ...query } = params;
      return transkribusRequest('GET', `/collections/${collId}/metadata`, undefined, query);
    })
  );

  // 31. POST /collections/{collId}/metadata
  server.registerTool(
    'transkribus_coll_update_metadata',
    {
      title: 'Update Collection Metadata',
      description: 'Update the metadata for a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        title: z.string().optional().describe('Collection title'),
        description: z.string().optional().describe('Collection description'),
        language: z.string().optional().describe('Primary language'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, ...body } = params;
      return transkribusRequest('POST', `/collections/${collId}/metadata`, body);
    })
  );

  // 32. DELETE /collections/{collId}/metadata/favorite
  server.registerTool(
    'transkribus_coll_remove_favorite',
    {
      title: 'Remove Collection from Favorites',
      description: 'Remove a collection from the user favorites.',
      inputSchema: z.object({
        collId: CollIdSchema,
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('DELETE', `/collections/${params.collId}/metadata/favorite`))
  );

  // 33. POST /collections/{collId}/metadata/favorite
  server.registerTool(
    'transkribus_coll_add_favorite',
    {
      title: 'Add Collection to Favorites',
      description: 'Add a collection to the user favorites.',
      inputSchema: z.object({
        collId: CollIdSchema,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('POST', `/collections/${params.collId}/metadata/favorite`))
  );

  // 34. GET /collections/{collId}/recent
  server.registerTool(
    'transkribus_coll_get_recent',
    {
      title: 'Get Recent in Collection',
      description: 'Get recently accessed items in a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        ...PaginationParams,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, ...query } = params;
      return transkribusRequest('GET', `/collections/${collId}/recent`, undefined, query);
    })
  );

  // 35. POST /collections/{collId}/modifyCollection
  server.registerTool(
    'transkribus_coll_modify',
    {
      title: 'Modify Collection',
      description: 'Modify the properties of a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        collName: z.string().optional().describe('New collection name'),
        description: z.string().optional().describe('New description'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, ...body } = params;
      return transkribusRequest('POST', `/collections/${collId}/modifyCollection`, body);
    })
  );

  // 36. POST /collections/{collId}/upload
  server.registerTool(
    'transkribus_coll_upload_doc',
    {
      title: 'Upload Document',
      description: 'Upload a document to a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        title: z.string().optional().describe('Document title'),
        author: z.string().optional().describe('Document author'),
        description: z.string().optional().describe('Document description'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, ...body } = params;
      return transkribusRequest('POST', `/collections/${collId}/upload`, body);
    })
  );

  // 37. POST /collections/{collId}/uploadMultipart
  server.registerTool(
    'transkribus_coll_upload_doc_multipart',
    {
      title: 'Upload Document (Multipart)',
      description: 'Upload a document to a collection using multipart form data.',
      inputSchema: z.object({
        collId: CollIdSchema,
        title: z.string().optional().describe('Document title'),
        author: z.string().optional().describe('Document author'),
        description: z.string().optional().describe('Document description'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, ...body } = params;
      return transkribusRequest('POST', `/collections/${collId}/uploadMultipart`, body);
    })
  );

  // 38. GET /collections/{userid}/listCols
  server.registerTool(
    'transkribus_coll_list_for_user',
    {
      title: 'List Collections for User',
      description: 'List collections accessible to a specific user.',
      inputSchema: z.object({
        userid: z.number().int().positive().describe('User ID'),
        index: z.number().int().optional().default(0).describe('Start index'),
        nValues: z.number().int().optional().default(0).describe('Number of values'),
        sortColumn: z.string().optional().describe('Column to sort by'),
        sortDirection: z.string().optional().describe('Sort direction (asc/desc)'),
        excludeEmpty: z.boolean().optional().default(false).describe('Exclude empty collections'),
        role: z.string().optional().describe('Filter by user role'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { userid, ...query } = params;
      return transkribusRequest('GET', `/collections/${userid}/listCols`, undefined, query);
    })
  );

  // 39. POST /collections/{collId}/removeDocFromCollection
  server.registerTool(
    'transkribus_coll_remove_doc',
    {
      title: 'Remove Document from Collection',
      description: 'Remove a document from a collection without deleting it.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema.describe('Document ID to remove'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id } = params;
      return transkribusRequest('POST', `/collections/${collId}/removeDocFromCollection`, undefined, { id });
    })
  );
}
