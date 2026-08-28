// @ts-check

const DEFAULT_DATABASE_NAME = "the-unclicked-local";
const DEFAULT_STORE_NAME = "repository-records";
const INDEXED_DB_VERSION = 1;

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionToPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
  });
}

function assertChanges(changes) {
  if (typeof changes !== "object" || changes === null) {
    throw new TypeError("IndexedDB commit changes must be an object.");
  }
  if (changes.puts !== undefined && !Array.isArray(changes.puts)) {
    throw new TypeError("IndexedDB puts must be an array.");
  }
  if (changes.deletes !== undefined && !Array.isArray(changes.deletes)) {
    throw new TypeError("IndexedDB deletes must be an array.");
  }

  for (const entry of changes.puts ?? []) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof entry.key !== "string" ||
      entry.key.length === 0 ||
      !Object.hasOwn(entry, "value")
    ) {
      throw new TypeError("IndexedDB put entries require key and value.");
    }
  }
  for (const key of changes.deletes ?? []) {
    if (typeof key !== "string" || key.length === 0) {
      throw new TypeError("IndexedDB delete keys must be non-empty strings.");
    }
  }
  if (changes.clear !== undefined && typeof changes.clear !== "boolean") {
    throw new TypeError("IndexedDB clear must be boolean.");
  }
}

/**
 * Create the concrete persistent adapter used by the local-first Repository.
 * IndexedDB is available in extension Service Workers and needs no additional
 * Chrome extension permission.
 *
 * @param {{
 *   indexedDB?: IDBFactory,
 *   databaseName?: string,
 *   storeName?: string
 * }} [options]
 */
export function createIndexedDbStorageAdapter(options = {}) {
  const indexedDbFactory = options.indexedDB ?? globalThis.indexedDB;
  const databaseName = options.databaseName ?? DEFAULT_DATABASE_NAME;
  const storeName = options.storeName ?? DEFAULT_STORE_NAME;

  if (!indexedDbFactory || typeof indexedDbFactory.open !== "function") {
    throw new TypeError("IndexedDB is required for the local storage adapter.");
  }
  if (typeof databaseName !== "string" || databaseName.length === 0) {
    throw new TypeError("IndexedDB databaseName must be non-empty.");
  }
  if (typeof storeName !== "string" || storeName.length === 0) {
    throw new TypeError("IndexedDB storeName must be non-empty.");
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDbFactory.open(
        databaseName,
        INDEXED_DB_VERSION
      );
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(storeName)) {
          database.createObjectStore(storeName, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("Unable to open IndexedDB."));
      request.onblocked = () =>
        reject(new Error("IndexedDB open request was blocked."));
    });
  }

  async function runTransaction(mode, operation) {
    const database = await openDatabase();
    let transaction;
    let completion;
    try {
      transaction = database.transaction(storeName, mode);
      completion = transactionToPromise(transaction);
      const result = await operation(
        transaction.objectStore(storeName),
        completion
      );
      return result;
    } catch (error) {
      if (transaction) {
        try {
          transaction.abort();
        } catch {
          // The transaction may already be complete or aborted.
        }
      }
      if (completion) {
        try {
          await completion;
        } catch {
          // Preserve the original request or operation error.
        }
      }
      throw error;
    } finally {
      database.close();
    }
  }

  return Object.freeze({
    async get(key) {
      if (typeof key !== "string" || key.length === 0) {
        throw new TypeError("IndexedDB key must be a non-empty string.");
      }

      return runTransaction("readonly", async (store, completion) => {
        const record = await requestToPromise(store.get(key));
        await completion;
        return record?.value;
      });
    },

    async entries() {
      return runTransaction("readonly", async (store, completion) => {
        const records = await requestToPromise(store.getAll());
        await completion;
        return records.map((record) => ({
          key: record.key,
          value: record.value
        }));
      });
    },

    async commit(changes) {
      assertChanges(changes);
      await runTransaction("readwrite", async (store, completion) => {
        const requests = [];
        if (changes.clear) {
          requests.push(requestToPromise(store.clear()));
        }
        for (const key of changes.deletes ?? []) {
          requests.push(requestToPromise(store.delete(key)));
        }
        for (const entry of changes.puts ?? []) {
          requests.push(
            requestToPromise(store.put({ key: entry.key, value: entry.value }))
          );
        }

        await Promise.all(requests);
        await completion;
      });
    }
  });
}
