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
  '  session-based, which is where all but four of the tools live.',
  '- The Metagrapho Processing API (base `https://transkribus.eu/processing/v1`),',
  '  OIDC bearer auth via `account.readcoop.eu`, covered by the four',
  '  `transkribus_processing_*` tools.',
  '',
  'Note the version: the live Processing API is `/processing/v1`. Some vendor',
  'material still shows `/processing/v2` and a `config.modelId` field; that path',
  'returns 404 and the live service requires `config.textRecognition.htrId`.',
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
  '- Processing (Metagrapho): submit a single image, poll its process, and fetch the',
  '  result as PAGE or ALTO XML.',
  '',
  '## Conventions',
  '',
  '- IDs (`collId`, `docId`, `pageNr`, `jobId`) may arrive as strings from MCP clients;',
  '  numeric ID schemas coerce them.',
  '- Responses are JSON; object results also surface as `structuredContent`.',
  '',
  'See the README for the full tool list — 304 tools across 23 domains, 9 entry points.',
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
        'Quick reference for the legacy Transkribus TrpServer REST API exposed by this MCP server.',
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
