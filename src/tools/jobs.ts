import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { transkribusRequest } from '../services/transkribus.js';
import { handleToolRequest } from '../helpers.js';
import { IdSchema, PaginationParams, intCoerce } from '../schemas/common.js';

/** The three states TrpJobStatus itself treats as terminal. UNFINISHED is NOT
 *  one of them — it is a meta-status used to FILTER job lists ("all but
 *  FINISHED"), never a state a job is actually in. */
export const TERMINAL_JOB_STATES: ReadonlySet<string> = new Set(['FINISHED', 'FAILED', 'CANCELED']);

export function isTerminalJobState(state: unknown): boolean {
  return typeof state === 'string' && TERMINAL_JOB_STATES.has(state.toUpperCase());
}

/** An export job's download link arrives in the job's free-form `result` string.
 *  Rather than assume the field IS a URL (the bean only types it String), pull the
 *  first http(s) URL out of it and surface nothing when there is none.
 *
 *  Because the field is prose, the match is trimmed of trailing punctuation:
 *  "Download (https://host/x.zip)." must not yield a URL ending in ")." — that
 *  is a different, broken link. A real URL ending in one of these characters is
 *  possible but far rarer than a sentence that ends after one. */
export function extractDownloadUrl(job: unknown): string | undefined {
  if (!job || typeof job !== 'object') return undefined;
  const result = (job as { result?: unknown }).result;
  if (typeof result !== 'string') return undefined;
  const match = /https?:\/\/[^\s"'<>]+/.exec(result)?.[0];
  return match?.replace(/[.,;:!?)\]}]+$/, '') || undefined;
}

export interface WaitForJobDeps {
  getJob: () => Promise<unknown>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** Resolves to TIMED_OUT once `deadline` passes, whatever `work` is doing. */
  raceWithDeadline: <T>(work: Promise<T>, deadline: number) => Promise<T | typeof TIMED_OUT>;
}

/** Sentinel for "the deadline won the race", distinguishable from any job payload. */
export const TIMED_OUT = Symbol('timed-out');

export interface WaitForJobResult {
  job: unknown;
  state: string | null;
  terminal: boolean;
  timedOut: boolean;
  polls: number;
  waitedSeconds: number;
  downloadUrl?: string;
}

/**
 * Poll a job until it reaches a terminal state or the wall-clock budget runs out.
 *
 * The budget is enforced by RACING every poll and every sleep against one absolute
 * deadline, not by adding up sleeps: the shared HTTP client can spend unbounded time
 * inside a login, a 401 re-login, or a 429 Retry-After backoff, and none of those are
 * individually bounded. Racing stops the WAITING instead of trying to bound each path,
 * which makes the budget total by construction. A poll that loses the race keeps running
 * and its result is discarded; Promise.race marks its later settlement as handled.
 */
export async function waitForJob(
  deps: WaitForJobDeps,
  opts: { pollIntervalMs: number; maxWaitMs: number }
): Promise<WaitForJobResult> {
  const start = deps.now();
  const deadline = start + opts.maxWaitMs;

  let job: unknown = null;
  let polls = 0;

  // Every exit from the loop below is either terminal-state or deadline, so
  // timedOut is exactly the complement of terminal — built in one place so the
  // two returns cannot drift apart.
  const build = (terminal: boolean): WaitForJobResult => {
    const state = (job as { state?: unknown } | null)?.state;
    const downloadUrl = extractDownloadUrl(job);
    return {
      job,
      state: typeof state === 'string' ? state : null,
      terminal,
      timedOut: !terminal,
      polls,
      waitedSeconds: (deps.now() - start) / 1000,
      ...(downloadUrl ? { downloadUrl } : {}),
    };
  };

  for (;;) {
    // Checked BEFORE issuing the request, not only after: a clamped sleep can
    // resolve at the same instant its deadline timer fires, and starting a poll
    // there means a login/session round trip whose answer is discarded.
    if (polls > 0 && deps.now() >= deadline) break;

    const outcome = await deps.raceWithDeadline(deps.getJob(), deadline);
    if (outcome === TIMED_OUT) break;

    job = outcome;
    polls += 1;
    if (isTerminalJobState((job as { state?: unknown } | null)?.state)) return build(true);

    const remaining = deadline - deps.now();
    if (remaining <= 0) break;
    // Never sleep past the deadline: pollIntervalSeconds 60 under maxWaitSeconds 5
    // waits ~5s, not 60.
    const slept = await deps.raceWithDeadline(deps.sleep(Math.min(opts.pollIntervalMs, remaining)), deadline);
    if (slept === TIMED_OUT) break;
  }

  return build(false);
}

/** Default race implementation. The timer is unref'd so a losing poll's pending
 *  deadline cannot hold the process open. */
export function raceWithDeadline<T>(work: Promise<T>, deadline: number): Promise<T | typeof TIMED_OUT> {
  const remaining = Math.max(0, deadline - Date.now());
  return new Promise<T | typeof TIMED_OUT>((resolve, reject) => {
    const timer = setTimeout(() => resolve(TIMED_OUT), remaining);
    timer.unref?.();
    work.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

export const JOB_WAIT_DEFAULT_MAX_WAIT_SECONDS = 30;
export const JOB_WAIT_DEFAULT_POLL_INTERVAL_SECONDS = 5;

export function registerJobTools(server: McpServer): void {
  // 1. POST /jobs
  server.registerTool(
    'transkribus_job_create',
    {
      title: 'Create Job',
      description: 'Create a new processing job.',
      inputSchema: z.object({
        type: z.string().describe('Job type'),
        docId: z.number().int().optional().describe('Document ID to process'),
        collId: z.number().int().optional().describe('Collection ID to process'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('POST', '/jobs', params))
  );

  // 2. GET /jobs/count
  server.registerTool(
    'transkribus_job_count',
    {
      title: 'Count Jobs',
      description: 'Get the total number of jobs, optionally filtered by status or type.',
      inputSchema: z.object({
        status: z.string().optional().describe('Filter by job status'),
        type: z.string().optional().describe('Filter by job type'),
        userid: z.number().int().optional().describe('Filter by user ID'),
        filterByUser: z.boolean().optional().describe('Filter jobs by current user'),
        jobImpl: z.string().optional().describe('Filter by job implementation class'),
        collId: z.number().int().optional().describe('Filter by collection ID'),
        id: z.number().int().optional().describe('Filter by job ID'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('GET', '/jobs/count', undefined, params))
  );

  // 3. GET /jobs/list
  server.registerTool(
    'transkribus_job_list',
    {
      title: 'List Jobs',
      description: 'List jobs with pagination, optionally filtered by status or type.',
      inputSchema: z.object({
        ...PaginationParams,
        status: z.string().optional().describe('Filter by job status'),
        type: z.string().optional().describe('Filter by job type'),
        userid: z.number().int().optional().describe('Filter by user ID'),
        filterByUser: z.boolean().optional().describe('Filter jobs by current user'),
        collId: z.number().int().optional().describe('Filter by collection ID'),
        id: z.number().int().optional().describe('Filter by job ID'),
        jobImpl: z.string().optional().describe('Filter by job implementation class'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('GET', '/jobs/list', undefined, params))
  );

  // 4. POST /jobs/restartAllJobsOfUser/{userid}
  server.registerTool(
    'transkribus_job_restart_all_by_user',
    {
      title: 'Restart All Jobs by User',
      description: 'Restart all jobs for a specific user.',
      inputSchema: z.object({
        userid: z.number().int().positive().describe('User ID whose jobs to restart'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('POST', `/jobs/restartAllJobsOfUser/${params.userid}`))
  );

  // 5. GET /jobs/{id}
  server.registerTool(
    'transkribus_job_get',
    {
      title: 'Get Job',
      description: 'Get details of a specific job by ID.',
      inputSchema: z.object({
        id: IdSchema,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('GET', `/jobs/${params.id}`))
  );

  // 6. POST /jobs/{id}
  server.registerTool(
    'transkribus_job_update',
    {
      title: 'Update Job',
      description: 'Update properties of an existing job.',
      inputSchema: z.object({
        id: IdSchema,
        status: z.string().optional().describe('New job status'),
        description: z.string().optional().describe('Updated job description'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { id, ...body } = params;
      return transkribusRequest('POST', `/jobs/${id}`, body);
    })
  );

  // 7. GET /jobs/{id}/errors
  server.registerTool(
    'transkribus_job_get_errors',
    {
      title: 'Get Job Errors',
      description: 'Get error details for a specific job.',
      inputSchema: z.object({
        id: IdSchema,
        ...PaginationParams,
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { id, ...query } = params;
      return transkribusRequest('GET', `/jobs/${id}/errors`, undefined, query);
    })
  );

  // 8. POST /jobs/{id}/kill
  server.registerTool(
    'transkribus_job_kill',
    {
      title: 'Kill Job',
      description: 'Kill a running job by ID.',
      inputSchema: z.object({
        id: IdSchema,
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('POST', `/jobs/${params.id}/kill`))
  );

  // 9. POST /jobs/{jobId}/undo
  server.registerTool(
    'transkribus_job_undo',
    {
      title: 'Undo Job',
      description: 'Undo the results of a completed job.',
      inputSchema: z.object({
        jobId: IdSchema,
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => transkribusRequest('POST', `/jobs/${params.jobId}/undo`))
  );

  // 10. Poll GET /jobs/{id} until terminal (no single REST endpoint — this is a loop)
  server.registerTool(
    'transkribus_job_wait',
    {
      title: 'Wait for Job',
      description:
        'Poll a job until it reaches FINISHED, FAILED or CANCELED, or until the wait budget runs out. ' +
        `Defaults: poll every ${JOB_WAIT_DEFAULT_POLL_INTERVAL_SECONDS}s, wait up to ${JOB_WAIT_DEFAULT_MAX_WAIT_SECONDS}s; ` +
        'a timed-out result is not an error — call again to keep waiting.',
      inputSchema: z.object({
        id: IdSchema,
        pollIntervalSeconds: intCoerce(z.number().int().min(1).max(60)).optional()
          .describe(`Seconds between polls (default ${JOB_WAIT_DEFAULT_POLL_INTERVAL_SECONDS})`),
        maxWaitSeconds: intCoerce(z.number().int().min(5).max(1800)).optional()
          .describe(`Wall-clock budget in seconds (default ${JOB_WAIT_DEFAULT_MAX_WAIT_SECONDS}). Above ~50 needs an MCP client configured with a longer request timeout.`),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) =>
      waitForJob(
        {
          getJob: () => transkribusRequest('GET', `/jobs/${params.id}`),
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          now: () => Date.now(),
          raceWithDeadline,
        },
        {
          pollIntervalMs: (params.pollIntervalSeconds ?? JOB_WAIT_DEFAULT_POLL_INTERVAL_SECONDS) * 1000,
          maxWaitMs: (params.maxWaitSeconds ?? JOB_WAIT_DEFAULT_MAX_WAIT_SECONDS) * 1000,
        }
      )
    )
  );

  // 11. GET /jobs/{jobId}/creditTransactions
  server.registerTool(
    'transkribus_job_get_credit_transactions',
    {
      title: 'Get Job Credit Transactions',
      description: 'Get credit transactions associated with a specific job.',
      inputSchema: z.object({
        jobId: IdSchema,
        index: z.number().int().optional().default(0).describe('Start index'),
        nValues: z.number().int().optional().default(-1).describe('Number of values'),
        sortColumn: z.string().optional().describe('Column to sort by'),
        sortDirection: z.string().optional().describe('Sort direction (asc/desc)'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleToolRequest(async (params) => {
      const { jobId, ...query } = params;
      return transkribusRequest('GET', `/jobs/${jobId}/creditTransactions`, undefined, query);
    })
  );
}
