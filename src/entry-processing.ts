#!/usr/bin/env node
import { createServer, logFatalAndExit, startServer } from './server.js';
import { registerProcessingTools } from './tools/processing.js';
import { registerReferenceResource } from './resources/transkribus-reference.js';

// Deliberately registers no legacy auth tools: they manage the TrpServer
// JSESSIONID session, which the Processing API does not use, so offering them
// alongside these four would misrepresent how this server authenticates.
const server = createServer('transkribus-mcp-processing');

registerProcessingTools(server);
registerReferenceResource(server);

startServer(server).catch(logFatalAndExit);
