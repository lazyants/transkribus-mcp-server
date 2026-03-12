#!/usr/bin/env node
import { createServer, startServer } from './server.js';
import { registerAuthTools } from './tools/auth.js';
import { registerAdminTools } from './tools/admin.js';
import { registerCreditTools } from './tools/credits.js';
import { registerUploadTools } from './tools/uploads.js';
import { registerLabelTools } from './tools/labels.js';
import { registerFileTools } from './tools/files.js';
import { registerSystemTools } from './tools/system.js';
import { registerRootTools } from './tools/root.js';

const server = createServer('transkribus-mcp-admin');

registerAuthTools(server);
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
