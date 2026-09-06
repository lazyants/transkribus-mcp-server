# Metagrapho Processing API — manual smoke test

`smoke-tools-list.cast` (asciinema) records a real MCP stdio session against the
**built** `dist/entry-processing.js`: `tools/list`, `resources/list`, and one
`tools/call` with a string-encoded `processId` and no credentials.

Replay: `asciinema play smoke-tools-list.cast`

Re-run from the repository root, after `npm run build`:

```bash
node docs/_attachments/metagrapho-processing-api/smoke-processing.mjs
```

What it proves, none of which a unit test asserts about the shipped binary:

- the entry point starts and advertises exactly the 4 processing tools;
- `required[]` carries `processId` / `config` + `image` — i.e. the zod-4
  `z.preprocess` `optin` trap that once dropped 191 required params is not
  present on the new schemas;
- the API-reference resource is advertised from this entry too;
- a string-encoded id passes schema validation (the failure comes from the
  credential stage, not from validation);
- the credential-missing error names the environment variables and carries no
  secret.

It performs no network call: `tools/list` never reaches Transkribus, and the
single `tools/call` fails before a request is made. A smoke test against the
live API needs a real Transkribus account and is not run here.
