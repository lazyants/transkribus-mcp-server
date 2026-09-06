#!/usr/bin/env node
import { createServer, logFatalAndExit, startServer } from './server.js';
import { collectionsEntry, registerAll } from './entries.js';
import { registerReferenceResource } from './resources/transkribus-reference.js';

const server = createServer('transkribus-mcp-collections');

registerAll(server, collectionsEntry);
registerReferenceResource(server);

startServer(server).catch(logFatalAndExit);
