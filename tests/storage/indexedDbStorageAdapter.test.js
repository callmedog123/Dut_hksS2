import assert from "node:assert/strict";
import test from "node:test";

import { createIndexedDbStorageAdapter } from "../../storage/indexedDbStorageAdapter.js";
import { createFakeIndexedDB } from "./fixtures/fakeIndexedDB.js";

test("requires an IndexedDB implementation", () => {
  assert.throws(
    () => createIndexedDbStorageAdapter({ indexedDB: null }),
    TypeError
  );
});

test("persists, lists, deletes, and clears local records", async () => {
  const adapter = createIndexedDbStorageAdapter({
    indexedDB: createFakeIndexedDB(),
    databaseName: "adapter-crud-test"
  });

  assert.equal(await adapter.get("missing"), undefined);
  await adapter.commit({
    puts: [
      { key: "a", value: { count: 1 } },
      { key: "b", value: { count: 2 } }
    ]
  });
  assert.deepEqual(await adapter.get("a"), { count: 1 });
  assert.deepEqual(await adapter.entries(), [
    { key: "a", value: { count: 1 } },
    { key: "b", value: { count: 2 } }
  ]);

  await adapter.commit({ deletes: ["a"] });
  assert.equal(await adapter.get("a"), undefined);
  assert.deepEqual(await adapter.get("b"), { count: 2 });

  await adapter.commit({
    clear: true,
    puts: [{ key: "schema", value: { schemaVersion: 1 } }]
  });
  assert.deepEqual(await adapter.entries(), [
    { key: "schema", value: { schemaVersion: 1 } }
  ]);
});

test("rolls back all writes when one request in the transaction fails", async () => {
  const indexedDB = createFakeIndexedDB();
  const adapter = createIndexedDbStorageAdapter({
    indexedDB,
    databaseName: "adapter-rollback-test"
  });
  await adapter.commit({
    puts: [
      { key: "a", value: { count: 1 } },
      { key: "b", value: { count: 2 } }
    ]
  });

  const failure = new Error("simulated IndexedDB request failure");
  indexedDB.failWriteAfter(1, failure);
  await assert.rejects(
    () =>
      adapter.commit({
        puts: [
          { key: "a", value: { count: 10 } },
          { key: "b", value: { count: 20 } }
        ]
      }),
    (error) => error === failure
  );

  assert.deepEqual(await adapter.get("a"), { count: 1 });
  assert.deepEqual(await adapter.get("b"), { count: 2 });
});
