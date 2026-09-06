#!/usr/bin/env node
import { createServer, logFatalAndExit, startServer } from './server.js';
import { adminEntry, registerAll } from './entries.js';
import { registerReferenceResource } from './resources/transkribus-reference.js';

const server = createServer('transkribus-mcp-admin');

registerAll(server, adminEntry);
registerReferenceResource(server);

startServer(server).catch(logFatalAndExit);
