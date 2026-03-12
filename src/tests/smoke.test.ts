import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAuthTools } from '../tools/auth.js';
import { registerCollectionCoreTools } from '../tools/collections-core.js';
import { registerCollectionDocumentTools } from '../tools/collections-documents.js';
import { registerCollectionPageTools } from '../tools/collections-pages.js';
import { registerCollectionUserTools } from '../tools/collections-users.js';
import { registerCollectionCrowdTools } from '../tools/collections-crowd.js';
import { registerCollectionEditDeclTools } from '../tools/collections-editdecl.js';
import { registerCollectionCreditTools } from '../tools/collections-credits.js';
import { registerCollectionStatsTools } from '../tools/collections-stats.js';
import { registerCollectionLabelTools } from '../tools/collections-labels.js';
import { registerCollectionActivityTools } from '../tools/collections-activity.js';
import { registerCollectionTagTools } from '../tools/collections-tags.js';
import { registerRecognitionTools } from '../tools/recognition.js';
import { registerModelTools } from '../tools/models.js';
import { registerSearchTools } from '../tools/search.js';
import { registerJobTools } from '../tools/jobs.js';
import { registerCreditTools } from '../tools/credits.js';
import { registerUserTools } from '../tools/user.js';
import { registerUploadTools } from '../tools/uploads.js';
import { registerLabelTools } from '../tools/labels.js';
import { registerLayoutAnalysisTools } from '../tools/layout-analysis.js';
import { registerKwsTools } from '../tools/kws.js';
import { registerCrowdsourcingTools } from '../tools/crowdsourcing.js';
import { registerElearningTools } from '../tools/elearning.js';
import { registerPylaiaTools } from '../tools/pylaia.js';
import { registerP2palaTools } from '../tools/p2pala.js';
import { registerDuTools } from '../tools/du.js';
import { registerAdminTools } from '../tools/admin.js';
import { registerFileTools } from '../tools/files.js';
import { registerSystemTools } from '../tools/system.js';
import { registerRootTools } from '../tools/root.js';
import { registerActionTools } from '../tools/actions.js';

function freshServer(): McpServer {
  return new McpServer({ name: 'test', version: '0.0.0' });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toolCount(server: McpServer): number {
  return Object.keys((server as any)._registeredTools).length;
}

describe('Transkribus MCP Server — smoke tests', () => {
  it('registers 290 tools for the full server', () => {
    const server = freshServer();

    // Auth (6)
    registerAuthTools(server);

    // Collections (117)
    registerCollectionCoreTools(server);
    registerCollectionDocumentTools(server);
    registerCollectionPageTools(server);
    registerCollectionUserTools(server);
    registerCollectionCrowdTools(server);
    registerCollectionEditDeclTools(server);
    registerCollectionCreditTools(server);
    registerCollectionStatsTools(server);
    registerCollectionLabelTools(server);
    registerCollectionActivityTools(server);
    registerCollectionTagTools(server);

    // Recognition & Training (41)
    registerRecognitionTools(server);
    registerLayoutAnalysisTools(server);
    registerPylaiaTools(server);
    registerP2palaTools(server);
    registerDuTools(server);

    // Models (21)
    registerModelTools(server);

    // Search & KWS (11)
    registerSearchTools(server);
    registerKwsTools(server);

    // Jobs & Actions (13)
    registerJobTools(server);
    registerActionTools(server);

    // Users & Crowdsourcing & eLearning (24)
    registerUserTools(server);
    registerCrowdsourcingTools(server);
    registerElearningTools(server);

    // Admin & System & Resources (49)
    registerAdminTools(server);
    registerCreditTools(server);
    registerUploadTools(server);
    registerLabelTools(server);
    registerFileTools(server);
    registerSystemTools(server);
    registerRootTools(server);

    expect(toolCount(server)).toBe(301);
  });

  it('registers 6 auth tools', () => {
    const server = freshServer();
    registerAuthTools(server);
    expect(toolCount(server)).toBe(6);
  });

  it('registers 126 collection tools', () => {
    const server = freshServer();
    registerCollectionCoreTools(server);
    registerCollectionDocumentTools(server);
    registerCollectionPageTools(server);
    registerCollectionUserTools(server);
    registerCollectionCrowdTools(server);
    registerCollectionEditDeclTools(server);
    registerCollectionCreditTools(server);
    registerCollectionStatsTools(server);
    registerCollectionLabelTools(server);
    registerCollectionActivityTools(server);
    registerCollectionTagTools(server);
    expect(toolCount(server)).toBe(127);
  });

  it('registers 33 recognition tools', () => {
    const server = freshServer();
    registerRecognitionTools(server);
    expect(toolCount(server)).toBe(33);
  });

  it('registers 21 model tools', () => {
    const server = freshServer();
    registerModelTools(server);
    expect(toolCount(server)).toBe(21);
  });

  it('registers 6 search tools', () => {
    const server = freshServer();
    registerSearchTools(server);
    expect(toolCount(server)).toBe(6);
  });

  it('registers 5 kws tools', () => {
    const server = freshServer();
    registerKwsTools(server);
    expect(toolCount(server)).toBe(5);
  });

  it('registers 10 job tools', () => {
    const server = freshServer();
    registerJobTools(server);
    expect(toolCount(server)).toBe(10);
  });

  it('registers 3 action tools', () => {
    const server = freshServer();
    registerActionTools(server);
    expect(toolCount(server)).toBe(3);
  });

  it('registers 12 credit tools', () => {
    const server = freshServer();
    registerCreditTools(server);
    expect(toolCount(server)).toBe(12);
  });

  it('registers 15 user tools', () => {
    const server = freshServer();
    registerUserTools(server);
    expect(toolCount(server)).toBe(15);
  });

  it('registers 11 upload tools', () => {
    const server = freshServer();
    registerUploadTools(server);
    expect(toolCount(server)).toBe(11);
  });

  it('registers 13 label tools', () => {
    const server = freshServer();
    registerLabelTools(server);
    expect(toolCount(server)).toBe(13);
  });

  it('registers 5 layout analysis tools', () => {
    const server = freshServer();
    registerLayoutAnalysisTools(server);
    expect(toolCount(server)).toBe(5);
  });

  it('registers 5 crowdsourcing tools', () => {
    const server = freshServer();
    registerCrowdsourcingTools(server);
    expect(toolCount(server)).toBe(5);
  });

  it('registers 4 elearning tools', () => {
    const server = freshServer();
    registerElearningTools(server);
    expect(toolCount(server)).toBe(4);
  });

  it('registers 2 pylaia tools', () => {
    const server = freshServer();
    registerPylaiaTools(server);
    expect(toolCount(server)).toBe(2);
  });

  it('registers 1 p2pala tool', () => {
    const server = freshServer();
    registerP2palaTools(server);
    expect(toolCount(server)).toBe(1);
  });

  it('registers 1 du tool', () => {
    const server = freshServer();
    registerDuTools(server);
    expect(toolCount(server)).toBe(1);
  });

  it('registers 8 admin tools', () => {
    const server = freshServer();
    registerAdminTools(server);
    expect(toolCount(server)).toBe(8);
  });

  it('registers 3 file tools', () => {
    const server = freshServer();
    registerFileTools(server);
    expect(toolCount(server)).toBe(3);
  });

  it('registers 2 system tools', () => {
    const server = freshServer();
    registerSystemTools(server);
    expect(toolCount(server)).toBe(2);
  });

  it('registers 8 root tools', () => {
    const server = freshServer();
    registerRootTools(server);
    expect(toolCount(server)).toBe(8);
  });

  // Entry point tests
  it('registers 123 tools for collections entry point', () => {
    const server = freshServer();
    registerAuthTools(server);
    registerCollectionCoreTools(server);
    registerCollectionDocumentTools(server);
    registerCollectionPageTools(server);
    registerCollectionUserTools(server);
    registerCollectionCrowdTools(server);
    registerCollectionEditDeclTools(server);
    registerCollectionCreditTools(server);
    registerCollectionStatsTools(server);
    registerCollectionLabelTools(server);
    registerCollectionActivityTools(server);
    registerCollectionTagTools(server);
    expect(toolCount(server)).toBe(133); // 6 auth + 127 collections
  });

  it('registers 47 tools for transcription entry point', () => {
    const server = freshServer();
    registerAuthTools(server);
    registerRecognitionTools(server);
    registerLayoutAnalysisTools(server);
    registerPylaiaTools(server);
    registerP2palaTools(server);
    registerDuTools(server);
    expect(toolCount(server)).toBe(48); // 6 + 33 + 5 + 2 + 1 + 1
  });

  it('registers 27 tools for models entry point', () => {
    const server = freshServer();
    registerAuthTools(server);
    registerModelTools(server);
    expect(toolCount(server)).toBe(27); // 6 + 21
  });

  it('registers 17 tools for search entry point', () => {
    const server = freshServer();
    registerAuthTools(server);
    registerSearchTools(server);
    registerKwsTools(server);
    expect(toolCount(server)).toBe(17); // 6 + 6 + 5
  });

  it('registers 19 tools for jobs entry point', () => {
    const server = freshServer();
    registerAuthTools(server);
    registerJobTools(server);
    registerActionTools(server);
    expect(toolCount(server)).toBe(19); // 6 + 10 + 3
  });

  it('registers 30 tools for users entry point', () => {
    const server = freshServer();
    registerAuthTools(server);
    registerUserTools(server);
    registerCrowdsourcingTools(server);
    registerElearningTools(server);
    expect(toolCount(server)).toBe(30); // 6 + 15 + 5 + 4
  });

  it('registers 63 tools for admin entry point', () => {
    const server = freshServer();
    registerAuthTools(server);
    registerAdminTools(server);
    registerCreditTools(server);
    registerUploadTools(server);
    registerLabelTools(server);
    registerFileTools(server);
    registerSystemTools(server);
    registerRootTools(server);
    expect(toolCount(server)).toBe(63); // 6 + 8 + 12 + 11 + 13 + 3 + 2 + 8
  });
});
