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

const server = createServer('transkribus-mcp-collections');

registerAuthTools(server);
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

startServer(server).catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
