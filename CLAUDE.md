# transkribus-mcp-server

> Repo-specific guidance. **Fleet-wide rules — ESM `.js` import extensions, the zod-4 traps, no
> `.strict()`, tool-description limits, the `CallToolResult` import path, `server.json`'s dual
> `version` fields, the `@types/node` cap, the build/test/publish flow, the code-review protocol and
> the git workflow — live in the fleet root `CLAUDE.md` one directory up** (`lazy-ants/development/mcp/`),
> which is now its own git repository. Read both. This file holds only what is true for this server
> and nothing else.

- **API**: Transkribus REST (handwriting OCR/HTR).
- **Tool naming**: `transkribus_<action>_<resource>`.
- **Layout**: 1 main + 7 split entry points (`entry-{admin,collections,jobs,models,search,transcription,users}.ts`), ~22 tool modules.
- **Architecture decisions** (see auto-memory):
  - `intCoerce` schema preprocessor — accept string-encoded numeric IDs from MCP clients.
  - `handleToolRequest` / `formatResponse` contract — JSON + `structuredContent`, array-wrap gotcha.
  - PyLaia training body — JAXB ParameterMap wire format; UI-default params required for usable models.
  - Transkribus `trainList` shape — `{train:[{docId,pageList:{pages:[...]}}]}`, NOT flat.
- **Hygiene baseline** (since PR #2, merged 2026-05-07): ALIGNED with lexware/hetzner — FSL-1.1-MIT, ESLint 10 + `preserve-caught-error`, Vitest 4 dist-exclude, TS6 + `types: ["node"]`, Trusted Publishing, Node 20+22 CI matrix, `npm@^11` pin in release job. Source helpers added in the same PR: `wrapAxiosError` in `services/transkribus.ts`, `logFatalAndExit` in `server.ts`. **v2.0.0 published 2026-05-07** via Trusted Publishing + provenance attestation. **v2.0.1 published 2026-05-07** (PR #5): jumped to `zod ^4.4.3`, migrated 23 `z.record(z.unknown())` → 2-arg form, and added a `clearOptinMarker` helper around `intCoerce` in `schemas/common.ts` (Zod 4 silently dropped 191 required ID/page params from `tools/list`; codex caught it in the reviewer loop). 164/191 collId-tools now correctly require it; remaining 27 use legitimate `.optional()` filter parameters.
