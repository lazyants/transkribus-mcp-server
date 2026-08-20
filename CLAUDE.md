# transkribus-mcp-server

Guidance for working in this repository. **Self-contained** — everything needed to work here safely
is below. If you are in the `lazy-ants/development/mcp/` fleet checkout, the fleet-root `CLAUDE.md`
one directory up carries the same cross-cutting rules plus fleet-only material (the publishing
playbook, the hygiene skill, the sibling servers). A standalone clone of this repo does not have it
and does not need it.

## Cross-cutting rules (all three lazy-ants MCP servers)

- **ESM + Node16 module resolution**: all relative imports MUST use the `.js` extension —
  `import { x } from '../helpers.js'`. TypeScript resolves `.js` → `.ts` at compile time.
- **NEVER** call `.strict()` on Zod schemas — it breaks MCP SDK schema generation.
- **Zod 4** (`zod ^4.4.3` here; requires MCP SDK ≥ 1.29). Two traps: the 1-arg
  `z.record(valueType)` overload is gone — use `z.record(z.string(), z.unknown())`; and
  `z.preprocess` outputs are tagged `optin: "optional"`, which silently drops required fields from
  the MCP `tools/list` `required[]` array. Runtime-verify `.describe()` propagation AND `required[]`
  via a `tools/list` round-trip in `{ io: 'input' }` mode before bumping the zod major.
- **Tool descriptions**: 1–2 sentences, no cross-references to other tools.
- **`CallToolResult` import path**: `@modelcontextprotocol/sdk/types.js`, NOT `server/mcp.js`.
- **`server.json` dual `version` fields**: root `version` is the MCP Registry version (unique per
  publish); `packages[0].version` is the npm version (must exist on npm). They may differ.
- **`@types/node` is capped at the `engines.node` floor** (Node 20). Reject Dependabot major bumps.
- **Git**: commit right after a change, present-tense imperative subject, never `git add -A`/`.`,
  no `Co-Authored-By` or "Generated with" trailers. Default branch `main`.
- **Counts in this file are pinned by `src/tests/smoke.test.ts`.** It is the source of truth — if a
  number here and a number there disagree, the test wins and this file is stale.

## Repository specifics

- **API**: Transkribus REST (handwriting OCR/HTR).
- **Tool naming**: `transkribus_<action>_<resource>`.
- **Layout**: 1 main + 7 split entry points
  (`entry-{admin,collections,jobs,models,search,transcription,users}.ts`) + 32 tool modules under
  `src/tools/`, all 32 imported by `src/index.ts`. `smoke.test.ts` pins 300 tools on the main entry.
- **Architecture decisions** (see auto-memory):
  - `intCoerce` schema preprocessor — accept string-encoded numeric IDs from MCP clients.
  - `handleToolRequest` / `formatResponse` contract — JSON + `structuredContent`, array-wrap gotcha.
  - PyLaia training body — JAXB ParameterMap wire format; UI-default params required for usable models.
  - Transkribus `trainList` shape — `{train:[{docId,pageList:{pages:[...]}}]}`, NOT flat.
- **Hygiene baseline** (since PR #2, merged 2026-05-07): aligned with lexware/hetzner — FSL-1.1-MIT,
  ESLint 10 + `preserve-caught-error`, Vitest 4 dist-exclude, TS6 + `types: ["node"]`, Trusted
  Publishing, Node 20+22 CI matrix, `npm@^11` pin in the release job. Source helpers added in the
  same PR: `wrapAxiosError` in `services/transkribus.ts`, `logFatalAndExit` in `server.ts`. v2.0.1
  (PR #5) jumped to `zod ^4.4.3`, migrated 23 `z.record(z.unknown())` to the 2-arg form, and added a
  `clearOptinMarker` helper around `intCoerce` in `schemas/common.ts` — zod 4 had silently dropped
  191 required ID/page params from `tools/list`.
