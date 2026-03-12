import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { transkribusRequest } from '../services/transkribus.js';
import { handleToolRequest } from '../helpers.js';
import { CollIdSchema, DocIdSchema, ModelIdSchema } from '../schemas/common.js';

export function registerLayoutAnalysisTools(server: McpServer): void {
  // 1. POST /LA
  server.registerTool(
    'transkribus_la_analyze',
    {
      title: 'Run Layout Analysis',
      description: 'Run layout analysis on document pages.',
      inputSchema: z.object({
        collId: CollIdSchema,
        docId: DocIdSchema,
        pages: z.string().optional().describe('Page range (e.g. "1-5" or "1,3,5")'),
        doBlockSeg: z.boolean().optional().describe('Perform block segmentation'),
        doLineSeg: z.boolean().optional().describe('Perform line segmentation'),
        doWordSeg: z.boolean().optional().describe('Perform word segmentation'),
        doPolygonToBaseline: z.boolean().optional().describe('Convert polygons to baselines'),
        doBaselineToPolygon: z.boolean().optional().describe('Convert baselines to polygons'),
        jobImpl: z.string().optional().describe('Job implementation class'),
        credits: z.string().optional().describe('Credits parameter'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    // GOTCHA: WADL lists collId + segmentation flags as query params, while docId/pages go in body (jobParameters).
    handleToolRequest(async (params) => {
      const { collId, doBlockSeg, doLineSeg, doWordSeg, doPolygonToBaseline, doBaselineToPolygon, jobImpl, credits, ...body } = params;
      return transkribusRequest('POST', '/LA', body,
        { collId, doBlockSeg, doLineSeg, doWordSeg, doPolygonToBaseline, doBaselineToPolygon, jobImpl, credits });
    })
  );

  // 2. POST /LA/analyze
  server.registerTool(
    'transkribus_la_analyze_advanced',
    {
      title: 'Run Advanced Layout Analysis',
      description: 'Run advanced layout analysis with additional parameters.',
      inputSchema: z.object({
        collId: CollIdSchema,
        docId: DocIdSchema,
        pages: z.string().optional().describe('Page range (e.g. "1-5" or "1,3,5")'),
        modelId: ModelIdSchema.optional(),
        doBlockSeg: z.boolean().optional().describe('Perform block segmentation'),
        doLineSeg: z.boolean().optional().describe('Perform line segmentation'),
        doWordSeg: z.boolean().optional().describe('Perform word segmentation'),
        doPolygonToBaseline: z.boolean().optional().describe('Convert polygons to baselines'),
        doBaselineToPolygon: z.boolean().optional().describe('Convert baselines to polygons'),
        jobImpl: z.string().optional().describe('Job implementation class'),
        credits: z.string().optional().describe('Credits parameter'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, doBlockSeg, doLineSeg, doWordSeg, doPolygonToBaseline, doBaselineToPolygon, jobImpl, credits, ...body } = params;
      return transkribusRequest('POST', '/LA/analyze', body,
        { collId, doBlockSeg, doLineSeg, doWordSeg, doPolygonToBaseline, doBaselineToPolygon, jobImpl, credits });
    })
  );

  // 3. GET /LA/costs
  server.registerTool(
    'transkribus_la_get_costs',
    {
      title: 'Get Layout Analysis Costs',
      description: 'Get the cost estimate for layout analysis on a document.',
      inputSchema: z.object({
        collId: CollIdSchema,
        docId: DocIdSchema,
        nrOfPages: z.number().int().optional().describe('Number of pages'),
        modelId: ModelIdSchema.optional(),
        credits: z.string().optional().describe('Credits parameter'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('GET', '/LA/costs', undefined, params))
  );

  // 4. POST /LA/la2Inference
  server.registerTool(
    'transkribus_la_la2_inference',
    {
      title: 'LA2 Inference',
      description: 'Run LA2 model inference on document pages.',
      inputSchema: z.object({
        collId: CollIdSchema,
        docId: DocIdSchema,
        modelId: ModelIdSchema.optional(),
        pages: z.string().optional().describe('Page range (e.g. "1-5" or "1,3,5")'),
        credits: z.string().optional().describe('Credits parameter'),
        threshold: z.number().optional().describe('Detection threshold (default 0.75)'),
        addToPageXML: z.boolean().optional().describe('Add results to PAGE XML'),
        approxPolyFrac: z.number().optional().describe('Approximate polygon fraction (default 0.7)'),
        combineWithBaseLayout: z.boolean().optional().describe('Combine with base layout'),
        keepEmptyRegions: z.boolean().optional().describe('Keep empty regions'),
        splitLines: z.boolean().optional().describe('Split lines'),
        lineOverlapFraction: z.number().optional().describe('Line overlap fraction (default 0.05)'),
        clusterLinesWithoutRegions: z.boolean().optional().describe('Cluster lines without regions'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, modelId, credits, threshold, addToPageXML, approxPolyFrac, combineWithBaseLayout, keepEmptyRegions, splitLines, lineOverlapFraction, clusterLinesWithoutRegions, ...body } = params;
      return transkribusRequest('POST', '/LA/la2Inference', body, { collId, modelId, credits, threshold, addToPageXML, approxPolyFrac, combineWithBaseLayout, keepEmptyRegions, splitLines, lineOverlapFraction, clusterLinesWithoutRegions });
    })
  );

  // 5. POST /LA/tableInference
  server.registerTool(
    'transkribus_la_table_inference',
    {
      title: 'Table Inference',
      description: 'Run table structure inference on document pages.',
      inputSchema: z.object({
        collId: CollIdSchema,
        docId: DocIdSchema,
        modelId: ModelIdSchema.optional(),
        pages: z.string().optional().describe('Page range (e.g. "1-5" or "1,3,5")'),
        credits: z.string().optional().describe('Credits parameter'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, modelId, credits, ...body } = params;
      return transkribusRequest('POST', '/LA/tableInference', body, { collId, modelId, credits });
    })
  );
}
