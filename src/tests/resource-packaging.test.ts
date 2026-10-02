import { beforeAll, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
  bin: Record<string, string>;
};

beforeAll(() => {
  execSync('npm run build', { cwd: repoRoot, stdio: 'pipe' });
}, 180_000);

describe('npm packaging', () => {
  it('ships the compiled reference and all binaries without tests or source maps', () => {
    const packed = JSON.parse(execSync('npm pack --dry-run --json', {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })) as Array<{ files: Array<{ path: string }> }>;
    const files = packed[0].files.map((f) => f.path.replace(/\\/g, '/'));

    expect(files).toContain('dist/resources/transkribus-reference.js');
    for (const target of Object.values(pkg.bin)) expect(files).toContain(target);
    expect(files.some((f) => f.startsWith('dist/tests/') || f.endsWith('.test.js'))).toBe(false);
    expect(files.some((f) => f.endsWith('.map'))).toBe(false);
  }, 30_000);
});
