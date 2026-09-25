import { vi } from 'vitest';

// Shared mock for `@/lib/supabase`. Test files wire it with:
//
//   vi.mock('@/lib/supabase', async () => {
//     const { getMockSupabase } = await vi.importActual('@/test/supabaseMock');
//     return { supabase: getMockSupabase() };
//   });
//
// (async importActual is the only hoist-safe way to share mock state.)
// Configure per test via resetMockSupabase({ tables, auth }).

export type TableHandler =
  | { data?: unknown; error?: unknown }
  | ((calls: { method: string; args: unknown[] }[]) => { data?: unknown; error?: unknown });

export interface MockSupabase {
  from: ReturnType<typeof vi.fn>;
  // Loose on purpose: tests attach per-test auth namespaces (e.g. auth.admin).
  auth: Record<string, any>;
  channel: ReturnType<typeof vi.fn>;
  removeChannel: ReturnType<typeof vi.fn>;
  _queries: { table: string; calls: { method: string; args: unknown[] }[] }[];
  _tables: Record<string, TableHandler>;
}

const CHAIN = [
  'select', 'insert', 'update', 'upsert', 'delete',
  'eq', 'neq', 'in', 'order', 'limit',
  'maybeSingle', 'single', 'gt', 'gte', 'lt', 'lte',
  'like', 'ilike', 'is', 'not', 'or', 'range',
];

function buildQuery(mock: MockSupabase, table: string): Record<string, unknown> {
  const calls: { method: string; args: unknown[] }[] = [];
  mock._queries.push({ table, calls });
  const q: Record<string, unknown> = {};
  for (const m of CHAIN) {
    q[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
      return q;
    };
  }
  q.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
    const h = mock._tables[table];
    const res = typeof h === 'function' ? h(calls) : (h ?? { data: [], error: null });
    return Promise.resolve(res).then(resolve, reject);
  };
  return q;
}

function build(): MockSupabase {
  const mock: MockSupabase = {
    from: vi.fn(),
    auth: {},
    channel: vi.fn(),
    removeChannel: vi.fn(),
    _queries: [],
    _tables: {},
  };
  mock.from.mockImplementation((table: string) => buildQuery(mock, table));
  applyAuthDefaults(mock);
  return mock;
}

function applyAuthDefaults(mock: MockSupabase) {
  const defaults: Record<string, (...args: never[]) => Promise<unknown>> = {
    getUser: async () => ({ data: { user: null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
    signInWithPassword: async () => ({ data: {}, error: null }),
    signUp: async () => ({ data: {}, error: null }),
    signOut: async () => ({ error: null }),
    resetPasswordForEmail: async () => ({ data: {}, error: null }),
    updateUser: async () => ({ data: {}, error: null }),
  };
  for (const [f, impl] of Object.entries(defaults)) {
    if (!mock.auth[f]) mock.auth[f] = vi.fn();
    mock.auth[f].mockReset();
    mock.auth[f].mockImplementation(impl);
  }
  if (!mock.auth.onAuthStateChange) mock.auth.onAuthStateChange = vi.fn();
  mock.auth.onAuthStateChange.mockReset();
  mock.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
}

let singleton: MockSupabase | null = null;

export function getMockSupabase(): MockSupabase {
  if (!singleton) singleton = build();
  return singleton;
}

export function resetMockSupabase(config: {
  tables?: Record<string, TableHandler>;
  auth?: Record<string, unknown>;
} = {}): MockSupabase {
  // Mutate the singleton IN PLACE: service modules captured this exact object
  // at import time, so replacing it would orphan all test configuration.
  const mock = getMockSupabase();
  mock._queries.length = 0;
  mock._tables = config.tables ?? {};
  mock.from.mockClear();
  mock.channel.mockClear();
  mock.removeChannel.mockClear();
  // Drop per-test extras (e.g. auth.admin) and restore auth defaults.
  for (const key of Object.keys(mock.auth)) {
    if (!(key in AUTH_FNS)) delete mock.auth[key];
  }
  applyAuthDefaults(mock);
  if (config.auth) {
    for (const [k, v] of Object.entries(config.auth)) {
      if (!mock.auth[k]) mock.auth[k] = vi.fn();
      if (typeof v === 'function') {
        mock.auth[k].mockImplementation(v as (...args: never[]) => unknown);
      } else {
        mock.auth[k].mockResolvedValue(v);
      }
    }
  }
  return mock;
}

const AUTH_FNS = {
  getUser: 1, getSession: 1, signInWithPassword: 1, signUp: 1, signOut: 1,
  onAuthStateChange: 1, resetPasswordForEmail: 1, updateUser: 1,
};

/** Find recorded queries for a table, in call order. */
export function queriesFor(mock: MockSupabase, table: string) {
  return mock._queries.filter((q) => q.table === table);
}

/** Last recorded query for a table (throws if none — test bug, not app bug). */
export function lastQuery(mock: MockSupabase, table: string) {
  const found = queriesFor(mock, table);
  if (found.length === 0) throw new Error(`No queries recorded for table "${table}"`);
  return found[found.length - 1];
}
