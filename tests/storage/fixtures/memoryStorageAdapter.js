function clone(value) {
  return value === undefined
    ? undefined
    : JSON.parse(JSON.stringify(value));
}

export function createTransactionalMemoryStorageAdapter(initialEntries = []) {
  let records = new Map(
    initialEntries.map(({ key, value }) => [key, clone(value)])
  );
  let commitCount = 0;
  let nextCommitError = null;

  return {
    async get(key) {
      return clone(records.get(key));
    },

    async entries() {
      return [...records].map(([key, value]) => ({
        key,
        value: clone(value)
      }));
    },

    async commit(changes) {
      commitCount += 1;
      const nextRecords = new Map(
        [...records].map(([key, value]) => [key, clone(value)])
      );

      if (changes.clear) {
        nextRecords.clear();
      }
      for (const key of changes.deletes ?? []) {
        nextRecords.delete(key);
      }
      for (const { key, value } of changes.puts ?? []) {
        nextRecords.set(key, clone(value));
      }

      if (nextCommitError !== null) {
        const error = nextCommitError;
        nextCommitError = null;
        throw error;
      }
      records = nextRecords;
    },

    failNextCommit(error) {
      nextCommitError = error;
    },

    get commitCount() {
      return commitCount;
    },

    snapshot() {
      return [...records].map(([key, value]) => ({ key, value: clone(value) }));
    }
  };
}
