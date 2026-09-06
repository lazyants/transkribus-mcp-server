#!/usr/bin/env node
import { createServer, logFatalAndExit, startServer } from './server.js';
import { jobsEntry, registerAll } from './entries.js';
import { registerReferenceResource } from './resources/transkribus-reference.js';

const server = createServer('transkribus-mcp-jobs');

registerAll(server, jobsEntry);
registerReferenceResource(server);

startServer(server).catch(logFatalAndExit);
