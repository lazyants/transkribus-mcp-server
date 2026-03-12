#!/usr/bin/env node
import { createServer, startServer } from './server.js';
import { registerAuthTools } from './tools/auth.js';
import { registerSearchTools } from './tools/search.js';
import { registerKwsTools } from './tools/kws.js';

const server = createServer('transkribus-mcp-search');

registerAuthTools(server);
registerSearchTools(server);
registerKwsTools(server);

startServer(server).catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
