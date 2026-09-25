import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// This setup file also runs for node-environment tests (api/, supabase/),
// so everything DOM-specific is guarded.
const hasDOM = typeof window !== 'undefined' && typeof window.navigator !== 'undefined';

let online = true;

if (hasDOM) {
  try {
    await import('fake-indexeddb/auto');
  } catch {
    // node environment — IndexedDB globals unavailable, tests there don't need them
  }
  // jsdom's navigator.onLine is a read-only getter in some versions — make it
  // writable so tests can flip online/offline.
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => online,
  });
}

export function setOnline(value: boolean) {
  online = value;
}

afterEach(() => {
  if (typeof document !== 'undefined') cleanup();
  vi.unstubAllEnvs();
  online = true;
});
