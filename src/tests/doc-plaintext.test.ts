import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  DEFAULT_MAX_CHARS,
  MAX_PAGES_PER_CALL,
  buildPlaintextDocument,
  extractPageNumbers,
  fetchDocPlaintext,
  registerCollectionDocumentTools,
  selectPageRange,
} from '../tools/collections-documents.js';

/** The real fulldoc shape: TrpDoc's @XmlElementWrapper("pageList") over List<TrpPage>. */
function fulldoc(pageNumbers: number[]) {
  return {
    md: { docId: 7, title: 'Test' },
    pageList: { pages: pageNumbers.map((pageNr) => ({ pageId: 1000 + pageNr, pageNr })) },
  };
}

describe('extractPageNumbers', () => {
  it('reads pageNr out of the real pageList.pages shape', () => {
    expect(extractPageNumbers(fulldoc([1, 2, 3]))).toEqual([1, 2, 3]);
  });

  it('sorts and de-duplicates', () => {
    expect(extractPageNumbers(fulldoc([3, 1, 2, 1]))).toEqual([1, 2, 3]);
  });

  it('returns an empty list for a missing, empty or malformed pageList', () => {
    expect(extractPageNumbers(null)).toEqual([]);
    expect(extractPageNumbers({})).toEqual([]);
    expect(extractPageNumbers({ pageList: {} })).toEqual([]);
    expect(extractPageNumbers({ pageList: { pages: 'nope' } })).toEqual([]);
    expect(extractPageNumbers({ pageList: { pages: [{ pageNr: 'x' }, {}] } })).toEqual([]);
  });
});

describe('selectPageRange', () => {
  const all = [1, 2, 3, 4, 5];

  it('returns every page when no range is given', () => {
    expect(selectPageRange(all)).toEqual({ pages: all, omitted: [] });
  });

  it('honours an inclusive start and end', () => {
    expect(selectPageRange(all, 2, 4).pages).toEqual([2, 3, 4]);
  });

  it('returns nothing for a reversed range', () => {
    expect(selectPageRange(all, 4, 2)).toEqual({ pages: [], omitted: [] });
  });

  it('returns nothing for a start past the last page', () => {
    expect(selectPageRange(all, 99)).toEqual({ pages: [], omitted: [] });
  });

  it('works on sparse, non-contiguous page numbering', () => {
    // Page numbers come from the document, so gaps need no special case.
    expect(selectPageRange([1, 5, 17, 40], 5, 17).pages).toEqual([5, 17]);
  });

  it('takes exactly maxPages and reports the rest as omitted', () => {
    const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(selectPageRange(hundred, undefined, undefined, MAX_PAGES_PER_CALL)).toEqual({
      pages: hundred,
      omitted: [],
    });

    const hundredOne = Array.from({ length: 101 }, (_, i) => i + 1);
    const clamped = selectPageRange(hundredOne, undefined, undefined, MAX_PAGES_PER_CALL);
    expect(clamped.pages).toHaveLength(100);
    expect(clamped.omitted).toEqual([101]);
  });
});

describe('buildPlaintextDocument', () => {
  it('uses the exact "--- page N ---" separator', () => {
    const { text } = buildPlaintextDocument([{ pageNr: 4, text: 'hello' }], DEFAULT_MAX_CHARS);
    expect(text).toBe('--- page 4 ---\nhello\n');
  });

  it('counts separators and newlines against the budget, not just page text', () => {
    const chunk = '--- page 1 ---\nabc\n'; // 19 chars
    expect(chunk).toHaveLength(19);
    // A budget that fits the text but not the separator must stop after page 1.
    const { used, nextStartPage } = buildPlaintextDocument(
      [{ pageNr: 1, text: 'abc' }, { pageNr: 2, text: 'abc' }],
      20
    );
    expect(used.map((u) => u.pageNr)).toEqual([1]);
    expect(nextStartPage).toBe(2);
  });

  it('stops exactly at the budget boundary without dropping a page that fits', () => {
    const { used, nextStartPage } = buildPlaintextDocument(
      [{ pageNr: 1, text: 'abc' }, { pageNr: 2, text: 'abc' }],
      38 // exactly two 19-char chunks
    );
    expect(used.map((u) => u.pageNr)).toEqual([1, 2]);
    expect(nextStartPage).toBeUndefined();
  });

  it('always returns the first page whole, even when it alone exceeds the budget', () => {
    // Refusing it would leave no way to read that page at all, and no
    // nextStartPage that could make progress.
    const { text, used, nextStartPage } = buildPlaintextDocument(
      [{ pageNr: 1, text: 'x'.repeat(5000) }, { pageNr: 2, text: 'y' }],
      100
    );
    expect(used.map((u) => u.pageNr)).toEqual([1]);
    expect(text.length).toBeGreaterThan(5000);
    expect(nextStartPage).toBe(2); // progress is still possible
  });

  it('renders a failed page inline instead of omitting it', () => {
    const { text } = buildPlaintextDocument([{ pageNr: 2, error: 'HTTP 404' }], DEFAULT_MAX_CHARS);
    expect(text).toBe('--- page 2 ---\n[error: HTTP 404]\n');
  });
});

describe('fetchDocPlaintext', () => {
  function deps(pages: number[], plaintext: (pageNr: number) => Promise<unknown>) {
    const fulldocCalls: unknown[] = [];
    return {
      fulldocCalls,
      deps: {
        getFulldoc: async () => { fulldocCalls.push(true); return fulldoc(pages); },
        getPagePlaintext: plaintext,
      },
    };
  }

  it('concatenates every page in order', async () => {
    const { deps: d } = deps([1, 2, 3], async (nr) => `text ${nr}`);
    const result = await fetchDocPlaintext(d, { collId: 1, id: 7, maxChars: DEFAULT_MAX_CHARS });

    expect(result.text).toBe('--- page 1 ---\ntext 1\n--- page 2 ---\ntext 2\n--- page 3 ---\ntext 3\n');
    expect(result.pageCount).toBe(3);
    expect(result.startPage).toBe(1);
    expect(result.endPage).toBe(3);
    expect(result.truncated).toBe(false);
    expect(result.nextStartPage).toBeUndefined();
  });

  it('keeps the other pages when one fails', async () => {
    const { deps: d } = deps([1, 2, 3], async (nr) => {
      if (nr === 2) throw new Error('no transcript');
      return `text ${nr}`;
    });
    const result = await fetchDocPlaintext(d, { collId: 1, id: 7, maxChars: DEFAULT_MAX_CHARS });

    expect(result.pageCount).toBe(3);
    expect(result.text).toContain('[error: no transcript]');
    expect(result.text).toContain('text 3');
    expect((result.pages as Array<{ pageNr: number; error?: string }>)[1].error).toBe('no transcript');
  });

  it('reports nextStartPage when the page clamp truncates', async () => {
    const many = Array.from({ length: 101 }, (_, i) => i + 1);
    const { deps: d } = deps(many, async () => 'x');
    const result = await fetchDocPlaintext(d, { collId: 1, id: 7, maxChars: DEFAULT_MAX_CHARS });

    expect(result.pageCount).toBe(MAX_PAGES_PER_CALL);
    expect(result.truncated).toBe(true);
    expect(result.nextStartPage).toBe(101);
  });

  it('reports nextStartPage when the character budget truncates', async () => {
    const { deps: d } = deps([1, 2, 3], async () => 'x'.repeat(50));
    const result = await fetchDocPlaintext(d, { collId: 1, id: 7, maxChars: 100 });

    expect(result.truncated).toBe(true);
    expect(result.nextStartPage).toBe(2);
    expect(result.charCount).toBeLessThanOrEqual(100);
  });

  it('returns an empty result, not an error, for a range that selects nothing', async () => {
    const { deps: d } = deps([1, 2, 3], async () => 'x');
    const result = await fetchDocPlaintext(d, { collId: 1, id: 7, startPage: 9, maxChars: DEFAULT_MAX_CHARS });

    expect(result.pageCount).toBe(0);
    expect(result.text).toBe('');
    expect(result.truncated).toBe(false);
    expect(result.startPage).toBeNull();
  });

  it('produces a plain object, never an array — structuredContent must be a Record', async () => {
    const { deps: d } = deps([1], async () => 'x');
    const result = await fetchDocPlaintext(d, { collId: 1, id: 7, maxChars: DEFAULT_MAX_CHARS });
    expect(Array.isArray(result)).toBe(false);
    expect(typeof result).toBe('object');
  });
});

describe('transkribus_doc_get_plaintext registration', () => {
  function tool() {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerCollectionDocumentTools(server);
    return (server as unknown as {
      _registeredTools: Record<string, { inputSchema?: z.ZodTypeAny; description?: string }>;
    })._registeredTools['transkribus_doc_get_plaintext'];
  }

  it('requires only collId and id', () => {
    const schema = z.toJSONSchema(tool().inputSchema!, { io: 'input' }) as { required?: string[] };
    expect(schema.required?.sort()).toEqual(['collId', 'id']);
  });

  it('states its budgets in the description', () => {
    const description = tool().description ?? '';
    expect(description).toContain(String(MAX_PAGES_PER_CALL));
    expect(description).toContain(String(DEFAULT_MAX_CHARS));
  });
});
