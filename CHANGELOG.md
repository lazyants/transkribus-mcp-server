# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

- npm package: [`@lazyants/transkribus-mcp-server`](https://www.npmjs.com/package/@lazyants/transkribus-mcp-server)
- MCP Registry: [`io.github.lazyants/transkribus`](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.lazyants/transkribus)

## [Unreleased]

### Added

- The publish workflow fails before `npm publish` when the GitHub Release tag
  and `package.json` version disagree. `check-versions.mjs` proved that
  `package.json` and `server.json` agreed with each other — it does not read
  `package-lock.json` in this repo — but nothing tied that version to the tag
  the release was cut from — so tagging
  `v1.9.0` on a commit reading `2.0.0` would have published 2.0.0 to npm and the
  MCP Registry while the GitHub Release — the artifact humans read — claimed
  otherwise, silently and on the irreversible side of the publish. Ported from
  lexware-mcp-server 5.2.0 (lexware #103).

### Changed

- The publish job runs on Node 24 (Active LTS) instead of Node 20. npm's Trusted
  Publishing prerequisite is two-part — npm 11.5.1+ **and** Node 22.14+ — and
  the job satisfied only the npm half, leaving the irreversible `npm publish`
  step one npm patch away from breaking if that floor starts being enforced. The
  CI *test* matrix stays on Node 20 + 22: it tracks `engines.node`, which is
  unchanged. Ported from lexware-mcp-server 5.2.0 (lexware #102).
- Raised the `@modelcontextprotocol/sdk` floor to `^1.30.0`, which declares
  `@hono/node-server: ^1.19.9 || ^2.0.5` where 1.29.0 declared only `^1.19.9`.
  A correctness alignment, not a security fix: the resolved tree already carried
  a patched `@hono/node-server`, and the production audit gate was green before
  and after. What it buys is that a resolver cannot fall back to an SDK whose
  range predates the widening. Ported from lexware-mcp-server 5.2.0 (lexware
  #81).

## [3.0.1] — 2026-08-20

Maintenance release. No API, tool, or behaviour change — the tool surface is
identical to 3.0.0.

### Security

- Clear rotted dependency **override pins** (#43, #46). The required CI gate
  `npm audit --audit-level=moderate --omit=dev` had gone red on `main` with 6
  vulnerabilities (3 high) without any repository change: two pins were correct
  when written and rotted in place as later advisories extended their ranges.
  Because branch protection is `strict`, this blocked the entire merge queue.
  - `fast-uri` `^3.1.2` → `^3.1.5` — advisory extended to 3.0.0–3.1.4 (host
    confusion via backslash authority delimiter / failed IDN canonicalization).
    Stays inside ajv's declared `^3.0.1`.
  - `hono` `^4.12.25` → `^4.12.34` — advisory extended to `<=4.12.33`.
  - `brace-expansion` `^5.0.6` → `^5.0.9` — advisory extended to 3.0.0–5.0.8.
  - `@hono/node-server` — **new** pin `^1.19.15`. The advisory is `<1.19.15`, so
    a patch bump inside the 1.x line clears it; no major-version move against
    the SDK's declared range is needed.
  - `ip-address` — **new** pin `^10.3.1` (advisory `<=10.3.0`: leading-zero
    octet and CIDR-suffix misparsing enabling SSRF / trust-boundary bypass),
    reached via `@modelcontextprotocol/sdk` → `express-rate-limit`.
  - `body-parser` — **new** pin `^2.3.0` (advisory 2.0.0–2.2.2).
  - `axios` needed no range change: the declared `^1.16.1` already permitted
    1.19.0, so the lockfile alone cleared GHSA-42h9-826w-cgv3 and nine siblings.

### Changed

- Bump `@modelcontextprotocol/sdk` 1.29.0 → 1.30.0, plus dev tooling —
  `vitest` 4.1.8 → 4.1.10, `eslint` 10.5.0 → 10.8.1, `typescript-eslint`
  8.61.0 → 8.67.0, `globals` 17.6.0 → 17.11.0 (#47).
- CI: `actions/setup-node` 6 → 7 (#42), `actions/checkout` 6 → 7 (#24).

### Tests

- `src/tests/overrides.test.ts` guarded only 3 of the 5 declared overrides, so
  deleting the `fast-uri` or `brace-expansion` line passed until the next
  lockfile regeneration — which is how the rot went unnoticed. `PINS` now covers
  all 8 pins, and a new assertion requires `PINS` and the `package.json`
  `overrides` block to have identical key sets, so an override added without a
  pin fails the suite instead of going silently unguarded. Each pin's rationale
  now sits on its own line rather than in a comment block that restated (and
  would rot alongside) every advisory range.

## [3.0.0] — 2026-07-17

### Removed

- **BREAKING:** Remove the `transkribus_auth_login` tool (#29). It was
  non-functional: `transkribusRequest` runs `ensureSession()` first (which
  already requires credentials), the tool sent `user`/`pw`/`otp` as URL query
  parameters instead of a form body (leaking them into access logs and never
  reaching the JAX-RS `@FormParam` endpoint), and it discarded the session it
  received. Authenticate via the `TRANSKRIBUS_USER` + `TRANSKRIBUS_PASSWORD`
  environment variables, or set `TRANSKRIBUS_SESSION_ID` directly. Tool count
  drops from 301 to 300.

### Security

- Redact secrets from `AxiosError` request/response **bodies** (#26). On a
  failed request the sanitizer now deletes `config.data` (the request body,
  which for a failed login carried the plaintext password) on every request,
  and value-redacts any session token it discovers in the response — across
  `response.data`, every `response.headers` value, `response.statusText`, and
  the error's own `message`/`stack`. Discovering the token from the response
  (rather than matching a known value) catches a freshly minted session that no
  prior value could predict. The wrapped error message is capped at 512
  characters so an unbounded error body can no longer become the message
  verbatim.
- Scrub `config.params` and any `config.url` query string from chained
  `AxiosError`s (#32). Complements the body scrub so user-supplied filters and
  search terms cannot leak through a serialized error regardless of channel.
- Add `pathSeg()` (percent-encoding) plus a `PathSegmentSchema` two-layer guard
  and apply both to every user-supplied string interpolated into a URL path —
  the `reportType`/`reportTime`/`jobImpl` admin segments and the model `type`
  segment across 14 model tools (#32). `encodeURIComponent` alone does not stop
  `..` traversal (it never escapes `.`, and the templates supply their own
  slashes), so the schema layer rejects `''`/`.`/`..`/`/`/whitespace before a
  URL is ever built.

### Fixed

- Stop the 401 re-authentication interceptor from recursing without bound when
  `/auth/login` itself responds 401 (#30). `login()` now posts through a
  dedicated axios instance that carries only the bounded 429 retry and no 401
  re-auth branch, so a 401 from the login endpoint can no longer re-enter the
  re-auth handler. A rate-limit exhaustion error now chains its cause instead
  of discarding the diagnostic.

## [2.1.2] — 2026-06-22

### Security

- Harden `wrapAxiosError` so the `JSESSIONID` session cookie can no longer leak
  through a chained/serialized error. `sanitizeAxiosError` now strips the request
  `Cookie` header, response `Set-Cookie` header, the raw `request._header` block,
  and `authorization`/`proxy-authorization`/`config.auth`/`proxy.auth` in place
  before the error is chained via `{ cause: err }`. Closed on every path: the normal
  request path, the 401 re-auth path (`sessionExpiredError`), and the initial-login
  failure path (`login()` now sanitizes its own `AxiosError`). New regression tests
  assert no leak under `util.inspect(err, { depth: null })` and `AxiosError.toJSON()`.
  Sibling of lexware #51. Resolves #23. No runtime or API behaviour change.

## [2.1.1] — 2026-06-20

### Security

- Bump the `hono` override to `^4.12.25` and add a `form-data` `^4.0.6`
  override to clear two HIGH advisories that started failing the
  `npm audit --audit-level=moderate --omit=dev` CI gate: `form-data` CRLF
  injection via unescaped multipart field/file names (GHSA-hmw2-7cc7-3qxx)
  and the `hono` `serve-static` path traversal et al. (`hono <= 4.12.24`).
  Dependency-only change; no runtime or API behaviour changes.

## [2.1.0] — 2026-06-13

### Added

- Read-only API-reference MCP Resource `reference://transkribus/api`
  (`text/markdown`), registered on the main server and all 7 split
  entry points so clients can pull the API quick-reference without a
  tool call (PR #17).

### Documentation

- Documented the legacy-only API scope: this server targets the legacy
  Transkribus TrpServer REST API; the newer Processing API v2 (OIDC,
  `/processing/v2`, `account.readcoop.eu`) is intentionally out of
  scope (PR #17).

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

[3.0.1]: https://github.com/lazyants/transkribus-mcp-server/releases/tag/v3.0.1
[3.0.0]: https://github.com/lazyants/transkribus-mcp-server/releases/tag/v3.0.0
[2.1.2]: https://github.com/lazyants/transkribus-mcp-server/releases/tag/v2.1.2
[2.1.1]: https://github.com/lazyants/transkribus-mcp-server/releases/tag/v2.1.1
[2.1.0]: https://github.com/lazyants/transkribus-mcp-server/releases/tag/v2.1.0
[2.0.3]: https://github.com/lazyants/transkribus-mcp-server/releases/tag/v2.0.3
[2.0.2]: https://github.com/lazyants/transkribus-mcp-server/releases/tag/v2.0.2
[2.0.1]: https://github.com/lazyants/transkribus-mcp-server/releases/tag/v2.0.1
[2.0.0]: https://github.com/lazyants/transkribus-mcp-server/releases/tag/v2.0.0
[1.0.1]: https://github.com/lazyants/transkribus-mcp-server/releases/tag/v1.0.1
