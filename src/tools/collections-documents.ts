import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { transkribusRequest } from '../services/transkribus.js';
import { handleToolRequest } from '../helpers.js';
import { CollIdSchema, DocIdSchema, PageNrSchema, PaginationParams, intCoerce } from '../schemas/common.js';

/** How many pages one transkribus_doc_get_plaintext call will fetch. A clamp, not
 *  an error: the result reports nextStartPage so a long document is read in
 *  successive calls instead of failing. */
export const MAX_PAGES_PER_CALL = 100;
export const DEFAULT_MAX_CHARS = 100_000;
/** Parallel plaintext requests. Sequential is the 200-round-trip problem being
 *  fixed; unbounded fan-out just earns 429s. */
const PLAINTEXT_CONCURRENCY = 5;

/** Page numbers out of a fulldoc response: { md, pageList: { pages: [{ pageNr }] } }. */
export function extractPageNumbers(fulldoc: unknown): number[] {
  const pages = (fulldoc as { pageList?: { pages?: unknown } } | null)?.pageList?.pages;
  if (!Array.isArray(pages)) return [];
  const numbers = pages
    .map((page) => (page as { pageNr?: unknown } | null)?.pageNr)
    .filter((nr): nr is number => typeof nr === 'number' && Number.isFinite(nr));
  return [...new Set(numbers)].sort((a, b) => a - b);
}

/** The pages this call will fetch, plus the ones the page clamp left behind.
 *  Works on the document's OWN page numbers, so sparse or non-contiguous
 *  numbering needs no special case. */
export function selectPageRange(
  all: number[],
  startPage?: number,
  endPage?: number,
  maxPages: number = MAX_PAGES_PER_CALL
): { pages: number[]; omitted: number[] } {
  const eligible = all.filter(
    (nr) => (startPage === undefined || nr >= startPage) && (endPage === undefined || nr <= endPage)
  );
  return { pages: eligible.slice(0, maxPages), omitted: eligible.slice(maxPages) };
}

export interface PlaintextPageEntry {
  pageNr: number;
  text?: string;
  error?: string;
}

function renderPage(entry: PlaintextPageEntry): string {
  return `--- page ${entry.pageNr} ---\n${entry.error ? `[error: ${entry.error}]` : entry.text ?? ''}\n`;
}

/** Concatenate page texts under a character budget. The budget counts the
 *  separators and newlines too — it bounds what the CLIENT receives, not just the
 *  transcript bytes, and it holds with no exceptions: a caller that asked for at
 *  most N characters never gets more.
 *
 *  A single page too large to fit the whole budget is therefore reported as an
 *  error naming its size rather than blowing past the bound. Its replacement text
 *  is short and maxChars has a 1000 floor, so that entry always fits — which is
 *  what keeps nextStartPage able to make progress instead of pointing forever at
 *  a page that can never be returned. */
export function buildPlaintextDocument(
  entries: PlaintextPageEntry[],
  maxChars: number
): { text: string; used: PlaintextPageEntry[]; nextStartPage?: number } {
  const chunks: string[] = [];
  const used: PlaintextPageEntry[] = [];
  let length = 0;

  for (const entry of entries) {
    let effective = entry;
    if (renderPage(entry).length > maxChars) {
      const size = entry.text?.length ?? 0;
      effective = {
        pageNr: entry.pageNr,
        error: `page text is ${size} characters, above maxChars ${maxChars} — raise maxChars or read this page with transkribus_page_get_plaintext`,
      };
    }
    const chunk = renderPage(effective);
    if (length + chunk.length > maxChars) {
      return { text: chunks.join(''), used, nextStartPage: entry.pageNr };
    }
    chunks.push(chunk);
    used.push(effective);
    length += chunk.length;
  }

  return { text: chunks.join(''), used };
}

/** Run `task` over `items` with at most `limit` in flight, preserving input order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await task(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export interface DocPlaintextDeps {
  getFulldoc: () => Promise<unknown>;
  getPagePlaintext: (pageNr: number) => Promise<unknown>;
}

export async function fetchDocPlaintext(
  deps: DocPlaintextDeps,
  params: { collId: number; id: number; startPage?: number; endPage?: number; maxChars: number }
): Promise<Record<string, unknown>> {
  const allPages = extractPageNumbers(await deps.getFulldoc());
  const { pages, omitted } = selectPageRange(allPages, params.startPage, params.endPage);

  const entries = await mapWithConcurrency(pages, PLAINTEXT_CONCURRENCY, async (pageNr) => {
    try {
      const text = await deps.getPagePlaintext(pageNr);
      return { pageNr, text: typeof text === 'string' ? text : JSON.stringify(text) };
    } catch (err) {
      // One untranscribed or failing page must not cost the caller the other 99.
      return { pageNr, error: err instanceof Error ? err.message : String(err) };
    }
  });

  const { text, used, nextStartPage } = buildPlaintextDocument(entries, params.maxChars);
  // Either budget can stop the walk: the char budget names the page it stopped
  // before, the page clamp names the first page it never fetched.
  const next = nextStartPage ?? omitted[0];

  return {
    collId: params.collId,
    docId: params.id,
    startPage: used[0]?.pageNr ?? null,
    endPage: used[used.length - 1]?.pageNr ?? null,
    pageCount: used.length,
    charCount: text.length,
    truncated: next !== undefined,
    ...(next !== undefined ? { nextStartPage: next } : {}),
    pages: used.map(({ pageNr, text: pageText, error }) => ({
      pageNr,
      chars: pageText?.length ?? 0,
      ...(error ? { error } : {}),
    })),
    text,
  };
}

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
        body: z.record(z.string(), z.unknown()).optional().describe('Editorial declaration data'),
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

  // 9. Whole-document plaintext: fulldoc for the page list, then one plaintext
  //    request per page (no single REST endpoint returns a whole document's text).
  server.registerTool(
    'transkribus_doc_get_plaintext',
    {
      title: 'Get Document Plaintext',
      description:
        'Get the transcribed text of a whole document in one call, with "--- page N ---" separators. ' +
        `Fetches at most ${MAX_PAGES_PER_CALL} pages and ${DEFAULT_MAX_CHARS} characters per call; when more remain, the result carries nextStartPage.`,
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
        startPage: PageNrSchema.optional().describe('First page to include (default: the document\'s first page)'),
        endPage: PageNrSchema.optional().describe('Last page to include, inclusive (default: the document\'s last page)'),
        maxChars: intCoerce(z.number().int().min(1_000).max(1_000_000)).optional()
          .describe(`Character budget for the returned text, separators included (default ${DEFAULT_MAX_CHARS})`),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) =>
      fetchDocPlaintext(
        {
          getFulldoc: () =>
            transkribusRequest('GET', `/collections/${params.collId}/${params.id}/fulldoc`, undefined, {
              nrOfTranscripts: 0,
              stats: false,
            }),
          getPagePlaintext: (pageNr) =>
            transkribusRequest('GET', `/collections/${params.collId}/${params.id}/${pageNr}/plaintext`),
        },
        {
          collId: params.collId,
          id: params.id,
          startPage: params.startPage,
          endPage: params.endPage,
          maxChars: params.maxChars ?? DEFAULT_MAX_CHARS,
        }
      )
    )
  );

  // 10. GET /collections/{collId}/{id}/fulldoc
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

  // 11. GET /collections/{collId}/{id}/fulldoc.xml
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

  // 12. GET /collections/{collId}/{id}/hasAffiliation
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

  // 13. GET /collections/{collId}/{id}/imageNames
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
  // 14. POST /collections/{collId}/{id}/kwsSearch
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

  // 15. GET /collections/{collId}/{id}/list
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

  // 16. GET /collections/{collId}/{id}/metadata
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

  // 17. POST /collections/{collId}/{id}/metadata
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

  // 18. GET /collections/{collId}/{id}/mets
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

  // 19. GET /collections/{collId}/{id}/pageIds
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

  // 20. GET /collections/{collId}/{id}/pages
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

  // 21. DELETE /collections/{collId}/{id}/remove
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

  // 22. GET /collections/{collId}/{id}/stats
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

  // 23. GET /collections/{collId}/{id}/testSet
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

  // 24. GET /collections/{collId}/{id}/trainData
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

  // 25. GET /collections/{collId}/{id}/transcriptIds
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
  // 26. POST /collections/{collId}/{id}/updateTranscript
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

  // 27. GET /collections/{collId}/{id}/validationData
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

  // 28. POST /collections/{collId}/{id}/imageNames
  server.registerTool(
    'transkribus_doc_move_pages_by_image_names',
    {
      title: 'Move Pages by Image Names',
      description: 'Move pages within a document based on image names.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
        body: z.record(z.string(), z.unknown()).describe('Image name mapping data'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, body } = params;
      return transkribusRequest('POST', `/collections/${collId}/${id}/imageNames`, body);
    })
  );

  // 29. POST /collections/{collId}/{id}/list
  server.registerTool(
    'transkribus_doc_update_metadata_v2',
    {
      title: 'Update Document Metadata v2',
      description: 'Update document metadata using the v2 endpoint.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: DocIdSchema,
        body: z.record(z.string(), z.unknown()).describe('Document metadata v2 data'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, body } = params;
      return transkribusRequest('POST', `/collections/${collId}/${id}/list`, body);
    })
  );
}
