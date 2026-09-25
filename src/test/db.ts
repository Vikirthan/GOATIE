import * as indexedDB from '@/lib/indexeddb';

const STORES: indexedDB.ObjectStore[] = [
  'goats', 'weights', 'deworming', 'vaccination', 'sales',
  'notifications', 'offlineQueue', 'syncHistory', 'variants',
  'languages', 'memberships',
];

/** Wipe every IndexedDB store (fake-indexeddb in tests). */
export async function clearTestDB(): Promise<void> {
  for (const s of STORES) {
    await indexedDB.clearStore(s).catch(() => undefined);
  }
}
