import { z } from 'zod';

// MCP clients occasionally serialize numeric IDs as JSON strings. Coerce only
// integer-looking strings ("123", "-1"); anything else (booleans, "", "1.5",
// objects) falls through to the inner schema and is rejected normally.
// Strings outside JS safe-integer range pass through as-is so Zod rejects
// them instead of silently rounding (e.g. "9007199254740993" → 9007199254740992).
export const intCoerce = <T extends z.ZodNumber>(inner: T) =>
  z.preprocess(
    (v) => {
      if (typeof v !== 'string' || !/^-?\d+$/.test(v)) return v;
      const n = Number(v);
      return Number.isSafeInteger(n) ? n : v;
    },
    inner,
  );

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
