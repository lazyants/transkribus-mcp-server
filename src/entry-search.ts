#!/usr/bin/env node
import { createServer, logFatalAndExit, startServer } from './server.js';
import { registerAuthTools } from './tools/auth.js';
import { registerSearchTools } from './tools/search.js';
import { registerKwsTools } from './tools/kws.js';

const server = createServer('transkribus-mcp-search');

registerAuthTools(server);
registerSearchTools(server);
registerKwsTools(server);

startServer(server).catch(logFatalAndExit);
