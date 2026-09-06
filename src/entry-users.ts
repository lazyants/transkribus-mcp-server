#!/usr/bin/env node
import { createServer, logFatalAndExit, startServer } from './server.js';
import { usersEntry, registerAll } from './entries.js';
import { registerReferenceResource } from './resources/transkribus-reference.js';

const server = createServer('transkribus-mcp-users');

registerAll(server, usersEntry);
registerReferenceResource(server);

startServer(server).catch(logFatalAndExit);
