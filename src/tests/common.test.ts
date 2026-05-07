import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  CollIdSchema,
  DocIdSchema,
  PageNrSchema,
  ModelIdSchema,
  IdSchema,
  TranscriptIdSchema,
  PaginationParams,
  intCoerce,
} from '../schemas/common.js';

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
