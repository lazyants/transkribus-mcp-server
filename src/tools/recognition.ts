import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { transkribusRequest } from '../services/transkribus.js';
import { handleToolRequest } from '../helpers.js';
import { CollIdSchema, DocIdSchema, PageNrSchema, ModelIdSchema, IdSchema, PaginationParams } from '../schemas/common.js';

export function registerRecognitionTools(server: McpServer): void {
  // 1. GET /recognition/atr
  server.registerTool(
    'transkribus_recog_get_atr',
    {
      title: 'Get ATR Info',
      description: 'Retrieve information about available ATR (Automatic Text Recognition) models.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async () => {
      return transkribusRequest('GET', '/recognition/atr');
    })
  );

  // 2. POST /recognition/atr
  server.registerTool(
    'transkribus_recog_run_atr',
    {
      title: 'Run ATR',
      description: 'Run Automatic Text Recognition on a document or specific pages.',
      inputSchema: z.object({
        collId: CollIdSchema,
        docId: DocIdSchema,
        pageNr: PageNrSchema.optional(),
        modelId: ModelIdSchema.optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, docId, pageNr, modelId } = params;
      return transkribusRequest('POST', '/recognition/atr', { collId, docId, pageNr, modelId });
    })
  );

  // 3. POST /recognition/computeSample
  server.registerTool(
    'transkribus_recog_compute_sample',
    {
      title: 'Compute Sample',
      description: 'Compute a recognition sample for a document in a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        docId: DocIdSchema,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, docId } = params;
      return transkribusRequest('POST', '/recognition/computeSample', { collId, docId });
    })
  );

  // 4. GET /recognition/computeWER
  server.registerTool(
    'transkribus_recog_compute_wer',
    {
      title: 'Compute WER',
      description: 'Compute the Word Error Rate for a document.',
      // GOTCHA: WADL only lists ref+key as query params; collId/docId/pages/hyp may be undocumented but functional.
      inputSchema: z.object({
        collId: CollIdSchema,
        docId: DocIdSchema,
        pages: z.string().optional().describe('Page range (e.g. "1-5")'),
        ref: z.string().optional().describe('Reference transcript identifier'),
        hyp: z.string().optional().describe('Hypothesis transcript identifier'),
        key: z.string().optional().describe('Transcript key'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, docId, ...rest } = params;
      return transkribusRequest('GET', '/recognition/computeWER', undefined, { collId, docId, ...rest });
    })
  );

  // 5. GET /recognition/computeWERTasas
  server.registerTool(
    'transkribus_recog_compute_wer_tasas',
    {
      title: 'Compute WER (TASAS)',
      description: 'Compute the Word Error Rate using TASAS method for a document.',
      // GOTCHA: WADL only lists ref+key as query params; collId/docId/pages/hyp may be undocumented but functional.
      inputSchema: z.object({
        collId: CollIdSchema,
        docId: DocIdSchema,
        pages: z.string().optional().describe('Page range (e.g. "1-5")'),
        ref: z.string().optional().describe('Reference transcript identifier'),
        hyp: z.string().optional().describe('Hypothesis transcript identifier'),
        key: z.string().optional().describe('Transcript key'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, docId, ...rest } = params;
      return transkribusRequest('GET', '/recognition/computeWERTasas', undefined, { collId, docId, ...rest });
    })
  );

  // 6. GET /recognition/dicts
  server.registerTool(
    'transkribus_recog_list_dicts',
    {
      title: 'List Dictionaries',
      description: 'List available dictionaries for recognition.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async () => {
      return transkribusRequest('GET', '/recognition/dicts');
    })
  );

  // 7. GET /recognition/errorRate
  server.registerTool(
    'transkribus_recog_get_error_rate',
    {
      title: 'Get Error Rate',
      description: 'Get the error rate for a collection or model.',
      inputSchema: z.object({
        collId: CollIdSchema.optional(),
        modelId: ModelIdSchema.optional(),
        ref: z.string().optional().describe('Reference identifier'),
        key: z.string().optional().describe('Key identifier'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      return transkribusRequest('GET', '/recognition/errorRate', undefined, params);
    })
  );

  // 8. POST /recognition/errorRate
  server.registerTool(
    'transkribus_recog_compute_error_rate',
    {
      title: 'Compute Error Rate',
      description: 'Compute the error rate for a model in a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        modelId: ModelIdSchema,
        body: z.record(z.unknown()).optional().describe('Additional error rate computation parameters'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, modelId, body } = params;
      return transkribusRequest('POST', '/recognition/errorRate', { collId, modelId, ...body });
    })
  );

  // 9. POST /recognition/htrTrainingCITlab
  server.registerTool(
    'transkribus_recog_train_htr_citlab',
    {
      title: 'Train HTR (CITlab)',
      description: 'Start CITlab HTR model training for a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        config: z.record(z.unknown()).describe('Training configuration parameters'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, config } = params;
      return transkribusRequest('POST', '/recognition/htrTrainingCITlab', { collId, ...config });
    })
  );

  // 10. POST /recognition/la2Training
  server.registerTool(
    'transkribus_recog_train_la2',
    {
      title: 'Train Layout Analysis 2',
      description: 'Start Layout Analysis 2 model training for a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        config: z.record(z.unknown()).describe('Training configuration parameters'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, config } = params;
      return transkribusRequest('POST', '/recognition/la2Training', { collId, ...config });
    })
  );

  // 11. POST /recognition/laTrainingCITlab
  server.registerTool(
    'transkribus_recog_train_la_citlab',
    {
      title: 'Train Layout Analysis (CITlab)',
      description: 'Start CITlab Layout Analysis model training for a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        config: z.record(z.unknown()).describe('Training configuration parameters'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, config } = params;
      return transkribusRequest('POST', '/recognition/laTrainingCITlab', { collId, ...config });
    })
  );

  // 12. GET /recognition/list
  server.registerTool(
    'transkribus_recog_list_models',
    {
      title: 'List Recognition Models',
      description: 'List available recognition models with optional filtering.',
      inputSchema: z.object({
        ...PaginationParams,
        provider: z.string().optional().describe('Filter by model provider'),
        collId: z.number().int().optional().describe('Filter by collection ID'),
        prov: z.string().optional().describe('Filter by provider (alternative)'),
        filter: z.string().optional().describe('Filter string'),
        releaseLevel: z.number().int().optional().describe('Filter by release level'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      return transkribusRequest('GET', '/recognition/list', undefined, params);
    })
  );

  // 13. POST /recognition/ocr
  server.registerTool(
    'transkribus_recog_run_ocr',
    {
      title: 'Run OCR',
      description: 'Run OCR on a document or specific pages in a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        docId: DocIdSchema,
        pages: z.string().optional().describe('Page range (e.g. "1-5")'),
        typeFace: z.string().optional().describe('Type face for OCR'),
        language: z.string().optional().describe('Language for OCR'),
        doBlockSegOnly: z.boolean().optional().describe('Only do block segmentation (default false)'),
        ocrType: z.string().optional().describe('OCR type (default "Legacy")'),
        id: z.number().int().optional().describe('Model ID'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, docId, pages, typeFace, language, doBlockSegOnly, ocrType, id } = params;
      return transkribusRequest('POST', '/recognition/ocr', { collId, docId, pages, typeFace, language, doBlockSegOnly, type: ocrType, id });
    })
  );

  // 14. GET /recognition/ocr/costs
  server.registerTool(
    'transkribus_recog_get_ocr_costs',
    {
      title: 'Get OCR Costs',
      description: 'Get the estimated OCR costs for a document.',
      inputSchema: z.object({
        collId: CollIdSchema,
        docId: DocIdSchema,
        nrOfPages: z.number().int().optional().describe('Number of pages'),
        id: z.number().int().optional().describe('Model ID'),
        pages: z.string().optional().describe('Page range'),
        doBlockSegOnly: z.boolean().optional().default(false).describe('Only do block segmentation'),
        type: z.string().optional().default('Legacy').describe('OCR type'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      return transkribusRequest('GET', '/recognition/ocr/costs', undefined, params);
    })
  );

  // 15. POST /recognition/t2iCITlab
  server.registerTool(
    'transkribus_recog_text2image_citlab',
    {
      title: 'Text2Image (CITlab)',
      description: 'Run CITlab Text2Image alignment for a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        body: z.record(z.unknown()).describe('Text2Image configuration parameters'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, body } = params;
      return transkribusRequest('POST', '/recognition/t2iCITlab', { collId, ...body });
    })
  );

  // 16. POST /recognition/tableTraining
  server.registerTool(
    'transkribus_recog_train_table',
    {
      title: 'Train Table Recognition',
      description: 'Start table recognition model training for a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        config: z.record(z.unknown()).describe('Training configuration parameters'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, config } = params;
      return transkribusRequest('POST', '/recognition/tableTraining', { collId, ...config });
    })
  );

  // 17. GET /recognition/{collId}/list
  server.registerTool(
    'transkribus_recog_list_by_collection',
    {
      title: 'List Models by Collection',
      description: 'List recognition models available in a specific collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        ...PaginationParams,
        prov: z.string().optional().describe('Filter by provider'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, ...rest } = params;
      return transkribusRequest('GET', `/recognition/${collId}/list`, undefined, rest);
    })
  );

  // 18. DELETE /recognition/{collId}/{id}
  server.registerTool(
    'transkribus_recog_delete',
    {
      title: 'Delete Recognition Model',
      description: 'Delete a recognition model from a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: IdSchema,
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id } = params;
      return transkribusRequest('DELETE', `/recognition/${collId}/${id}`);
    })
  );

  // 19. GET /recognition/{collId}/{id}
  server.registerTool(
    'transkribus_recog_get',
    {
      title: 'Get Recognition Model',
      description: 'Get details of a recognition model in a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: IdSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id } = params;
      return transkribusRequest('GET', `/recognition/${collId}/${id}`);
    })
  );

  // 20. POST /recognition/{collId}/{id}
  server.registerTool(
    'transkribus_recog_update',
    {
      title: 'Update Recognition Model',
      description: 'Update a recognition model in a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: IdSchema,
        body: z.record(z.unknown()).describe('Model update data'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, body } = params;
      return transkribusRequest('POST', `/recognition/${collId}/${id}`, body);
    })
  );

  // 21. POST /recognition/{collId}/{id}/add
  server.registerTool(
    'transkribus_recog_add_to_collection',
    {
      title: 'Add Model to Collection',
      description: 'Add a recognition model to another collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: IdSchema,
        targetCollId: CollIdSchema.describe('Target collection ID to add the model to'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, targetCollId } = params;
      return transkribusRequest('POST', `/recognition/${collId}/${id}/add`, { targetCollId });
    })
  );

  // 22. GET /recognition/{collId}/{id}/collections/list
  server.registerTool(
    'transkribus_recog_list_collections',
    {
      title: 'List Model Collections',
      description: 'List collections that have access to a recognition model.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: IdSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id } = params;
      return transkribusRequest('GET', `/recognition/${collId}/${id}/collections/list`);
    })
  );

  // 23. GET /recognition/{collId}/{id}/costs
  server.registerTool(
    'transkribus_recog_get_costs',
    {
      title: 'Get Model Costs',
      description: 'Get the cost information for a recognition model.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: IdSchema,
        nrOfPages: z.number().int().optional().describe('Number of pages'),
        writeKwsIndex: z.boolean().optional().default(false).describe('Write KWS index'),
        credits: z.string().optional().default('AUTO').describe('Credits parameter'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, ...query } = params;
      return transkribusRequest('GET', `/recognition/${collId}/${id}/costs`, undefined, query);
    })
  );

  // 24. DELETE /recognition/{collId}/{id}/remove
  server.registerTool(
    'transkribus_recog_remove_from_collection',
    {
      title: 'Remove Model from Collection',
      description: 'Remove a recognition model from a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: IdSchema,
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id } = params;
      return transkribusRequest('DELETE', `/recognition/${collId}/${id}/remove`);
    })
  );

  // 25. GET /recognition/{collId}/{id}/testSet
  server.registerTool(
    'transkribus_recog_get_test_set',
    {
      title: 'Get Test Set',
      description: 'Get the test set data for a recognition model.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: IdSchema,
        nrOfTranscripts: z.number().int().optional().default(-1).describe('Number of transcripts'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, ...query } = params;
      return transkribusRequest('GET', `/recognition/${collId}/${id}/testSet`, undefined, query);
    })
  );

  // 26. GET /recognition/{collId}/{id}/trainData
  server.registerTool(
    'transkribus_recog_get_train_data',
    {
      title: 'Get Training Data',
      description: 'Get the training data for a recognition model.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: IdSchema,
        index: z.number().int().optional().default(0).describe('Start index'),
        nValues: z.number().int().optional().default(-1).describe('Number of values'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, ...query } = params;
      return transkribusRequest('GET', `/recognition/${collId}/${id}/trainData`, undefined, query);
    })
  );

  // 27. GET /recognition/{collId}/{id}/trainSet
  server.registerTool(
    'transkribus_recog_get_train_set',
    {
      title: 'Get Training Set',
      description: 'Get the training set for a recognition model.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: IdSchema,
        nrOfTranscripts: z.number().int().optional().default(-1).describe('Number of transcripts'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, ...query } = params;
      return transkribusRequest('GET', `/recognition/${collId}/${id}/trainSet`, undefined, query);
    })
  );

  // 28. POST /recognition/{collId}/{modelId}/htrCITlab
  server.registerTool(
    'transkribus_recog_run_htr_citlab',
    {
      title: 'Run HTR (CITlab)',
      description: 'Run CITlab HTR recognition on a document using a specific model.',
      inputSchema: z.object({
        collId: CollIdSchema,
        modelId: ModelIdSchema,
        docId: DocIdSchema,
        pages: z.string().optional().describe('Page range (e.g. "1-5")'),
        dict: z.string().optional().describe('Dictionary to use'),
        tempDict: z.string().optional().describe('Temporary dictionary'),
        doLinePolygonSimplification: z.boolean().optional().describe('Simplify line polygons (default true)'),
        keepOriginalLinePolygons: z.boolean().optional().describe('Keep original line polygons (default false)'),
        doStoreConfMats: z.boolean().optional().describe('Store confidence matrices (default true)'),
        doStructures: z.boolean().optional().describe('Run structure analysis'),
        credits: z.string().optional().describe('Credits parameter'),
        allowConcurrentExecution: z.boolean().optional().describe('Allow concurrent execution (default false)'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, modelId, docId, pages, ...queryOpts } = params;
      return transkribusRequest('POST', `/recognition/${collId}/${modelId}/htrCITlab`, undefined, { id: docId, pages, ...queryOpts });
    })
  );

  // 29. POST /recognition/{collId}/{modelId}/text2Image
  server.registerTool(
    'transkribus_recog_text2image',
    {
      title: 'Run Text2Image',
      description: 'Run Text2Image alignment using a specific model in a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        modelId: ModelIdSchema,
        body: z.record(z.unknown()).describe('Text2Image parameters'),
        credits: z.string().optional().default('AUTO').describe('Credits parameter'),
        doNotDeleteWorkDir: z.boolean().optional().default(false).describe('Do not delete work directory'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, modelId, credits, doNotDeleteWorkDir, body } = params;
      return transkribusRequest('POST', `/recognition/${collId}/${modelId}/text2Image`, body, { credits, doNotDeleteWorkDir });
    })
  );

  // 30. POST /recognition/{collId}/{modelId}/text2ImageMatching
  server.registerTool(
    'transkribus_recog_text2image_matching',
    {
      title: 'Run Text2Image Matching',
      description: 'Run Text2Image matching using a specific model in a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        modelId: ModelIdSchema,
        docId: z.number().int().positive().describe('Document ID'),
        pages: z.string().optional().describe('Page range (e.g. "1-5")'),
        credits: z.string().optional().default('AUTO').describe('Credits parameter'),
        doNotDeleteWorkDir: z.boolean().optional().default(true).describe('Do not delete work directory'),
        preserveLineOrder: z.boolean().optional().default(false).describe('Preserve line order'),
        keepUnmatchedLines: z.boolean().optional().default(false).describe('Keep unmatched lines'),
        useSourceLineFeeds: z.boolean().optional().default(true).describe('Use source line feeds'),
        addNotMatchedTextInLastLine: z.boolean().optional().default(true).describe('Add unmatched text in last line'),
        useCurrentTranskript: z.boolean().optional().default(false).describe('Use current transcript'),
        allowDoubleMatching: z.boolean().optional().default(false).describe('Allow double matching'),
        reductionMethod: z.number().int().optional().default(0).describe('Reduction method'),
        blockThresh: z.number().optional().default(0).describe('Block threshold'),
        lineThresh: z.number().optional().default(0.45).describe('Line threshold'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, modelId, ...query } = params;
      return transkribusRequest('POST', `/recognition/${collId}/${modelId}/text2ImageMatching`, undefined, query);
    })
  );

  // 31. POST /recognition/{collId}/{modelId}/trhtr
  server.registerTool(
    'transkribus_recog_run_trhtr',
    {
      title: 'Run TRHTR',
      description: 'Run TRHTR recognition using a specific model in a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        modelId: ModelIdSchema,
        modelName: z.string().optional().describe('Model name'),
        id: z.number().int().optional().describe('Document ID'),
        pages: z.string().optional().describe('Page range (e.g. "1-5")'),
        credits: z.string().optional().default('AUTO').describe('Credits parameter'),
        allowConcurrentExecution: z.boolean().optional().default(false).describe('Allow concurrent execution'),
        doNotDeleteWorkDir: z.boolean().optional().default(false).describe('Do not delete work directory'),
        doLinePolygonSimplification: z.boolean().optional().default(true).describe('Simplify line polygons'),
        useExistingLinePolygons: z.boolean().optional().default(false).describe('Use existing line polygons'),
        b2pBackend: z.string().optional().default('Legacy').describe('B2P backend type'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, modelId, ...query } = params;
      return transkribusRequest('POST', `/recognition/${collId}/${modelId}/trhtr`, undefined, query);
    })
  );

  // 32. GET /recognition/{collId}/{id}/add
  server.registerTool(
    'transkribus_recog_get_add_info',
    {
      title: 'Get Add Info',
      description: 'Get information about adding a recognition model to collections.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: IdSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id } = params;
      return transkribusRequest('GET', `/recognition/${collId}/${id}/add`);
    })
  );

  // 33. GET /recognition/{collId}/{id}/validationData
  server.registerTool(
    'transkribus_recog_get_validation_gt_by_htr',
    {
      title: 'Get Validation GT by HTR ID',
      description: 'Get validation ground truth data for a recognition model.',
      inputSchema: z.object({
        collId: CollIdSchema,
        id: IdSchema,
        index: z.number().int().optional().default(0).describe('Start index'),
        nValues: z.number().int().optional().default(-1).describe('Number of values'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, id, ...query } = params;
      return transkribusRequest('GET', `/recognition/${collId}/${id}/validationData`, undefined, query);
    })
  );
}
