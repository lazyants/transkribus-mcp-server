#!/usr/bin/env node
import { createServer, logFatalAndExit, startServer } from './server.js';
import { searchEntry, registerAll } from './entries.js';
import { registerReferenceResource } from './resources/transkribus-reference.js';

const server = createServer('transkribus-mcp-search');

registerAll(server, searchEntry);
registerReferenceResource(server);

startServer(server).catch(logFatalAndExit);
