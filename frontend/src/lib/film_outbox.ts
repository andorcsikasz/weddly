// Durable outbox for guest-camera shots. The in-memory upload queue in
// GuestPhotoPage loses every pending shot the moment the tab dies: the guest
// pockets the phone, iOS reclaims the backgrounded tab, and the photos they
// took at the venue with no signal are simply gone. Each shot is written here
// at capture and removed only once the server has it (or has refused the file
// for good), so the next visit to the same film picks up where the last left.
//
// The shot's `id` doubles as the upload's `client_shot_id`, which the backend
// dedupes on (album, device, id). That is what makes resending safe: an upload
// that landed just before the tab died comes back as the same photo, never a
// second copy, and never spends a second frame of a capped roll.
//
// The bytes go to disk as an ArrayBuffer, not a Blob. WebKit shipped years of
// bugs storing Blobs in IndexedDB (iOS 12-13 refused them outright, later
// versions lost them across a restart), and wedding guests are exactly the
// crowd still on an old iPhone. A plain buffer clones everywhere.
//
// Every call fails soft. Private mode, a full disk, or an old Safari that
// can't store a Blob degrades to the old in-memory behaviour, never to a
// shutter that throws.

const DB_NAME = "weddly-film-outbox";
const DB_VERSION = 1;
const STORE = "shots";
const BY_TOKEN = "by_token";
/** A shot nobody came back for inside a week belongs to a film that has long
 *  closed; holding its bytes on the guest's phone forever helps no one. */
export const OUTBOX_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** What lives on disk. */
interface StoredShot {
  id: string;
  token: string;
  deviceId: string;
  bytes: ArrayBuffer;
  type: string;
  createdAt: number;
}

export interface OutboxShot {
  /** Client-minted UUID; sent as `client_shot_id`. */
  id: string;
  /** The film's upload token, so one phone can hold shots for several films. */
  token: string;
  /** The device id the shot was taken under. Replayed as-is, so a cleared
   *  localStorage can't re-attribute it to a fresh, unregistered device. */
  deviceId: string;
  blob: Blob;
  createdAt: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex(BY_TOKEN, "token", { unique: false });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        // Another tab upgrading the schema must not be blocked by this one.
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function run<T>(
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore) => IDBRequest<T> | undefined,
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const tx = db.transaction(STORE, mode);
          const req = body(tx.objectStore(STORE));
          // Resolve on COMMIT, not on the request: a put that "succeeded" in a
          // transaction that then aborts (quota) never reached the disk.
          tx.oncomplete = () => resolve(req ? req.result : null);
          tx.onerror = () => resolve(null);
          tx.onabort = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

// Reading the bytes is async, so a put has not opened its transaction yet when
// a fast upload's delete arrives. The delete waits for that shot's put, or the
// put would land after it and leave a shot on disk that is already uploaded.
const pendingPuts = new Map<string, Promise<boolean>>();

/** Persist a shot. Resolves true once it is committed to disk. */
export function putShot(shot: OutboxShot): Promise<boolean> {
  const write = (async () => {
    let bytes: ArrayBuffer;
    try {
      bytes = await shot.blob.arrayBuffer();
    } catch {
      return false;
    }
    const stored: StoredShot = {
      id: shot.id,
      token: shot.token,
      deviceId: shot.deviceId,
      bytes,
      type: shot.blob.type || "image/jpeg",
      createdAt: shot.createdAt,
    };
    const result = await run("readwrite", (store) => store.put(stored));
    return result !== null;
  })();
  pendingPuts.set(shot.id, write);
  void write.finally(() => {
    if (pendingPuts.get(shot.id) === write) pendingPuts.delete(shot.id);
  });
  return write;
}

export async function deleteShot(id: string): Promise<void> {
  await pendingPuts.get(id);
  await run("readwrite", (store) => store.delete(id));
}

/** Every shot still owed to this film, oldest first. Expired shots are
 *  dropped on the way out rather than handed back. */
export async function listShots(token: string, now = Date.now()): Promise<OutboxShot[]> {
  const rows = await run<unknown[]>("readonly", (store) =>
    store.index(BY_TOKEN).getAll(IDBKeyRange.only(token)),
  );
  if (!rows) return [];
  const live: OutboxShot[] = [];
  for (const row of rows) {
    if (!isStoredShot(row)) continue;
    if (now - row.createdAt > OUTBOX_TTL_MS) {
      void deleteShot(row.id);
      continue;
    }
    live.push({
      id: row.id,
      token: row.token,
      deviceId: row.deviceId,
      blob: new Blob([row.bytes], { type: row.type }),
      createdAt: row.createdAt,
    });
  }
  return live.sort((a, b) => a.createdAt - b.createdAt);
}

function isStoredShot(value: unknown): value is StoredShot {
  const v = value as Partial<StoredShot> | null;
  return (
    !!v &&
    typeof v.id === "string" &&
    typeof v.token === "string" &&
    typeof v.deviceId === "string" &&
    typeof v.type === "string" &&
    typeof v.createdAt === "number" &&
    // Not `instanceof ArrayBuffer`: a buffer cloned across realms fails that.
    Object.prototype.toString.call(v.bytes) === "[object ArrayBuffer]"
  );
}

/** Test seam: forget the cached connection so a fresh fake IDB is reopened. */
export function _resetOutboxForTests(): void {
  dbPromise = null;
  pendingPuts.clear();
}
