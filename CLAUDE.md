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
- **Do not add a structural count to this file that no test enforces.** `src/tests/smoke.test.ts`
  pins the tool-registration counts and nothing else — not module counts, not file counts, not
  dependency versions. Every other number rots silently, so this file names the command that
  produces the figure instead of the figure. If you find a bare count here, it is a bug: replace it
  with its command or delete it.

## Repository specifics

- **API**: Transkribus REST (handwriting OCR/HTR).
- **Tool naming**: `transkribus_<action>_<resource>`.
- **Layout**: 1 main + 7 split entry points
  (`entry-{admin,collections,jobs,models,search,transcription,users}.ts`) + the tool modules under
  `src/tools/`, all of which `src/index.ts` imports (`ls src/tools/*.ts | wc -l` for the count —
  it was 32 on 2026-08-20 and no test pins it). `smoke.test.ts` DOES pin the tool total at 300 on
  the main entry, plus each split's sub-count.
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
