import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { transkribusRequest } from '../services/transkribus.js';
import { handleToolRequest } from '../helpers.js';
import { CollIdSchema, ModelIdSchema, IdSchema, PaginationParams } from '../schemas/common.js';

export function registerModelTools(server: McpServer): void {
  // 1. POST /models/
  server.registerTool(
    'transkribus_model_update',
    {
      title: 'Update Model',
      description: 'Update a model by posting updated model data.',
      inputSchema: z.object({
        body: z.record(z.unknown()).describe('Model data to update'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { body } = params;
      return transkribusRequest('POST', '/models/', body);
    })
  );

  // 2. GET /models/list
  server.registerTool(
    'transkribus_model_list',
    {
      title: 'List Models',
      description: 'List available models with optional pagination and filtering.',
      inputSchema: z.object({
        ...PaginationParams,
        userid: z.number().int().optional().describe('Filter by user ID'),
        type: z.string().optional().describe('Filter by model type'),
        prov: z.string().optional().describe('Filter by model provider'),
        collId: z.number().int().optional().describe('Filter by collection ID'),
        filter: z.string().optional().describe('Filter string'),
        releaseLevel: z.number().int().optional().describe('Filter by release level'),
        onlyActive: z.boolean().optional().describe('Only return active models (default true)'),
        all: z.boolean().optional().describe('Return all models including inactive (default false)'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      return transkribusRequest('GET', '/models/list', undefined, params);
    })
  );

  // 3. GET /models/{modelId}
  server.registerTool(
    'transkribus_model_get',
    {
      title: 'Get Model',
      description: 'Get details of a model by its ID.',
      inputSchema: z.object({
        modelId: ModelIdSchema,
        collId: z.number().int().optional().describe('Filter by collection ID'),
        userid: z.number().int().optional().describe('Filter by user ID'),
        filter: z.string().optional().describe('Filter string'),
        releaseLevel: z.number().int().optional().describe('Filter by release level'),
        prov: z.string().optional().describe('Filter by provider'),
        centuries: z.string().optional().describe('Filter by centuries'),
        isoLanguages: z.string().optional().describe('Filter by ISO languages'),
        scriptTypes: z.string().optional().describe('Filter by script types'),
        creator: z.string().optional().describe('Filter by creator'),
        publisher: z.string().optional().describe('Filter by publisher'),
        docType: z.string().optional().describe('Filter by document type'),
        featured: z.boolean().optional().describe('Filter featured models'),
        application: z.string().optional().describe('Filter by application'),
        slug: z.string().optional().describe('Filter by slug'),
        labels: z.string().optional().describe('Filter by labels'),
        facetLimit: z.number().int().optional().default(10).describe('Facet limit'),
        minFacetCount: z.number().int().optional().default(2).describe('Minimum facet count'),
        index: z.number().int().optional().default(0).describe('Start index'),
        nValues: z.number().int().optional().default(-1).describe('Number of values'),
        sortColumn: z.string().optional().describe('Column to sort by'),
        sortDirection: z.string().optional().describe('Sort direction (asc/desc)'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { modelId, ...query } = params;
      return transkribusRequest('GET', `/models/${modelId}`, undefined, query);
    })
  );

  // 4. DELETE /models/{modelId}
  server.registerTool(
    'transkribus_model_delete',
    {
      title: 'Delete Model',
      description: 'Delete a model by its ID.',
      inputSchema: z.object({
        modelId: ModelIdSchema,
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { modelId } = params;
      return transkribusRequest('DELETE', `/models/${modelId}`);
    })
  );

  // 5. GET /models/{modelId}/collections/list
  server.registerTool(
    'transkribus_model_list_collections_by_id',
    {
      title: 'List Model Collections by ID',
      description: 'List collections associated with a model by its ID.',
      inputSchema: z.object({
        modelId: ModelIdSchema,
        transcriptIds: z.boolean().optional().default(false).describe('Include transcript IDs'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { modelId, ...query } = params;
      return transkribusRequest('GET', `/models/${modelId}/collections/list`, undefined, query);
    })
  );

  // 6. POST /models/{modelId}/collections/{collId}
  server.registerTool(
    'transkribus_model_add_collection_by_id',
    {
      title: 'Add Collection to Model by ID',
      description: 'Add a collection to a model by model ID and collection ID.',
      inputSchema: z.object({
        modelId: ModelIdSchema,
        collId: CollIdSchema,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { modelId, collId } = params;
      return transkribusRequest('POST', `/models/${modelId}/collections/${collId}`);
    })
  );

  // 7. DELETE /models/{modelId}/collections/{collId}
  server.registerTool(
    'transkribus_model_remove_collection_by_id',
    {
      title: 'Remove Collection from Model by ID',
      description: 'Remove a collection from a model by model ID and collection ID.',
      inputSchema: z.object({
        modelId: ModelIdSchema,
        collId: CollIdSchema,
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { modelId, collId } = params;
      return transkribusRequest('DELETE', `/models/${modelId}/collections/${collId}`);
    })
  );

  // 8. GET /models/{type}
  server.registerTool(
    'transkribus_model_get_by_type',
    {
      title: 'Get Models by Type',
      description: 'Get models filtered by type with optional query parameters.',
      inputSchema: z.object({
        type: z.string().describe('Model type (e.g. htr, la, ocr)'),
        collId: z.number().int().optional().describe('Filter by collection ID'),
        userid: z.number().int().optional().describe('Filter by user ID'),
        filter: z.string().optional().describe('Filter string'),
        releaseLevel: z.number().int().optional().describe('Filter by release level'),
        prov: z.string().optional().describe('Filter by provider'),
        centuries: z.string().optional().describe('Filter by centuries'),
        isoLanguages: z.string().optional().describe('Filter by ISO languages'),
        scriptTypes: z.string().optional().describe('Filter by script types'),
        creator: z.string().optional().describe('Filter by creator'),
        publisher: z.string().optional().describe('Filter by publisher'),
        docType: z.string().optional().describe('Filter by document type'),
        featured: z.boolean().optional().describe('Filter featured models'),
        application: z.string().optional().describe('Filter by application'),
        slug: z.string().optional().describe('Filter by slug'),
        labels: z.string().optional().describe('Filter by labels'),
        facetLimit: z.number().int().optional().default(10).describe('Facet limit'),
        minFacetCount: z.number().int().optional().default(2).describe('Minimum facet count'),
        ...PaginationParams,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { type, ...rest } = params;
      return transkribusRequest('GET', `/models/${type}`, undefined, rest);
    })
  );

  // 9. GET /models/{type}/{id}
  server.registerTool(
    'transkribus_model_get_details',
    {
      title: 'Get Model Details',
      description: 'Get detailed information about a model by type and ID.',
      inputSchema: z.object({
        type: z.string().describe('Model type (e.g. htr, la, ocr)'),
        id: IdSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { type, id } = params;
      return transkribusRequest('GET', `/models/${type}/${id}`);
    })
  );

  // 10. POST /models/{type}/{id}
  server.registerTool(
    'transkribus_model_update_by_type',
    {
      title: 'Update Model by Type',
      description: 'Update a model by its type and ID.',
      inputSchema: z.object({
        type: z.string().describe('Model type (e.g. htr, la, ocr)'),
        id: IdSchema,
        body: z.record(z.unknown()).describe('Model update data'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { type, id, body } = params;
      return transkribusRequest('POST', `/models/${type}/${id}`, body);
    })
  );

  // 11. DELETE /models/{type}/{id}
  server.registerTool(
    'transkribus_model_delete_by_type',
    {
      title: 'Delete Model by Type',
      description: 'Delete a model by its type and ID.',
      inputSchema: z.object({
        type: z.string().describe('Model type (e.g. htr, la, ocr)'),
        id: IdSchema,
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { type, id } = params;
      return transkribusRequest('DELETE', `/models/${type}/${id}`);
    })
  );

  // 12. GET /models/{type}/{id}/collections
  server.registerTool(
    'transkribus_model_list_collections',
    {
      title: 'List Model Collections',
      description: 'List collections associated with a model by type and ID.',
      inputSchema: z.object({
        type: z.string().describe('Model type (e.g. htr, la, ocr)'),
        id: IdSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { type, id } = params;
      return transkribusRequest('GET', `/models/${type}/${id}/collections`);
    })
  );

  // 13. GET /models/{type}/{id}/fieldParams
  server.registerTool(
    'transkribus_model_get_field_params',
    {
      title: 'Get Model Field Parameters',
      description: 'Get the field parameters for a model by type and ID.',
      inputSchema: z.object({
        type: z.string().describe('Model type (e.g. htr, la, ocr)'),
        id: IdSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { type, id } = params;
      return transkribusRequest('GET', `/models/${type}/${id}/fieldParams`);
    })
  );

  // 14. GET /models/{type}/{id}/trainData
  server.registerTool(
    'transkribus_model_get_train_data',
    {
      title: 'Get Model Training Data',
      description: 'Get the training data for a model by type and ID.',
      inputSchema: z.object({
        type: z.string().describe('Model type (e.g. htr, la, ocr)'),
        id: IdSchema,
        index: z.number().int().optional().describe('Start index (0-based)'),
        nValues: z.number().int().optional().describe('Number of values to return'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { type, id, ...query } = params;
      return transkribusRequest('GET', `/models/${type}/${id}/trainData`, undefined, query);
    })
  );

  // 15. GET /models/{type}/{id}/trainData/docs
  server.registerTool(
    'transkribus_model_get_train_data_docs',
    {
      title: 'Get Training Data Documents',
      description: 'Get the documents used as training data for a model.',
      inputSchema: z.object({
        type: z.string().describe('Model type (e.g. htr, la, ocr)'),
        id: IdSchema,
        index: z.number().int().optional().default(0).describe('Start index'),
        nValues: z.number().int().optional().default(-1).describe('Number of values'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { type, id, ...query } = params;
      return transkribusRequest('GET', `/models/${type}/${id}/trainData/docs`, undefined, query);
    })
  );

  // 16. GET /models/{type}/{id}/trainData/stats
  server.registerTool(
    'transkribus_model_get_train_data_stats',
    {
      title: 'Get Training Data Statistics',
      description: 'Get statistics about the training data for a model.',
      inputSchema: z.object({
        type: z.string().describe('Model type (e.g. htr, la, ocr)'),
        id: IdSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { type, id } = params;
      return transkribusRequest('GET', `/models/${type}/${id}/trainData/stats`);
    })
  );

  // 17. GET /models/{type}/{id}/validationData
  server.registerTool(
    'transkribus_model_get_validation_data',
    {
      title: 'Get Validation Data',
      description: 'Get the validation data for a model by type and ID.',
      inputSchema: z.object({
        type: z.string().describe('Model type (e.g. htr, la, ocr)'),
        id: IdSchema,
        index: z.number().int().optional().default(0).describe('Start index'),
        nValues: z.number().int().optional().default(-1).describe('Number of values'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { type, id, ...query } = params;
      return transkribusRequest('GET', `/models/${type}/${id}/validationData`, undefined, query);
    })
  );

  // 18. GET /models/{type}/{id}/validationData/docs
  server.registerTool(
    'transkribus_model_get_validation_data_docs',
    {
      title: 'Get Validation Data Documents',
      description: 'Get the documents used as validation data for a model.',
      inputSchema: z.object({
        type: z.string().describe('Model type (e.g. htr, la, ocr)'),
        id: IdSchema,
        index: z.number().int().optional().default(0).describe('Start index'),
        nValues: z.number().int().optional().default(-1).describe('Number of values'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { type, id, ...query } = params;
      return transkribusRequest('GET', `/models/${type}/${id}/validationData/docs`, undefined, query);
    })
  );

  // 19. GET /models/{type}/{id}/validationData/stats
  server.registerTool(
    'transkribus_model_get_validation_data_stats',
    {
      title: 'Get Validation Data Statistics',
      description: 'Get statistics about the validation data for a model.',
      inputSchema: z.object({
        type: z.string().describe('Model type (e.g. htr, la, ocr)'),
        id: IdSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { type, id } = params;
      return transkribusRequest('GET', `/models/${type}/${id}/validationData/stats`);
    })
  );

  // 20. POST /models/{type}/{modelId}/collections
  server.registerTool(
    'transkribus_model_add_collection',
    {
      title: 'Add Collection to Model',
      description: 'Add a collection to a model by type and model ID.',
      inputSchema: z.object({
        type: z.string().describe('Model type (e.g. htr, la, ocr)'),
        modelId: ModelIdSchema,
        collId: CollIdSchema.describe('Collection ID to add'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { type, modelId, collId } = params;
      return transkribusRequest('POST', `/models/${type}/${modelId}/collections`, { collId });
    })
  );

  // 21. DELETE /models/{type}/{modelId}/collections/{collId}
  server.registerTool(
    'transkribus_model_remove_collection',
    {
      title: 'Remove Collection from Model',
      description: 'Remove a collection from a model by type, model ID, and collection ID.',
      inputSchema: z.object({
        type: z.string().describe('Model type (e.g. htr, la, ocr)'),
        modelId: ModelIdSchema,
        collId: CollIdSchema,
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { type, modelId, collId } = params;
      return transkribusRequest('DELETE', `/models/${type}/${modelId}/collections/${collId}`);
    })
  );
}
