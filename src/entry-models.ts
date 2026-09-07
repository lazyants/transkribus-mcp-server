#!/usr/bin/env node
import { createServer, logFatalAndExit, startServer } from './server.js';
import { modelsEntry, registerAll } from './entries.js';
import { registerReferenceResource } from './resources/transkribus-reference.js';

const server = createServer('transkribus-mcp-models');

registerAll(server, modelsEntry);
registerReferenceResource(server);

startServer(server).catch(logFatalAndExit);
