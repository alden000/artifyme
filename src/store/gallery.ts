// Private on‑device gallery (IndexedDB). Nothing here is ever synced anywhere.

export interface Creation {
  id: string;
  kind: 'image' | 'video';
  styleId: string;
  styleName: string;
  createdAt: number;
  blob: Blob;
  thumb: Blob;
  original?: Blob;
  width: number;
  height: number;
}

const DB = 'artifyme';
const STORE = 'creations';
let dbp: Promise<IDBDatabase> | null = null;

function db() {
  dbp ??= new Promise((res, rej) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const s = req.result.createObjectStore(STORE, { keyPath: 'id' });
      s.createIndex('createdAt', 'createdAt');
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  return dbp;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((res, rej) => {
        const t = d.transaction(STORE, mode);
        const r = fn(t.objectStore(STORE));
        t.oncomplete = () => res(r.result);
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error);
      }),
  );
}

export const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export async function addCreation(c: Creation) {
  await tx('readwrite', (s) => s.put(c));
  notify();
  // Ask the browser not to evict the gallery under storage pressure.
  navigator.storage?.persist?.().catch(() => {});
}

export async function listCreations(): Promise<Creation[]> {
  try {
    const all = await tx<Creation[]>('readonly', (s) => s.getAll());
    return all.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

export async function deleteCreation(id: string) {
  await tx('readwrite', (s) => s.delete(id));
  notify();
}

export const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
