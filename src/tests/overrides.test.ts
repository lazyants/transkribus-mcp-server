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
//
//   qs                ^6.15.2   — GHSA-q8mj-m7cp-5q26 (qs.stringify DoS)
//   hono              ^4.12.34  — advisory range extended to <=4.12.33 (JSX cross-request
//                                 disclosure, cx() XSS, CORS/Language ReDoS, proxy headers)
//   form-data         ^4.0.6    — GHSA-hmw2-7cc7-3qxx (CRLF injection via unescaped
//                                 multipart field/file names)
//   fast-uri          ^3.1.5    — advisory range extended to 3.0.0–3.1.4 (host confusion via
//                                 backslash authority delimiter / failed IDN canonicalization).
//                                 Stays inside ajv's declared ^3.0.1.
//   brace-expansion   ^5.0.6    — ReDoS
//   @hono/node-server ^1.19.15  — advisory is <1.19.15, so a PATCH bump inside the 1.x line
//                                 clears it; no major bump against the SDK's declared range.
//   ip-address        ^10.3.1   — advisory <=10.3.0 (leading-zero octet and CIDR-suffix
//                                 misparsing enabling SSRF / trust-boundary bypass)
//   body-parser       ^2.3.0    — advisory 2.0.0–2.2.2; no 2.2.3 exists, 2.3.0 is the first clean
//
// Production reachability: `qs` arrives via @modelcontextprotocol/sdk → express →
// body-parser → qs, so `npm audit --omit=dev` cannot exclude it; `form-data` via
// axios; `fast-uri` via the SDK's ajv; `hono` / `@hono/node-server` via the SDK's
// HTTP transport; `ip-address` via the SDK → express-rate-limit.
function pin(range: string): { range: string; min: number[] } {
  // Strip only a leading caret/tilde operator, then parse the strict core.
  const m = /^[\^~]?(.+)$/.exec(range);
  const min = m ? core(m[1]) : null;
  if (!min) throw new Error(`overrides.test: malformed pin range "${range}"`);
  return { range, min };
}

const PINS = {
  qs: pin('^6.15.2'),
  hono: pin('^4.12.34'),
  'form-data': pin('^4.0.6'),
  'fast-uri': pin('^3.1.5'),
  'brace-expansion': pin('^5.0.6'),
  '@hono/node-server': pin('^1.19.15'),
  'ip-address': pin('^10.3.1'),
  'body-parser': pin('^2.3.0'),
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

describe('security overrides (audit-gate regression catcher)', () => {
  // Layer (a): PINS must cover EXACTLY the declared overrides. Without this the
  // table silently under-covers — an override added to package.json with no pin()
  // entry is unguarded, and deleting it passes until the next lockfile regen.
  it('pins every declared override, and declares every pin', () => {
    expect(pkg.overrides).toBeDefined();
    expect(Object.keys(pkg.overrides).sort()).toEqual(Object.keys(PINS).sort());
  });

  // Layer (b): the override DECLARATION must exist and be pinned to the stated
  // range. A lockfile-only check would still pass after someone deletes or
  // loosens the overrides block (until the lock is regenerated).
  it.each(Object.keys(PINS) as Array<keyof typeof PINS>)(
    'declares the pinned %s override in package.json',
    (name) => {
      expect(pkg.overrides[name]).toBe(PINS[name].range);
    },
  );

  // Layer (c): every resolved entry in the committed lockfile must satisfy the
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
