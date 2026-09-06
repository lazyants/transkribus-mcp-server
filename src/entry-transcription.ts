#!/usr/bin/env node
import { createServer, logFatalAndExit, startServer } from './server.js';
import { transcriptionEntry, registerAll } from './entries.js';
import { registerReferenceResource } from './resources/transkribus-reference.js';

const server = createServer('transkribus-mcp-transcription');

registerAll(server, transcriptionEntry);
registerReferenceResource(server);

startServer(server).catch(logFatalAndExit);
