// IndexedDB utilities for offline storage

const DB_NAME = 'GOATIE_DB';
const DB_VERSION = 2;

export type ObjectStore = 
  | 'goats'
  | 'weights'
  | 'deworming'
  | 'vaccination'
  | 'sales'
  | 'notifications'
  | 'offlineQueue'
  | 'syncHistory'
  | 'variants'
  | 'languages';

let db: IDBDatabase | null = null;

export async function initDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;

      const stores = [
        { name: 'goats', keyPath: 'id' },
        { name: 'weights', keyPath: 'id' },
        { name: 'deworming', keyPath: 'id' },
        { name: 'vaccination', keyPath: 'id' },
        { name: 'sales', keyPath: 'id' },
        { name: 'notifications', keyPath: 'id' },
        { name: 'offlineQueue', keyPath: 'id' },
        { name: 'syncHistory', keyPath: 'id' },
        { name: 'variants', keyPath: 'id' },
        { name: 'languages', keyPath: 'id' },
      ];

      stores.forEach((store) => {
        if (!database.objectStoreNames.contains(store.name)) {
          database.createObjectStore(store.name, { keyPath: store.keyPath });
        }
      });
    };
  });
}

export async function getDB(): Promise<IDBDatabase> {
  if (db) return db;
  return initDB();
}

export async function addItem<T extends { id: string }>(
  storeName: ObjectStore,
  item: T
): Promise<string> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.add(item);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result as string);
  });
}

export async function updateItem<T extends { id: string }>(
  storeName: ObjectStore,
  item: T
): Promise<void> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.put(item);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

export async function getItem<T>(
  storeName: ObjectStore,
  id: string
): Promise<T | undefined> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.get(id);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result as T | undefined);
  });
}

export async function getAllItems<T>(storeName: ObjectStore): Promise<T[]> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.getAll();

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result as T[]);
  });
}

export async function deleteItem(
  storeName: ObjectStore,
  id: string
): Promise<void> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.delete(id);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

export async function clearStore(storeName: ObjectStore): Promise<void> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.clear();

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}
