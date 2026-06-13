# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

- npm package: [`@lazyants/transkribus-mcp-server`](https://www.npmjs.com/package/@lazyants/transkribus-mcp-server)
- MCP Registry: [`io.github.lazyants/transkribus`](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.lazyants/transkribus)

## [2.0.3] — 2026-06-13

### Security

- Added `qs` (`^6.15.2`) and `hono` (`^4.12.21`) to the `package.json`
  `overrides` block, plus a two-layer regression test, clearing the
  `npm audit --omit=dev` CI gate (PR #14). `qs` reaches the production
  tree via `@modelcontextprotocol/sdk → express → body-parser → qs`, so
  `--omit=dev` cannot exclude it. The pins resolve qs 6.15.2
  (GHSA-q8mj-m7cp-5q26, `qs.stringify` DoS) and hono 4.12.25
  (GHSA-xrhx-7g5j-rcj5 et al.). No runtime behavior change.

### Changed

- Bumped the minor-and-patch dependency group in the lockfile
  (5 transitive updates) via Dependabot (PR #13). Lockfile-only — no
  `package.json` or runtime change.

## [2.0.2] — 2026-05-20

### Added

- Targeted contract tests locking in three load-bearing helpers
  (PR #10):
  - `formatResponse([…])` omits `structuredContent` (regression
    guard — the MCP SDK rejects arrays in `structuredContent`).
  - `formatResponse({…})` sets `structuredContent` for plain objects.
  - `wrapAxiosError(err)` does NOT leak `config.headers` into the
    rethrown message (cookie-leak guard from the prior 2.0.1 audit).
  - `tools/list` integration test proving `.optional()` filter
    parameters stay out of `required[]` under Zod 4.

### Fixed

- npm `overrides` block pins `fast-uri ^3.1.2` and
  `brace-expansion ^5.0.6` to clear high/moderate
  audit advisories that surfaced in transitive deps after the
  2026-05 dep refresh (PR #8). No runtime behavior change — both
  packages are dev-transitive.
- Aligned stale tool-count documentation: `package.json`
  description, `src/index.ts` collection comment, and `smoke.test.ts`
  test-name strings now consistently report 301 tools (127
  collection tools), matching the smoke assertion (PR #9).

### Changed

- Grouped minor+patch dep bump (PR #7): see the Dependabot PR for
  the exact diff. No behavior changes.

## [2.0.1] — 2026-05-07

### Changed

- Bumped `zod` from `^3.25.0` to `^4.4.3`. Migrated 23 `z.record(z.unknown())`
  call sites across `src/tools/*.ts` to the Zod-4 two-argument form
  `z.record(z.string(), z.unknown())`. This brings transkribus into
  line with `@lazyants/lexware-mcp-server` (also on Zod 4 since `2.0.1`).

### Fixed

- `intCoerce` schema preprocessor: cleared the Zod 4 `optin: "optional"`
  marker that Zod 4 sets on `z.preprocess` outputs. Without this fix,
  every required ID/page parameter wrapped by `intCoerce` would be
  silently dropped from the `tools/list` JSON Schema `required[]`
  array, leading MCP clients to omit the field at call time even
  though runtime validation still rejected the empty value.

### Notes

- Emitted JSON Schemas have small differences vs. Zod 3 because the
  MCP SDK now routes through Zod 4's native `toJSONSchema`: regular
  object schemas no longer carry `additionalProperties: false`, record
  schemas now emit `propertyNames`, and integer schemas now carry an
  explicit `maximum: 9007199254740991` (JS safe-integer ceiling). All
  three are non-semantic refinements — tool input shapes are unchanged.
- 301/301 tools still emit non-empty `description` strings under Zod 4 +
  MCP SDK `^1.29` (verified via the `tools/list` smoke-test recipe).

## [2.0.0] — 2026-05-07

### Changed

- **License relicensed from MIT to FSL-1.1-MIT.** Versions `1.x` remain
  available under MIT on npm; new versions ship under FSL-1.1-MIT.
- Adopted the Lazy Ants MCP hygiene baseline v2.0.0 — ESLint 10 flat config
  with `preserve-caught-error`, Vitest 4 with `dist/` excludes, TypeScript 6
  with explicit `types: ["node"]`, npm Trusted Publishing for releases.

### Added

- `npm run lint` and `npm run check-versions` scripts.
- `SECURITY.md` vulnerability-disclosure policy.
- Dependabot (weekly, grouped minor+patch) and a Node 20+22 CI matrix with
  audit and lint gates.
- `.nvmrc` pinning the contributor Node floor to 20.19.0.

### Fixed

- Chained `Error` cause (`{ cause: err }`) in re-throws inside
  `src/services/transkribus.ts` to preserve the original `AxiosError` /
  network details for downstream callers.

### Security

- Bumped `@modelcontextprotocol/sdk` to `^1.29.0` and `axios` to `^1.16.0`,
  closing the moderate-severity transitive CVE cluster reported during
  Q1–Q2 2026 (NO_PROXY bypass, prototype pollution gadgets, CRLF injection,
  header injection chain).

## [1.0.1] — 2025

### Added

- Initial release under MIT (`io.github.lazyants/transkribus` MCP Registry
  descriptor only; npm package version was `1.0.0`).

[2.0.3]: https://github.com/lazyants/transkribus-mcp-server/releases/tag/v2.0.3
[2.0.2]: https://github.com/lazyants/transkribus-mcp-server/releases/tag/v2.0.2
[2.0.1]: https://github.com/lazyants/transkribus-mcp-server/releases/tag/v2.0.1
[2.0.0]: https://github.com/lazyants/transkribus-mcp-server/releases/tag/v2.0.0
[1.0.1]: https://github.com/lazyants/transkribus-mcp-server/releases/tag/v1.0.1
