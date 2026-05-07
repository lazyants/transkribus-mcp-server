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

/**
 * Default textFeatsCfg matching Transkribus UI defaults (TextFeats preprocessing).
 * Without this, the server falls back to trpPreprocPars (128px, no deslope/deslant)
 * which produces significantly worse models.
 */
const DEFAULT_TEXT_FEATS_CFG = {
  verbose: false,
  deslope: true,
  deslant: true,
  type: 'raw',
  format: 'img',
  stretch: true,
  enh: true,
  enh_win: 30,
  enh_prm: 0.1,
  normheight: 64,
  normxheight: 0,
  momentnorm: true,
  fpgram: true,
  fcontour: true,
  fcontour_dilate: 0,
  padding: 10,
  maxwidth: 6000,
};

/**
 * Default createModelPars matching Transkribus UI defaults.
 * Critical: use_masked_conv=True (server default is False, which degrades CER).
 */
const DEFAULT_CREATE_MODEL_PARS: Record<string, string> = {
  '--print_args': 'True',
  '--train_path': './model',
  '--model_filename': 'model',
  '--logging_level': 'info',
  '--cnn_kernel_size': '3 3 3 3',
  '--cnn_dilation': '1 1 1 1',
  '--cnn_num_features': '12 24 48 48',
  '--cnn_batchnorm': 'True True True True',
  '--cnn_activations': 'LeakyReLU LeakyReLU LeakyReLU LeakyReLU',
  '--cnn_poolsize': '2 2 0 2',
  '--use_masked_conv': 'True',
  '--rnn_type': 'LSTM',
  '--rnn_layers': '3',
  '--rnn_units': '256',
  '--rnn_dropout': '0.5',
  '--lin_dropout': '0.5',
  '--logging_also_to_stderr': 'info',
  '--logging_file': 'train-crnn.log',
  '--logging_overwrite': 'False',
};

/**
 * Default trainCtcPars matching Transkribus UI defaults.
 * Key differences from server defaults: max_epochs=100 (not 250),
 * use_distortions=True, use_baidu_ctc=True.
 */
const DEFAULT_TRAIN_CTC_PARS: Record<string, string> = {
  '--max_nondecreasing_epochs': '20',
  '--max_epochs': '100',
  '--batch_size': '24',
  '--learning_rate': '3.0E-4',
  '--delimiters': '<space>',
  '--use_baidu_ctc': 'True',
  '--add_logsoftmax_to_loss': 'False',
  '--train_path': './model',
  '--logging_level': 'info',
  '--logging_also_to_stderr': 'info',
  '--logging_file': 'train-crnn.log',
  '--show_progress_bar': 'False',
  '--use_distortions': 'True',
  '--save_checkpoint_interval': '1',
  '--print_args': 'True',
  '--logging_overwrite': 'False',
};

/**
 * Convert a flat key-value map to the JAXB ParameterMap format for the Transkribus API.
 * GOTCHA: JAXB's AJaxbMap uses @XmlElement(name="entry") on getMap() — Jackson JSON
 * serializes this as {"entry": [...]} without any outer wrapper. An extra "params" wrapper
 * causes silent deserialization failure (createModelPars stripped) or 500 (trainCtcPars).
 */
function toParameterMap(params: Record<string, string>): { entry: Array<{ key: string; value: string }> } {
  return {
    entry: Object.entries(params).map(([key, value]) => ({ key, value })),
  };
}

/** Zod schema for textFeatsCfg — all fields optional to allow partial overrides */
const TextFeatsCfgSchema = z.object({
  verbose: z.boolean().optional(),
  deslope: z.boolean().optional(),
  deslant: z.boolean().optional(),
  type: z.string().optional(),
  format: z.string().optional(),
  stretch: z.boolean().optional(),
  enh: z.boolean().optional(),
  enh_win: z.number().optional(),
  enh_prm: z.number().optional(),
  normheight: z.number().int().optional(),
  normxheight: z.number().int().optional(),
  momentnorm: z.boolean().optional(),
  fpgram: z.boolean().optional(),
  fcontour: z.boolean().optional(),
  fcontour_dilate: z.number().int().optional(),
  padding: z.number().int().optional(),
  maxwidth: z.number().int().optional(),
}).describe('TextFeats preprocessing config. Merged with UI defaults. Set to override specific fields.');

export interface PylaiaTrainBodyInput {
  trainList?: Array<{ docId: number; pageId: number }>;
  testList?: Array<{ docId: number; pageId: number }>;
  textFeatsCfg?: Record<string, unknown>;
  createModelPars?: Record<string, string>;
  trainCtcPars?: Record<string, string>;
  max_epochs?: number;
  max_nondecreasing_epochs?: number;
  learning_rate?: number;
  batch_size?: number;
  noTrainingDefaults?: boolean;
  [key: string]: unknown;
}

/**
 * Build the POST /pylaia/{collId}/train request body from tool params.
 * Pure: no I/O, no schema validation. Caller resolves trainListFile/testListFile beforehand.
 *
 * Default mode: applies Transkribus UI-default training params (textFeatsCfg, createModelPars,
 * trainCtcPars). Convenience shortcut fields (max_epochs etc.) merge into trainCtcPars.
 *
 * `noTrainingDefaults: true` skips UI defaults but still honors explicit `*Pars` overrides
 * AND the convenience shortcut fields — a shortcut alone is enough to emit `trainCtcPars`.
 */
export function buildPylaiaTrainBody(params: PylaiaTrainBodyInput): Record<string, unknown> {
  const {
    textFeatsCfg: textFeatsCfgOverride,
    createModelPars: createModelParsOverride,
    trainCtcPars: trainCtcParsOverride,
    max_epochs,
    max_nondecreasing_epochs,
    learning_rate,
    batch_size,
    noTrainingDefaults,
    trainList,
    testList,
    ...body
  } = params;

  // Build shortcuts as a key-value map; applied last so they win over trainCtcPars overrides.
  const shortcuts: Record<string, string> = {};
  if (max_epochs !== undefined) shortcuts['--max_epochs'] = String(max_epochs);
  if (max_nondecreasing_epochs !== undefined) shortcuts['--max_nondecreasing_epochs'] = String(max_nondecreasing_epochs);
  if (learning_rate !== undefined) shortcuts['--learning_rate'] = String(learning_rate);
  if (batch_size !== undefined) shortcuts['--batch_size'] = String(batch_size);
  const hasShortcut = Object.keys(shortcuts).length > 0;

  // GOTCHA: createModelPars and trainCtcPars use JAXB ParameterMap format: {entry: [{key, value}, ...]}
  // Do NOT wrap in {params: ...} — the extra layer causes silent param stripping or 500.
  // textFeatsCfg is a regular JAXB bean — sent as flat JSON object (not ParameterMap).
  const trainingConfig: Record<string, unknown> = {};

  if (!noTrainingDefaults) {
    trainingConfig.textFeatsCfg = { ...DEFAULT_TEXT_FEATS_CFG, ...textFeatsCfgOverride };
    trainingConfig.createModelPars = toParameterMap({ ...DEFAULT_CREATE_MODEL_PARS, ...createModelParsOverride });
    trainingConfig.trainCtcPars = toParameterMap({ ...DEFAULT_TRAIN_CTC_PARS, ...trainCtcParsOverride, ...shortcuts });
  } else {
    if (textFeatsCfgOverride) trainingConfig.textFeatsCfg = textFeatsCfgOverride;
    if (createModelParsOverride) trainingConfig.createModelPars = toParameterMap(createModelParsOverride);
    if (trainCtcParsOverride || hasShortcut) {
      trainingConfig.trainCtcPars = toParameterMap({ ...trainCtcParsOverride, ...shortcuts });
    }
  }

  // GOTCHA: API expects trainList: {train: [{docId, pageList: {pages: [{pageId}]}}]}, not flat [{docId, pageId}].
  return {
    ...body,
    ...trainingConfig,
    ...(trainList && trainList.length > 0 && { trainList: { train: groupPagesByDoc(trainList) } }),
    ...(testList && testList.length > 0 && { testList: { test: groupPagesByDoc(testList) } }),
  };
}

export function registerPylaiaTools(server: McpServer): void {
  // 1. POST /pylaia/{collId}/train
  server.registerTool(
    'transkribus_pylaia_train',
    {
      title: 'Train PyLaia Model',
      description:
        'Start PyLaia HTR model training for a collection. ' +
        'By default, sends training parameters matching the Transkribus UI defaults ' +
        '(textFeatsCfg with TextFeats preprocessing, use_masked_conv=True, max_epochs=100). ' +
        'Without these defaults, the server uses different preprocessing (trpPreprocPars) ' +
        'which produces significantly worse models. ' +
        'Set noTrainingDefaults=true to send no training parameters (server defaults).',
      inputSchema: z.object({
        collId: CollIdSchema,
        modelName: z.string().optional().describe('Name for the new model'),
        description: z.string().optional().describe('Description of the model'),
        baseModelId: z.number().int().optional().describe('Base model ID for transfer learning'),
        provider: z.string().optional().default('PyLaia').describe('Training provider (default: "PyLaia")'),
        language: z.string().optional().describe('Language code (e.g. "rus", "deu", "eng")'),
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

        // --- Training configuration parameters (UI defaults applied automatically) ---
        textFeatsCfg: TextFeatsCfgSchema.optional().describe(
          'TextFeats preprocessing config override. Merged with UI defaults (normheight=64, deslope/deslant=true, enh=true). ' +
          'Only specify fields you want to change.'
        ),
        createModelPars: z.record(z.string(), z.string()).optional().describe(
          'Model architecture parameters as key-value pairs (e.g. {"--rnn_units": "512"}). ' +
          'Merged with UI defaults (use_masked_conv=True, cnn_poolsize="2 2 0 2", etc.). ' +
          'Only specify parameters you want to override.'
        ),
        trainCtcPars: z.record(z.string(), z.string()).optional().describe(
          'CTC training parameters as key-value pairs (e.g. {"--max_epochs": "200"}). ' +
          'Merged with UI defaults (max_epochs=100, learning_rate=3.0E-4, batch_size=24, etc.). ' +
          'Only specify parameters you want to override.'
        ),

        // --- Convenience parameters (override specific trainCtcPars values) ---
        max_epochs: z.number().int().optional().describe('Maximum training epochs (default: 100). Shortcut for trainCtcPars --max_epochs.'),
        max_nondecreasing_epochs: z.number().int().optional().describe('Early stopping patience (default: 20). Shortcut for trainCtcPars --max_nondecreasing_epochs.'),
        learning_rate: z.number().optional().describe('Learning rate (default: 3.0E-4). Shortcut for trainCtcPars --learning_rate.'),
        batch_size: z.number().int().optional().describe('Batch size (default: 24). Shortcut for trainCtcPars --batch_size.'),

        // --- Opt-out of defaults ---
        noTrainingDefaults: z.boolean().optional().describe(
          'If true, do NOT apply UI-default training parameters. ' +
          'The server will use its own defaults (which differ from the UI and may produce worse models).'
        ),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { collId, trainListFile, testListFile, ...rest } = params;

      // File params provide defaults; inline params take precedence
      if (trainListFile && !rest.trainList) {
        rest.trainList = JSON.parse(readFileSync(trainListFile, 'utf-8'));
      }
      if (testListFile && !rest.testList) {
        rest.testList = JSON.parse(readFileSync(testListFile, 'utf-8'));
      }

      const requestBody = buildPylaiaTrainBody(rest);
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
