#!/usr/bin/env node
import { createServer, logFatalAndExit, startServer } from './server.js';
import { registerAuthTools } from './tools/auth.js';
import { registerUserTools } from './tools/user.js';
import { registerCrowdsourcingTools } from './tools/crowdsourcing.js';
import { registerElearningTools } from './tools/elearning.js';
import { registerReferenceResource } from './resources/transkribus-reference.js';

const server = createServer('transkribus-mcp-users');

registerAuthTools(server);
registerUserTools(server);
registerCrowdsourcingTools(server);
registerElearningTools(server);
registerReferenceResource(server);

startServer(server).catch(logFatalAndExit);
