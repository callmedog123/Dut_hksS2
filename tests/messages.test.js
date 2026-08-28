import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTIVE_CONTEXT_STATUSES,
  DEFAULT_SETTINGS_V1,
  MESSAGE_SCHEMA_VERSION,
  MESSAGE_TYPES,
  RESPONSE_ERROR_CODES,
  REENCOUNTER_FEEDBACK_OUTCOMES,
  SCHEMA_VERSION,
  createActiveContextQueryMessage,
  createCandidateChosenMessage,
  createCandidatesDiscoveredMessage,
  createDataDeleteAllMessage,
  createErrorResponseMessage,
  createMissedPathDeleteMessage,
  createMissedPathsQueryMessage,
  createPingMessage,
  createPongMessage,
  createReencounterQueryMessage,
  createReencounterFeedbackMessage,
  createReencounterShownMessage,
  createSessionFinalizeMessage,
  createSettingsUpdateMessage,
  createSignalsUpdatedMessage,
  createSuccessResponseMessage,
  isActiveContextQueryMessage,
  isActiveContextQueryResponse,
  isCandidateChosenMessage,
  isCandidatesDiscoveredMessage,
  isCandidatesDiscoveredResponse,
  isDataDeleteAllMessage,
  isDataDeleteAllResponse,
  isMissedPathDeleteMessage,
  isMissedPathDeleteResponse,
  isMissedPathsQueryMessage,
  isMissedPathsQueryResponse,
  isPingMessage,
  isPongMessage,
  isReencounterQueryMessage,
  isReencounterQueryResponse,
  isReencounterFeedbackMessage,
  isReencounterFeedbackResponse,
  isReencounterShownMessage,
  isReencounterShownResponse,
  isResponseMessage,
  isSessionFinalizeMessage,
  isSessionFinalizeResponse,
  isSettingsUpdateMessage,
  isSettingsUpdateResponse,
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
const activeContextQuery = createActiveContextQueryMessage(
  "request-active-context"
);
const missedPathsQuery = createMissedPathsQueryMessage("request-missed-paths");
const dataDeleteAll = createDataDeleteAllMessage(
  1_400,
  "request-data-delete-all"
);
const missedPathDelete = createMissedPathDeleteMessage(
  "missed-1",
  1_300,
  "request-missed-path-delete"
);
const settingsUpdate = createSettingsUpdateMessage(
  false,
  550,
  "request-settings-update"
);
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
const missedPath = {
  id: "missed-1",
  candidate: discoveredCandidates[0],
  context: discoveredContext,
  score: 0.7,
  reasons: [
    {
      code: "LONG_EXPOSURE",
      label: "Visible time contributed.",
      contribution: 0.3
    }
  ],
  status: "MISSED",
  createdAt: 300
};
const rankedReencounter = {
  missedPath,
  score: 0.8,
  reasons: [
    {
      code: "COOLDOWN_PENALTY",
      label: "Cooldown reduced relevance.",
      contribution: -0.2
    }
  ]
};
const reencounterShown = createReencounterShownMessage(
  rankedReencounter,
  reencounterContext,
  1_100,
  "request-reencounter-shown"
);
const reencounterFeedback = createReencounterFeedbackMessage(
  reencounterShown.payload.id,
  REENCOUNTER_FEEDBACK_OUTCOMES.OPENED,
  1_200,
  "request-reencounter-feedback"
);

const messageCases = [
  {
    name: "ACTIVE_CONTEXT_QUERY",
    message: activeContextQuery,
    validator: isActiveContextQueryMessage,
    wrongType: MESSAGE_TYPES.PING
  },
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
  },
  {
    name: "RE_ENCOUNTER_SHOWN",
    message: reencounterShown,
    validator: isReencounterShownMessage,
    wrongType: MESSAGE_TYPES.PING
  },
  {
    name: "DATA_DELETE_ALL",
    message: dataDeleteAll,
    validator: isDataDeleteAllMessage,
    wrongType: MESSAGE_TYPES.PING
  },
  {
    name: "SETTINGS_UPDATE",
    message: settingsUpdate,
    validator: isSettingsUpdateMessage,
    wrongType: MESSAGE_TYPES.PING
  },
  {
    name: "MISSED_PATH_DELETE",
    message: missedPathDelete,
    validator: isMissedPathDeleteMessage,
    wrongType: MESSAGE_TYPES.PING
  },
  {
    name: "RE_ENCOUNTER_FEEDBACK",
    message: reencounterFeedback,
    validator: isReencounterFeedbackMessage,
    wrongType: MESSAGE_TYPES.PING
  }
];

test("keeps MESSAGE_TYPES frozen with the implemented v1 messages", () => {
  assert.equal(Object.isFrozen(MESSAGE_TYPES), true);
  assert.deepEqual(Object.keys(MESSAGE_TYPES).sort(), [
    "ACTIVE_CONTEXT_QUERY",
    "CANDIDATES_DISCOVERED",
    "CANDIDATE_CHOSEN",
    "DATA_DELETE_ALL",
    "MISSED_PATHS_QUERY",
    "MISSED_PATH_DELETE",
    "PING",
    "PONG",
    "RE_ENCOUNTER_FEEDBACK",
    "RE_ENCOUNTER_QUERY",
    "RE_ENCOUNTER_SHOWN",
    "SESSION_FINALIZE",
    "SETTINGS_UPDATE",
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

test("creates an exact ACTIVE_CONTEXT_QUERY with a strict empty payload", () => {
  assert.deepEqual(activeContextQuery, {
    schemaVersion: SCHEMA_VERSION,
    type: MESSAGE_TYPES.ACTIVE_CONTEXT_QUERY,
    requestId: "request-active-context",
    payload: {}
  });
  assert.equal(isActiveContextQueryMessage(activeContextQuery), true);
  assert.throws(() => createActiveContextQueryMessage(""), TypeError);
  assert.equal(
    isActiveContextQueryMessage({
      ...activeContextQuery,
      payload: { source: "side-panel" }
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

test("creates a strict deterministic RE_ENCOUNTER_SHOWN durable record", () => {
  assert.equal(isReencounterShownMessage(reencounterShown), true);
  assert.deepEqual(reencounterShown, {
    schemaVersion: SCHEMA_VERSION,
    type: MESSAGE_TYPES.RE_ENCOUNTER_SHOWN,
    requestId: "request-reencounter-shown",
    payload: {
      id: reencounterShown.payload.id,
      missedPathId: "missed-1",
      triggerContext: reencounterContext,
      score: 0.8,
      reasons: rankedReencounter.reasons,
      shownAt: 1_100
    }
  });
  assert.equal(
    createReencounterShownMessage(
      rankedReencounter,
      reencounterContext,
      1_100,
      "retry-request"
    ).payload.id,
    reencounterShown.payload.id
  );
  assert.notEqual(
    createReencounterShownMessage(
      rankedReencounter,
      { ...reencounterContext, query: "different context" },
      1_100,
      "different-context"
    ).payload.id,
    reencounterShown.payload.id
  );
});

test("RE_ENCOUNTER_SHOWN rejects outcome, invalid time, and extra fields", () => {
  assert.equal(
    isReencounterShownMessage({
      ...reencounterShown,
      payload: { ...reencounterShown.payload, outcome: "OPENED" }
    }),
    false
  );
  assert.equal(
    isReencounterShownMessage({
      ...reencounterShown,
      payload: { ...reencounterShown.payload, shownAt: Number.NaN }
    }),
    false
  );
  assert.equal(
    isReencounterShownMessage({
      ...reencounterShown,
      payload: { ...reencounterShown.payload, extra: true }
    }),
    false
  );
  assert.throws(
    () =>
      createReencounterShownMessage(
        rankedReencounter,
        reencounterContext,
        -1,
        "request"
      ),
    TypeError
  );
});

test("MISSED_PATHS_QUERY response strictly validates every MissedPathV1", () => {
  const responseFor = (item) =>
    createSuccessResponseMessage("request-missed-response", {
      missedPaths: [item]
    });

  assert.equal(isMissedPathsQueryResponse(responseFor(missedPath)), true);
  assert.equal(
    isMissedPathsQueryResponse(
      responseFor({ ...missedPath, status: "UNKNOWN" })
    ),
    false
  );
  assert.equal(
    isMissedPathsQueryResponse(responseFor({ ...missedPath, score: 1.1 })),
    false
  );
  assert.equal(
    isMissedPathsQueryResponse(
      responseFor({
        ...missedPath,
        reasons: [{ code: "UNKNOWN", label: "Unknown." }]
      })
    ),
    false
  );
  assert.equal(
    isMissedPathsQueryResponse(responseFor({ ...missedPath, extra: true })),
    false
  );
  assert.equal(
    isMissedPathsQueryResponse(
      responseFor(
        Object.fromEntries(
          Object.entries(missedPath).filter(([key]) => key !== "candidate")
        )
      )
    ),
    false
  );
});

test("ACTIVE_CONTEXT_QUERY response strictly distinguishes available and unavailable", () => {
  const available = createSuccessResponseMessage("request-active-available", {
    status: ACTIVE_CONTEXT_STATUSES.AVAILABLE,
    context: discoveredContext
  });
  const unavailable = createSuccessResponseMessage(
    "request-active-unavailable",
    {
      status: ACTIVE_CONTEXT_STATUSES.UNAVAILABLE,
      context: null
    }
  );

  assert.equal(isActiveContextQueryResponse(available), true);
  assert.equal(isActiveContextQueryResponse(unavailable), true);
  assert.equal(
    isActiveContextQueryResponse(
      createSuccessResponseMessage("request-active-invalid", {
        status: ACTIVE_CONTEXT_STATUSES.AVAILABLE,
        context: null
      })
    ),
    false
  );
  assert.equal(
    isActiveContextQueryResponse(
      createSuccessResponseMessage("request-active-invalid", {
        status: ACTIVE_CONTEXT_STATUSES.UNAVAILABLE,
        context: discoveredContext
      })
    ),
    false
  );
  assert.equal(
    isActiveContextQueryResponse(
      createSuccessResponseMessage("request-active-invalid", {
        status: "UNKNOWN",
        context: null
      })
    ),
    false
  );
  assert.equal(
    isActiveContextQueryResponse(
      createSuccessResponseMessage("request-active-invalid", {
        status: ACTIVE_CONTEXT_STATUSES.AVAILABLE,
        context: discoveredContext,
        extra: true
      })
    ),
    false
  );
});

test("RE_ENCOUNTER_QUERY response strictly validates RankedReencounterV1", () => {
  const responseFor = (item) =>
    createSuccessResponseMessage("request-reencounter-response", {
      reencounters: [item]
    });

  assert.equal(
    isReencounterQueryResponse(responseFor(rankedReencounter)),
    true
  );
  assert.equal(
    isReencounterQueryResponse(
      responseFor({ ...rankedReencounter, score: Number.NaN })
    ),
    false
  );
  assert.equal(
    isReencounterQueryResponse(
      responseFor({
        ...rankedReencounter,
        reasons: [{ code: "UNKNOWN", label: "Unknown." }]
      })
    ),
    false
  );
  assert.equal(
    isReencounterQueryResponse(
      responseFor({ ...rankedReencounter, extra: true })
    ),
    false
  );
  assert.equal(
    isReencounterQueryResponse(
      responseFor({
        id: "persistent-reencounter",
        missedPathId: "missed-1",
        triggerContext: reencounterContext,
        score: 0.8,
        reasons: rankedReencounter.reasons,
        shownAt: 500
      })
    ),
    false
  );
});

test("RE_ENCOUNTER_SHOWN response strictly validates persisted identity", () => {
  const response = createSuccessResponseMessage("shown-response", {
    reencounterId: reencounterShown.payload.id,
    missedPathId: "missed-1",
    shownAt: 1_100,
    created: true
  });
  assert.equal(isReencounterShownResponse(response), true);
  assert.equal(
    isReencounterShownResponse({
      ...response,
      data: { ...response.data, created: "yes" }
    }),
    false
  );
  assert.equal(
    isReencounterShownResponse({
      ...response,
      data: { ...response.data, extra: true }
    }),
    false
  );
  assert.equal(
    isReencounterShownResponse(
      createErrorResponseMessage("shown-response", {
        code: RESPONSE_ERROR_CODES.MISSED_PATH_NOT_FOUND,
        message: "Unknown Missed Path.",
        retryable: false
      })
    ),
    true
  );
});

test("creates and strictly validates DATA_DELETE_ALL", () => {
  assert.equal(isDataDeleteAllMessage(dataDeleteAll), true);
  assert.deepEqual(dataDeleteAll, {
    schemaVersion: SCHEMA_VERSION,
    type: MESSAGE_TYPES.DATA_DELETE_ALL,
    requestId: "request-data-delete-all",
    payload: { requestedAt: 1_400 }
  });
  assert.equal(
    isDataDeleteAllMessage({
      ...dataDeleteAll,
      payload: { requestedAt: -1 }
    }),
    false
  );
  assert.equal(
    isDataDeleteAllMessage({
      ...dataDeleteAll,
      payload: { ...dataDeleteAll.payload, extra: true }
    }),
    false
  );
  const response = createSuccessResponseMessage("clear-response", {
    deleted: true
  });
  assert.equal(isDataDeleteAllResponse(response), true);
  assert.equal(
    isDataDeleteAllResponse({
      ...response,
      data: { deleted: "yes" }
    }),
    false
  );
});

test("creates and strictly validates MISSED_PATH_DELETE", () => {
  assert.equal(isMissedPathDeleteMessage(missedPathDelete), true);
  assert.deepEqual(missedPathDelete, {
    schemaVersion: SCHEMA_VERSION,
    type: MESSAGE_TYPES.MISSED_PATH_DELETE,
    requestId: "request-missed-path-delete",
    payload: { missedPathId: "missed-1", requestedAt: 1_300 }
  });
  for (const payload of [
    { ...missedPathDelete.payload, missedPathId: "" },
    { ...missedPathDelete.payload, requestedAt: -1 },
    { ...missedPathDelete.payload, extra: true }
  ]) {
    assert.equal(
      isMissedPathDeleteMessage({ ...missedPathDelete, payload }),
      false
    );
  }

  const response = createSuccessResponseMessage("delete-response", {
    missedPathId: "missed-1",
    deleted: true
  });
  assert.equal(isMissedPathDeleteResponse(response), true);
  assert.equal(
    isMissedPathDeleteResponse({
      ...response,
      data: { ...response.data, deleted: "yes" }
    }),
    false
  );
  assert.equal(
    isMissedPathDeleteResponse({
      ...response,
      data: { ...response.data, extra: true }
    }),
    false
  );
});

test("creates and strictly validates SETTINGS_UPDATE", () => {
  assert.equal(isSettingsUpdateMessage(settingsUpdate), true);
  assert.deepEqual(settingsUpdate, {
    schemaVersion: SCHEMA_VERSION,
    type: MESSAGE_TYPES.SETTINGS_UPDATE,
    requestId: "request-settings-update",
    payload: { enabled: false, requestedAt: 550 }
  });
  for (const payload of [
    { ...settingsUpdate.payload, enabled: "no" },
    { ...settingsUpdate.payload, requestedAt: -1 },
    { ...settingsUpdate.payload, extra: true }
  ]) {
    assert.equal(
      isSettingsUpdateMessage({ ...settingsUpdate, payload }),
      false
    );
  }

  const response = createSuccessResponseMessage("settings-response", {
    settings: { ...DEFAULT_SETTINGS_V1, enabled: false },
    updated: true
  });
  assert.equal(isSettingsUpdateResponse(response), true);
  assert.equal(
    isSettingsUpdateResponse({
      ...response,
      data: { ...response.data, settings: { enabled: false } }
    }),
    false
  );
  assert.equal(
    isSettingsUpdateResponse({
      ...response,
      data: { ...response.data, extra: true }
    }),
    false
  );
});

test("creates and strictly validates RE_ENCOUNTER_FEEDBACK", () => {
  assert.equal(isReencounterFeedbackMessage(reencounterFeedback), true);
  assert.deepEqual(reencounterFeedback, {
    schemaVersion: SCHEMA_VERSION,
    type: MESSAGE_TYPES.RE_ENCOUNTER_FEEDBACK,
    requestId: "request-reencounter-feedback",
    payload: {
      reencounterId: reencounterShown.payload.id,
      outcome: REENCOUNTER_FEEDBACK_OUTCOMES.OPENED,
      feedbackAt: 1_200
    }
  });

  for (const payload of [
    { ...reencounterFeedback.payload, reencounterId: "" },
    { ...reencounterFeedback.payload, outcome: "DISMISSED" },
    { ...reencounterFeedback.payload, feedbackAt: -1 },
    { ...reencounterFeedback.payload, extra: true }
  ]) {
    assert.equal(
      isReencounterFeedbackMessage({ ...reencounterFeedback, payload }),
      false
    );
  }
});

test("RE_ENCOUNTER_FEEDBACK response strictly validates persisted feedback", () => {
  const response = createSuccessResponseMessage("feedback-response", {
    reencounterId: reencounterShown.payload.id,
    outcome: REENCOUNTER_FEEDBACK_OUTCOMES.LATER,
    feedbackAt: 1_200,
    updated: true
  });
  assert.equal(isReencounterFeedbackResponse(response), true);
  assert.equal(
    isReencounterFeedbackResponse({
      ...response,
      data: { ...response.data, outcome: "DISMISSED" }
    }),
    false
  );
  assert.equal(
    isReencounterFeedbackResponse({
      ...response,
      data: { ...response.data, extra: true }
    }),
    false
  );
  assert.equal(
    isReencounterFeedbackResponse(
      createErrorResponseMessage("feedback-response", {
        code: RESPONSE_ERROR_CODES.REENCOUNTER_FEEDBACK_CONFLICT,
        message: "Conflicting feedback.",
        retryable: false
      })
    ),
    true
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
