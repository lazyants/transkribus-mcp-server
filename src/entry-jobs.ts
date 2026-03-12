#!/usr/bin/env node
import { createServer, startServer } from './server.js';
import { registerAuthTools } from './tools/auth.js';
import { registerJobTools } from './tools/jobs.js';
import { registerActionTools } from './tools/actions.js';

const server = createServer('transkribus-mcp-jobs');

registerAuthTools(server);
registerJobTools(server);
registerActionTools(server);

startServer(server).catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
