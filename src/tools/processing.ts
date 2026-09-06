import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { metagraphoRequest, metagraphoRequestText } from '../services/metagrapho.js';
import { handleTextToolRequest, handleToolRequest } from '../helpers.js';
import { intCoerce } from '../schemas/common.js';

/**
 * Tools for the Transkribus Metagrapho ("Processing") API — a separate service
 * from the legacy TrpServer REST API the other ~300 tools target. Shapes follow
 * https://transkribus.eu/processing/v1/openapi.json ("Transkribus Metagrapho
 * API" 1.13.1).
 */

const ProcessIdSchema = intCoerce(z.number().int().positive()).describe(
  'Process ID returned when the image was submitted'
);

const LineDetectionSchema = z
  .object({
    modelId: intCoerce(z.number().int().positive())
      .optional()
      .describe('Line detection model ID. Ignored when regions and lines are supplied.'),
    minimalBaselineLength: intCoerce(z.number().int())
      .optional()
      .describe('Detected baselines shorter than this are dropped'),
    baselineAccuracyThreshold: intCoerce(z.number().int().min(0).max(255))
      .optional()
      .describe('Binarization threshold for the baseline mask, 0-255. Higher is stricter.'),
    maxDistForMerging: intCoerce(z.number().int())
      .optional()
      .describe('Maximum distance between two baselines for them to be merged'),
    numTextRegions: z
      .number()
      .optional()
      .describe('Regions to build from detected lines: one -1, few 1.6, medium 1.0, many 0.4'),
    textRegionClusteringType: z
      .enum(['horizontal', 'mixed'])
      .optional()
      .describe('horizontal: all lines horizontal. mixed: lines rotated by 0, 90, 180 or 270 degrees.'),
  })
  .describe('Layout analysis settings. Omit to use the service defaults.');

const TextRecognitionSchema = z
  .object({
    htrId: intCoerce(z.number().int().positive()).describe(
      'ID of the Transkribus HTR model to apply'
    ),
    // The OpenAPI document marks this required, but the vendor's own documented
    // request omits it and the enum holds a single value. Requiring it here
    // would reject calls the service itself accepts.
    languageModel: z
      .enum(['built-in'])
      .optional()
      .describe('Enable the built-in language model when generating the transcription'),
  })
  .describe('Text recognition settings');

const ImageSchema = z
  .object({
    imageUrl: z.string().url().optional().describe('URL of a publicly reachable image file'),
    base64: z.string().optional().describe('Base64-encoded image data'),
  })
  // The API models this as `maxProperties: 1`. A JSON Schema refinement is not
  // representable, so the constraint is enforced here at parse time and stated
  // in the field descriptions above and the tool description below.
  .refine(
    (v) => (v.imageUrl !== undefined ? 1 : 0) + (v.base64 !== undefined ? 1 : 0) === 1,
    { message: 'Provide exactly one of imageUrl or base64' }
  )
  .describe('The image to process: exactly one of imageUrl or base64');

export function registerProcessingTools(server: McpServer): void {
  // 1. POST /processes
  server.registerTool(
    'transkribus_processing_submit_image',
    {
      title: 'Submit Image for Processing',
      description:
        'Submit a single image to the Transkribus Processing API for text recognition and ' +
        'get back a process ID. Supply exactly one of imageUrl or base64 (JPEG, TIFF or PNG, up to 20 MB).',
      inputSchema: z.object({
        config: z
          .object({
            textRecognition: TextRecognitionSchema,
            lineDetection: LineDetectionSchema.optional(),
          })
          .describe('How the image should be processed'),
        image: ImageSchema,
        content: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('Existing regions and lines. When supplied, line detection is skipped.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => metagraphoRequest('POST', '/processes', params))
  );

  // 2. GET /processes/{processId}
  server.registerTool(
    'transkribus_processing_get_status',
    {
      title: 'Get Processing Status',
      description:
        'Get the status of a Processing API job, including the recognised text once it has ' +
        'finished. Status is one of CREATED, WAITING, RUNNING, FINISHED or FAILED; results are kept for two days.',
      inputSchema: z.object({ processId: ProcessIdSchema }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async ({ processId }: { processId: number }) =>
      metagraphoRequest('GET', `/processes/${processId}`)
    )
  );

  // 3. GET /processes/{processId}/page
  server.registerTool(
    'transkribus_processing_get_page_xml',
    {
      title: 'Get Processing Result as PAGE XML',
      description:
        'Get a finished Processing API result as PAGE XML (version 2013-07-15). ' +
        'Returns 404 while the job is still running.',
      inputSchema: z.object({ processId: ProcessIdSchema }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleTextToolRequest(async ({ processId }: { processId: number }) =>
      metagraphoRequestText(`/processes/${processId}/page`)
    )
  );

  // 4. GET /processes/{processId}/alto
  server.registerTool(
    'transkribus_processing_get_alto_xml',
    {
      title: 'Get Processing Result as ALTO XML',
      description:
        'Get a finished Processing API result as ALTO v4 XML. ' +
        'Returns 404 while the job is still running.',
      inputSchema: z.object({ processId: ProcessIdSchema }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleTextToolRequest(async ({ processId }: { processId: number }) =>
      metagraphoRequestText(`/processes/${processId}/alto`)
    )
  );
}
