import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Repo root is two levels up from src/tests/.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(resolve(repoRoot, 'package-lock.json'), 'utf8'));

// Parse a strict stable semver core (major.minor.patch) into [major, minor, patch].
// Returns null for anything that is not exactly three dot-separated numeric parts
// with no leading zeros — prereleases (6.15.2-rc.0), build metadata, and otherwise
// malformed strings all fail. A prerelease at the floor sorts BELOW the release in
// semver, so this security regression catcher must treat such versions as failing
// rather than silently passing. (Matches the leading-zero rule in check-versions.mjs.)
function core(version: string): number[] | null {
  const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// Patched floors that clear the audited GHSAs. `min` is derived from `range` so
// the two can never drift — bumping the override range automatically raises the
// lockfile floor this test enforces.
//   qs        ^6.15.2 — GHSA-q8mj-m7cp-5q26 (qs.stringify DoS)
//   hono      ^4.12.25 — GHSA-xrhx-7g5j-rcj5 / 3hrh-pfw6-9m5x / f577-qrjj-4474 / 2gcr-mfcq-wcc3 + serve-static path traversal et al.
//   form-data ^4.0.6  — GHSA-hmw2-7cc7-3qxx (CRLF injection via unescaped multipart field/file names)
// `qs` reaches the production tree via @modelcontextprotocol/sdk → express →
// body-parser → qs, so `npm audit --omit=dev` cannot exclude it. `form-data`
// reaches it via axios.
function pin(range: string): { range: string; min: number[] } {
  // Strip only a leading caret/tilde operator, then parse the strict core.
  const m = /^[\^~]?(.+)$/.exec(range);
  const min = m ? core(m[1]) : null;
  if (!min) throw new Error(`overrides.test: malformed pin range "${range}"`);
  return { range, min };
}

const PINS = {
  qs: pin('^6.15.2'),
  hono: pin('^4.12.25'),
  'form-data': pin('^4.0.6'),
} as const;

function gte(version: string, min: readonly number[]): boolean {
  const v = core(version);
  if (!v) return false; // prerelease / malformed → treat as below the floor
  for (let i = 0; i < 3; i++) {
    const a = v[i] ?? 0;
    const b = min[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

// Resolved entries in the committed lockfile whose package name is exactly `name`.
function resolvedVersions(name: string): string[] {
  const packages: Record<string, { version?: string }> = lock.packages ?? {};
  const versions: string[] = [];
  for (const [path, meta] of Object.entries(packages)) {
    const basename = path.split('node_modules/').pop();
    if (basename === name && meta && typeof meta.version === 'string') {
      versions.push(meta.version);
    }
  }
  return versions;
}

describe('security overrides — qs, hono & form-data (audit-gate regression catcher)', () => {
  // Layer (a): the override DECLARATION must exist and be pinned. A lockfile-only
  // check would still pass after someone deletes the overrides block (until the
  // lock is regenerated), so assert the declaration itself.
  it('declares pinned qs, hono & form-data overrides in package.json', () => {
    expect(pkg.overrides).toBeDefined();
    expect(pkg.overrides.qs).toBe(PINS.qs.range);
    expect(pkg.overrides.hono).toBe(PINS.hono.range);
    expect(pkg.overrides['form-data']).toBe(PINS['form-data'].range);
  });

  // Layer (b): every resolved entry in the committed lockfile must satisfy the
  // patched floor — independent of (and stricter than) the network npm audit gate.
  it.each(Object.keys(PINS) as Array<keyof typeof PINS>)(
    'resolves every %s entry at or above the patched floor',
    (name) => {
      const versions = resolvedVersions(name);
      expect(versions.length).toBeGreaterThan(0);
      for (const v of versions) {
        expect(gte(v, PINS[name].min), `${name}@${v} is below ${PINS[name].range}`).toBe(true);
      }
    },
  );
});
