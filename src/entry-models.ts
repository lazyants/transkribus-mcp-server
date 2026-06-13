#!/usr/bin/env node
import { createServer, logFatalAndExit, startServer } from './server.js';
import { registerAuthTools } from './tools/auth.js';
import { registerModelTools } from './tools/models.js';
import { registerReferenceResource } from './resources/transkribus-reference.js';

const server = createServer('transkribus-mcp-models');

registerAuthTools(server);
registerModelTools(server);
registerReferenceResource(server);

startServer(server).catch(logFatalAndExit);
