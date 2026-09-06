# Security Policy

## Project status

`@lazyants/transkribus-mcp-server` is an independent MCP server. It is
**not** an official product of, endorsed by, or affiliated with the
Transkribus REST API vendor, Anthropic, or the Model Context Protocol
project. Security guarantees are limited to what this repository's
maintainers commit to in [Reporting a vulnerability](#reporting-a-vulnerability)
below; the upstream vendor's security team is not responsible for issues in
this wrapper.

## Supported versions

| Version | Supported |
| ------- | --------- |
| 3.x   | ✅        |

Older majors are not supported. `3.0.0` was released on 2026-07-17, so `2.x`
receives security fixes until 2027-01-17, six months after that.

## Reporting a vulnerability

If you discover a security issue in `@lazyants/transkribus-mcp-server`, please
report it privately rather than opening a public GitHub issue.

**Preferred channel — GitHub Security Advisories**

Open a private advisory at
<https://github.com/lazyants/transkribus-mcp-server/security/advisories/new>.
GitHub will notify the maintainers and let us coordinate a fix and disclosure
timeline with you.

**Alternative — email**

If GitHub Security Advisories are not available to you, send a description
to **smaxims@gmail.com** with `[transkribus-mcp-server security]` in the subject.
We aim to acknowledge reports within 3 business days.

## What to include

- The version of `@lazyants/transkribus-mcp-server` and Node.js you tested.
- A minimal reproduction (preferably a payload, an MCP-tool invocation, or
  a stack trace).
- Your assessment of impact: data leakage, unauthenticated execution,
  privilege escalation, denial of service, etc.

## What is in scope

- The MCP server itself: tool registration, request handling, the
  `services/transkribus.ts` HTTP client, and any rate-limiting / retry layer.
- The published npm artifact (`dist/`).
- Sample configurations in `README.md` that could mislead users into an
  insecure setup.

## What is out of scope

- Vulnerabilities in the upstream Transkribus REST API itself —
  please report those to the upstream vendor.
- Issues in transitive devDependencies that do not ship in the published
  package (e.g. `vitest`, its sub-deps). We track them via Dependabot but
  do not treat them as security incidents.
- Misconfiguration of the consumer's own environment (leaked
  `TRANSKRIBUS_PASSWORD`, over-privileged API tokens, etc.).

## Credential resolution

Each credential is resolved in this order, independently of the others:

1. **OS keyring** — service `transkribus-mcp` (override with
   `TRANSKRIBUS_KEYRING_SERVICE`), accounts `user`, `password` and
   `session-id`, via [`@napi-rs/keyring`](https://www.npmjs.com/package/@napi-rs/keyring).
2. **`TRANSKRIBUS_USER` / `TRANSKRIBUS_PASSWORD` / `TRANSKRIBUS_SESSION_ID`**
   environment variables (fallback).

Notes relevant to the supply-chain and credential surface:

- **`@napi-rs/keyring` is a native module shipped as prebuilt platform
  binaries** (napi-rs, distributed as per-platform packages) — there is **no
  local compile step / `node-gyp`** at install time. It is **pinned** in
  `package.json` (`^2.0.0`); the resolved binaries are locked in
  `package-lock.json` with integrity hashes.
- **It is listed under `optionalDependencies`, not `dependencies`, and loaded
  through a lazy `await import(...)`.** npm installs `optionalDependencies` by
  default, so this does not shrink the default install for env-var-only setups.
  What it buys instead: there is no wasm fallback, so an install on an
  unsupported platform (or through a registry that does not mirror the
  per-platform packages) would otherwise fail outright; marking it optional
  turns that into a graceful degrade to the environment variables, and gives
  users an explicit opt-out via `npm install --omit=optional`.
- **Graceful, non-fatal fallback:** every keyring failure resolves to "this
  value is absent" — no such entry, an unreadable or locked store, a load
  failure, an unsupported platform, `--omit=optional`. The keyring is never
  *required*, and each of the three entries is isolated, so one failing entry
  does not discard the others.
- **The keyring lookup is bounded at 5 seconds**, so a hung or locked
  credential store cannot stall the MCP stdio handshake indefinitely. The
  `AsyncEntry.getPassword(signal)` abort signal alone would not achieve that —
  napi-rs cancels only work that has not started — so each read is additionally
  raced against a 5-second deadline, after which the environment fallback
  applies. Residual: the abandoned native read keeps a worker thread until the
  OS itself gives up on it (on macOS, a keychain permission dialog nobody
  answers). Credential resolution has already returned by then and the server
  serves requests normally; the only visible effect is on a process that would
  otherwise be idle enough to exit.
- **Known limitation — a keyring backend that hangs while it is being opened.**
  The 5-second bound covers the *read*. Creating the entry object is synchronous
  inside the native binding, and on Linux that opens the Secret Service D-Bus
  connection, so a Secret Service that accepts the connection but never answers
  blocks the event loop until D-Bus's own timeout expires; no JavaScript timer
  can interrupt it. The common headless case is unaffected — with no Secret
  Service at all the call fails immediately and the environment fallback
  applies. Isolating the native calls in a worker thread would close this; it is
  deliberately not done, because it would add a thread and its message plumbing
  to every credential resolution on every platform for a Linux-only condition
  nobody has reported. Please report it if you hit it.
- **Credential resolution never echoes a credential.** The "no credentials
  found" error names only the sources to configure (keyring service/accounts,
  environment variables) and prints the *default* service constant, never the
  runtime `TRANSKRIBUS_KEYRING_SERVICE` value — which a user could have mis-set
  to their password. Reports of any log line or error that prints a credential
  are in scope; note that the HTTP error-redaction layer removes session
  tokens, and a Transkribus endpoint that echoed a submitted password back in a
  response body is a separate, known gap rather than something this resolution
  order addresses.

## Responsible disclosure

Please do not disclose the issue publicly until a fix has been released and
the maintainers have had a reasonable opportunity to coordinate. We commit
to working on a fix promptly and crediting reporters in the changelog
unless you ask to remain anonymous.
