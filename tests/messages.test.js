import assert from "node:assert/strict";
import test from "node:test";

import {
  MESSAGE_SCHEMA_VERSION,
  MESSAGE_TYPES,
  createPingMessage,
  createPongMessage,
  isPingMessage,
  isPongMessage
} from "../shared/messages.js";

test("creates a valid deterministic PING", () => {
  const ping = createPingMessage("side-panel", {
    requestId: "request-1",
    sentAt: 100
  });

  assert.deepEqual(ping, {
    schemaVersion: MESSAGE_SCHEMA_VERSION,
    type: MESSAGE_TYPES.PING,
    requestId: "request-1",
    payload: {
      source: "side-panel",
      sentAt: 100
    }
  });
  assert.equal(isPingMessage(ping), true);
});

test("rejects invalid PING messages", () => {
  assert.equal(isPingMessage(null), false);
  assert.equal(isPingMessage({}), false);
  assert.equal(
    isPingMessage({
      schemaVersion: 999,
      type: MESSAGE_TYPES.PING,
      requestId: "request-1",
      payload: { source: "side-panel", sentAt: 100 }
    }),
    false
  );
});

test("creates a correlated PONG", () => {
  const ping = createPingMessage("local-demo", {
    requestId: "request-2",
    sentAt: 200
  });
  const pong = createPongMessage(ping, "service-worker", 250);

  assert.deepEqual(pong, {
    schemaVersion: MESSAGE_SCHEMA_VERSION,
    type: MESSAGE_TYPES.PONG,
    requestId: "request-2",
    payload: {
      requestSource: "local-demo",
      responder: "service-worker",
      receivedSentAt: 200,
      respondedAt: 250
    }
  });
  assert.equal(isPongMessage(pong), true);
});

test("Service Worker answers a valid PING with a correlated PONG", async () => {
  let messageListener;

  globalThis.chrome = {
    runtime: {
      onInstalled: {
        addListener() {}
      },
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        }
      }
    },
    sidePanel: {
      setPanelBehavior() {
        return Promise.resolve();
      }
    }
  };

  try {
    await import("../background/serviceWorker.js?service-worker-test");
    assert.equal(typeof messageListener, "function");

    const ping = createPingMessage("side-panel", {
      requestId: "request-3",
      sentAt: 300
    });
    let response;
    const listenerResult = messageListener(
      ping,
      { url: "chrome-extension://test/sidepanel/index.html" },
      (value) => {
        response = value;
      }
    );

    assert.equal(listenerResult, false);
    assert.equal(isPongMessage(response), true);
    assert.equal(response.requestId, ping.requestId);
    assert.equal(response.payload.requestSource, "side-panel");
    assert.equal(response.payload.responder, "service-worker");
  } finally {
    delete globalThis.chrome;
  }
});
