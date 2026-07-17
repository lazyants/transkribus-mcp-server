import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CollIdSchema,
  DocIdSchema,
  PageNrSchema,
  ModelIdSchema,
  IdSchema,
  TranscriptIdSchema,
  PaginationParams,
  intCoerce,
  pathSeg,
  PathSegmentSchema,
} from '../schemas/common.js';

// GOTCHA: vi.mock is hoisted above top-level const declarations — use vi.hoisted()
// so the mock fn is accessible both inside the factory and in the test bodies below.
const { transkribusRequestMock } = vi.hoisted(() => ({
  transkribusRequestMock: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('../services/transkribus.js', () => ({
  transkribusRequest: transkribusRequestMock,
}));

import { registerAdminTools } from '../tools/admin.js';
import { registerModelTools } from '../tools/models.js';

// Internal McpServer shape — same access pattern contracts.test.ts / smoke.test.ts use.
type RegisteredTool = { inputSchema?: z.ZodObject<z.ZodRawShape>; handler: (params: unknown) => Promise<unknown> };
function getRegisteredTool(server: McpServer, name: string): RegisteredTool {
  const tool = (server as unknown as { _registeredTools: Record<string, RegisteredTool> })._registeredTools[name];
  if (!tool) throw new Error(`tool ${name} not registered`);
  return tool;
}

// Source text of the two files Lane B owns, for the source-level exhaustive
// contract below (independent of the runtime registration checks).
const toolsDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'tools');
const adminSrc = readFileSync(resolve(toolsDir, 'admin.ts'), 'utf8');
const modelsSrc = readFileSync(resolve(toolsDir, 'models.ts'), 'utf8');

describe('shared schemas — int coercion', () => {
  it('accepts integer-string IDs', () => {
    expect(CollIdSchema.safeParse('1969970').success).toBe(true);
    expect(CollIdSchema.parse('1969970')).toBe(1969970);
    expect(DocIdSchema.safeParse('42').success).toBe(true);
    expect(ModelIdSchema.safeParse('532897').success).toBe(true);
    expect(IdSchema.safeParse('532897').success).toBe(true);
    expect(TranscriptIdSchema.safeParse('987654').success).toBe(true);
    expect(PageNrSchema.safeParse('1').success).toBe(true);
  });

  it('accepts native number IDs (no regression)', () => {
    expect(CollIdSchema.safeParse(1969970).success).toBe(true);
    expect(PageNrSchema.safeParse(1).success).toBe(true);
  });

  it('rejects booleans (guards against z.coerce.number footgun)', () => {
    expect(CollIdSchema.safeParse(true).success).toBe(false);
    expect(CollIdSchema.safeParse(false).success).toBe(false);
    expect(IdSchema.safeParse(true).success).toBe(false);
  });

  it('rejects empty strings and non-numeric strings', () => {
    expect(CollIdSchema.safeParse('').success).toBe(false);
    expect(CollIdSchema.safeParse('abc').success).toBe(false);
    expect(CollIdSchema.safeParse('12.5').success).toBe(false);
  });

  it('rejects zero/negative on positive-only ID schemas', () => {
    expect(CollIdSchema.safeParse('0').success).toBe(false);
    expect(CollIdSchema.safeParse('-1').success).toBe(false);
    expect(PageNrSchema.safeParse('0').success).toBe(false);
  });

  it('accepts MAX_SAFE_INTEGER and rejects beyond (no silent rounding)', () => {
    expect(CollIdSchema.safeParse(String(Number.MAX_SAFE_INTEGER)).success).toBe(true);
    expect(CollIdSchema.parse(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
    expect(CollIdSchema.safeParse('9007199254740993').success).toBe(false);
    expect(CollIdSchema.safeParse('99999999999999999999').success).toBe(false);
  });

  it('rejects whitespace-padded and decimal-looking strings', () => {
    expect(CollIdSchema.safeParse(' 1 ').success).toBe(false);
    expect(CollIdSchema.safeParse('1.0').success).toBe(false);
    expect(CollIdSchema.safeParse('1 ').success).toBe(false);
  });
});

describe('PaginationParams — int coercion', () => {
  it('index accepts "0" and rejects empty/negative/boolean', () => {
    expect(PaginationParams.index.safeParse('0').success).toBe(true);
    expect(PaginationParams.index.safeParse(0).success).toBe(true);
    expect(PaginationParams.index.safeParse('').success).toBe(false);
    expect(PaginationParams.index.safeParse('-1').success).toBe(false);
    expect(PaginationParams.index.safeParse(true).success).toBe(false);
    expect(PaginationParams.index.safeParse(undefined).success).toBe(true);
  });

  it('nValues accepts "-1" (Transkribus "all" convention) and integers', () => {
    expect(PaginationParams.nValues.safeParse('-1').success).toBe(true);
    expect(PaginationParams.nValues.parse('-1')).toBe(-1);
    expect(PaginationParams.nValues.safeParse(-1).success).toBe(true);
    expect(PaginationParams.nValues.safeParse('100').success).toBe(true);
    expect(PaginationParams.nValues.safeParse('').success).toBe(false);
    expect(PaginationParams.nValues.safeParse(false).success).toBe(false);
    expect(PaginationParams.nValues.safeParse(undefined).success).toBe(true);
  });

  it('index applies defaults when omitted but still rejects empty string', () => {
    const withDefault = z.object({
      index: intCoerce(z.number().int().min(0)).optional().default(0),
    });
    expect(withDefault.parse({})).toEqual({ index: 0 });
    expect(withDefault.parse({ index: '1' })).toEqual({ index: 1 });
    expect(withDefault.parse({ index: undefined })).toEqual({ index: 0 });
    expect(withDefault.safeParse({ index: '' }).success).toBe(false);
  });
});

describe('intCoerce — JSON Schema emit (input mode, MCP tools/list path)', () => {
  it('keeps required intCoerce-wrapped fields in JSON Schema required[]', () => {
    const obj = z.object({
      collId: CollIdSchema,
      plain: z.number().int(),
    });
    const schema = z.toJSONSchema(obj, { io: 'input' });
    expect(schema.required).toContain('collId');
    expect(schema.required).toContain('plain');
  });

  it('still omits .optional() intCoerce fields from required[]', () => {
    const obj = z.object({
      index: PaginationParams.index,
      collId: CollIdSchema,
    });
    const schema = z.toJSONSchema(obj, { io: 'input' });
    expect(schema.required).toContain('collId');
    expect(schema.required ?? []).not.toContain('index');
  });
});

describe('pathSeg — URL path-segment encoder', () => {
  it('percent-encodes reserved URL characters and space', () => {
    expect(pathSeg('a/b')).toBe('a%2Fb');
    expect(pathSeg('a?b')).toBe('a%3Fb');
    expect(pathSeg('a#b')).toBe('a%23b');
    expect(pathSeg('a%b')).toBe('a%25b');
    expect(pathSeg('a b')).toBe('a%20b');
  });

  it('encodes numbers via String() coercion', () => {
    expect(pathSeg(42)).toBe('42');
    expect(pathSeg(0)).toBe('0');
  });

  // encodeURIComponent does NOT escape '.', so these all round-trip unchanged.
  // This is exactly the blind spot PathSegmentSchema exists to close — pathSeg
  // alone never stops '..' from reaching a URL template that supplies its own
  // literal slashes (e.g. `/models/${pathSeg(type)}/${id}`).
  it('does NOT escape "." or ".." (the traversal blind spot — schema layer must catch this)', () => {
    expect(pathSeg('')).toBe('');
    expect(pathSeg('.')).toBe('.');
    expect(pathSeg('..')).toBe('..');
  });
});

describe('PathSegmentSchema — schema-layer traversal guard', () => {
  it('rejects "", ".", "..", embedded slashes, and whitespace', () => {
    expect(PathSegmentSchema.safeParse('').success).toBe(false);
    expect(PathSegmentSchema.safeParse('.').success).toBe(false);
    expect(PathSegmentSchema.safeParse('..').success).toBe(false);
    expect(PathSegmentSchema.safeParse('a/b').success).toBe(false);
    expect(PathSegmentSchema.safeParse('../etc/passwd').success).toBe(false);
    expect(PathSegmentSchema.safeParse(' ').success).toBe(false);
    expect(PathSegmentSchema.safeParse('a b').success).toBe(false);
    expect(PathSegmentSchema.safeParse('a\tb').success).toBe(false);
  });

  it('accepts a plain segment and segments containing reserved-but-encodable characters', () => {
    expect(PathSegmentSchema.safeParse('htr').success).toBe(true);
    expect(PathSegmentSchema.safeParse('a?b').success).toBe(true);
    expect(PathSegmentSchema.safeParse('a#b').success).toBe(true);
    expect(PathSegmentSchema.safeParse('a%b').success).toBe(true);
  });

  // Split per the plan: traversal must be rejected at the schema layer BEFORE
  // any URL is constructed — this does not depend on pathSeg() at all.
  it('rejects a traversal value before any URL-building code runs', () => {
    const result = PathSegmentSchema.safeParse('..');
    expect(result.success).toBe(false);
    // No URL was ever built from this value — nothing to assert about pathSeg()
    // here; the point is the reject happens at parse time, upstream of it.
  });
});

describe('path segment guard — interpolation layer builds a percent-encoded URL', () => {
  // These prove the OTHER layer: given a value the schema already accepts
  // (no '/', no whitespace, not '.'/'..'), pathSeg() still encodes reserved
  // characters before the value reaches the URL template.
  it('transkribus_admin_get_reports encodes reportType and reportTime independently', async () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerAdminTools(server);
    const tool = getRegisteredTool(server, 'transkribus_admin_get_reports');
    transkribusRequestMock.mockClear();
    await tool.handler({ reportType: 'a?b', reportTime: 'c#d' });
    expect(transkribusRequestMock).toHaveBeenCalledTimes(1);
    const [, url] = transkribusRequestMock.mock.calls[0]!;
    expect(url).toBe('/admin/reports/a%3Fb/c%23d');
  });

  it('transkribus_model_get_by_type encodes the type segment', async () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerModelTools(server);
    const tool = getRegisteredTool(server, 'transkribus_model_get_by_type');
    transkribusRequestMock.mockClear();
    await tool.handler({ type: 'a?b#c%d' });
    expect(transkribusRequestMock).toHaveBeenCalledTimes(1);
    const [, url] = transkribusRequestMock.mock.calls[0]!;
    expect(url).toBe(`/models/${encodeURIComponent('a?b#c%d')}`);
  });
});

describe('path segment guard — registered tool schemas (runtime, 17 tools / 18 fields)', () => {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerAdminTools(server);
  registerModelTools(server);

  // Every tool that interpolates a caller-supplied value directly into a REST
  // path template (D2/#32a). Hand-listed here so each pair gets a direct
  // runtime assertion; drift against the actual source is independently
  // caught by the source-level contract below (which fails if this table and
  // the code disagree on the count).
  const PATH_SEGMENT_FIELDS: Record<string, string[]> = {
    transkribus_admin_get_reports: ['reportType', 'reportTime'],
    transkribus_admin_authorize_users_for_job: ['jobImpl'],
    transkribus_admin_get_job_users: ['jobImpl'],
    transkribus_model_get_by_type: ['type'],
    transkribus_model_get_details: ['type'],
    transkribus_model_update_by_type: ['type'],
    transkribus_model_delete_by_type: ['type'],
    transkribus_model_list_collections: ['type'],
    transkribus_model_get_field_params: ['type'],
    transkribus_model_get_train_data: ['type'],
    transkribus_model_get_train_data_docs: ['type'],
    transkribus_model_get_train_data_stats: ['type'],
    transkribus_model_get_validation_data: ['type'],
    transkribus_model_get_validation_data_docs: ['type'],
    transkribus_model_get_validation_data_stats: ['type'],
    transkribus_model_add_collection: ['type'],
    transkribus_model_remove_collection: ['type'],
  };

  const entries = Object.entries(PATH_SEGMENT_FIELDS).flatMap(([tool, fields]) =>
    fields.map((field) => [tool, field] as const)
  );

  it('lists exactly 17 tools / 18 (tool, field) pairs', () => {
    expect(Object.keys(PATH_SEGMENT_FIELDS).length).toBe(17);
    expect(entries.length).toBe(18);
  });

  it.each(entries)('%s field "%s" is wired to PathSegmentSchema behavior', (toolName, field) => {
    const tool = getRegisteredTool(server, toolName);
    const shape = tool.inputSchema?.shape as Record<string, z.ZodTypeAny> | undefined;
    const fieldSchema = shape?.[field];
    expect(fieldSchema, `${toolName} has no field "${field}"`).toBeDefined();
    expect(fieldSchema!.safeParse('..').success).toBe(false);
    expect(fieldSchema!.safeParse('.').success).toBe(false);
    expect(fieldSchema!.safeParse('').success).toBe(false);
    expect(fieldSchema!.safeParse('a/b').success).toBe(false);
    expect(fieldSchema!.safeParse(' ').success).toBe(false);
    expect(fieldSchema!.safeParse('htr').success).toBe(true);
  });
});

describe('path segment guard — source-level exhaustive contract (independent of the hand-list above)', () => {
  // Regex-based structural scan, not the Zod runtime: proves the COUNT and
  // CO-LOCATION of both required layers directly from source text, so this
  // fails even if someone edits admin.ts/models.ts without touching the
  // hand-maintained table in the describe block above. Per the plan (codex
  // R1/R2): a test that only proves "wrapped in pathSeg()?" is insufficient
  // on its own, because a field left as bare z.string() still greenlights
  // that check while traversal survives — so this asserts BOTH (a) every
  // pathSeg(x) interpolation AND (b) every corresponding `x: PathSegmentSchema`
  // declaration, paired per `server.registerTool(...)` block, not just as two
  // coincidentally-equal global totals.
  type ToolBlock = { name: string; text: string };

  function extractToolBlocks(source: string): ToolBlock[] {
    return source
      .split('server.registerTool(')
      .slice(1)
      .map((chunk) => {
        const nameMatch = /^\s*['"]([^'"]+)['"]/.exec(chunk);
        if (!nameMatch) {
          throw new Error('extractToolBlocks: could not find a tool name after server.registerTool(');
        }
        return { name: nameMatch[1]!, text: chunk };
      });
  }

  function matchAll(re: RegExp, text: string): string[] {
    const out: string[] = [];
    const local = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    let m: RegExpExecArray | null;
    while ((m = local.exec(text))) out.push(m[1]!);
    return out;
  }

  const PATH_SEG_CALL_RE = /\$\{pathSeg\((\w+)\)\}/;
  const PATH_SEG_SCHEMA_RE = /(\w+):\s*PathSegmentSchema\b/;

  const blocks = [...extractToolBlocks(adminSrc), ...extractToolBlocks(modelsSrc)];

  it('found tool blocks to scan (sanity guard against a silent split-on-refactor)', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(17);
  });

  it('every pathSeg(x)-interpolated field has an "x: PathSegmentSchema" declaration in the SAME tool block', () => {
    for (const { name, text } of blocks) {
      const interpolated = matchAll(PATH_SEG_CALL_RE, text);
      const declared = new Set(matchAll(PATH_SEG_SCHEMA_RE, text));
      for (const field of interpolated) {
        expect(declared.has(field), `${name}: "${field}" is pathSeg()-wrapped but not declared PathSegmentSchema in the same block`).toBe(true);
      }
    }
  });

  it('totals exactly 18 pathSeg() interpolations and 18 PathSegmentSchema declarations', () => {
    let totalInterpolations = 0;
    let totalSchemaDecls = 0;
    for (const { text } of blocks) {
      totalInterpolations += matchAll(PATH_SEG_CALL_RE, text).length;
      totalSchemaDecls += new Set(matchAll(PATH_SEG_SCHEMA_RE, text)).size;
    }
    // 18 = reportType + reportTime + jobImpl (x2 separate tool declarations) + type (x14).
    // A newly-added tool that copy-pastes the old `type: z.string()` pattern, or
    // that pathSeg()-wraps an interpolation without switching its schema field,
    // drifts one of these counts away from 18 and fails here.
    expect(totalInterpolations).toBe(18);
    expect(totalSchemaDecls).toBe(18);
  });
});
