#!/usr/bin/env node
import { createServer, startServer } from './server.js';
import { registerAuthTools } from './tools/auth.js';
import { registerModelTools } from './tools/models.js';

const server = createServer('transkribus-mcp-models');

registerAuthTools(server);
registerModelTools(server);

startServer(server).catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
