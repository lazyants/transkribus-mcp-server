import { z } from 'zod';
import { DocIdSchema, intCoerce } from './common.js';

// Request body of `POST /collections/{collId}/{id}/export` and
// `POST /collections/{collId}/export`: an `ExportParameters` object (TrpServer
// OpenAPI 4.69.0). Formats are switched on in `commonPars`; each format's own
// options live in its own section. The page range is NOT part of this body — both
// endpoints read it from the `pages` query parameter.
//
// Deliberately left out of `commonPars`: `pages` (sent as the query parameter),
// fields the spec marks internal or admin-only (`dir`, `useOcrMasterDir`,
// `customEmail`), local-client switches (`useCache`, `useHttps`, `doOverwrite`,
// `pageDirName`), and the undocumented TXT-split group (`doSplitTxt`,
// `*_for_split*`).

const flag = () => z.boolean().optional();
const int = () => intCoerce(z.number().int()).optional();

const ImageQualitySchema = z.enum(['orig', 'browser', 'view', 'thumb', 'scale50', 'scale25', 'bin']);

export const CommonExportParsSchema = z.object({
  doWriteMets: flag().describe('Write mets.xml (metadata, pagination)'),
  doWriteImages: flag().describe('Export the image files'),
  doExportPageXml: flag().describe('Export PAGE XML'),
  doExportAltoXml: flag().describe('Export ALTO XML (options in altoPars)'),
  doWritePdf: flag().describe('Export PDF (options in pdfPars)'),
  doWriteTei: flag().describe('Export TEI (options in teiPars)'),
  doWriteDocx: flag().describe('Export DOCX (options in docxPars)'),
  doExportSingleTxtFiles: flag().describe('Export one TXT file per image'),
  doWriteOneTxt: flag().describe('Export one TXT file per document'),
  doExportDocMetadata: flag().describe('Export document metadata to metadata.xml'),
  doWriteStructureInMets: flag().describe('Add the logical structure to mets.xml'),
  doWriteTagsXlsx: flag(),
  doWriteTagsIob: flag(),
  doWriteTablesXlsx: flag().describe('Export tables to XLSX'),
  doWriteTableSingleColumn: flag(),
  doIncludeImagesInXlsx: flag(),
  doWriteOneTableForDoc: flag(),
  doWriteStructuresInXlsx: flag(),
  doWriteWordsIntoTable: flag(),
  doWriteStructuresRowBased: flag(),
  doWritePageMdXlsx: flag().describe('Export page metadata to XLSX'),
  tableColumn: int(),
  doCreateTitle: flag(),
  useVersionStatus: z.string().optional().describe('Transcript version to export, e.g. "Latest"'),
  writeTextOnWordLevel: flag(),
  doBlackening: flag(),
  selectedTags: z.array(z.string()).optional(),
  structureTagNames: z.array(z.string()).optional(),
  font: z.string().optional().describe('Font of the text in PDF exports'),
  splitIntoWordsInAltoXml: flag(),
  fileNamePattern: z.string().optional(),
  remoteImgQuality: ImageQualitySchema.optional().describe('Which image derivative to export'),
  exportTranscriptMetadata: flag(),
  storeValidPageXml: flag(),
  store2019PageXml: flag(),
  updatePageXmlImageDimensions: flag(),
  doResume: flag(),
  filterHiddenPages: flag(),
  hideUser: z.enum(['NULL', 'NA', 'HIDDEN']).optional().describe('How the uploader is anonymized in exported metadata'),
});

export const AltoExportParsSchema = z.object({
  splitIntoWordsInAltoXml: flag(),
  createAltov2: flag(),
  altoVersion: z.enum(['2.0', '4.0', '4.4']).optional(),
  exportTextStyleTags: flag(),
  useFilenameAsPageId: flag(),
  exportStructureTags: flag(),
});

export const PdfExportParsSchema = z.object({
  doPdfImagesOnly: flag(),
  doPdfImagesPlusText: flag(),
  doPdfWithTextPages: flag(),
  doPdfWithTags: flag(),
  doPdfWithArticles: flag(),
  doPdfA: flag(),
  doSinglePagePdfs: flag(),
  doUseLinePolygons: flag(),
  isAddImagePages: flag(),
  defaultLineHeight: int(),
  pdfImgQuality: ImageQualitySchema.optional(),
  fullCompression: flag(),
  compressionLevel: int().describe('Stream compression and JPEG quality: 0 = fastest, 9 = smallest, -1 = default'),
  imgMaxDpi: int().describe('Downscale embedded images to this DPI; 0 = off'),
  doTagHighlightsOnImage: flag(),
  doTagHighlightsInText: flag(),
  doTagLegendPage: flag(),
  doTableCellBorders: flag(),
  doPdfTableStructure: flag(),
  pageNumberPosition: z.string().optional().describe('Page number position, e.g. "BC" (bottom center); empty = none'),
  textPageLayout: z.enum(['legacy', 'compact']).optional(),
});

export const TeiExportParsSchema = z.object({
  regionZones: flag(),
  lineZones: flag(),
  wordZones: flag(),
  boundingBoxCoords: flag(),
  linebreakType: z.string().optional(),
  lineBreakAtBeginningOfLine: flag(),
  pbImageNameAsXmlId: flag(),
  lineXmlIds: flag(),
  exportPredefinedTagsAndAttsInTei: flag(),
  useXslTransformation: flag().describe('Build the TEI with the page2tei XSL transformation'),
  useBoundingRects: flag(),
  useRsTags: flag(),
  tokenizeWhitespace: flag(),
  combineContinuedTags: flag(),
  useAbElements: flag(),
  useWordCoordinates: flag(),
  withoutTextline: flag(),
});

export const DocxExportParsSchema = z.object({
  doDocxWithTags: flag(),
  doDocxPreserveLineBreaks: flag(),
  doDocxForcePageBreaks: flag(),
  doDocxMarkUnclear: flag(),
  doDocxKeepAbbrevs: flag(),
  doDocxExpandAbbrevs: flag(),
  doDocxSubstituteAbbrevs: flag(),
  doDocxWriteFilenames: flag(),
  doDocxIgnoreSuppliedTag: flag(),
  doDocxShowSuppliedTagWithBrackets: flag(),
});

// The defaults this server has always advertised for an export: METS, images,
// PAGE XML and ALTO of the latest transcript. Sent explicitly so the outcome does
// not depend on the service's own defaults; any value the caller sets wins.
export const DEFAULT_COMMON_EXPORT_PARS = {
  doWriteMets: true,
  doWriteImages: true,
  doExportPageXml: true,
  doExportAltoXml: true,
  splitIntoWordsInAltoXml: true,
  useVersionStatus: 'Latest',
} as const;

/** Input fields shared by the document and the collection export tools. */
export const ExportOptionsShape = {
  pages: z.string().optional().describe('Page range to export, e.g. "1-5,8"; all pages when omitted'),
  commonPars: CommonExportParsSchema.optional().describe(
    'Formats and common options. Defaults: METS, images, PAGE XML and ALTO of the latest version',
  ),
  altoPars: AltoExportParsSchema.optional().describe('ALTO options'),
  pdfPars: PdfExportParsSchema.optional().describe('PDF options'),
  teiPars: TeiExportParsSchema.optional().describe('TEI options'),
  docxPars: DocxExportParsSchema.optional().describe('DOCX options'),
};

type ExportOptions = {
  commonPars?: z.infer<typeof CommonExportParsSchema>;
  altoPars?: z.infer<typeof AltoExportParsSchema>;
  pdfPars?: z.infer<typeof PdfExportParsSchema>;
  teiPars?: z.infer<typeof TeiExportParsSchema>;
  docxPars?: z.infer<typeof DocxExportParsSchema>;
};

/** Build the `ExportParameters` body. Reads only the named sections, so an
 *  unrecognised top-level argument can never reach the request. */
export function buildExportParameters(options: ExportOptions): Record<string, unknown> {
  const body: Record<string, unknown> = {
    commonPars: { ...DEFAULT_COMMON_EXPORT_PARS, ...options.commonPars },
  };
  for (const section of ['altoPars', 'pdfPars', 'teiPars', 'docxPars'] as const) {
    if (options[section] !== undefined) body[section] = options[section];
  }
  return body;
}

/** Document selection for the collection export: which documents, and
 *  optionally which of their pages. */
export const ExportDocsSchema = z
  .array(
    z.object({
      docId: DocIdSchema,
      pageIds: z.array(intCoerce(z.number().int().positive())).optional().describe('Page IDs; all pages when omitted'),
    }),
  )
  .describe('Documents to export, each with an optional page selection');

/** The `docs` member of ExportParameters: `{ doc: [DocumentSelectionDescriptor] }`,
 *  with pages wrapped as `pageList: { pages: [{ pageId }] }`. */
export function buildDocumentSelection(docs: z.infer<typeof ExportDocsSchema>): Record<string, unknown> {
  return {
    doc: docs.map(({ docId, pageIds }) =>
      pageIds ? { docId, pageList: { pages: pageIds.map((pageId) => ({ pageId })) } } : { docId },
    ),
  };
}
