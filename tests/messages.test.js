import assert from "node:assert/strict";
import test from "node:test";

import {
  MESSAGE_SCHEMA_VERSION,
  MESSAGE_TYPES,
  SCHEMA_VERSION,
  createCandidateChosenMessage,
  createPingMessage,
  createPongMessage,
  isCandidateChosenMessage,
  isPingMessage,
  isPongMessage
} from "../shared/messages.js";

const ping = createPingMessage("side-panel", {
  requestId: "request-ping",
  sentAt: 100
});
const pong = createPongMessage(ping, "service-worker", 150);
const chosen = createCandidateChosenMessage(
  { id: "candidate-1", sessionId: "session-1" },
  200,
  "request-chosen"
);

const messageCases = [
  {
    name: "PING",
    message: ping,
    validator: isPingMessage,
    wrongType: MESSAGE_TYPES.PONG
  },
  {
    name: "PONG",
    message: pong,
    validator: isPongMessage,
    wrongType: MESSAGE_TYPES.PING
  },
  {
    name: "CANDIDATE_CHOSEN",
    message: chosen,
    validator: isCandidateChosenMessage,
    wrongType: MESSAGE_TYPES.PING
  }
];

test("keeps MESSAGE_TYPES frozen with only the current v1 messages", () => {
  assert.equal(Object.isFrozen(MESSAGE_TYPES), true);
  assert.deepEqual(Object.keys(MESSAGE_TYPES).sort(), [
    "CANDIDATE_CHOSEN",
    "PING",
    "PONG"
  ]);
});

test("creates an exact PING that passes its validator", () => {
  assert.deepEqual(ping, {
    schemaVersion: SCHEMA_VERSION,
    type: MESSAGE_TYPES.PING,
    requestId: "request-ping",
    payload: { source: "side-panel", sentAt: 100 }
  });
  assert.equal(isPingMessage(ping), true);
});

test("creates an exact correlated PONG that passes its validator", () => {
  assert.deepEqual(pong, {
    schemaVersion: SCHEMA_VERSION,
    type: MESSAGE_TYPES.PONG,
    requestId: "request-ping",
    payload: {
      requestSource: "side-panel",
      responder: "service-worker",
      receivedSentAt: 100,
      respondedAt: 150
    }
  });
  assert.equal(isPongMessage(pong), true);
});

test("creates an exact CANDIDATE_CHOSEN that passes its validator", () => {
  assert.deepEqual(chosen, {
    schemaVersion: SCHEMA_VERSION,
    type: MESSAGE_TYPES.CANDIDATE_CHOSEN,
    requestId: "request-chosen",
    payload: {
      candidateId: "candidate-1",
      sessionId: "session-1",
      clicked: true,
      chosenAt: 200
    }
  });
  assert.equal(isCandidateChosenMessage(chosen), true);
});

test("keeps MESSAGE_SCHEMA_VERSION as the shared constant alias", () => {
  assert.equal(MESSAGE_SCHEMA_VERSION, SCHEMA_VERSION);
  assert.equal(SCHEMA_VERSION, 1);
});

test("all message validators reject wrong schemaVersion and type", () => {
  for (const { validator, message, wrongType } of messageCases) {
    assert.equal(validator({ ...message, schemaVersion: 2 }), false);
    assert.equal(validator({ ...message, type: wrongType }), false);
  }
});

test("all message validators reject missing, wrong, or extra envelope fields", () => {
  for (const { validator, message } of messageCases) {
    const { requestId: _requestId, ...withoutRequestId } = message;
    assert.equal(validator(withoutRequestId), false);
    assert.equal(validator({ ...message, requestId: "" }), false);
    assert.equal(validator({ ...message, requestId: 1 }), false);
    assert.equal(validator({ ...message, payload: null }), false);
    assert.equal(validator({ ...message, extra: true }), false);
  }
});

test("all message validators reject extra or missing payload fields", () => {
  for (const { validator, message } of messageCases) {
    const firstPayloadKey = Object.keys(message.payload)[0];
    const payloadWithoutFirstKey = Object.fromEntries(
      Object.entries(message.payload).filter(([key]) => key !== firstPayloadKey)
    );
    assert.equal(
      validator({ ...message, payload: payloadWithoutFirstKey }),
      false
    );
    assert.equal(
      validator({ ...message, payload: { ...message.payload, extra: true } }),
      false
    );
  }
});

test("PING rejects empty requestId and invalid sentAt", () => {
  assert.throws(
    () =>
      createPingMessage("side-panel", { requestId: "", sentAt: 100 }),
    TypeError
  );
  assert.throws(
    () =>
      createPingMessage("side-panel", {
        requestId: "request-1",
        sentAt: Number.NaN
      }),
    TypeError
  );
  assert.equal(
    isPingMessage({ ...ping, payload: { ...ping.payload, source: "" } }),
    false
  );
  assert.equal(
    isPingMessage({
      ...ping,
      payload: { ...ping.payload, sentAt: Number.POSITIVE_INFINITY }
    }),
    false
  );
});

test("PONG rejects empty responder and invalid response times", () => {
  assert.throws(() => createPongMessage(ping, "", 150), TypeError);
  assert.throws(
    () => createPongMessage(ping, "service-worker", Number.NaN),
    TypeError
  );
  assert.equal(
    isPongMessage({
      ...pong,
      payload: { ...pong.payload, responder: "" }
    }),
    false
  );
  assert.equal(
    isPongMessage({
      ...pong,
      payload: {
        ...pong.payload,
        receivedSentAt: Number.NEGATIVE_INFINITY
      }
    }),
    false
  );
});

test("CANDIDATE_CHOSEN rejects invalid IDs, clicked value, and times", () => {
  assert.throws(
    () =>
      createCandidateChosenMessage(
        { id: "", sessionId: "session-1" },
        200,
        "request-1"
      ),
    TypeError
  );
  assert.throws(
    () =>
      createCandidateChosenMessage(
        { id: "candidate-1", sessionId: "session-1" },
        Number.POSITIVE_INFINITY,
        "request-1"
      ),
    TypeError
  );
  assert.throws(
    () =>
      createCandidateChosenMessage(
        { id: "candidate-1", sessionId: "session-1" },
        200,
        ""
      ),
    TypeError
  );
  assert.equal(
    isCandidateChosenMessage({
      ...chosen,
      payload: { ...chosen.payload, clicked: false }
    }),
    false
  );
  assert.equal(
    isCandidateChosenMessage({
      ...chosen,
      payload: { ...chosen.payload, candidateId: 1 }
    }),
    false
  );
});

test("Service Worker still answers a valid PING with a correlated PONG", async () => {
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
    await import("../background/serviceWorker.js?service-worker-contract-test");
    assert.equal(typeof messageListener, "function");

    const request = createPingMessage("side-panel", {
      requestId: "request-service-worker",
      sentAt: 300
    });
    let response;
    const listenerResult = messageListener(
      request,
      { url: "chrome-extension://test/sidepanel/index.html" },
      (value) => {
        response = value;
      }
    );

    assert.equal(listenerResult, false);
    assert.equal(isPongMessage(response), true);
    assert.equal(response.requestId, request.requestId);
    assert.equal(response.payload.requestSource, "side-panel");
    assert.equal(response.payload.responder, "service-worker");
  } finally {
    delete globalThis.chrome;
  }
});
