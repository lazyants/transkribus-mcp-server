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

// Patched floors that clear the audited advisories. `min` is derived from `range`
// so the two can never drift — bumping the override range automatically raises the
// lockfile floor this test enforces.
//
// Raising a floor touches exactly two places: the `overrides` block in package.json
// and the PINS table below; the tests assert those two agree. Advisory ranges are
// deliberately NOT restated here — they extend over time, and a third copy would
// rot with nothing to catch it. `npm audit` is the live source for them.
//
// Production reachability, i.e. why `npm audit --omit=dev` cannot exclude these:
// `qs` arrives via @modelcontextprotocol/sdk → express → body-parser → qs;
// `form-data` via axios; `fast-uri` via the SDK's ajv; `hono` / `@hono/node-server`
// via the SDK's HTTP transport; `ip-address` via the SDK → express-rate-limit.
function pin(range: string): { range: string; min: number[] } {
  // Strip only a leading caret/tilde operator, then parse the strict core.
  const m = /^[\^~]?(.+)$/.exec(range);
  const min = m ? core(m[1]) : null;
  if (!min) throw new Error(`overrides.test: malformed pin range "${range}"`);
  return { range, min };
}

const PINS = {
  // qs.stringify DoS (GHSA-q8mj-m7cp-5q26).
  qs: pin('^6.15.2'),
  // JSX cross-request disclosure, cx() XSS, CORS/Language ReDoS, proxy headers.
  hono: pin('^4.12.34'),
  // CRLF injection via unescaped multipart field/file names (GHSA-hmw2-7cc7-3qxx).
  'form-data': pin('^4.0.6'),
  // Host confusion via backslash authority delimiter / failed IDN canonicalization.
  // The floor stays inside ajv's declared ^3.0.1.
  'fast-uri': pin('^3.1.5'),
  // ReDoS.
  'brace-expansion': pin('^5.0.6'),
  // A patch bump inside the 1.x line clears it — no major bump against the SDK's
  // declared range.
  '@hono/node-server': pin('^1.19.15'),
  // Leading-zero octet and CIDR-suffix misparsing enabling SSRF / trust-boundary bypass.
  'ip-address': pin('^10.3.1'),
  // First clean release in the 2.x line; no patch release exists below it.
  'body-parser': pin('^2.3.0'),
} as const;

const PIN_NAMES = Object.keys(PINS) as Array<keyof typeof PINS>;

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
  it.each(PIN_NAMES)(
    'declares the pinned %s override in package.json',
    (name) => {
      expect(pkg.overrides[name]).toBe(PINS[name].range);
    },
  );

  // Layer (c): every resolved entry in the committed lockfile must satisfy the
  // patched floor — independent of (and stricter than) the network npm audit gate.
  it.each(PIN_NAMES)(
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
