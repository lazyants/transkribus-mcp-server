# Issue #28 — live ingestion smoke test

Proof that document ingestion works against the real Transkribus server, not just
against the unit tests.

- `live-smoke.cast` — asciinema recording of the run. Replay with
  `asciinema play live-smoke.cast`.
- `live-smoke.mjs` — the script that was recorded. It drives the compiled `dist/`
  with the operator's own `TRANSKRIBUS_USER` / `TRANSKRIBUS_PASSWORD`.

## What the run proves

| Step | Tool | What it establishes |
|---|---|---|
| 1 | `transkribus_upload_create_structure` | `collId` is accepted as a query param and the body is parsed as a `documentUploadDescriptor`; the server echoes back `pageList.pages` with the page it was given |
| 2 | `transkribus_upload_page` | the page image reaches the server as a real `multipart/form-data` part named `img` — `pageUploaded` flips to `true` and an ingest job is created |
| 3 | `transkribus_upload_get_status` | the upload is retrievable by id |
| 4 | `transkribus_upload_delete` | cleanup; the run leaves no document behind, verified afterwards by listing the collection |

## What is deliberately not in the transcript

The script prints only the fields that prove the wire contract. Account
identifiers, the operator's email, collection names and `files.transkribus.eu`
URLs are not printed, because this transcript is committed to a public
repository.

Run of 2026-09-07: all four steps returned HTTP OK and the collection was
unchanged afterwards.
