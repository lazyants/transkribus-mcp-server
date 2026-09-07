#!/usr/bin/env node
import { createServer, logFatalAndExit, startServer } from './server.js';
import { fullEntry, registerAll } from './entries.js';
import { registerReferenceResource } from './resources/transkribus-reference.js';

const server = createServer('transkribus-mcp-server');

registerAll(server, fullEntry);
registerReferenceResource(server);

startServer(server).catch(logFatalAndExit);
