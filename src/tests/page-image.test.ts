import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import axios, { AxiosError, AxiosHeaders } from 'axios';
import { assertTranskribusImageUrl, fetchImageBytes } from '../services/transkribus.js';
import {
  DEFAULT_IMAGE_MAX_BYTES,
  buildImageResult,
  pickPageImageUrl,
  registerCollectionPageTools,
} from '../tools/collections-pages.js';

describe('assertTranskribusImageUrl', () => {
  it('accepts the API host and its subdomains over https', () => {
    expect(assertTranskribusImageUrl('https://transkribus.eu/x.jpg').hostname).toBe('transkribus.eu');
    expect(assertTranskribusImageUrl('https://files.transkribus.eu/Get?id=abc&fileType=thumb').hostname)
      .toBe('files.transkribus.eu');
  });

  it('rejects a look-alike host that merely ENDS with the domain text', () => {
    // The suffix check is dot-prefixed on purpose: 'evil-transkribus.eu' ends
    // with 'transkribus.eu' as a string but is a different registrable domain.
    expect(() => assertTranskribusImageUrl('https://evil-transkribus.eu/x.jpg')).toThrow(/outside transkribus\.eu/);
  });

  it('rejects userinfo smuggling — the real host is what follows the @', () => {
    expect(() => assertTranskribusImageUrl('https://transkribus.eu@evil.example/x.jpg'))
      .toThrow(/outside transkribus\.eu/);
  });

  it('rejects internal and link-local targets', () => {
    for (const raw of [
      'https://localhost/x.jpg',
      'https://127.0.0.1/x.jpg',
      'https://169.254.169.254/latest/meta-data/',
      'https://192.168.1.1/x.jpg',
    ]) {
      expect(() => assertTranskribusImageUrl(raw)).toThrow(/outside transkribus\.eu/);
    }
  });

  it('rejects non-https schemes, including file: and data:', () => {
    expect(() => assertTranskribusImageUrl('http://transkribus.eu/x.jpg')).toThrow(/non-https/);
    expect(() => assertTranskribusImageUrl('file:///etc/passwd')).toThrow(/non-https/);
    expect(() => assertTranskribusImageUrl('data:image/png;base64,AAAA')).toThrow(/non-https/);
  });

  it('rejects a missing, empty, non-string or unparseable value', () => {
    expect(() => assertTranskribusImageUrl(undefined)).toThrow(/missing/);
    expect(() => assertTranskribusImageUrl(null)).toThrow(/missing/);
    expect(() => assertTranskribusImageUrl('')).toThrow(/missing/);
    expect(() => assertTranskribusImageUrl(42)).toThrow(/missing/);
    expect(() => assertTranskribusImageUrl('not a url')).toThrow(/not a valid URL/);
  });
});

describe('fetchImageBytes wiring', () => {
  /** Capture the axios config without any network access. */
  async function capturedConfig(): Promise<Record<string, unknown>> {
    const original = axios.get;
    let seen: Record<string, unknown> = {};
    (axios as unknown as { get: unknown }).get = async (_url: string, config: Record<string, unknown>) => {
      seen = config;
      return { data: new ArrayBuffer(4), headers: { 'content-type': 'image/jpeg' } };
    };
    try {
      await fetchImageBytes(new URL('https://files.transkribus.eu/Get?id=a'), 1234);
    } finally {
      (axios as unknown as { get: unknown }).get = original;
    }
    return seen;
  }

  it('registers a beforeRedirect callback that re-checks every hop', async () => {
    // A guard that is never wired to the request is a guard that does nothing:
    // assert it is IN the config, then that it actually rejects.
    const config = await capturedConfig();
    const beforeRedirect = config.beforeRedirect as (o: { href: string }) => void;
    expect(typeof beforeRedirect).toBe('function');
    expect(() => beforeRedirect({ href: 'https://files.transkribus.eu/next' })).not.toThrow();
    expect(() => beforeRedirect({ href: 'https://evil.example/next' })).toThrow(/outside transkribus\.eu/);
    expect(() => beforeRedirect({ href: 'http://169.254.169.254/' })).toThrow();
  });

  it('passes the byte cap to axios and does not set maxBodyLength (a GET has no request body)', async () => {
    const config = await capturedConfig();
    expect(config.maxContentLength).toBe(1234);
    expect(config.maxBodyLength).toBeUndefined();
    expect(config.responseType).toBe('arraybuffer');
  });

  it('rejects a non-image response rather than handing the client an unrenderable block', async () => {
    const original = axios.get;
    (axios as unknown as { get: unknown }).get = async () => ({
      data: new ArrayBuffer(4),
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
    try {
      await expect(fetchImageBytes(new URL('https://files.transkribus.eu/a'), 100)).rejects.toThrow(/Expected an image/);
    } finally {
      (axios as unknown as { get: unknown }).get = original;
    }
  });

  it('routes a failed download through the redaction layer, not out raw', async () => {
    // This is the one network call in the module that could bypass
    // wrapAxiosError. It sends no session cookie, so nothing is known to leak
    // today — but an unsanitized AxiosError reaching a caller that inspects it
    // deeply is exactly the class that layer exists to close.
    const original = axios.get;
    (axios as unknown as { get: unknown }).get = async () => {
      const err = new AxiosError('Request failed with status code 404', 'ERR_BAD_REQUEST');
      err.response = {
        status: 404,
        statusText: 'Not Found',
        data: { message: 'no such image' },
        headers: new AxiosHeaders(),
        config: { headers: new AxiosHeaders() },
      } as never;
      throw err;
    };
    try {
      const thrown = await fetchImageBytes(new URL('https://files.transkribus.eu/a'), 100)
        .then(() => null, (e: unknown) => e);
      expect(thrown).toBeInstanceOf(Error);
      expect(thrown).not.toBeInstanceOf(AxiosError);
      // wrapAxiosError's shape — proves the sanitizing path ran.
      expect((thrown as Error).message).toContain('Transkribus API error 404');
    } finally {
      (axios as unknown as { get: unknown }).get = original;
    }
  });

  it('normalizes the mime type off a parameterised content-type header', async () => {
    const original = axios.get;
    (axios as unknown as { get: unknown }).get = async () => ({
      data: new ArrayBuffer(3),
      headers: { 'content-type': 'IMAGE/JPEG; charset=binary' },
    });
    try {
      const { mimeType, data } = await fetchImageBytes(new URL('https://files.transkribus.eu/a'), 100);
      expect(mimeType).toBe('image/jpeg');
      expect(data).toHaveLength(3);
    } finally {
      (axios as unknown as { get: unknown }).get = original;
    }
  });
});

describe('pickPageImageUrl', () => {
  const page = { url: 'https://files.transkribus.eu/full', thumbUrl: 'https://files.transkribus.eu/thumb' };

  it('picks the thumbnail for "thumb" and the full image for "full"', () => {
    expect(pickPageImageUrl(page, 'thumb')).toBe('https://files.transkribus.eu/thumb');
    expect(pickPageImageUrl(page, 'full')).toBe('https://files.transkribus.eu/full');
  });

  it('yields undefined for a page carrying no such URL', () => {
    expect(pickPageImageUrl({}, 'thumb')).toBeUndefined();
    expect(pickPageImageUrl(null, 'full')).toBeUndefined();
  });
});

describe('buildImageResult', () => {
  it('returns a text block plus a valid MCP image block', () => {
    const result = buildImageResult(Buffer.from('PNGDATA'), 'image/png', {
      pageNr: 3,
      size: 'thumb',
      sourceUrl: 'https://files.transkribus.eu/thumb',
    });

    expect(result.content).toHaveLength(2);
    expect(result.content[0]).toMatchObject({ type: 'text' });
    expect(JSON.parse((result.content[0] as { text: string }).text)).toMatchObject({
      pageNr: 3,
      size: 'thumb',
      mimeType: 'image/png',
      bytes: 7,
    });
    expect(result.content[1]).toEqual({
      type: 'image',
      data: Buffer.from('PNGDATA').toString('base64'),
      mimeType: 'image/png',
    });
    // structuredContent would be invalid here — an image result has no Record payload.
    expect(result.structuredContent).toBeUndefined();
  });
});

describe('transkribus_page_get_image registration', () => {
  function tool() {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerCollectionPageTools(server);
    return (server as unknown as {
      _registeredTools: Record<string, { inputSchema?: z.ZodTypeAny; description?: string }>;
    })._registeredTools['transkribus_page_get_image'];
  }

  it('requires collId, id and page, and offers thumb/full', () => {
    const schema = z.toJSONSchema(tool().inputSchema!, { io: 'input' }) as {
      required?: string[];
      properties: Record<string, { enum?: string[] }>;
    };
    expect(schema.required?.sort()).toEqual(['collId', 'id', 'page']);
    expect(schema.properties.size.enum).toEqual(['thumb', 'full']);
  });

  it('states the default size and byte cap in the description', () => {
    const description = tool().description ?? '';
    expect(description).toContain('thumbnail');
    expect(description).toContain(String(DEFAULT_IMAGE_MAX_BYTES));
  });
});
