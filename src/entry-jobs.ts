#!/usr/bin/env node
import { createServer, logFatalAndExit, startServer } from './server.js';
import { registerAuthTools } from './tools/auth.js';
import { registerJobTools } from './tools/jobs.js';
import { registerActionTools } from './tools/actions.js';
import { registerReferenceResource } from './resources/transkribus-reference.js';

const server = createServer('transkribus-mcp-jobs');

registerAuthTools(server);
registerJobTools(server);
registerActionTools(server);
registerReferenceResource(server);

startServer(server).catch(logFatalAndExit);
