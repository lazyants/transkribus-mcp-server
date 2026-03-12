#!/usr/bin/env node
import { createServer, startServer } from './server.js';
import { registerAuthTools } from './tools/auth.js';
import { registerRecognitionTools } from './tools/recognition.js';
import { registerLayoutAnalysisTools } from './tools/layout-analysis.js';
import { registerPylaiaTools } from './tools/pylaia.js';
import { registerP2palaTools } from './tools/p2pala.js';
import { registerDuTools } from './tools/du.js';

const server = createServer('transkribus-mcp-transcription');

registerAuthTools(server);
registerRecognitionTools(server);
registerLayoutAnalysisTools(server);
registerPylaiaTools(server);
registerP2palaTools(server);
registerDuTools(server);

startServer(server).catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
