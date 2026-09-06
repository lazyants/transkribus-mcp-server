import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { registerActionTools } from '../tools/actions.js';
import { registerAdminTools } from '../tools/admin.js';
import { registerAuthTools } from '../tools/auth.js';
import { registerCollectionActivityTools } from '../tools/collections-activity.js';
import { registerCollectionCoreTools } from '../tools/collections-core.js';
import { registerCollectionCreditTools } from '../tools/collections-credits.js';
import { registerCollectionCrowdTools } from '../tools/collections-crowd.js';
import { registerCollectionDocumentTools } from '../tools/collections-documents.js';
import { registerCollectionEditDeclTools } from '../tools/collections-editdecl.js';
import { registerCollectionLabelTools } from '../tools/collections-labels.js';
import { registerCollectionPageTools } from '../tools/collections-pages.js';
import { registerCollectionStatsTools } from '../tools/collections-stats.js';
import { registerCollectionTagTools } from '../tools/collections-tags.js';
import { registerCollectionUserTools } from '../tools/collections-users.js';
import { registerCreditTools } from '../tools/credits.js';
import { registerCrowdsourcingTools } from '../tools/crowdsourcing.js';
import { registerDuTools } from '../tools/du.js';
import { registerElearningTools } from '../tools/elearning.js';
import { registerFileTools } from '../tools/files.js';
import { registerJobTools } from '../tools/jobs.js';
import { registerKwsTools } from '../tools/kws.js';
import { registerLabelTools } from '../tools/labels.js';
import { registerLayoutAnalysisTools } from '../tools/layout-analysis.js';
import { registerModelTools } from '../tools/models.js';
import { registerP2palaTools } from '../tools/p2pala.js';
import { registerPylaiaTools } from '../tools/pylaia.js';
import { registerRecognitionTools } from '../tools/recognition.js';
import { registerRootTools } from '../tools/root.js';
import { registerSearchTools } from '../tools/search.js';
import { registerSystemTools } from '../tools/system.js';
import { registerUploadTools } from '../tools/uploads.js';
import { registerUserTools } from '../tools/user.js';

// Ratchet for issue #33. MCP clients sometimes serialize numbers as JSON
// strings; `intCoerce` (src/schemas/common.ts) exists so that "3" is accepted
// wherever 3 is. v2.0.1 applied it to 191 params and #33 swept up the 24
// required stragglers. This file stops the next one appearing: a newly added
// tool that hand-rolls `z.number()` for a REQUIRED param, or for index/nValues,
// fails here with the offending tool.param named.
//
// Deliberately NOT covered: OPTIONAL params that still reject string numbers
// (137 of them when this was written). A client can omit an optional filter, so
// the tool stays usable, and that count moves whenever anyone adds any optional
// numeric param — freezing it would produce noise rather than defects.

const REGISTRARS = [
  registerActionTools,
  registerAdminTools,
  registerAuthTools,
  registerCollectionActivityTools,
  registerCollectionCoreTools,
  registerCollectionCreditTools,
  registerCollectionCrowdTools,
  registerCollectionDocumentTools,
  registerCollectionEditDeclTools,
  registerCollectionLabelTools,
  registerCollectionPageTools,
  registerCollectionStatsTools,
  registerCollectionTagTools,
  registerCollectionUserTools,
  registerCreditTools,
  registerCrowdsourcingTools,
  registerDuTools,
  registerElearningTools,
  registerFileTools,
  registerJobTools,
  registerKwsTools,
  registerLabelTools,
  registerLayoutAnalysisTools,
  registerModelTools,
  registerP2palaTools,
  registerPylaiaTools,
  registerRecognitionTools,
  registerRootTools,
  registerSearchTools,
  registerSystemTools,
  registerUploadTools,
  registerUserTools,
];

type RegisteredTools = Record<string, { inputSchema?: z.ZodObject }>;

function registerEveryTool(): RegisteredTools {
  const server = new McpServer({ name: 'coercion-test', version: '0.0.0' });
  for (const register of REGISTRARS) register(server);
  return (server as unknown as { _registeredTools: RegisteredTools })._registeredTools;
}

interface JsonSchemaProperty {
  type?: string;
  const?: unknown;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  anyOf?: JsonSchemaProperty[];
  oneOf?: JsonSchemaProperty[];
}

interface NumericField {
  tool: string;
  param: string;
  required: boolean;
  probes: number[];
  accepted?: number;
  coerces: boolean;
}

// A value can satisfy the property itself or any of its alternatives: a union or
// a .nullable() emits `anyOf` and carries no `type` of its own. Ignoring those
// is how a numeric param drops out of the scan without anything going red.
function branches(prop: JsonSchemaProperty): JsonSchemaProperty[] {
  return [prop, ...(prop.anyOf ?? []), ...(prop.oneOf ?? [])];
}

// One candidate value per numeric branch, inside that branch's own bounds and as
// small as they allow. Probing with a fixed literal would silently SKIP any param
// whose constraints exclude it (`z.number().int().min(4)` rejects 3), and a
// skipped param produces exactly what a clean one produces.
function numericProbes(prop: JsonSchemaProperty): number[] {
  const probes: number[] = [];
  for (const branch of branches(prop)) {
    if (typeof branch.const === 'number') {
      probes.push(branch.const);
      continue;
    }
    if (branch.type !== 'integer' && branch.type !== 'number') continue;
    const low = branch.exclusiveMinimum !== undefined ? branch.exclusiveMinimum + 1 : branch.minimum;
    const high = branch.exclusiveMaximum !== undefined ? branch.exclusiveMaximum - 1 : branch.maximum;
    let value = 3;
    if (low !== undefined && value < low) value = low;
    if (high !== undefined && value > high) value = high;
    probes.push(value);
  }
  return probes;
}

// Numeric params are identified from the JSON Schema MCP actually publishes, and
// `required` is read from that same schema rather than guessed.
function numericFields(tools: RegisteredTools): NumericField[] {
  const fields: NumericField[] = [];
  for (const [tool, def] of Object.entries(tools)) {
    if (!def.inputSchema) continue;
    const emitted = z.toJSONSchema(def.inputSchema, { io: 'input' }) as {
      properties?: Record<string, JsonSchemaProperty>;
      required?: string[];
    };
    const required = new Set(emitted.required ?? []);
    for (const [param, prop] of Object.entries(emitted.properties ?? {})) {
      const probes = numericProbes(prop);
      if (probes.length === 0) continue;
      const field = (def.inputSchema.shape as Record<string, z.ZodType>)[param];
      const accepted = probes.find((value) => field.safeParse(value).success);
      fields.push({
        tool,
        param,
        required: required.has(param),
        probes,
        accepted,
        coerces: accepted !== undefined && field.safeParse(String(accepted)).success,
      });
    }
  }
  return fields;
}

const tools = registerEveryTool();
const fields = numericFields(tools);
const isPagination = (f: NumericField) => f.param === 'index' || f.param === 'nValues';

describe('string-encoded numbers are accepted wherever a number is (issue #33)', () => {
  // Non-vacuity guards. Every assertion below is "the offender list is empty",
  // and an empty traversal produces exactly that, so a scan that silently
  // stopped finding fields would look identical to a pass.
  it('registers every module under src/tools/', () => {
    const toolsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../tools');
    const modules = readdirSync(toolsDir).filter((f) => f.endsWith('.ts'));
    // A new tool module that nobody adds to REGISTRARS would never be scanned
    // by the assertions below, and its raw params would pass unnoticed.
    expect(modules.length).toBe(REGISTRARS.length);
    expect(Object.keys(tools).length).toBeGreaterThan(250);
  });

  it('exercised every numeric param it found', () => {
    // If no value inside a param's declared bounds is accepted, the coercion
    // answer below is meaningless for it — fail rather than skip it.
    const unexercised = fields
      .filter((f) => f.accepted === undefined)
      .map((f) => `${f.tool}.${f.param} (probes ${f.probes.join('/')})`);
    expect(unexercised, `no in-bounds probe was accepted: ${unexercised.join(', ')}`).toEqual([]);
    expect(fields.filter((f) => f.required).length).toBeGreaterThan(300);
    expect(fields.filter(isPagination).length).toBeGreaterThan(100);
  });

  it('no REQUIRED numeric param rejects its own string form', () => {
    // A required param that rejects "3" makes its tool uncallable from a
    // string-serializing client — there is no way to omit it.
    const offenders = fields
      .filter((f) => f.required && !f.coerces)
      .map((f) => `${f.tool}.${f.param}`);
    expect(
      offenders,
      `use the intCoerce-backed schemas from src/schemas/common.ts for: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('no index/nValues pagination param rejects its own string form', () => {
    const offenders = fields
      .filter((f) => isPagination(f) && !f.coerces)
      .map((f) => `${f.tool}.${f.param}`);
    expect(
      offenders,
      `use PaginationParams / paginationWithDefaults for: ${offenders.join(', ')}`,
    ).toEqual([]);
  });
});
