#!/usr/bin/env node
import { createServer, startServer } from './server.js';
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

const server = createServer('transkribus-mcp-server');

// Auth
registerAuthTools(server);

// Collections (117 tools)
registerCollectionCoreTools(server);
registerCollectionDocumentTools(server);
registerCollectionPageTools(server);
registerCollectionUserTools(server);
registerCollectionCrowdTools(server);
registerCollectionEditDeclTools(server);
registerCollectionCreditTools(server);
registerCollectionStatsTools(server);
registerCollectionLabelTools(server);
registerCollectionActivityTools(server);
registerCollectionTagTools(server);

// Recognition & Training
registerRecognitionTools(server);
registerLayoutAnalysisTools(server);
registerPylaiaTools(server);
registerP2palaTools(server);
registerDuTools(server);

// Models
registerModelTools(server);

// Search & KWS
registerSearchTools(server);
registerKwsTools(server);

// Jobs & Actions
registerJobTools(server);
registerActionTools(server);

// Users & Crowdsourcing & eLearning
registerUserTools(server);
registerCrowdsourcingTools(server);
registerElearningTools(server);

// Admin & System
registerAdminTools(server);
registerCreditTools(server);
registerUploadTools(server);
registerLabelTools(server);
registerFileTools(server);
registerSystemTools(server);
registerRootTools(server);

startServer(server).catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
