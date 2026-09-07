#!/usr/bin/env node
import { createServer, logFatalAndExit, startServer } from './server.js';
import { processingEntry, registerAll } from './entries.js';
import { registerReferenceResource } from './resources/transkribus-reference.js';

const server = createServer('transkribus-mcp-processing');

registerAll(server, processingEntry);
registerReferenceResource(server);

startServer(server).catch(logFatalAndExit);
