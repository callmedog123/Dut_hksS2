function clone(value) {
  return value === undefined
    ? undefined
    : JSON.parse(JSON.stringify(value));
}

export function createFakeIndexedDB() {
  const databases = new Map();
  let pendingWriteFailure = null;

  function consumeWriteFailure() {
    if (pendingWriteFailure === null) {
      return null;
    }
    if (pendingWriteFailure.successesBeforeFailure > 0) {
      pendingWriteFailure.successesBeforeFailure -= 1;
      return null;
    }

    const error = pendingWriteFailure.error;
    pendingWriteFailure = null;
    return error;
  }

  class FakeTransaction {
    constructor(databaseState, storeName, mode) {
      this.databaseState = databaseState;
      this.storeName = storeName;
      this.mode = mode;
      this.error = null;
      this.oncomplete = null;
      this.onerror = null;
      this.onabort = null;
      this.active = true;
      this.pendingRequests = 0;
      this.workingRecords = new Map(
        [...databaseState.stores.get(storeName)].map(([key, value]) => [
          key,
          clone(value)
        ])
      );
      queueMicrotask(() => this.maybeComplete());
    }

    objectStore(storeName) {
      if (storeName !== this.storeName) {
        throw new Error(`Unknown fake object store: ${storeName}`);
      }
      return new FakeObjectStore(this);
    }

    createRequest(operation, isWrite = false) {
      if (!this.active) {
        throw new Error("Fake IndexedDB transaction is inactive.");
      }

      const request = {
        result: undefined,
        error: null,
        onsuccess: null,
        onerror: null
      };
      this.pendingRequests += 1;
      queueMicrotask(() => {
        if (!this.active) {
          return;
        }

        const failure = isWrite ? consumeWriteFailure() : null;
        if (failure !== null) {
          request.error = failure;
          this.error = failure;
          request.onerror?.();
          this.pendingRequests -= 1;
          this.abort();
          return;
        }

        try {
          request.result = operation();
          request.onsuccess?.();
        } catch (error) {
          request.error = error;
          this.error = error;
          request.onerror?.();
          this.pendingRequests -= 1;
          this.abort();
          return;
        }
        this.pendingRequests -= 1;
        queueMicrotask(() => this.maybeComplete());
      });
      return request;
    }

    maybeComplete() {
      if (!this.active || this.pendingRequests !== 0) {
        return;
      }
      if (this.mode === "readwrite") {
        this.databaseState.stores.set(this.storeName, this.workingRecords);
      }
      this.active = false;
      this.oncomplete?.();
    }

    abort() {
      if (!this.active) {
        throw new Error("Fake IndexedDB transaction is already inactive.");
      }
      this.active = false;
      queueMicrotask(() => this.onabort?.());
    }
  }

  class FakeObjectStore {
    constructor(transaction) {
      this.transaction = transaction;
    }

    get(key) {
      return this.transaction.createRequest(() =>
        clone(this.transaction.workingRecords.get(key))
      );
    }

    getAll() {
      return this.transaction.createRequest(() =>
        [...this.transaction.workingRecords.values()].map(clone)
      );
    }

    put(record) {
      return this.transaction.createRequest(() => {
        this.transaction.workingRecords.set(record.key, clone(record));
        return record.key;
      }, true);
    }

    delete(key) {
      return this.transaction.createRequest(() => {
        this.transaction.workingRecords.delete(key);
      }, true);
    }

    clear() {
      return this.transaction.createRequest(() => {
        this.transaction.workingRecords.clear();
      }, true);
    }
  }

  function createDatabase(databaseState) {
    return {
      objectStoreNames: {
        contains(storeName) {
          return databaseState.stores.has(storeName);
        }
      },
      createObjectStore(storeName) {
        databaseState.stores.set(storeName, new Map());
      },
      transaction(storeName, mode) {
        if (!databaseState.stores.has(storeName)) {
          throw new Error(`Unknown fake object store: ${storeName}`);
        }
        return new FakeTransaction(databaseState, storeName, mode);
      },
      close() {}
    };
  }

  return {
    open(databaseName, version) {
      const request = {
        result: undefined,
        error: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null
      };

      queueMicrotask(() => {
        let databaseState = databases.get(databaseName);
        const needsUpgrade = databaseState === undefined;
        if (databaseState === undefined) {
          databaseState = { version, stores: new Map() };
          databases.set(databaseName, databaseState);
        } else if (version < databaseState.version) {
          request.error = new Error("Requested IndexedDB version is too old.");
          request.onerror?.();
          return;
        }

        request.result = createDatabase(databaseState);
        if (needsUpgrade) {
          request.onupgradeneeded?.();
        }
        request.onsuccess?.();
      });
      return request;
    },

    failWriteAfter(successesBeforeFailure, error) {
      pendingWriteFailure = { successesBeforeFailure, error };
    }
  };
}
