import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { transkribusRequest } from '../services/transkribus.js';
import { handleToolRequest } from '../helpers.js';
import { CollIdSchema } from '../schemas/common.js';

export function registerSearchTools(server: McpServer): void {
  // 1. GET /search/fulltext
  server.registerTool(
    'transkribus_search_fulltext',
    {
      title: 'Fulltext Search',
      description: 'Search across document transcriptions using a fulltext query.',
      inputSchema: z.object({
        query: z.string().describe('Fulltext search query'),
        collId: z.number().int().optional().describe('Limit search to a specific collection ID'),
        type: z.string().optional().describe('Filter by document type'),
        start: z.number().int().optional().describe('Start offset (default 0)'),
        rows: z.number().int().optional().describe('Number of results (default 10)'),
        filter: z.string().optional().describe('Filter string'),
        legacy: z.boolean().optional().describe('Use legacy search'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('GET', '/search/fulltext', undefined, params))
  );

  // 2. GET /search/keyword
  server.registerTool(
    'transkribus_search_keyword',
    {
      title: 'Keyword Search',
      description: 'Search for documents matching a keyword.',
      inputSchema: z.object({
        query: z.string().describe('Keyword search query'),
        collId: z.number().int().optional().describe('Limit search to a specific collection ID'),
        start: z.number().int().optional().describe('Start offset'),
        rows: z.number().int().optional().describe('Number of results'),
        probL: z.number().optional().describe('Lower probability threshold'),
        probH: z.number().optional().describe('Upper probability threshold'),
        filter: z.string().optional().describe('Filter string'),
        fuzzy: z.number().int().optional().describe('Fuzzy matching level'),
        sorting: z.string().optional().describe('Sorting mode'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('GET', '/search/keyword', undefined, params))
  );

  // 3. POST /search/replace
  server.registerTool(
    'transkribus_search_replace',
    {
      title: 'Search and Replace',
      description: 'Search for a term and replace it across documents.',
      inputSchema: z.object({
        searchTerm: z.string().describe('Term to search for'),
        replaceTerm: z.string().describe('Replacement term'),
        collId: z.number().int().optional().describe('Limit to a specific collection ID'),
        docId: z.number().int().optional().describe('Limit to a specific document ID'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('POST', '/search/replace', params))
  );

  // 4. POST /search/resetIndex
  server.registerTool(
    'transkribus_search_reset_index',
    {
      title: 'Reset Search Index',
      description: 'Reset the search index, optionally for a specific collection.',
      inputSchema: z.object({
        collId: z.number().int().optional().describe('Collection ID to reset index for'),
        id: z.number().int().optional().describe('Document ID'),
        pageId: z.number().int().optional().describe('Page ID'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('POST', '/search/resetIndex', undefined, params))
  );

  // 5. GET /search/tags
  server.registerTool(
    'transkribus_search_tags',
    {
      title: 'Search Tags',
      description: 'Search for tags, optionally filtered by collection or tag name.',
      inputSchema: z.object({
        collId: z.number().int().optional().describe('Limit search to a specific collection ID'),
        tagName: z.string().optional().describe('Filter by tag name'),
        id: z.string().optional().describe('Document ID'),
        pageId: z.string().optional().describe('Page ID'),
        tagValue: z.string().optional().describe('Filter by tag value'),
        regionType: z.string().optional().describe('Region type (default "Line")'),
        exactMatch: z.boolean().optional().describe('Require exact match (default true)'),
        caseSensitive: z.boolean().optional().describe('Case sensitive search (default false)'),
        attributes: z.string().optional().describe('Attributes filter'),
        legacy: z.boolean().optional().describe('Use legacy search (default false)'),
        start: z.number().int().optional().describe('Start offset (default 0)'),
        rows: z.number().int().optional().describe('Number of results (default 20000)'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('GET', '/search/tags', undefined, params))
  );

  // 6. POST /search/{collId}/searchReplace
  server.registerTool(
    'transkribus_search_replace_in_collection',
    {
      title: 'Search and Replace in Collection',
      description: 'Search for a term and replace it within a specific collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        searchTerm: z.string().describe('Term to search for'),
        replaceTerm: z.string().describe('Replacement term'),
        docId: z.number().int().optional().describe('Limit to a specific document ID'),
        query: z.string().optional().describe('Search query'),
        type: z.string().optional().describe('Search type'),
        start: z.number().int().optional().default(0).describe('Start offset'),
        rows: z.number().int().optional().default(10).describe('Number of results'),
        filter: z.string().optional().describe('Filter string'),
        legacy: z.boolean().optional().default(false).describe('Use legacy search'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, query, type, start, rows, filter, legacy, ...body } = params;
      return transkribusRequest('POST', `/search/${collId}/searchReplace`, body, { query, type, start, rows, filter, legacy });
    })
  );
}
