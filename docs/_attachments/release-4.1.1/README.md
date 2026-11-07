# 4.1.1 release — packed-tarball smoke test

`smoke-packed.cast` (asciinema) records `smoke-packed.sh`: build, `npm pack`,
install the tarball into a clean project the way a user gets it, then start the
installed `transkribus-mcp-server` binary over stdio and run `tools/list`.

Replay: `asciinema play smoke-packed.cast`

Re-run from the repository root: `bash docs/_attachments/release-4.1.1/smoke-packed.sh`

Recorded result: server reports `4.1.1`, resolves `@modelcontextprotocol/sdk`
1.32.2 and `zod` 4.6.7, lists 304 tools, 240 of them with a `required[]` array
holding 427 parameters in total.

The same `smoke-packed.mjs` run against 4.1.0 built from its own lockfile
(SDK 1.30.0, zod 4.6.5) gives the same 304 / 240 / 427, so the dependency updates
did not drop any required parameter from `tools/list`.

No network call to Transkribus and no credential lookup: `tools/list` never
reaches the API or the keyring.
