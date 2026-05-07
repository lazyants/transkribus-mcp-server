import { z } from 'zod';

// MCP clients occasionally serialize numeric IDs as JSON strings. Coerce only
// integer-looking strings ("123", "-1"); anything else (booleans, "", "1.5",
// objects) falls through to the inner schema and is rejected normally.
// Strings outside JS safe-integer range pass through as-is so Zod rejects
// them instead of silently rounding (e.g. "9007199254740993" → 9007199254740992).
// Zod 4 models z.preprocess as a pipe whose input leg is tagged
// `optin: "optional"`. MCP `tools/list` runs JSON Schema emit in INPUT mode,
// so every intCoerce-wrapped required param ends up missing from `required[]`
// — clients omit the field at call time, server rejects, opaque failure.
// Fix: clear the `optin` markers on both surfaces the emitter consults.
// Asserted at construction time so a future Zod minor that renames these
// internals fails loudly instead of silently no-op'ing the fix.
//
// .optional() builds a separate ZodOptional wrapper with its own optin
// semantics, so `intCoerce(...).optional()` continues to be excluded from
// `required[]` as expected.
function clearOptinMarker(schema: z.ZodType): void {
  const def = (schema as { _def?: { in?: { _zod?: { optin?: unknown } } } })._def;
  const zod = (schema as { _zod?: { optin?: unknown } })._zod;
  if (def?.in?._zod?.optin !== 'optional' || zod?.optin !== 'optional') {
    throw new Error(
      'intCoerce: Zod 4 internals changed — _def.in._zod.optin / _zod.optin no longer ' +
      "marked 'optional' on z.preprocess output. Update intCoerce in src/schemas/common.ts " +
      'to clear the new marker, or required intCoerce fields will silently drop from MCP ' +
      'tools/list `required[]`.',
    );
  }
  def.in._zod.optin = undefined;
  zod.optin = undefined;
}

export const intCoerce = <T extends z.ZodNumber>(inner: T) => {
  const schema = z.preprocess(
    (v) => {
      if (typeof v !== 'string' || !/^-?\d+$/.test(v)) return v;
      const n = Number(v);
      return Number.isSafeInteger(n) ? n : v;
    },
    inner,
  );
  clearOptinMarker(schema);
  return schema;
};

export const CollIdSchema = intCoerce(z.number().int().positive()).describe('Collection ID');
export const DocIdSchema = intCoerce(z.number().int().positive()).describe('Document ID');
export const PageNrSchema = intCoerce(z.number().int().min(1)).describe('Page number');
export const ModelIdSchema = intCoerce(z.number().int().positive()).describe('Model/HTR ID');
export const IdSchema = intCoerce(z.number().int().positive()).describe('Resource ID');
export const TranscriptIdSchema = intCoerce(z.number().int().positive()).describe('Transcript ID');

export const PaginationParams = {
  index: intCoerce(z.number().int().min(0)).optional().describe('Start index (0-based)'),
  nValues: intCoerce(z.number().int()).optional().describe('Number of results (-1 for all)'),
  sortColumn: z.string().optional().describe('Column to sort by'),
  sortDirection: z.string().optional().describe('Sort direction: asc or desc'),
};
