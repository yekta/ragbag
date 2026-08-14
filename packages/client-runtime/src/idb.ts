// Tiny promise wrapper around IndexedDB — just enough for the blob queue and
// cache. Not a general ORM; Zero owns the app data store.

export function requestAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.addEventListener("success", () => resolve(req.result));
    req.addEventListener("error", () => reject(req.error ?? new Error("IndexedDB request failed")));
  });
}

/**
 * How long an open may take before we declare IndexedDB wedged. Opens are
 * normally milliseconds; a profile with a stuck backend (or a `blocked` state
 * nothing will ever resolve) hangs the request forever with no event at all —
 * and anything awaiting it used to hang with it. Callers get a rejection
 * instead and can fall back.
 */
const OPEN_TIMEOUT_MS = 5_000;

export function openDb(
  name: string,
  version: number,
  upgrade: (db: IDBDatabase) => void,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fn();
      }
    };
    const timer = setTimeout(
      () => settle(() => reject(new Error(`IndexedDB ${name} did not open within 5s`))),
      OPEN_TIMEOUT_MS,
    );

    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(name, version);
    } catch (err) {
      // Missing/forbidden IndexedDB throws synchronously in some browsers.
      settle(() => reject(err instanceof Error ? err : new Error(String(err))));
      return;
    }
    req.addEventListener("upgradeneeded", () => upgrade(req.result));
    req.addEventListener("success", () => {
      // Won the race against the timeout — but if the timeout already fired,
      // close rather than leak a connection nobody holds.
      if (settled) req.result.close();
      settle(() => resolve(req.result));
    });
    req.addEventListener("error", () =>
      settle(() => reject(req.error ?? new Error(`cannot open IndexedDB ${name}`))),
    );
    req.addEventListener("blocked", () =>
      settle(() => reject(new Error(`IndexedDB ${name} is blocked by another open tab`))),
    );
  });
}

export function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.addEventListener("complete", () => resolve());
    tx.addEventListener("error", () =>
      reject(tx.error ?? new Error("IndexedDB transaction failed")),
    );
    tx.addEventListener("abort", () =>
      reject(tx.error ?? new Error("IndexedDB transaction aborted")),
    );
  });
}

export async function idbGet<T>(
  db: IDBDatabase,
  store: string,
  key: IDBValidKey,
): Promise<T | undefined> {
  return requestAsPromise(db.transaction(store).objectStore(store).get(key)) as Promise<
    T | undefined
  >;
}

export async function idbGetAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return requestAsPromise(db.transaction(store).objectStore(store).getAll()) as Promise<T[]>;
}

export async function idbPut(db: IDBDatabase, store: string, value: unknown): Promise<void> {
  const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).put(value);
  await txDone(tx);
}

export async function idbDelete(db: IDBDatabase, store: string, key: IDBValidKey): Promise<void> {
  const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).delete(key);
  await txDone(tx);
}
