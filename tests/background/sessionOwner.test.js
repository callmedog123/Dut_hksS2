import assert from "node:assert/strict";
import test from "node:test";

import {
  SessionOwnerError,
  createSessionOwnerFromSender
} from "../../background/sessionOwner.js";

test("derives the exact Session Owner from a trusted main-frame sender", () => {
  const sender = {
    tab: { id: 17 },
    documentId: "document-17",
    frameId: 0,
    url: "https://search.bilibili.com/all?keyword=robot"
  };

  const owner = createSessionOwnerFromSender(sender, "session-17");
  assert.deepEqual(owner, {
    tabId: 17,
    documentId: "document-17",
    frameId: 0,
    sessionId: "session-17"
  });
  assert.equal(Object.isFrozen(owner), true);
});

test("rejects a child frame and every incomplete sender identity", () => {
  assert.throws(
    () =>
      createSessionOwnerFromSender(
        {
          tab: { id: 17 },
          documentId: "document-17",
          frameId: 2
        },
        "session-17"
      ),
    (error) =>
      error instanceof SessionOwnerError &&
      /main frame/u.test(error.message)
  );

  for (const sender of [
    { documentId: "document-17", frameId: 0 },
    { tab: { id: 17 }, frameId: 0 },
    { tab: { id: 17 }, documentId: "document-17" }
  ]) {
    assert.throws(
      () => createSessionOwnerFromSender(sender, "session-17"),
      SessionOwnerError
    );
  }
  assert.throws(
    () => createSessionOwnerFromSender({
      tab: { id: 17 },
      documentId: "document-17",
      frameId: 0
    }),
    SessionOwnerError
  );
});
