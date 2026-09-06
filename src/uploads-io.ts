import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

/** Local-file I/O and multipart assembly shared by the ingestion tools.
 *
 *  Transkribus' ingestion endpoints take real bytes: `multipart/form-data`
 *  (parts `img` / `xml` / `mets`), `application/xml` (METS), or `text/csv`.
 *  These helpers turn caller-supplied local paths and inline strings into
 *  those bodies. Reading a caller-chosen path follows the precedent already
 *  set by `src/tools/pylaia.ts` (`readFileSync(trainListFile)`): the caller is
 *  the user's own local MCP client acting with the user's own credentials, and
 *  no path here originates in an API response. */

/** Read a local file, surfacing a message an MCP client can act on rather than
 *  a bare ENOENT stack. */
export function readLocalFile(filePath: string): Buffer {
  try {
    return readFileSync(filePath);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read local file "${filePath}": ${reason}`, { cause: err });
  }
}

/** Resolve a text payload supplied either inline or as a local file path.
 *  Exactly one of the two must be present — the tool schemas enforce that with
 *  a `.refine()`, but the XOR is invisible in the emitted JSON Schema, so this
 *  re-checks it at call time. */
export function resolveTextPayload(
  inline: string | undefined,
  filePath: string | undefined,
  inlineField: string,
  fileField: string,
): string {
  if (!exactlyOneOf(inline, filePath)) {
    throw new Error(`Provide exactly one of "${inlineField}" or "${fileField}".`);
  }
  return inline !== undefined ? inline : readLocalFile(filePath as string).toString('utf-8');
}

/** True when exactly one of the two values was supplied. Used as the predicate
 *  of the tool schemas' `.refine()` for content-or-path inputs. */
export function exactlyOneOf(a: unknown, b: unknown): boolean {
  return (a === undefined) !== (b === undefined);
}

/** Append a local file as a named multipart part. The part name is the wire
 *  contract (`img`, `xml`, `mets`) — Transkribus looks the part up by name, so
 *  these strings are not cosmetic. */
export function appendFilePart(
  form: FormData,
  partName: string,
  filePath: string,
  fileName?: string,
): void {
  const bytes = readLocalFile(filePath);
  // `new Blob([buffer])` does not type-check against @types/node 20's BlobPart:
  // a Buffer is a Uint8Array<ArrayBufferLike>, while BlobPart wants a view over
  // a plain ArrayBuffer. readFileSync never returns SharedArrayBuffer-backed
  // memory, so re-wrapping the same bytes with that narrower type is sound and
  // copies nothing.
  const view = new Uint8Array(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength);
  form.append(partName, new Blob([view]), fileName ?? basename(filePath));
}

/** Append an in-memory string as a named multipart part. */
export function appendTextPart(
  form: FormData,
  partName: string,
  content: string,
  fileName: string,
): void {
  form.append(partName, new Blob([content]), fileName);
}
