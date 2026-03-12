import { readFileSync } from 'fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { transkribusRequest } from '../services/transkribus.js';
import { handleToolRequest } from '../helpers.js';
import { CollIdSchema, ModelIdSchema } from '../schemas/common.js';

/** Transform flat [{docId, pageId}] → grouped [{docId, pageList: {pages: [{pageId}]}}] */
function groupPagesByDoc(
  pages: Array<{ docId: number; pageId: number }>
): Array<{ docId: number; pageList: { pages: Array<{ pageId: number }> } }> {
  const grouped = new Map<number, Array<{ pageId: number }>>();
  for (const { docId, pageId } of pages) {
    if (!grouped.has(docId)) grouped.set(docId, []);
    grouped.get(docId)!.push({ pageId });
  }
  return Array.from(grouped, ([docId, pageList]) => ({ docId, pageList: { pages: pageList } }));
}

export function registerPylaiaTools(server: McpServer): void {
  // 1. POST /pylaia/{collId}/train
  server.registerTool(
    'transkribus_pylaia_train',
    {
      title: 'Train PyLaia Model',
      description: 'Start PyLaia HTR model training for a collection.',
      inputSchema: z.object({
        collId: CollIdSchema,
        modelName: z.string().optional().describe('Name for the new model'),
        description: z.string().optional().describe('Description of the model'),
        baseModelId: z.number().int().optional().describe('Base model ID for transfer learning'),
        provider: z.string().optional().default('PyLaia').describe('Training provider (default: "PyLaia")'),
        trainList: z.array(z.object({ docId: z.number().int(), pageId: z.number().int() })).optional().describe('Training page list'),
        trainListFile: z.string().optional().describe('Absolute path to JSON file containing training page list array of {docId, pageId} objects. Example: /tmp/transkribus-training/train_list.json'),
        testList: z.array(z.object({ docId: z.number().int(), pageId: z.number().int() })).optional().describe('Test page list'),
        testListFile: z.string().optional().describe('Absolute path to JSON file containing test page list array of {docId, pageId} objects. Example: /tmp/transkribus-training/test_list.json'),
        omitLinesByTag: z.array(z.string()).optional().describe('Tags of lines to omit from training'),
        reverseText: z.boolean().optional().describe('Whether to reverse text direction'),
        imgType: z.string().optional().describe('Image type'),
        customAbbrevsTraining: z.boolean().optional().describe('Enable custom abbreviations training'),
        customTagTraining: z.boolean().optional().describe('Enable custom tag training'),
        trainProperties: z.boolean().optional().describe('Enable training properties'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, trainListFile, testListFile, ...body } = params;

      // File params provide defaults; inline params take precedence
      if (trainListFile && !body.trainList) {
        body.trainList = JSON.parse(readFileSync(trainListFile, 'utf-8'));
      }
      if (testListFile && !body.testList) {
        body.testList = JSON.parse(readFileSync(testListFile, 'utf-8'));
      }

      // GOTCHA: API expects trainList: {train: [{docId, pageList: {pages: [{pageId}]}}]}, not flat [{docId, pageId}].
      const requestBody = {
        ...body,
        ...(body.trainList && { trainList: { train: groupPagesByDoc(body.trainList) } }),
        ...(body.testList && { testList: { test: groupPagesByDoc(body.testList) } }),
      };
      return transkribusRequest('POST', `/pylaia/${collId}/train`, requestBody);
    })
  );

  // 2. POST /pylaia/{collId}/{modelId}/recognition
  server.registerTool(
    'transkribus_pylaia_recognize',
    {
      title: 'Run PyLaia Recognition',
      description: 'Run PyLaia HTR recognition on a document using a specific model.',
      inputSchema: z.object({
        collId: CollIdSchema,
        modelId: ModelIdSchema,
        docId: z.number().int().positive().describe('Document ID'),
        pages: z.string().optional().describe('Page range (e.g. "1-5")'),
        languageModel: z.string().optional().describe('Language model to use'),
        printedModelId: z.number().int().optional().describe('Printed text model ID'),
        printedLanguageModel: z.string().optional().describe('Language model for printed text'),
        doLinePolygonSimplification: z.boolean().optional().describe('Simplify line polygons (default true)'),
        keepOriginalLinePolygons: z.boolean().optional().describe('Keep original line polygons (default false)'),
        writeKwsIndex: z.boolean().optional().describe('Write KWS index (default false)'),
        nBest: z.number().int().optional().describe('Number of best results (default 1)'),
        useExistingLinePolygons: z.boolean().optional().describe('Use existing line polygons (default false)'),
        doStructures: z.string().optional().describe('Structure analysis mode'),
        doWordSeg: z.boolean().optional().describe('Perform word segmentation'),
        credits: z.string().optional().describe('Credits parameter'),
        allowConcurrentExecution: z.boolean().optional().describe('Allow concurrent execution (default false)'),
        doNotDeleteWorkDir: z.boolean().optional().describe('Do not delete working directory'),
        writeLineConfScore: z.boolean().optional().describe('Write line confidence scores'),
        writeWordConfScores: z.boolean().optional().describe('Write word confidence scores'),
        batchSize: z.number().int().optional().describe('Batch size (default 10)'),
        clearLines: z.boolean().optional().describe('Clear existing lines before recognition'),
        b2pBackend: z.string().optional().describe('Baseline to polygon backend (default "Legacy")'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, modelId, docId, pages, ...queryOpts } = params;
      const url = `/pylaia/${collId}/${modelId}/recognition`;
      return transkribusRequest('POST', url, undefined, { id: docId, pages, ...queryOpts });
    })
  );
}
