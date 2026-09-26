// @vitest-environment node
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

// Guards the deployment contract: SPA fallback must never swallow /api, the
// closed-app cron must stay wired, and api/ must stay bundler-safe.
const dir = dirname(fileURLToPath(import.meta.url));
const vercel = JSON.parse(readFileSync(join(dir, '..', 'vercel.json'), 'utf8')) as {
  rewrites?: { source: string; destination: string }[];
  crons?: { path: string; schedule: string }[];
};

describe('vercel.json', () => {
  it('excludes /api/* from the SPA rewrite', () => {
    expect(vercel.rewrites).toBeDefined();
    for (const r of vercel.rewrites ?? []) {
      if (r.destination === '/index.html') {
        expect(r.source).toMatch(/api/);
      }
    }
    // The exclusion must actually let an api path through (negative lookahead).
    const spa = (vercel.rewrites ?? []).find((r) => r.destination === '/index.html');
    expect(spa).toBeDefined();
    expect(new RegExp(`^${spa?.source}$`).test('/api/master-sync')).toBe(false);
    expect(new RegExp(`^${spa?.source}$`).test('/dashboard')).toBe(true);
  });

  it('schedules the closed-app master-sync cron', () => {
    const cron = (vercel.crons ?? []).find((c) => c.path.startsWith('/api/master-sync'));
    expect(cron).toBeDefined();
    expect(cron?.path).toContain('run=1');
    expect(cron?.schedule).toBe('30 19 * * *');
  });
});

describe('api/ bundler safety', () => {
  // Functions ship as ESM (repo root is `"type": "module"`). Node ESM has no
  // extension searching, so every relative import must carry its explicit
  // `.js` extension, and nothing may import `@/` or `../src` (the Vite-only
  // alias). Violations crash the function at load (FUNCTION_INVOCATION_FAILED).
  const sources = [
    'master-sync.ts',
    '_lib/reconcile.ts',
    '_lib/rows.ts',
    'admin/users.ts',
  ].map((f) => ({ file: f, src: readFileSync(join(dir, f), 'utf8') }));

  for (const { file, src } of sources) {
    it(`${file} has no @/ or src/ imports`, () => {
      expect(src).not.toMatch(/from ['"]@\//);
      expect(src).not.toMatch(/from ['"]\.\.\/(\.\.\/)*src\//);
    });

    it(`${file} uses explicit .js extensions on relative imports`, () => {
      const relatives = [...src.matchAll(/from (['"])(\.[^'"]*)\1/g)].map((m) => m[2]);
      for (const spec of relatives) {
        expect(spec.endsWith('.js')).toBe(true);
      }
    });
  }

  it('api/ has no nested package.json fighting the root module type', () => {
    // A nested `{"type": "commonjs"}` would force Node to parse the ESM
    // output as CJS and crash at boot. The root `"type": "module"` governs.
    expect(existsSync(join(dir, 'package.json'))).toBe(false);
  });
});
