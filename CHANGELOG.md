# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

- npm package: [`@lazyants/transkribus-mcp-server`](https://www.npmjs.com/package/@lazyants/transkribus-mcp-server)
- MCP Registry: [`io.github.lazyants/transkribus`](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.lazyants/transkribus)

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

[2.0.0]: https://github.com/lazyants/transkribus-mcp-server/releases/tag/v2.0.0
[1.0.1]: https://github.com/lazyants/transkribus-mcp-server/releases/tag/v1.0.1
