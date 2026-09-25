// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const reconcileMocks = vi.hoisted(() => ({
  reconcileAllTabs: vi.fn(),
  readAllTabs: vi.fn(),
  currentMonthKey: vi.fn(() => '2026-09'),
}));

vi.mock('./_lib/reconcile', () => reconcileMocks);

const supabaseState = vi.hoisted(() => ({
  stateRow: null as null | { last_sync_at: string | null; rewrite_month: string | null; last_result: unknown },
  throwOnState: false,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table !== 'master_sync_state') throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              if (supabaseState.throwOnState) throw new Error('db down');
              return { data: supabaseState.stateRow, error: null };
            },
          }),
        }),
        upsert: async () => ({ data: null, error: null }),
      };
    },
  }),
}));

interface MockRes {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockRes;
  json: (body: unknown) => MockRes;
}

function mockReq(over: Record<string, unknown> = {}) {
  return { method: 'GET', query: {}, headers: {}, body: {}, ...over } as never;
}

function mockRes(): MockRes {
  const r = {} as MockRes;
  r.status = vi.fn((code: number) => {
    r.statusCode = code;
    return r;
  }) as unknown as MockRes['status'];
  r.json = vi.fn((body: unknown) => {
    r.body = body;
    return r;
  }) as unknown as MockRes['json'];
  return r;
}

// The route reads SHEETS env at import time — configure per test via re-import.
async function loadHandler(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [k, v] of Object.entries({ ...process.env, ...env })) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const m = await import('./master-sync');
  return m.default as (req: never, res: never) => Promise<void>;
}

const CONFIGURED = {
  VITE_SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  GOOGLE_SHEETS_BACKUP_WEBAPP_URL: 'https://script.google.com/exec',
  GOOGLE_SHEETS_BACKUP_SECRET: 'secret',
};

describe('master-sync handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseState.stateRow = null;
    supabaseState.throwOnState = false;
  });

  it('rejects non-GET/POST methods', async () => {
    const handler = await loadHandler(CONFIGURED);
    const res = mockRes();
    await handler(mockReq({ method: 'PUT' }), res as never);
    expect(res.statusCode).toBe(405);
  });

  it('POST pushes and reports the summary when configured', async () => {
    reconcileMocks.reconcileAllTabs.mockResolvedValue({
      summary: [{ tab: 'Goats Data', added: 1, updated: 0, deleted: 0 }],
      fullRewrite: false,
    });
    const handler = await loadHandler(CONFIGURED);
    const res = mockRes();
    await handler(mockReq({ method: 'POST' }), res as never);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, fullRewrite: false });
  });

  it('POST without server env fails closed with 500', async () => {
    const handler = await loadHandler({
      VITE_SUPABASE_URL: undefined,
      SUPABASE_SERVICE_ROLE_KEY: undefined,
      GOOGLE_SHEETS_BACKUP_WEBAPP_URL: undefined,
      GOOGLE_SHEETS_BACKUP_SECRET: undefined,
    });
    const res = mockRes();
    await handler(mockReq({ method: 'POST' }), res as never);
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ ok: false });
  });

  it('POST surfaces reconcile failures as 500', async () => {
    reconcileMocks.reconcileAllTabs.mockRejectedValue(new Error('sheets down'));
    const handler = await loadHandler(CONFIGURED);
    const res = mockRes();
    await handler(mockReq({ method: 'POST' }), res as never);
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ ok: false, error: 'sheets down' });
  });

  it('GET status returns persisted state', async () => {
    supabaseState.stateRow = { last_sync_at: '2026-09-25T00:00:00.000Z', rewrite_month: '2026-09', last_result: [] };
    const handler = await loadHandler(CONFIGURED);
    const res = mockRes();
    await handler(mockReq({ method: 'GET', query: {} }), res as never);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, rewriteMonth: '2026-09' });
  });

  it('GET status tolerates a missing state table', async () => {
    supabaseState.throwOnState = true;
    const handler = await loadHandler(CONFIGURED);
    const res = mockRes();
    await handler(mockReq({ method: 'GET', query: {} }), res as never);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, lastSyncAt: null });
  });

  it('GET view=tabs returns all four tabs', async () => {
    reconcileMocks.readAllTabs.mockResolvedValue({ 'Goats Data': [{ id: 'g1' }] });
    const handler = await loadHandler(CONFIGURED);
    const res = mockRes();
    await handler(mockReq({ method: 'GET', query: { view: 'tabs' } }), res as never);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  it('GET run=1 without the cron secret is unauthorized', async () => {
    const handler = await loadHandler({ ...CONFIGURED, CRON_SECRET: 'cron-secret' });
    const res = mockRes();
    await handler(
      mockReq({ method: 'GET', query: { run: '1' }, headers: {} }),
      res as never,
    );
    expect(res.statusCode).toBe(401);
    expect(reconcileMocks.reconcileAllTabs).not.toHaveBeenCalled();
  });

  it('GET run=1 with a wrong bearer is unauthorized', async () => {
    const handler = await loadHandler({ ...CONFIGURED, CRON_SECRET: 'cron-secret' });
    const res = mockRes();
    await handler(
      mockReq({ method: 'GET', query: { run: '1' }, headers: { authorization: 'Bearer wrong' } }),
      res as never,
    );
    expect(res.statusCode).toBe(401);
  });

  it('GET run=1 with the cron secret pushes', async () => {
    reconcileMocks.reconcileAllTabs.mockResolvedValue({ summary: [], fullRewrite: true });
    const handler = await loadHandler({ ...CONFIGURED, CRON_SECRET: 'cron-secret' });
    const res = mockRes();
    await handler(
      mockReq({ method: 'GET', query: { run: '1' }, headers: { authorization: 'Bearer cron-secret' } }),
      res as never,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, fullRewrite: true });
  });
});
