import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAuthTools } from './tools/auth.js';
import { registerCollectionCoreTools } from './tools/collections-core.js';
import { registerCollectionDocumentTools } from './tools/collections-documents.js';
import { registerCollectionPageTools } from './tools/collections-pages.js';
import { registerCollectionUserTools } from './tools/collections-users.js';
import { registerCollectionCrowdTools } from './tools/collections-crowd.js';
import { registerCollectionEditDeclTools } from './tools/collections-editdecl.js';
import { registerCollectionCreditTools } from './tools/collections-credits.js';
import { registerCollectionStatsTools } from './tools/collections-stats.js';
import { registerCollectionLabelTools } from './tools/collections-labels.js';
import { registerCollectionActivityTools } from './tools/collections-activity.js';
import { registerCollectionTagTools } from './tools/collections-tags.js';
import { registerRecognitionTools } from './tools/recognition.js';
import { registerModelTools } from './tools/models.js';
import { registerSearchTools } from './tools/search.js';
import { registerJobTools } from './tools/jobs.js';
import { registerCreditTools } from './tools/credits.js';
import { registerUserTools } from './tools/user.js';
import { registerUploadTools } from './tools/uploads.js';
import { registerLabelTools } from './tools/labels.js';
import { registerLayoutAnalysisTools } from './tools/layout-analysis.js';
import { registerKwsTools } from './tools/kws.js';
import { registerCrowdsourcingTools } from './tools/crowdsourcing.js';
import { registerElearningTools } from './tools/elearning.js';
import { registerPylaiaTools } from './tools/pylaia.js';
import { registerP2palaTools } from './tools/p2pala.js';
import { registerDuTools } from './tools/du.js';
import { registerAdminTools } from './tools/admin.js';
import { registerFileTools } from './tools/files.js';
import { registerSystemTools } from './tools/system.js';
import { registerRootTools } from './tools/root.js';
import { registerActionTools } from './tools/actions.js';

// Single source of truth for which tool modules each published entry point ships.
// The entry files, src/index.ts and the smoke tests all consume these arrays, so a
// module added or dropped here moves the shipped binary and the test together —
// previously the lists were written out once per consumer and could drift apart.
export type ToolRegistrar = (server: McpServer) => void;

export const collectionsEntry: readonly ToolRegistrar[] = [
  registerAuthTools,
  registerCollectionCoreTools,
  registerCollectionDocumentTools,
  registerCollectionPageTools,
  registerCollectionUserTools,
  registerCollectionCrowdTools,
  registerCollectionEditDeclTools,
  registerCollectionCreditTools,
  registerCollectionStatsTools,
  registerCollectionLabelTools,
  registerCollectionActivityTools,
  registerCollectionTagTools,
];

export const transcriptionEntry: readonly ToolRegistrar[] = [
  registerAuthTools,
  registerRecognitionTools,
  registerLayoutAnalysisTools,
  registerPylaiaTools,
  registerP2palaTools,
  registerDuTools,
];

export const modelsEntry: readonly ToolRegistrar[] = [registerAuthTools, registerModelTools];

export const searchEntry: readonly ToolRegistrar[] = [
  registerAuthTools,
  registerSearchTools,
  registerKwsTools,
];

export const jobsEntry: readonly ToolRegistrar[] = [
  registerAuthTools,
  registerJobTools,
  registerActionTools,
];

export const usersEntry: readonly ToolRegistrar[] = [
  registerAuthTools,
  registerUserTools,
  registerCrowdsourcingTools,
  registerElearningTools,
];

export const adminEntry: readonly ToolRegistrar[] = [
  registerAuthTools,
  registerAdminTools,
  registerCreditTools,
  registerUploadTools,
  registerLabelTools,
  registerFileTools,
  registerSystemTools,
  registerRootTools,
];

// The full server is exactly the union of the seven split entries, de-duplicated by
// function identity (registerAuthTools appears in all seven; Set preserves insertion
// order, so this reproduces the hand-written registration order src/index.ts used).
// Consequence, accepted deliberately: a new tool module has to join one of the split
// entries above to reach the full server — a module reachable only from index.ts
// would be missing from every split binary anyway.
export const fullEntry: readonly ToolRegistrar[] = [
  ...new Set([
    ...collectionsEntry,
    ...transcriptionEntry,
    ...modelsEntry,
    ...searchEntry,
    ...jobsEntry,
    ...usersEntry,
    ...adminEntry,
  ]),
];

export function registerAll(server: McpServer, registrars: readonly ToolRegistrar[]): void {
  for (const register of registrars) register(server);
}
