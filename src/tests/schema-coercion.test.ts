import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { fullEntry, registerAll } from '../entries.js';

// Two ratchets from issue #33, both scanning the whole registered tool surface
// so a new tool cannot quietly reintroduce what the sweep cleaned up.
//
// COERCION. MCP clients sometimes serialize numbers as JSON strings;
// `intCoerce` (src/schemas/common.ts) exists so that "3" is accepted wherever 3
// is. v2.0.1 applied it to 191 params and #33 swept up the 24 required
// stragglers. A newly added tool that hand-rolls `z.number()` for a REQUIRED
// param, or for index/nValues, fails here with the offending tool.param named.
//
// ADVERTISED DEFAULTS, in the second describe block below: a param whose default
// the server applies but never publishes.
//
// Deliberately NOT covered: OPTIONAL params that still reject string numbers
// (137 of them when this was written). A client can omit an optional filter, so
// the tool stays usable, and that count moves whenever anyone adds any optional
// numeric param — freezing it would produce noise rather than defects.

type RegisteredTools = Record<string, { inputSchema?: z.ZodObject }>;

function registerEveryTool(): RegisteredTools {
  const server = new McpServer({ name: 'coercion-test', version: '0.0.0' });
  registerAll(server, fullEntry);
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
  /** Probed values the field accepts but whose string form it rejects — the defect. */
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

function isPagination(field: NumericField): boolean {
  return field.param === 'index' || field.param === 'nValues';
}

// Both assertions below are "this list is empty"; only the selector and the
// remediation hint differ.
function offendersMatching(selector: (field: NumericField) => boolean): string[] {
  return fields
    .filter((field) => selector(field) && field.rejectedAsString.length > 0)
    .map((field) => `${field.tool}.${field.param} (rejects ${field.rejectedAsString.map((v) => `"${v}"`).join(', ')})`);
}

describe('string-encoded numbers are accepted wherever a number is (issue #33)', () => {
  // Non-vacuity guards. Every assertion below is "the offender list is empty",
  // and an empty scan produces exactly that, so a scan that silently stopped
  // finding fields would look identical to a pass.
  it('registers every module under src/tools/', () => {
    const toolsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../tools');
    const modules = readdirSync(toolsDir).filter((f) => f.endsWith('.ts'));
    // A new tool module missing from fullEntry is not served by the full entry
    // point at all, and would also never be scanned by the assertions below.
    expect(modules.length).toBe(fullEntry.length);
    expect(Object.keys(tools).length).toBeGreaterThan(250);
  });

  it('found a plausible number of numeric params', () => {
    expect(fields.filter((f) => f.required).length).toBeGreaterThan(300);
    expect(fields.filter(isPagination).length).toBeGreaterThan(100);
  });

  it('no REQUIRED numeric param rejects its own string form', () => {
    // A required param that rejects "3" makes its tool uncallable from a
    // string-serializing client — there is no way to omit it.
    const offenders = offendersMatching((field) => field.required);
    expect(
      offenders,
      `use the intCoerce-backed schemas from src/schemas/common.ts for: ${offenders.join('; ')}`,
    ).toEqual([]);
  });

  it('no index/nValues pagination param rejects its own string form', () => {
    const offenders = offendersMatching(isPagination);
    expect(
      offenders,
      `use PaginationParams / paginationWithDefaults for: ${offenders.join('; ')}`,
    ).toEqual([]);
  });
});

interface AppliedDefault {
  tool: string;
  param: string;
  value: unknown;
  advertised: boolean;
}

// Params the server substitutes a value for when the client omits them.
const appliedDefaults: AppliedDefault[] = [];
for (const [tool, def] of Object.entries(tools)) {
  if (!def.inputSchema) continue;
  const emitted = z.toJSONSchema(def.inputSchema, { io: 'input' }) as {
    properties?: Record<string, { default?: unknown }>;
  };
  for (const [param, schema] of Object.entries(def.inputSchema.shape as Record<string, z.ZodType>)) {
    const parsed = schema.safeParse(undefined);
    if (!parsed.success || parsed.data === undefined) continue;
    appliedDefaults.push({
      tool,
      param,
      value: parsed.data,
      advertised: emitted.properties?.[param]?.default !== undefined,
    });
  }
}

describe('a param that applies a default also advertises it (issue #33)', () => {
  // These defaults are wire behaviour: params go straight into the query string,
  // so `nValues=0` and an omitted `nValues` are different HTTP requests. A client
  // that is not told about the substitution cannot reason about what it sends.
  //
  // The trap this guards: zod 4 renders a z.preprocess pipe — which is every
  // intCoerce param — from its input leg when emitting JSON Schema in INPUT mode,
  // and drops a `default` attached to any outer wrapper. `.optional().default(N)`
  // therefore applies N at runtime while advertising nothing. `.prefault(N)`
  // survives the emit; see the comment on the factories in src/schemas/common.ts.
  it('found a plausible number of defaulted params', () => {
    expect(appliedDefaults.length).toBeGreaterThan(100);
  });

  it('advertises every default it applies', () => {
    const silent = appliedDefaults
      .filter((d) => !d.advertised)
      .map((d) => `${d.tool}.${d.param}=${JSON.stringify(d.value)}`);
    expect(
      silent,
      `use .prefault(value) instead of .optional().default(value) for: ${silent.join(', ')}`,
    ).toEqual([]);
  });
});
