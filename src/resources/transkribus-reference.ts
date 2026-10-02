import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Transkribus API quick reference, embedded as a compiled string constant so it
 * ships inside `dist` (package.json#files = dist/README/LICENSE/logo.png) and
 * resolves for every npm/npx consumer. A runtime read of a fleet-root markdown
 * file works locally but breaks once the package is installed elsewhere.
 *
 * Built from an array of plain quoted lines joined with '\n' (NOT a template
 * literal) so backtick code fences and `${...}`-style placeholder text in the
 * markdown cannot corrupt the constant.
 */
export const REFERENCE_MD: string = [
  '# Transkribus MCP — API Reference',
  '',
  '**API scope:** This server covers two separate Transkribus APIs:',
  '',
  '- The legacy TrpServer REST API (base `https://transkribus.eu/TrpServer/rest`),',
  '  session-based, covering collections, documents, models, and recognition.',
  '- The Metagrapho Processing API defaults to `https://transkribus.eu/processing/v1`',
  '  with four `transkribus_processing_*` tools. Explicitly select the Developer',
  '  Platform v2 beta with `TRANSKRIBUS_PROCESSING_BACKEND=v2` for six tools at',
  '  `https://api-staging.transkribus.org/v2` (the published staging backend).',
  '  Both use OIDC bearer auth via `account.readcoop.eu`.',
  '',
  'v1 remains the default; production v2 availability has not been confirmed.',
  'Both backends require `config.textRecognition.htrId` for text recognition.',
  '',
  '## Authentication',
  '',
  '- Legacy API: session-based. Provide `TRANSKRIBUS_USER` + `TRANSKRIBUS_PASSWORD`',
  '  for auto-login, or set `TRANSKRIBUS_SESSION_ID` directly.',
  '- Session IDs expire; prefer username + password for long-running setups.',
  '- Processing API: the SAME `TRANSKRIBUS_USER` + `TRANSKRIBUS_PASSWORD` are',
  '  exchanged for an OIDC bearer token (READCOOP SSO password grant, client',
  '  `processing-api-client`), refreshed automatically. `TRANSKRIBUS_ACCESS_TOKEN`',
  '  supplies a token directly and skips the exchange.',
  '',
  '## Domains and key endpoints',
  '',
  '- Collections: `/collections` — list and manage collections, documents, pages,',
  '  users, tags, labels, stats, credits, and activity.',
  '- Documents and pages: nested under `/collections/{collId}/{docId}` — full document,',
  '  page transcripts, and metadata.',
  '- Recognition and layout: HTR/OCR text recognition, layout analysis, PyLaia, P2PaLA,',
  '  and document understanding (DU).',
  '- Models: `/models` — list, search, train, and manage HTR and text models.',
  '- Search and KWS: full-text search and keyword spotting over transcribed material.',
  '- Jobs and actions: `/jobs` — poll job status and manage actions.',
  '- Users, crowdsourcing, and eLearning.',
  '- Admin, credits, uploads, labels, files, system, and root.',
  '- Processing: submit a single image, get its status, and fetch PAGE or ALTO XML.',
  '  v2 also exposes longpoll and ZIP results (base64 with filename and MIME type,',
  '  up to 20 MiB). Numeric IDs work on both; v2 also accepts UUIDs.',
  '- v1 results are retained for two days; v2 results for 24 hours after completion.',
  '  v2 terminal statuses are FINISHED, FAILED, CANCELLED. Links are indexed by rel,',
  '  not display title; absence of rel=longpoll stops polling availability.',
  '- v2 longpoll reports the returned terminal state independently of HTTP 200.',
  '  HTTP 408 or the 45-second deadline returns timedOut=true and terminal=null',
  '  (unknown), allowing another call without reporting completion.',
  '',
  '## Conventions',
  '',
  '- IDs (`collId`, `docId`, `pageNr`, `jobId`) may arrive as strings from MCP clients;',
  '  numeric ID schemas coerce them.',
  '- Responses are JSON; object results also surface as `structuredContent`.',
  '',
  'See the README for the full tool list: 304 tools by default, 306 with v2,',
  'across 23 domains and 9 entry points.',
  '',
].join('\n');

/** Stable URI advertised for the read-only API-reference resource. */
export const REFERENCE_URI = 'reference://transkribus/api';

/**
 * Register the read-only API-reference resource on an MCP server. Called from
 * the main entry (`index.ts`) and every split entry (`entry-*.ts`) so split
 * deployments expose the reference too. This makes the server advertise the
 * `resources` capability — additive; tool registration is unaffected.
 */
export function registerReferenceResource(server: McpServer): void {
  server.registerResource(
    'transkribus-api-reference',
    REFERENCE_URI,
    {
      title: 'Transkribus API Reference',
      description:
        'Quick reference for Transkribus REST and Processing APIs, including optional v2 beta selection.',
      mimeType: 'text/markdown',
    },
    (uri) => ({
      contents: [
        {
          uri: uri.toString(),
          mimeType: 'text/markdown',
          text: REFERENCE_MD,
        },
      ],
    }),
  );
}
