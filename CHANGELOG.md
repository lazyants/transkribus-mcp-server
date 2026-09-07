# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

- npm package: [`@lazyants/transkribus-mcp-server`](https://www.npmjs.com/package/@lazyants/transkribus-mcp-server)
- MCP Registry: [`io.github.lazyants/transkribus`](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.lazyants/transkribus)

## [Unreleased]

## [4.0.0] — 2026-09-07

Breaking: three ingestion tools are gone (see **Removed**). The tool count goes
from 300 to 304.

### Added

- Support for the Transkribus **Metagrapho ("Processing") API** — 4 tools
  (`transkribus_processing_submit_image`, `_get_status`, `_get_page_xml`,
  `_get_alto_xml`), a `transkribus-mcp-processing` entry point, and a dedicated
  client in `src/services/metagrapho.ts`. It authenticates with the READCOOP SSO
  password grant (client `processing-api-client`) using the existing
  `TRANSKRIBUS_USER` / `TRANSKRIBUS_PASSWORD`, refreshes the token automatically,
  and accepts `TRANSKRIBUS_ACCESS_TOKEN` to skip the exchange. Closes #22.
- `transkribus_job_wait` — polls a job until it reaches `FINISHED`, `FAILED` or
  `CANCELED`, so an LLM client no longer burns a turn per "still RUNNING" poll.
  When the finished job's `result` carries an `http(s)` URL — an export's ZIP or
  PDF, typically — it is surfaced as `downloadUrl` instead of being left for the
  caller to dig out of the raw job JSON. The wall-clock budget is enforced by
  racing each poll against one absolute deadline rather than by adding up
  sleeps: the shared HTTP client can spend unbounded time in a login, a 401
  re-login or a 429 backoff, and none of those are individually bounded. A
  timed-out result is a normal result, not an error — call again to keep
  waiting. Defaults: poll every 5s, wait up to 30s, which returns before the MCP
  SDK's 60s default client timeout.
- `transkribus_doc_get_plaintext` — the transcribed text of a whole document in
  one call with `--- page N ---` separators, replacing one tool call per page.
  Bounded by both a 100-page and a 100 000-character budget per call; when
  either stops the walk the result carries `nextStartPage`, so a long document
  is read in successive calls rather than failing. A page that has no transcript
  is reported inline and does not abort the rest of the document.
- `transkribus_page_get_image` — a page scan as an MCP image content block, so a
  multimodal client can look at the manuscript next to its HTR output.
  Thumbnail by default. The image URL comes from the API's own page metadata and
  is downloaded with a bare HTTP client: no session cookie reaches the image
  host, only `https` on `transkribus.eu` (or a subdomain) is accepted, that check
  runs again on every redirect hop, the response must be an `image/*`, and a
  byte cap (5 MB by default) is enforced while the response accumulates.
- Credentials are read from the OS keyring before the environment, so an MCP
  client config file no longer has to carry the Transkribus account password in
  clear text. One entry per value under a configurable service name
  (`transkribus-mcp` by default, `TRANSKRIBUS_KEYRING_SERVICE` to override),
  accounts `user`, `password` and `session-id`; each value falls back to its
  existing environment variable independently, so current setups keep working
  unchanged. The keyring is optional in every sense: `@napi-rs/keyring` is an
  `optionalDependency` loaded lazily, and an absent, locked or slow store
  degrades to the environment — bounded at 5 seconds, because a hung credential
  store would otherwise stall the MCP stdio handshake. Credentials added,
  corrected or rotated while the server runs are picked up: re-authentication
  after a 401 re-reads both sources rather than reusing the snapshot the
  process started with. README and SECURITY.md document the setup commands and
  the resolution order. Ported from lexware-mcp-server 4.2.0 (#44).
- `UserIdSchema`, and `paginationIndex`/`paginationNValues`/`paginationWithDefaults`
  in `src/schemas/common.ts`.
- `src/tests/schema-coercion.test.ts`, two ratchets over the whole registered tool
  surface: no required numeric parameter may reject its own string form — bare or
  inside an array — and every default the server applies must be advertised in
  `tools/list`. Both scan the live schemas, so a new tool that reintroduces either
  defect fails CI by name.

### Changed

- `src/entries.ts` now holds one registrar array per entry point, consumed by the
  entry file, by `index.ts` and by the smoke test. Each list had been written out
  three or four times, and the test re-registered the modules itself — so it
  asserted its own copy rather than the shipped one, and dropping a registrar
  from an entry file left the corresponding test green. Part of #34.
- `index` now rejects a negative start index across all pagination parameters,
  and `index`/`nValues`/`sortDirection` descriptions are the same everywhere.
  Previously the 32 tools using the shared `PaginationParams` and the 18 with
  hand-rolled copies disagreed on both.
- Deleted the seven unused response-interface modules under `src/types`. Nothing
  in the repo imported them: tool handlers type their responses through
  `transkribusRequest<T>`'s `unknown` default, so the interfaces described a
  contract nothing checked. Part of #34.
- Dependency bumps: axios 1.19.0 → 1.20.0, zod 4.4.3 → 4.5.4, eslint
  10.8.1 → 10.9.1, globals 17.11.0 → 17.12.0, typescript-eslint 8.67.0 → 8.69.0.

### Removed

- **`transkribus_coll_create_doc_from_pdf`, `transkribus_coll_upload_doc` and
  `transkribus_coll_upload_doc_multipart`.** Their wire formats appear in no
  public Transkribus client and could never have succeeded against the live
  server. A client calling one of them was already getting an error; it now gets
  an unknown-tool error instead. Use the corrected `transkribus_coll_create_upload`
  + `transkribus_coll_put_upload` pair, or `transkribus_coll_create_doc_from_mets`.
  Part of #28.

### Fixed

- **Document ingestion works end to end.** Nine ingestion tools sent a JSON body
  to endpoints that require multipart, XML, CSV or bare query parameters, so
  there was no working way to get a document into Transkribus. The contracts were
  re-derived from the live TrpServer WADL and the official Java client, then
  confirmed against the live server. `POST /uploads` takes `collId` as a query
  parameter and a body that is either a `documentUploadDescriptor`
  (`{ md, pageList: { pages } }` — a wrapper object, not a flat array) or a METS
  XML document sent as `application/xml`; `PUT /uploads/{uploadId}` is real
  multipart with parts `img` and `xml`, fed from local file paths;
  `createDocFromIiifUrl` / `createDocFromMetsUrl` / `ingest` read the URL from the
  `fileName` query parameter and no longer send an unread body;
  `createDocFromMets` is multipart with a part named `mets`; the bulk metadata
  endpoints take `text/csv` and `text/csv+isad`. Files are sent as raw bytes
  rather than decoded and re-encoded, so a Windows-1252 metadata CSV or a UTF-16
  METS document arrives intact. Closes #28.
- Every REQUIRED numeric tool parameter now accepts a string-encoded number, so
  an MCP client that serializes numbers as JSON strings can call every tool.
  `intCoerce` was applied to 191 parameters in 2.0.1; a measurement of all
  registered tools — every parameter that accepts the number 3 but rejects the
  string `"3"` — found 24 required stragglers it had missed, in nine modules.
  Each one made its tool uncallable from such a client with no workaround, since
  a required parameter cannot simply be omitted. The 18 hand-rolled
  `index`/`nValues` pagination blocks are coerced too, and now come from
  `src/schemas/common.ts` rather than being copy-pasted. Their existing default
  values are unchanged: these parameters go straight into the query string, so
  `nValues=0` and an omitted `nValues` are different requests. Numeric ARRAY
  parameters are covered too: five required ones (`userIds`, `documentIds` ×2,
  `pageIds` ×2) accepted `[1, 2]` but rejected `["1", "2"]`, which fails a
  string-serializing client exactly as a bare number does. (#33)
- 16 parameters applied a default the server never published in `tools/list`,
  in `models.ts` and `collections-pages.ts`. Zod 4 renders a `z.preprocess` pipe
  — which is every `intCoerce` parameter — from its input leg when emitting JSON
  Schema in INPUT mode, and drops a `default` attached to an outer wrapper, so
  `intCoerce(...).optional().default(N)` substituted N while telling the client
  nothing about it. `.prefault(N)` survives the emit; advertised defaults go from
  16 missing to 0.
- The 429 retry interceptor parsed `Retry-After` with a bare `parseInt`, so an
  RFC 7231 HTTP-date became `NaN` and `setTimeout` fired immediately: every retry
  landed inside the rate-limit window instead of after it, and a large
  delta-seconds value overflowed `setTimeout`'s 32-bit coercion the same way.
  `parseRetryAfterMs` accepts delta-seconds or a strict IMF-fixdate, validated by
  a `Date.UTC` round-trip so normalized or obsolete date forms are rejected
  rather than yielding a wrong delay, and clamps the result to a non-negative
  finite delay; an unparseable header falls back to exponential backoff. The 429
  branch has its first tests, which assert the delay itself under fake timers.
  Closes #31.
- Concurrent cold-start tool calls each found `sessionId` null and fired their own
  `POST /auth/login`, and concurrent 401s did the same through the re-auth
  interceptor. Both paths now share one memoized in-flight login promise, held per
  replaced session — `login()` takes an `expiredSessionId` and that argument
  changes its result, so callers replacing different sessions must not share a
  login. The memo stores the promise returned by `.finally()`, so a rejection
  reaches every awaiting caller instead of going unhandled, and it is cleared on
  settle — failure included — so a failed login never poisons it for later
  callers. Closes #39.
- Raised the `qs` and `fast-uri` override floors to 6.16.0 and 3.1.7. The CI audit
  gate had gone red with no change to this repo: four further `fast-uri`
  advisories extended its vulnerable range through 3.1.5 and two further `qs`
  advisories extended theirs through 6.15.3, so the existing pins no longer
  cleared the gate. `fast-uri` stays on the 3.x line, inside ajv's declared
  `^3.0.1`.
- **Corrected the documented Processing API version.** Earlier releases (see
  2.1.0 below) recorded the newer API as "Processing API v2" at `/processing/v2`.
  Verified against the live service: `/processing/v2` returns **404**, while
  `/processing/v1` answers and its OpenAPI document self-describes as
  "Transkribus Metagrapho API" 1.13.1. The request shape differs too — the live
  service requires `config.textRecognition.htrId`, not `config.modelId`.

### Security

- The Metagrapho client never attaches an upstream error as `cause` and never
  copies a response body into an error message; failures report fixed text plus
  the numeric HTTP status. The legacy client's sanitizer only discovers
  `sessionId` / `JSESSIONID`-shaped secrets, so an OIDC password, access token or
  refresh token **echoed back** in an error body would have survived into the MCP
  tool result and stderr. Covered by regression tests that check both
  `util.inspect(err, { depth: null })` and `JSON.stringify` — the former is the
  one that catches a response-body leak.
- A regression test now holds the login password to being scrubbed from a failed
  login error. The cookie-leak test only proved `JSESSIONID` was redacted;
  `scrubConfig` also drops `config.data` and `config.params`, the two request-side
  surfaces that carry the `pw=` form field, but nothing held it to that. The test
  seeds the password into both and checks the sentinel really was sent, so a clean
  result means redaction rather than absence. Part of #34.

### Known limitation

- 137 OPTIONAL numeric parameters still reject string-encoded numbers. An optional
  filter can be omitted, so the tool stays usable; several are counts, timestamps
  or floats that need per-parameter judgement rather than a mechanical sweep.

## [3.1.0] — 2026-08-20

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
  scope (PR #17). *(Superseded — see [Unreleased]: the live endpoint is
  `/processing/v1`, `/processing/v2` does not exist, and the API is now
  supported rather than out of scope.)*

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

[4.0.0]: https://github.com/lazyants/transkribus-mcp-server/releases/tag/v4.0.0
[3.1.0]: https://github.com/lazyants/transkribus-mcp-server/releases/tag/v3.1.0
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
