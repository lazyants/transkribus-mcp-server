import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  TERMINAL_JOB_STATES,
  TIMED_OUT,
  JOB_WAIT_DEFAULT_MAX_WAIT_SECONDS,
  JOB_WAIT_DEFAULT_POLL_INTERVAL_SECONDS,
  extractDownloadUrl,
  isTerminalJobState,
  raceWithDeadline,
  registerJobTools,
  waitForJob,
  type WaitForJobDeps,
} from '../tools/jobs.js';

/**
 * A virtual clock. Every dep waitForJob is given resolves against it, so a test
 * for a 30-minute budget finishes in microseconds and cannot go flaky on a
 * loaded machine.
 */
function virtualClock(startMs = 1_000_000) {
  let current = startMs;
  return {
    now: () => current,
    advance: (ms: number) => { current += ms; },
    /** Sleeps by moving the clock, not by waiting. */
    sleep: async (ms: number) => { current += ms; },
    /**
     * Deadline race over the virtual clock: `work` wins only if it settles
     * without the clock passing `deadline`. A never-resolving work promise
     * therefore times out immediately at the virtual deadline rather than
     * hanging the test.
     */
    race: async <T>(work: Promise<T>, deadline: number): Promise<T | typeof TIMED_OUT> => {
      const settled = await Promise.race([
        work.then((value) => ({ ok: true as const, value })),
        Promise.resolve().then(() => ({ ok: false as const })),
      ]);
      if (settled.ok) return settled.value;
      // work did not settle in this microtask: the deadline wins.
      current = Math.max(current, deadline);
      return TIMED_OUT;
    },
  };
}

function job(state: string, extra: Record<string, unknown> = {}) {
  return { jobId: '42', state, ...extra };
}

describe('isTerminalJobState', () => {
  it('treats exactly FINISHED, FAILED and CANCELED as terminal', () => {
    expect([...TERMINAL_JOB_STATES].sort()).toEqual(['CANCELED', 'FAILED', 'FINISHED']);
    for (const state of TERMINAL_JOB_STATES) expect(isTerminalJobState(state)).toBe(true);
  });

  it('does NOT treat UNFINISHED as terminal', () => {
    // UNFINISHED is a job-LIST filter meaning "all but FINISHED" — never a state
    // a job is in. Treating it as terminal would end the wait on a running job.
    expect(isTerminalJobState('UNFINISHED')).toBe(false);
  });

  it('leaves CREATED, WAITING and RUNNING non-terminal', () => {
    for (const state of ['CREATED', 'WAITING', 'RUNNING']) {
      expect(isTerminalJobState(state)).toBe(false);
    }
  });

  it('matches case-insensitively and rejects non-strings', () => {
    expect(isTerminalJobState('finished')).toBe(true);
    expect(isTerminalJobState(undefined)).toBe(false);
    expect(isTerminalJobState(null)).toBe(false);
    expect(isTerminalJobState(3)).toBe(false);
  });
});

describe('extractDownloadUrl', () => {
  it('pulls the URL out of a finished export job result', () => {
    expect(extractDownloadUrl(job('FINISHED', { result: 'https://files.transkribus.eu/Get?id=abc' })))
      .toBe('https://files.transkribus.eu/Get?id=abc');
  });

  it('finds a URL embedded in surrounding prose', () => {
    expect(extractDownloadUrl(job('FINISHED', { result: 'Export ready: http://example.org/x.zip (2 weeks)' })))
      .toBe('http://example.org/x.zip');
  });

  it('drops trailing prose punctuation that is not part of the link', () => {
    // "…(https://host/x.zip)." must not yield a URL ending in ")." — that is a
    // different, broken link.
    expect(extractDownloadUrl(job('FINISHED', { result: 'Download (https://files.transkribus.eu/Get?id=abc).' })))
      .toBe('https://files.transkribus.eu/Get?id=abc');
    expect(extractDownloadUrl(job('FINISHED', { result: 'Ready: https://files.transkribus.eu/a.zip, valid 2 weeks' })))
      .toBe('https://files.transkribus.eu/a.zip');
  });

  it('returns undefined when result holds no URL, is absent, or is not a string', () => {
    expect(extractDownloadUrl(job('FINISHED', { result: 'OK' }))).toBeUndefined();
    expect(extractDownloadUrl(job('FINISHED'))).toBeUndefined();
    expect(extractDownloadUrl(job('FINISHED', { result: 12 }))).toBeUndefined();
    expect(extractDownloadUrl(null)).toBeUndefined();
  });
});

describe('waitForJob', () => {
  function deps(clock: ReturnType<typeof virtualClock>, getJob: () => Promise<unknown>): WaitForJobDeps {
    return { getJob, sleep: clock.sleep, now: clock.now, raceWithDeadline: clock.race };
  }

  it('returns after one poll when the job is already finished', async () => {
    const clock = virtualClock();
    let calls = 0;
    const result = await waitForJob(
      deps(clock, async () => { calls += 1; return job('FINISHED', { result: 'https://files.transkribus.eu/z' }); }),
      { pollIntervalMs: 5_000, maxWaitMs: 30_000 }
    );

    expect(calls).toBe(1);
    expect(result.terminal).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.state).toBe('FINISHED');
    expect(result.downloadUrl).toBe('https://files.transkribus.eu/z');
  });

  it('keeps polling while the job runs and returns the terminal poll', async () => {
    const clock = virtualClock();
    const states = ['CREATED', 'RUNNING', 'RUNNING', 'FAILED'];
    let calls = 0;
    const result = await waitForJob(
      deps(clock, async () => job(states[calls++])),
      { pollIntervalMs: 5_000, maxWaitMs: 300_000 }
    );

    expect(calls).toBe(4);
    expect(result.polls).toBe(4);
    expect(result.state).toBe('FAILED');
    expect(result.terminal).toBe(true);
    expect(result.waitedSeconds).toBe(15); // three 5s sleeps between four polls
  });

  it('returns the last completed poll with timedOut when the budget runs out', async () => {
    const clock = virtualClock();
    const result = await waitForJob(
      deps(clock, async () => job('RUNNING')),
      { pollIntervalMs: 5_000, maxWaitMs: 12_000 }
    );

    expect(result.timedOut).toBe(true);
    expect(result.terminal).toBe(false);
    expect(result.state).toBe('RUNNING');
    expect(result.job).not.toBeNull();
    expect(result.waitedSeconds).toBeLessThanOrEqual(12);
  });

  it('never sleeps past the deadline when the interval is longer than the budget', async () => {
    const clock = virtualClock();
    const result = await waitForJob(
      deps(clock, async () => job('RUNNING')),
      { pollIntervalMs: 60_000, maxWaitMs: 5_000 }
    );

    // The whole point of clamping: a 60s interval under a 5s budget waits 5s.
    expect(result.waitedSeconds).toBe(5);
    expect(result.timedOut).toBe(true);
  });

  it('returns a normal timedOut result with no job when the FIRST poll never completes', async () => {
    const clock = virtualClock();
    const result = await waitForJob(
      deps(clock, () => new Promise<unknown>(() => { /* never settles */ })),
      { pollIntervalMs: 5_000, maxWaitMs: 30_000 }
    );

    expect(result.timedOut).toBe(true);
    expect(result.job).toBeNull();
    expect(result.state).toBeNull();
    expect(result.polls).toBe(0);
    expect(result.terminal).toBe(false);
  });

  it('does not extend the total wait when a poll hangs far past the deadline', async () => {
    // Stands in for a login, a 401 re-login, or a 429 Retry-After backoff inside
    // the shared client — none of which are individually bounded. The race is
    // what makes the budget hold anyway.
    const clock = virtualClock();
    let calls = 0;
    const result = await waitForJob(
      deps(clock, () => {
        calls += 1;
        return calls === 1
          ? Promise.resolve(job('RUNNING'))
          : new Promise<unknown>(() => { /* hangs for an hour */ });
      }),
      { pollIntervalMs: 1_000, maxWaitMs: 10_000 }
    );

    expect(result.timedOut).toBe(true);
    expect(result.waitedSeconds).toBeLessThanOrEqual(10);
    expect(result.state).toBe('RUNNING'); // the last COMPLETED poll
  });

  it('does not start another poll once the budget is spent', async () => {
    // A clamped sleep can resolve at the same instant its deadline fires; issuing
    // a poll there costs a session round trip whose answer is thrown away.
    const clock = virtualClock();
    let calls = 0;
    await waitForJob(
      deps(clock, async () => { calls += 1; return job('RUNNING'); }),
      { pollIntervalMs: 60_000, maxWaitMs: 5_000 }
    );
    expect(calls).toBe(1);
  });

  it('propagates a poll that rejects rather than reporting it as a timeout', async () => {
    const clock = virtualClock();
    await expect(
      waitForJob(deps(clock, async () => { throw new Error('Request failed with status code 404'); }), {
        pollIntervalMs: 5_000,
        maxWaitMs: 30_000,
      })
    ).rejects.toThrow('404');
  });
});

describe('raceWithDeadline (real timers)', () => {
  it('resolves with the work value when work wins', async () => {
    await expect(raceWithDeadline(Promise.resolve('done'), Date.now() + 10_000)).resolves.toBe('done');
  });

  it('resolves with TIMED_OUT when the deadline has already passed', async () => {
    await expect(
      raceWithDeadline(new Promise(() => { /* never */ }), Date.now() - 1)
    ).resolves.toBe(TIMED_OUT);
  });

  it('rejects when work rejects before the deadline', async () => {
    await expect(raceWithDeadline(Promise.reject(new Error('boom')), Date.now() + 10_000)).rejects.toThrow('boom');
  });

  it('marks a losing rejection as handled — no unhandled rejection reaches the process', async () => {
    // Promise.race attaches handlers to both, so a rejection arriving after the
    // deadline already won cannot crash the stdio server.
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      // Rejected only when we say so, so this test has no wall-clock window to
      // lose on a loaded CI runner.
      let rejectLate!: (err: Error) => void;
      const late = new Promise((_, reject) => { rejectLate = reject; });
      await expect(raceWithDeadline(late, Date.now())).resolves.toBe(TIMED_OUT);
      rejectLate(new Error('late'));
      // Two macrotask turns: an unhandled rejection is reported at the end of
      // the turn in which nothing handled it.
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

describe('transkribus_job_wait registration', () => {
  function registeredTools(): Record<string, { inputSchema?: z.ZodTypeAny; description?: string }> {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerJobTools(server);
    return (server as unknown as { _registeredTools: Record<string, { inputSchema?: z.ZodTypeAny; description?: string }> })._registeredTools;
  }

  it('registers the tool with only `id` required', () => {
    // zod 4 tags z.preprocess output `optin: "optional"`, which silently drops
    // intCoerce-wrapped params from `required[]` unless clearOptinMarker ran.
    const tool = registeredTools()['transkribus_job_wait'];
    expect(tool).toBeDefined();
    const schema = z.toJSONSchema(tool.inputSchema!, { io: 'input' }) as {
      required?: string[];
      properties: Record<string, unknown>;
    };
    expect(schema.required).toEqual(['id']);
    expect(Object.keys(schema.properties).sort()).toEqual(['id', 'maxWaitSeconds', 'pollIntervalSeconds']);
  });

  it('states its defaults in the description, since intCoerce drops them from the schema', () => {
    const description = registeredTools()['transkribus_job_wait'].description ?? '';
    expect(description).toContain(`${JOB_WAIT_DEFAULT_POLL_INTERVAL_SECONDS}s`);
    expect(description).toContain(`${JOB_WAIT_DEFAULT_MAX_WAIT_SECONDS}s`);
  });

  it('defaults the budget below the MCP SDK 60s client timeout', () => {
    // A default above ~60s would have the client abort before the tool could
    // return its non-error timedOut result.
    expect(JOB_WAIT_DEFAULT_MAX_WAIT_SECONDS).toBeLessThan(60);
  });
});
