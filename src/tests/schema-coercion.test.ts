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

// Candidate values, probed against the real Zod schema rather than against a
// reconstruction of it. Deriving the value domain from the emitted JSON Schema
// was tried and abandoned: every added shape (bounds, then anyOf, then nested
// anyOf, allOf, $ref, mixed enums) left another one silently unscanned, because
// that approach re-implements Zod's validation instead of asking it.
const PROBE_LADDER = [3, 1, 0, 4, -1, 0.5];

// Any number appearing anywhere in the emitted property — minimum, maximum,
// const, an enum entry, at any nesting depth. This is a value HARVEST, not a
// domain reconstruction: it cannot be wrong about a shape it does not
// understand, only silent about one, and the ladder covers the ordinary cases.
function harvestNumbers(node: unknown, into: number[] = []): number[] {
  if (typeof node === 'number') into.push(node, node + 1);
  else if (Array.isArray(node)) for (const item of node) harvestNumbers(item, into);
  else if (node && typeof node === 'object') for (const value of Object.values(node)) harvestNumbers(value, into);
  return into;
}

interface NumericField {
  tool: string;
  param: string;
  required: boolean;
  /** Every probed value the field accepted. Empty means the field is not numeric. */
  accepted: number[];
  /** Accepted values whose string form the field rejects — the defect. */
  rejectedAsString: number[];
}

// A param is "numeric" when it actually accepts a number, which is what matters
// to a client. `required` is read from the JSON Schema MCP publishes, so it
// matches what a client is told it must send.
function numericFields(tools: RegisteredTools): NumericField[] {
  const fields: NumericField[] = [];
  for (const [tool, def] of Object.entries(tools)) {
    if (!def.inputSchema) continue;
    const emitted = z.toJSONSchema(def.inputSchema, { io: 'input' }) as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    const required = new Set(emitted.required ?? []);
    const shape = def.inputSchema.shape as Record<string, z.ZodType>;
    for (const [param, prop] of Object.entries(emitted.properties ?? {})) {
      const field = shape[param];
      if (!field) continue;
      const candidates = new Set([...PROBE_LADDER, ...harvestNumbers(prop)]);
      const accepted = [...candidates].filter((value) => field.safeParse(value).success);
      if (accepted.length === 0) continue;
      fields.push({
        tool,
        param,
        required: required.has(param),
        accepted,
        // EVERY accepted value must survive its own string form, not just the
        // first: a union whose sentinel branch does not coerce is still broken
        // for a client that can only send strings.
        rejectedAsString: accepted.filter((value) => !field.safeParse(String(value)).success),
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
  // and an empty scan produces exactly that, so a scan that silently stopped
  // finding fields would look identical to a pass.
  it('registers every module under src/tools/', () => {
    const toolsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../tools');
    const modules = readdirSync(toolsDir).filter((f) => f.endsWith('.ts'));
    // A new tool module that nobody adds to REGISTRARS would never be scanned
    // by the assertions below, and its raw params would pass unnoticed.
    expect(modules.length).toBe(REGISTRARS.length);
    expect(Object.keys(tools).length).toBeGreaterThan(250);
  });

  it('found a plausible number of numeric params', () => {
    expect(fields.filter((f) => f.required).length).toBeGreaterThan(300);
    expect(fields.filter(isPagination).length).toBeGreaterThan(100);
  });

  it('no REQUIRED numeric param rejects its own string form', () => {
    // A required param that rejects "3" makes its tool uncallable from a
    // string-serializing client — there is no way to omit it.
    const offenders = fields
      .filter((f) => f.required && f.rejectedAsString.length > 0)
      .map((f) => `${f.tool}.${f.param} (rejects ${f.rejectedAsString.map((v) => `"${v}"`).join(', ')})`);
    expect(
      offenders,
      `use the intCoerce-backed schemas from src/schemas/common.ts for: ${offenders.join('; ')}`,
    ).toEqual([]);
  });

  it('no index/nValues pagination param rejects its own string form', () => {
    const offenders = fields
      .filter((f) => isPagination(f) && f.rejectedAsString.length > 0)
      .map((f) => `${f.tool}.${f.param} (rejects ${f.rejectedAsString.map((v) => `"${v}"`).join(', ')})`);
    expect(
      offenders,
      `use PaginationParams / paginationWithDefaults for: ${offenders.join('; ')}`,
    ).toEqual([]);
  });
});
