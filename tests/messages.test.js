import assert from "node:assert/strict";
import test from "node:test";

import {
  MESSAGE_SCHEMA_VERSION,
  MESSAGE_TYPES,
  RESPONSE_ERROR_CODES,
  SCHEMA_VERSION,
  createCandidateChosenMessage,
  createCandidatesDiscoveredMessage,
  createErrorResponseMessage,
  createMissedPathsQueryMessage,
  createPingMessage,
  createPongMessage,
  createReencounterQueryMessage,
  createSessionFinalizeMessage,
  createSignalsUpdatedMessage,
  createSuccessResponseMessage,
  isCandidateChosenMessage,
  isCandidatesDiscoveredMessage,
  isCandidatesDiscoveredResponse,
  isMissedPathsQueryMessage,
  isMissedPathsQueryResponse,
  isPingMessage,
  isPongMessage,
  isReencounterQueryMessage,
  isReencounterQueryResponse,
  isResponseMessage,
  isSessionFinalizeMessage,
  isSessionFinalizeResponse,
  isSignalsUpdatedMessage,
  isSignalsUpdatedResponse
} from "../shared/messages.js";
import { createFakeIndexedDB } from "./storage/fixtures/fakeIndexedDB.js";

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
const discoveredContext = {
  query: "robot navigation",
  source: "local-demo",
  timestamp: 100,
  keywords: ["robot", "navigation"]
};
const discoveredCandidates = [
  {
    id: "candidate-1",
    url: "https://example.com/result-1",
    title: "Result one",
    source: "local-demo",
    rank: 1,
    sessionId: "session-1"
  },
  {
    id: "candidate-2",
    url: "https://example.com/result-2",
    title: "Result two",
    source: "local-demo",
    rank: 2,
    sessionId: "session-1"
  }
];
const candidatesDiscovered = createCandidatesDiscoveredMessage(
  "session-1",
  discoveredContext,
  discoveredCandidates,
  200,
  "request-discovered"
);
const signalsSnapshot = {
  candidateId: "candidate-1",
  sessionId: "session-1",
  visibleMs: 1_000,
  hoverMs: 200,
  hoverCount: 2,
  returnCount: 1,
  clicked: false
};
const signalsUpdated = createSignalsUpdatedMessage(
  signalsSnapshot,
  250,
  "request-signals"
);
const sessionFinalize = createSessionFinalizeMessage(
  "session-1",
  500,
  "request-finalize"
);
const missedPathsQuery = createMissedPathsQueryMessage("request-missed-paths");
const reencounterContext = {
  query: "robot navigation",
  source: "local-demo",
  timestamp: 1_000,
  keywords: ["robot", "navigation"]
};
const reencounterQuery = createReencounterQueryMessage(
  reencounterContext,
  3,
  "request-reencounter"
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
  },
  {
    name: "CANDIDATES_DISCOVERED",
    message: candidatesDiscovered,
    validator: isCandidatesDiscoveredMessage,
    wrongType: MESSAGE_TYPES.PING
  },
  {
    name: "SIGNALS_UPDATED",
    message: signalsUpdated,
    validator: isSignalsUpdatedMessage,
    wrongType: MESSAGE_TYPES.PING
  },
  {
    name: "SESSION_FINALIZE",
    message: sessionFinalize,
    validator: isSessionFinalizeMessage,
    wrongType: MESSAGE_TYPES.PING
  },
  {
    name: "MISSED_PATHS_QUERY",
    message: missedPathsQuery,
    validator: isMissedPathsQueryMessage,
    wrongType: MESSAGE_TYPES.PING
  },
  {
    name: "RE_ENCOUNTER_QUERY",
    message: reencounterQuery,
    validator: isReencounterQueryMessage,
    wrongType: MESSAGE_TYPES.PING
  }
];

test("keeps MESSAGE_TYPES frozen with the implemented v1 messages", () => {
  assert.equal(Object.isFrozen(MESSAGE_TYPES), true);
  assert.deepEqual(Object.keys(MESSAGE_TYPES).sort(), [
    "CANDIDATES_DISCOVERED",
    "CANDIDATE_CHOSEN",
    "MISSED_PATHS_QUERY",
    "PING",
    "PONG",
    "RE_ENCOUNTER_QUERY",
    "SESSION_FINALIZE",
    "SIGNALS_UPDATED"
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

test("creates a strict CANDIDATES_DISCOVERED batch", () => {
  assert.deepEqual(candidatesDiscovered, {
    schemaVersion: SCHEMA_VERSION,
    type: MESSAGE_TYPES.CANDIDATES_DISCOVERED,
    requestId: "request-discovered",
    payload: {
      sessionId: "session-1",
      context: discoveredContext,
      candidates: discoveredCandidates,
      discoveredAt: 200
    }
  });
  assert.equal(isCandidatesDiscoveredMessage(candidatesDiscovered), true);
  assert.throws(
    () =>
      createCandidatesDiscoveredMessage(
        "session-1",
        discoveredContext,
        [],
        200,
        "request-discovered-empty"
      ),
    TypeError
  );
  assert.equal(
    isCandidatesDiscoveredMessage({
      ...candidatesDiscovered,
      payload: {
        ...candidatesDiscovered.payload,
        candidates: [
          discoveredCandidates[0],
          { ...discoveredCandidates[1], id: "candidate-1" }
        ]
      }
    }),
    false
  );
  assert.equal(
    isCandidatesDiscoveredMessage({
      ...candidatesDiscovered,
      payload: {
        ...candidatesDiscovered.payload,
        candidates: [
          discoveredCandidates[0],
          {
            ...discoveredCandidates[1],
            url: "https://example.com/result-1#duplicate"
          }
        ]
      }
    }),
    false
  );
  assert.equal(
    isCandidatesDiscoveredMessage({
      ...candidatesDiscovered,
      payload: {
        ...candidatesDiscovered.payload,
        candidates: [
          { ...discoveredCandidates[0], sessionId: "session-other" }
        ]
      }
    }),
    false
  );
  assert.equal(
    isCandidatesDiscoveredMessage({
      ...candidatesDiscovered,
      payload: {
        ...candidatesDiscovered.payload,
        candidates: [
          {
            ...discoveredCandidates[0],
            url: "https://example.com/result-1?utm_source=test"
          }
        ]
      }
    }),
    false
  );
});

test("creates a strict SIGNALS_UPDATED absolute snapshot", () => {
  assert.deepEqual(signalsUpdated, {
    schemaVersion: SCHEMA_VERSION,
    type: MESSAGE_TYPES.SIGNALS_UPDATED,
    requestId: "request-signals",
    payload: {
      signals: signalsSnapshot,
      updatedAt: 250
    }
  });
  assert.equal(isSignalsUpdatedMessage(signalsUpdated), true);
  assert.throws(
    () => createSignalsUpdatedMessage(signalsSnapshot, -1, "request-signals"),
    TypeError
  );
  assert.throws(
    () =>
      createSignalsUpdatedMessage(
        { ...signalsSnapshot, hoverCount: 1.5 },
        250,
        "request-signals"
      ),
    TypeError
  );
  assert.equal(
    isSignalsUpdatedMessage({
      ...signalsUpdated,
      payload: {
        ...signalsUpdated.payload,
        signals: { ...signalsSnapshot, extra: true }
      }
    }),
    false
  );
  assert.equal(
    isSignalsUpdatedMessage({
      ...signalsUpdated,
      payload: { ...signalsUpdated.payload, updatedAt: Number.POSITIVE_INFINITY }
    }),
    false
  );
});

test("creates a strict SESSION_FINALIZE request", () => {
  assert.deepEqual(sessionFinalize, {
    schemaVersion: SCHEMA_VERSION,
    type: MESSAGE_TYPES.SESSION_FINALIZE,
    requestId: "request-finalize",
    payload: {
      sessionId: "session-1",
      finalizedAt: 500
    }
  });
  assert.equal(isSessionFinalizeMessage(sessionFinalize), true);
  assert.throws(
    () => createSessionFinalizeMessage("", 500, "request-finalize"),
    TypeError
  );
  assert.throws(
    () => createSessionFinalizeMessage("session-1", -1, "request-finalize"),
    TypeError
  );
  assert.equal(
    isSessionFinalizeMessage({
      ...sessionFinalize,
      payload: {
        sessionId: "session-1",
        finalizedAt: Number.POSITIVE_INFINITY
      }
    }),
    false
  );
});

test("creates an exact MISSED_PATHS_QUERY with a strict empty payload", () => {
  assert.deepEqual(missedPathsQuery, {
    schemaVersion: SCHEMA_VERSION,
    type: MESSAGE_TYPES.MISSED_PATHS_QUERY,
    requestId: "request-missed-paths",
    payload: {}
  });
  assert.equal(isMissedPathsQueryMessage(missedPathsQuery), true);
  assert.throws(() => createMissedPathsQueryMessage(""), TypeError);
  assert.equal(
    isMissedPathsQueryMessage({
      ...missedPathsQuery,
      payload: { limit: 10 }
    }),
    false
  );
});

test("creates an exact RE_ENCOUNTER_QUERY with strict context and limit", () => {
  assert.deepEqual(reencounterQuery, {
    schemaVersion: SCHEMA_VERSION,
    type: MESSAGE_TYPES.RE_ENCOUNTER_QUERY,
    requestId: "request-reencounter",
    payload: {
      context: reencounterContext,
      limit: 3
    }
  });
  assert.equal(isReencounterQueryMessage(reencounterQuery), true);
  assert.throws(
    () => createReencounterQueryMessage(reencounterContext, 0, "request-1"),
    TypeError
  );
  assert.throws(
    () => createReencounterQueryMessage(reencounterContext, 4, "request-1"),
    TypeError
  );
  assert.throws(
    () => createReencounterQueryMessage(reencounterContext, 3, ""),
    TypeError
  );
  assert.equal(
    isReencounterQueryMessage({
      ...reencounterQuery,
      payload: { ...reencounterQuery.payload, extra: true }
    }),
    false
  );
});

test("shared ResponseMessage factories create strict success and error shapes", () => {
  const success = createSuccessResponseMessage("request-success", {
    missedPaths: []
  });
  const error = createErrorResponseMessage("request-error", {
    code: RESPONSE_ERROR_CODES.STORAGE_ERROR,
    message: "Unable to query local Missed Paths.",
    retryable: true
  });

  assert.deepEqual(success, {
    schemaVersion: SCHEMA_VERSION,
    requestId: "request-success",
    ok: true,
    data: { missedPaths: [] }
  });
  assert.deepEqual(error, {
    schemaVersion: SCHEMA_VERSION,
    requestId: "request-error",
    ok: false,
    error: {
      code: RESPONSE_ERROR_CODES.STORAGE_ERROR,
      message: "Unable to query local Missed Paths.",
      retryable: true
    }
  });
  assert.equal(isResponseMessage(success), true);
  assert.equal(isResponseMessage(error), true);
  assert.equal(isMissedPathsQueryResponse(success), true);
  assert.equal(isMissedPathsQueryResponse(error), true);
  assert.equal(
    isCandidatesDiscoveredResponse(
      createSuccessResponseMessage("request-discovery-response", {
        sessionId: "session-1",
        acceptedCandidateIds: ["candidate-1"],
        totalCandidateCount: 2,
        updatedAt: 200
      })
    ),
    true
  );
  assert.equal(isCandidatesDiscoveredResponse(error), true);
  assert.equal(
    isSignalsUpdatedResponse(
      createSuccessResponseMessage("request-signals-response", {
        sessionId: "session-1",
        candidateId: "candidate-1",
        updatedAt: 250,
        changed: true
      })
    ),
    true
  );
  assert.equal(
    isSignalsUpdatedResponse(
      createSuccessResponseMessage("request-invalid-signals-response", {
        sessionId: "session-1",
        candidateId: "candidate-1",
        updatedAt: 250,
        changed: 1
      })
    ),
    false
  );
  assert.equal(
    isSessionFinalizeResponse(
      createSuccessResponseMessage("request-finalize-response", {
        sessionId: "session-1",
        finalizedAt: 500,
        alreadyFinalized: false,
        chosen: [],
        missedPaths: []
      })
    ),
    true
  );
  assert.equal(
    isSessionFinalizeResponse(
      createSuccessResponseMessage("request-invalid-finalize-response", {
        sessionId: "session-1",
        finalizedAt: 500,
        alreadyFinalized: false,
        chosen: [],
        missedPaths: [],
        marker: {}
      })
    ),
    false
  );
  assert.equal(
    isSessionFinalizeResponse(
      createSuccessResponseMessage("request-envelope-finalize-response", {
        sessionId: "session-1",
        finalizedAt: 500,
        alreadyFinalized: false,
        chosen: [
          {
            schemaVersion: 1,
            kind: "chosen",
            id: "chosen-1",
            data: {}
          }
        ],
        missedPaths: []
      })
    ),
    false
  );
  assert.equal(
    isReencounterQueryResponse(
      createSuccessResponseMessage("request-reencounter-response", {
        reencounters: []
      })
    ),
    true
  );
  assert.equal(isResponseMessage({ ...success, schemaVersion: 2 }), false);
  assert.equal(isResponseMessage({ ...success, extra: true }), false);
  assert.equal(
    isResponseMessage({
      ...error,
      error: { ...error.error, retryable: "yes" }
    }),
    false
  );
  assert.equal(
    isMissedPathsQueryResponse(
      createSuccessResponseMessage("request-wrong-data", { paths: [] })
    ),
    false
  );
  assert.equal(
    isCandidatesDiscoveredResponse(
      createSuccessResponseMessage("request-invalid-discovery-response", {
        sessionId: "session-1",
        acceptedCandidateIds: ["candidate-1", "candidate-1"],
        totalCandidateCount: 1,
        updatedAt: 200
      })
    ),
    false
  );
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
    if (firstPayloadKey !== undefined) {
      const payloadWithoutFirstKey = Object.fromEntries(
        Object.entries(message.payload).filter(
          ([key]) => key !== firstPayloadKey
        )
      );
      assert.equal(
        validator({ ...message, payload: payloadWithoutFirstKey }),
        false
      );
    }
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

test("Service Worker routes MISSED_PATHS_QUERY without Side Panel storage access", async () => {
  let messageListener;
  globalThis.indexedDB = createFakeIndexedDB();
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
    await import("../background/serviceWorker.js?missed-paths-query-test");
    const request = createMissedPathsQueryMessage("request-side-panel-query");
    let resolveResponse;
    const responsePromise = new Promise((resolve) => {
      resolveResponse = resolve;
    });
    const listenerResult = messageListener(
      request,
      { url: "chrome-extension://test/sidepanel/index.html" },
      resolveResponse
    );

    assert.equal(listenerResult, true);
    const response = await responsePromise;
    assert.equal(isMissedPathsQueryResponse(response), true);
    assert.equal(response.requestId, request.requestId);
    assert.deepEqual(response.data, { missedPaths: [] });
  } finally {
    delete globalThis.chrome;
    delete globalThis.indexedDB;
  }
});

test("Service Worker routes RE_ENCOUNTER_QUERY through the read-only use case", async () => {
  let messageListener;
  globalThis.indexedDB = createFakeIndexedDB();
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
    await import("../background/serviceWorker.js?reencounter-query-test");
    const request = createReencounterQueryMessage(
      reencounterContext,
      3,
      "request-service-worker-reencounter"
    );
    let resolveResponse;
    const responsePromise = new Promise((resolve) => {
      resolveResponse = resolve;
    });
    const listenerResult = messageListener(
      request,
      { url: "chrome-extension://test/sidepanel/index.html" },
      resolveResponse
    );

    assert.equal(listenerResult, true);
    const response = await responsePromise;
    assert.equal(isReencounterQueryResponse(response), true);
    assert.equal(response.requestId, request.requestId);
    assert.deepEqual(response.data, { reencounters: [] });
  } finally {
    delete globalThis.chrome;
    delete globalThis.indexedDB;
  }
});
