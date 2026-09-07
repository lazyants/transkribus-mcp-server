// Live smoke test for issue #28 against the real Transkribus server, using the
// COMPILED dist and the operator's own credentials.
//   create upload structure -> PUT one page image -> poll status -> delete
// Output is deliberately reduced to the fields that prove the wire contract:
// account identifiers, collection names and file URLs are not printed, because
// this transcript is committed to a public repository.
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const ROOT = new URL('../../../', import.meta.url).pathname;
const { registerUploadTools } = await import(`${ROOT}/dist/tools/uploads.js`);
const { registerCollectionCoreTools } = await import(`${ROOT}/dist/tools/collections-core.js`);

function tools(register) {
  const s = new McpServer({ name: 'smoke', version: '0.0.0' });
  register(s);
  return s._registeredTools;
}
const up = tools(registerUploadTools);
const coll = tools(registerCollectionCoreTools);

async function call(reg, name, args, shown = args) {
  console.log(`\n>>> ${name} ${JSON.stringify(shown)}`);
  const res = await reg[name].handler(args);
  const text = res.content?.[0]?.text ?? '';
  if (res.isError) { console.log(`!!! ${text}`); throw new Error(`${name} failed`); }
  console.log('    HTTP OK');
  try { return JSON.parse(text); } catch { return text; }
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');
const img = join(mkdtempSync(join(tmpdir(), 'trp-smoke-')), 'page_0001.png');
writeFileSync(img, PNG);
console.log(`fixture: page_0001.png, ${PNG.length} bytes of real PNG`);

console.log('\n===== STEP 0: pick a collection (read-only) =====');
const cols = await call(coll, 'transkribus_coll_list', {});
const collId = (cols?.trpCollection ?? [])[0]?.colId;
if (!collId) throw new Error('no collection on this account');
console.log(`    collections visible: ${cols.total}; using the first one`);

console.log('\n===== STEP 1: create upload structure =====');
console.log('    proves: collId is accepted as a QUERY param and the body is read');
console.log('    as a documentUploadDescriptor with a nested pageList wrapper');
const title = `issue-28 smoke ${new Date().toISOString()}`;
const upload = await call(up, 'transkribus_upload_create_structure',
  { collId, title, pages: [{ fileName: 'page_0001.png', pageNr: 1 }] },
  { collId: '<collId>', title, pages: [{ fileName: 'page_0001.png', pageNr: 1 }] });
const uploadId = upload?.uploadId;
if (!uploadId) throw new Error('server returned no uploadId');
console.log(`    server echoed uploadType=${upload.uploadType}, nrOfPagesTotal=${upload.nrOfPagesTotal}`);
console.log(`    pageList.pages -> ${JSON.stringify(upload.pageList?.pages)}`);

console.log('\n===== STEP 2: PUT the page image as multipart part "img" =====');
console.log('    proves: real image bytes reach the server, not the JSON literal {"img":{}}');
const put = await call(up, 'transkribus_upload_page', { uploadId, imagePath: img },
  { uploadId, imagePath: '<tmp>/page_0001.png' });
console.log(`    pageUploaded -> ${put.pageList?.pages?.[0]?.pageUploaded}`);
console.log(`    finished -> ${put.finished !== undefined}; ingest job created -> ${put.jobId !== undefined}`);

console.log('\n===== STEP 3: poll upload status =====');
const st = await call(up, 'transkribus_upload_get_status', { uploadId });
console.log(`    pageUploaded -> ${st.pageList?.pages?.[0]?.pageUploaded}`);

console.log('\n===== STEP 4: clean up — delete the upload =====');
await call(up, 'transkribus_upload_delete', { uploadId });

console.log('\n===== SMOKE TEST PASSED — ingestion works against the live server =====');
