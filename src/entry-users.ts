#!/usr/bin/env node
import { createServer, startServer } from './server.js';
import { registerAuthTools } from './tools/auth.js';
import { registerUserTools } from './tools/user.js';
import { registerCrowdsourcingTools } from './tools/crowdsourcing.js';
import { registerElearningTools } from './tools/elearning.js';

const server = createServer('transkribus-mcp-users');

registerAuthTools(server);
registerUserTools(server);
registerCrowdsourcingTools(server);
registerElearningTools(server);

startServer(server).catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
