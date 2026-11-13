# 4.2.0 release — packed-tarball smoke test

`smoke-packed.cast` (asciinema; plain-text copy in `smoke-packed.txt`) records
`smoke-packed.sh`: build, `npm pack`, install the tarball into a clean project the
way a user gets it, run `tools/list` over stdio, then call the three tools changed
in 4.2.0 through the installed binary.

Replay: `asciinema play smoke-packed.cast`

Re-run from the repository root: `bash docs/_attachments/release-4.2.0/smoke-packed.sh`

No request reaches Transkribus. `smoke-wire.mjs` starts the binary with
`HTTPS_PROXY` pointing at a local proxy that accepts the CONNECT tunnel for
`transkribus.eu` and terminates its TLS with a one-day throwaway certificate that
only the child process trusts (`NODE_EXTRA_CA_CERTS`). The proxy records the exact
method, URL, content type and body and answers with a canned reply. The keyring is
pointed at a service name with no entry, so no real credential is read.

Recorded result (server 4.2.0, SDK 1.32.2, zod 4.6.7):

- `tools/list`: 305 tools, 241 with a `required[]` array holding 429 parameters
  (4.1.1: 304 / 240 / 427 — the new PDF tool adds one tool and its two required
  parameters).
- `transkribus_doc_export` (#94): `POST …/collections/1/2/export?pages=1-2`,
  `application/json`, an `ExportParameters` body with the defaults plus
  `commonPars.doWritePdf` and `pdfPars.doPdfImagesPlusText`.
- `transkribus_model_get_by_type` (#95): `GET …/models/text?releaseLevel=public&isoLanguages=de&isoLanguages=en&…`
  — repeated keys, no `[]`.
- `transkribus_coll_create_doc_from_pdf` (#96): `POST …/collections/1/createDocFromPdf`,
  `multipart/form-data` with parts `file` (`application/pdf`, exact bytes) and `title`.
- A non-PDF file is refused with zero requests and no file content in the error.

The temporary directory path in the recording is replaced by `<tmp>`.
