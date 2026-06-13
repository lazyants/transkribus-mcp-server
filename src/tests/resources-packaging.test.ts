import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as {
  bin: Record<string, string>;
};

const REFERENCE_URI = 'reference://transkribus/api';
const DIST_RESOURCE = 'dist/resources/transkribus-reference.js';

/** Reject if `p` does not settle within `ms` so a hung child fails fast. */
async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms: ${label}`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

beforeAll(() => {
  // Packaging must be tested against a CLEAN build: a stale dist could ship
  // orphaned compiled entry files (no source/bin) that a non-clean pack would
  // pass while shipping junk. Rebuild from scratch.
  rmSync(resolve(repoRoot, 'dist'), { recursive: true, force: true });
  execSync('npm run build', { cwd: repoRoot, stdio: 'inherit' });
}, 180_000);

describe('reference resource — packaging from compiled dist', () => {
  it('compiles the reference module into dist and exports its API', async () => {
    const distPath = resolve(repoRoot, DIST_RESOURCE);
    expect(existsSync(distPath), `${DIST_RESOURCE} not built`).toBe(true);

    // Import the COMPILED artifact (not src) — exercises the real shipped file.
    const mod = await import(pathToFileURL(distPath).href);
    expect(typeof mod.REFERENCE_MD).toBe('string');
    expect(mod.REFERENCE_MD).toContain('TrpServer');
    expect(mod.REFERENCE_URI).toBe(REFERENCE_URI);
    expect(typeof mod.registerReferenceResource).toBe('function');
  });

  it('npm pack ships the compiled resource and keeps bin↔dist in parity', () => {
    const out = execSync('npm pack --dry-run --json', {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const packed = JSON.parse(out) as Array<{ files: Array<{ path: string }> }>;
    const files = new Set(packed[0].files.map((f) => f.path));

    // (i) the compiled resource is actually shipped to npm consumers.
    expect(files.has(DIST_RESOURCE), `${DIST_RESOURCE} not in npm pack`).toBe(true);

    // (ii) bin ↔ dist parity: every bin target ships, and every shipped
    // index/entry file has a matching bin (no orphans, no missing).
    const binTargets = Object.values(pkg.bin);
    for (const target of binTargets) {
      expect(files.has(target), `bin target missing from pack: ${target}`).toBe(true);
    }
    const shippedEntries = [...files].filter((p) => /^dist\/(index|entry-[^/]+)\.js$/.test(p));
    for (const entry of shippedEntries) {
      expect(binTargets.includes(entry), `shipped entry has no bin target (orphan): ${entry}`).toBe(
        true,
      );
    }
    expect(shippedEntries.sort()).toEqual([...binTargets].sort());
  });
});

describe('reference resource — every shipped binary exposes it', () => {
  // "At least one split" is insufficient — a forgotten registration in ANY bin
  // must fail. Spawn each compiled bin via the SDK client (real stdio handshake).
  it.each(Object.entries(pkg.bin))(
    'bin %s lists reference://transkribus/api',
    async (_binName, relPath) => {
      const binPath = resolve(repoRoot, relPath);
      expect(existsSync(binPath), `bin not built: ${relPath}`).toBe(true);

      // dist/*.js are mode 0644 (no exec bit / usable shebang) — spawn via node.
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [binPath],
        stderr: 'ignore',
      });
      const client = new Client({ name: 'pack-test-client', version: '0.0.0' });

      let connected = false;
      try {
        await withTimeout(client.connect(transport), 8_000, `connect ${relPath}`);
        connected = true;
        const { resources } = await withTimeout(client.listResources(), 8_000, `list ${relPath}`);
        expect(
          resources.some((r) => r.uri === REFERENCE_URI),
          `reference resource missing from ${relPath}`,
        ).toBe(true);
      } finally {
        // The client owns the transport after connect — tear down via the client.
        if (connected) {
          await client.close();
        } else {
          await transport.close();
        }
      }
    },
    30_000,
  );
});
