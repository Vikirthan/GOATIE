// @vitest-environment node
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
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
    expect(typeof cron?.schedule).toBe('string');
  });
});

describe('api/ bundler safety', () => {
  // Vercel bundles functions without the Vite `@/` alias: any `@/` or
  // `../src` import crashes the function at load (FUNCTION_INVOCATION_FAILED).
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
  }
});
