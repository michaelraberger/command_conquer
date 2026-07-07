import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PKG_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(PKG_ROOT, 'src');

/** APIs that break determinism or headless execution. */
const FORBIDDEN = [
  'Math.random',
  'Math.sin(',
  'Math.cos(',
  'Math.tan(',
  'Math.atan',
  'Math.sqrt(',
  'Date.now',
  'new Date',
  'performance.',
  'window.',
  'document.',
  'setTimeout',
  'setInterval',
  'requestAnimationFrame',
];

function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.ts'))
    .map((f) => join(dir, f));
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('sim purity', () => {
  it('sim source never touches nondeterministic or DOM APIs', () => {
    for (const file of listFiles(SRC)) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const pattern of FORBIDDEN) {
        expect(code.includes(pattern), `${file} uses forbidden API: ${pattern}`).toBe(false);
      }
    }
  });

  it('sim package has zero runtime dependencies', () => {
    const pkg = JSON.parse(
      readFileSync(join(PKG_ROOT, 'package.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(pkg['dependencies']).toBeUndefined();
  });
});
