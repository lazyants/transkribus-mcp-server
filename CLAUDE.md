# transkribus-mcp-server

Guidance for working in this repository. It carries the **coding and convention** rules — enough to
write and review code here without another file. It is deliberately NOT the whole story:

- **Validation and CI** are defined by `.github/workflows/test.yml` (the required sequence: `npm ci`,
  lint, `node scripts/check-versions.mjs`, `npm audit --audit-level=moderate --omit=dev`, build,
  tests, on the Node 20 + 22 matrix). Read that file — it is versioned here and is the source of
  truth, not a summary of it.
- **Releasing** is in `README.md` § Releasing, including the guarded tagging sequence.
- **Fleet-wide material** — the publishing playbook, the hygiene skill, the sibling servers — is in
  the fleet-root `CLAUDE.md` of the `lazy-ants/development/mcp/` checkout. A standalone clone does
  not have it; everything needed to work in *this* repo is here or in the two files named above.

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
- **This file does not restate CURRENT STRUCTURE that lives in code** — module inventories, tool or
  file counts, entry/split tables. A copy of such a fact rots the moment the code moves and no test
  checks it, so read the file that owns it (named below in each case) instead. Finding one here is
  a bug: delete it and point at the source.
  **Exempt, and deliberately kept:** fixed conventions that are limits rather than measurements
  (the 1–2 sentence description cap), dependency and runtime versions, and dated historical notes
  about past releases — those record what happened, which cannot go stale.

## Repository specifics

- **API**: Transkribus REST (handwriting OCR/HTR).
- **Tool naming**: `transkribus_<action>_<resource>`.
- **Layout**: `src/index.ts` plus `src/entry-*.ts` split entries, with the tool modules in
  `src/tools/` — all of them imported by `src/index.ts`. `src/tests/smoke.test.ts` asserts the tool
  count for the main entry and for each split; read it for the current numbers and update it in the
  same commit as any tool change.

- **Architecture decisions**, each with its source in this repo — no external reference needed:
  - **`intCoerce` preprocessor** (`src/schemas/common.ts`) — accepts string-encoded numeric IDs from
    MCP clients. It is paired with `clearOptinMarker()` in the same file: zod 4 tags `z.preprocess`
    output as `optin: "optional"`, which silently drops the field from the `tools/list` `required[]`
    array. Never add a preprocessor without clearing that marker.
  - **`formatResponse()` / `handleToolRequest()`** (`src/helpers.ts`) — returns JSON text plus
    `structuredContent`. **Array gotcha:** `structuredContent` must be a Record, not an array; an
    array passes `typeof === 'object'` and produces an invalid result. The guard is in
    `src/helpers.ts` at the `structuredContent` assignment — read it before changing the shape.
  - **PyLaia training body** (`src/tests/pylaia.test.ts`) — the wire format is a JAXB
    `ParameterMap`, `{ entry: [{ key, value }] }`, not a plain object, and the UI-default parameters
    are required for a usable model. The test encodes both; treat it as the spec.
  - **`trainList` shape** — `{ train: [{ docId, pageList: { pages: [...] } }] }`, NOT flat. Also
    covered in `src/tests/pylaia.test.ts`.

- **Hygiene baseline** (since PR #2, merged 2026-05-07): aligned with lexware/hetzner — FSL-1.1-MIT,
  ESLint 10 + `preserve-caught-error`, Vitest 4 dist-exclude, TS6 + `types: ["node"]`, Trusted
  Publishing, Node 20+22 CI matrix, `npm@^11` pin in the release job. Source helpers added in the
  same PR: `wrapAxiosError` in `services/transkribus.ts`, `logFatalAndExit` in `server.ts`. v2.0.1
  (PR #5) jumped to `zod ^4.4.3`, migrated 23 `z.record(z.unknown())` to the 2-arg form, and added a
  `clearOptinMarker` helper around `intCoerce` in `schemas/common.ts` — zod 4 had silently dropped
  191 required ID/page params from `tools/list`.
