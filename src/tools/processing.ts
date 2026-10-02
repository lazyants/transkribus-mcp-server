import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  describeProcessingJob,
  getProcessingBackend,
  metagraphoLongpoll,
  metagraphoRequest,
  metagraphoRequestText,
  metagraphoResultZip,
  type ProcessingJob,
} from '../services/metagrapho.js';
import { handleTextToolRequest, handleToolRequest } from '../helpers.js';
import { intCoerce } from '../schemas/common.js';

/**
 * Tools for the Transkribus Metagrapho ("Processing") API — a separate service
 * from the legacy TrpServer REST API. v1 is the default; v2 follows the published
 * Developer Platform staging contract at api-staging.transkribus.org/v2/openapi.json.
 */

const NumericProcessIdSchema = intCoerce(z.number().int().positive());
// Give v2 discovery a typed input before coercion; the v1 input schema stays
// unchanged. The final numeric schema still rejects unsafe or nonpositive IDs.
const V2NumericProcessIdSchema = z.union([
  z.number().int().positive(),
  z.string().regex(/^-?\d+$/),
]).pipe(NumericProcessIdSchema as z.ZodType<number, number | string>);
type ProcessParams = { processId: number | string };

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

// The live spec caps base64 image data at 27962027 characters — the string length
// of the documented 20 MB binary limit. Enforcing it (and the base64 alphabet)
// here rather than letting the upload fail upstream matters more than usual for
// this client: `metagraphoError` deliberately discards the server's wording, so
// an oversized or malformed payload would otherwise cost a full upload and come
// back as a bare "HTTP 400" with nothing to act on.
const MAX_BASE64_LENGTH = 27962027;

const Base64Schema = z
  .string()
  .min(1)
  .max(MAX_BASE64_LENGTH)
  // Whitespace is allowed because MIME-wrapped base64 arrives with line breaks;
  // padding is only ever trailing.
  .regex(/^[A-Za-z0-9+/\s]*={0,2}$/, 'Must be base64-encoded image data')
  .describe('Base64-encoded image data (JPEG, TIFF or PNG, up to 20 MB)');

// The API models the image as `maxProperties: 1` — exactly one source. A
// `.refine` would enforce that at runtime but is invisible to
// `z.toJSONSchema`, so `tools/list` would advertise both fields as optional and
// a client that synthesizes or pre-validates arguments from the published schema
// would happily produce a call that can only fail. A union publishes the
// constraint instead: it emits `anyOf` with each branch requiring its own field
// and forbidding the other.
const ImageSchema = z
  .union([
    z.object({
      imageUrl: z.string().url().describe('URL of a publicly reachable image file'),
      base64: z.never().optional(),
    }),
    z.object({
      base64: Base64Schema,
      imageUrl: z.never().optional(),
    }),
  ])
  .describe('The image to process: exactly one of imageUrl or base64');

export function registerProcessingTools(server: McpServer): void {
  const v2 = getProcessingBackend() === 'v2';
  const ProcessIdSchema = (v2
    ? z.union([V2NumericProcessIdSchema, z.string().uuid()])
    : NumericProcessIdSchema
  ).describe(v2 ? 'Numeric process ID or UUID returned by the job' : 'Process ID returned when the image was submitted');
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
    handleToolRequest(async (params) =>
      describeProcessingJob(await metagraphoRequest<ProcessingJob>('POST', '/processes', params))
    )
  );

  // 2. GET /processes/{processId}
  server.registerTool(
    'transkribus_processing_get_status',
    {
      title: 'Get Processing Status',
      description:
        'Get the status of a Processing API job, including the recognised text once it has ' +
        (v2
          ? 'finished. Status is CREATED, WAITING, RUNNING, FINISHED, FAILED or CANCELLED; results are kept for 24 hours after completion, and links are indexed by rel.'
          : 'finished. Status is one of CREATED, WAITING, RUNNING, FINISHED or FAILED; results are kept for two days.'),
      inputSchema: z.object({ processId: ProcessIdSchema }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async ({ processId }: ProcessParams) =>
      describeProcessingJob(await metagraphoRequest<ProcessingJob>('GET', `/processes/${processId}`))
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
    handleTextToolRequest(async ({ processId }: ProcessParams) =>
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
    handleTextToolRequest(async ({ processId }: ProcessParams) =>
      metagraphoRequestText(`/processes/${processId}/alto`)
    )
  );

  if (!v2) return;

  server.registerTool(
    'transkribus_processing_longpoll',
    {
      title: 'Longpoll Processing Status',
      description:
        'Wait for a v2 job status observation for up to 45 seconds, with an optional polling interval in milliseconds. Returns terminal state and links by rel, or timedOut with unknown terminal state on HTTP 408 or the local deadline; results are retained for 24 hours after completion.',
      inputSchema: z.object({
        processId: ProcessIdSchema,
        interval: intCoerce(z.number().int().min(-2147483648).max(2147483647))
          .optional().describe('Server polling interval in milliseconds (int32)'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async ({ processId, interval }: ProcessParams & { interval?: number }) =>
      metagraphoLongpoll(processId, interval)
    )
  );

  server.registerTool(
    'transkribus_processing_get_result_zip',
    {
      title: 'Get Processing Result ZIP',
      description:
        'Download a finished v2 job result as a ZIP, up to 20 MiB, returned as base64 data with filename and MIME type. Results are retained for 24 hours after completion; unavailable results return HTTP 404.',
      inputSchema: z.object({ processId: ProcessIdSchema }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async ({ processId }: ProcessParams) => metagraphoResultZip(processId))
  );
}
