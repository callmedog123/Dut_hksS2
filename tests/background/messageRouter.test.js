import assert from "node:assert/strict";
import test from "node:test";

import { createMessageRouter } from "../../background/messageRouter.js";
import { DataDeleteAllError } from "../../background/dataDeleteAll.js";
import { MissedPathDeleteError } from "../../background/missedPathDelete.js";
import { ReencounterFeedbackError } from "../../background/reencounterFeedback.js";
import { ReencounterQueryError } from "../../background/reencounterQuery.js";
import { ReencounterShownError } from "../../background/reencounterShown.js";
import { SettingsUpdateError } from "../../background/settingsUpdate.js";
import { createSessionFinalizeUseCase } from "../../background/sessionFinalize.js";
import { createSessionManager } from "../../background/sessionManager.js";
import {
  ACTIVE_CONTEXT_STATUSES,
  RESPONSE_ERROR_CODES,
  SCHEMA_VERSION,
  REENCOUNTER_FEEDBACK_OUTCOMES,
  createActiveContextQueryMessage,
  createMissedPathDeleteMessage,
  createCandidatesDiscoveredMessage,
  createDataDeleteAllMessage,
  createMissedPathsQueryMessage,
  createReencounterQueryMessage,
  createReencounterFeedbackMessage,
  createReencounterShownMessage,
  createSessionFinalizeMessage,
  createSettingsUpdateMessage,
  createSignalsUpdatedMessage,
  isActiveContextQueryResponse,
  isCandidatesDiscoveredResponse,
  isDataDeleteAllResponse,
  isMissedPathsQueryResponse,
  isMissedPathDeleteResponse,
  isReencounterQueryResponse,
  isReencounterFeedbackResponse,
  isReencounterShownResponse,
  isSessionFinalizeResponse,
  isSettingsUpdateResponse,
  isSignalsUpdatedResponse
} from "../../shared/messages.js";
import { DEFAULT_SETTINGS_V1 } from "../../shared/types.js";
import { createRepository } from "../../storage/repository.js";
import { createTransactionalMemoryStorageAdapter } from "../storage/fixtures/memoryStorageAdapter.js";

function createMissedPath() {
  return {
    id: "missed-1",
    candidate: {
      id: "candidate-1",
      url: "https://example.com/result",
      title: "Example result",
      source: "local-demo",
      rank: 1,
      sessionId: "session-1"
    },
    context: {
      query: "robot navigation",
      source: "local-demo",
      timestamp: 100,
      keywords: ["robot", "navigation"]
    },
    score: 0.7,
    reasons: [
      {
        code: "LONG_EXPOSURE",
        label: "较长的累计可见时间表明你曾认真考虑该结果。",
        contribution: 0.3
      },
      {
        code: "NOT_CLICKED",
        label: "你在本次搜索中最终没有选择该结果。",
        contribution: 0
      }
    ],
    status: "MISSED",
    createdAt: 500
  };
}

function createCurrentContext() {
  return {
    query: "robot navigation",
    source: "local-demo",
    timestamp: 10_000_000_000,
    keywords: ["robot", "navigation"]
  };
}

function createDiscoveryContext(timestamp = 100) {
  return {
    query: "robot navigation",
    source: "local-demo",
    timestamp,
    keywords: ["robot", "navigation"]
  };
}

function createDiscoveryCandidate(overrides = {}) {
  return {
    id: "candidate-1",
    url: "https://example.com/result",
    title: "Example result",
    source: "local-demo",
    rank: 1,
    sessionId: "session-1",
    ...overrides
  };
}

function createUpdateSignals(overrides = {}) {
  return {
    candidateId: "candidate-1",
    sessionId: "session-1",
    visibleMs: 1_000,
    hoverMs: 200,
    hoverCount: 2,
    returnCount: 1,
    clicked: false,
    ...overrides
  };
}

function createFinalizeEntry(id, rank, signalOverrides = {}) {
  return {
    candidate: createDiscoveryCandidate({
      id,
      url: `https://example.com/${id}`,
      title: `Result ${id}`,
      rank
    }),
    signals: createUpdateSignals({
      candidateId: id,
      visibleMs: 0,
      hoverMs: 0,
      hoverCount: 0,
      returnCount: 0,
      clicked: false,
      ...signalOverrides
    })
  };
}

function createFinalizeSession(candidates) {
  return {
    sessionId: "session-1",
    context: createDiscoveryContext(),
    candidates,
    updatedAt: 200
  };
}

function createFinalizeRouter(repository) {
  return createMessageRouter(repository, {
    sessionFinalizeUseCase: createSessionFinalizeUseCase(
      createSessionManager(repository)
    )
  });
}

test("routes CANDIDATES_DISCOVERED and persists an idempotent Session", async () => {
  const repository = createRepository(
    createTransactionalMemoryStorageAdapter()
  );
  const router = createMessageRouter(repository);
  const request = createCandidatesDiscoveredMessage(
    "session-1",
    createDiscoveryContext(),
    [createDiscoveryCandidate()],
    200,
    "request-discovery-success"
  );

  const first = await router.route(request);
  assert.equal(isCandidatesDiscoveredResponse(first), true);
  assert.deepEqual(first, {
    schemaVersion: SCHEMA_VERSION,
    requestId: request.requestId,
    ok: true,
    data: {
      sessionId: "session-1",
      acceptedCandidateIds: ["candidate-1"],
      totalCandidateCount: 1,
      updatedAt: 200
    }
  });

  const repeated = await router.route(request);
  assert.deepEqual(repeated.data, {
    sessionId: "session-1",
    acceptedCandidateIds: [],
    totalCandidateCount: 1,
    updatedAt: 200
  });
  assert.equal((await repository.getSession("session-1")).candidates.length, 1);
});

test("rejects invalid discovery payload and version before persistence", async () => {
  let executionCount = 0;
  const router = createMessageRouter(
    { async listMissedPaths() { return []; } },
    {
      candidateDiscoveryUseCase: {
        async execute() {
          executionCount += 1;
          return {};
        }
      }
    }
  );
  const valid = createCandidatesDiscoveredMessage(
    "session-1",
    createDiscoveryContext(),
    [createDiscoveryCandidate()],
    200,
    "request-discovery-validation"
  );

  const invalidPayload = await router.route({
    ...valid,
    payload: { ...valid.payload, candidates: [] }
  });
  assert.equal(executionCount, 0);
  assert.deepEqual(invalidPayload.error, {
    code: RESPONSE_ERROR_CODES.INVALID_REQUEST,
    message: "Invalid CANDIDATES_DISCOVERED payload.",
    retryable: false
  });

  const invalidVersion = await router.route({
    ...valid,
    schemaVersion: SCHEMA_VERSION + 1
  });
  assert.equal(executionCount, 0);
  assert.equal(
    invalidVersion.error.code,
    RESPONSE_ERROR_CODES.SCHEMA_VERSION_UNSUPPORTED
  );
  assert.equal(invalidVersion.requestId, valid.requestId);
});

test("maps Candidate discovery conflicts to a non-retryable response", async () => {
  const repository = createRepository(
    createTransactionalMemoryStorageAdapter()
  );
  const router = createMessageRouter(repository);
  await router.route(
    createCandidatesDiscoveredMessage(
      "session-1",
      createDiscoveryContext(),
      [createDiscoveryCandidate()],
      200,
      "request-discovery-first"
    )
  );

  const response = await router.route(
    createCandidatesDiscoveredMessage(
      "session-1",
      createDiscoveryContext(101),
      [createDiscoveryCandidate()],
      300,
      "request-discovery-conflict"
    )
  );

  assert.equal(response.requestId, "request-discovery-conflict");
  assert.equal(response.ok, false);
  assert.equal(
    response.error.code,
    RESPONSE_ERROR_CODES.CANDIDATE_DISCOVERY_CONFLICT
  );
  assert.equal(response.error.retryable, false);
});

test("maps Candidate discovery storage failures to a retryable response", async () => {
  const router = createMessageRouter({
    async listMissedPaths() {
      return [];
    },
    async mergeDiscoveredCandidates() {
      throw new Error("simulated storage failure");
    }
  });
  const request = createCandidatesDiscoveredMessage(
    "session-1",
    createDiscoveryContext(),
    [createDiscoveryCandidate()],
    200,
    "request-discovery-storage"
  );

  const response = await router.route(request);

  assert.equal(response.requestId, request.requestId);
  assert.deepEqual(response.error, {
    code: RESPONSE_ERROR_CODES.STORAGE_ERROR,
    message: "Unable to persist discovered Candidates.",
    retryable: true
  });
});

test("routes SIGNALS_UPDATED as an idempotent absolute snapshot", async () => {
  const repository = createRepository(
    createTransactionalMemoryStorageAdapter()
  );
  await repository.mergeDiscoveredCandidates({
    sessionId: "session-1",
    context: createDiscoveryContext(),
    candidates: [createDiscoveryCandidate()],
    discoveredAt: 200
  });
  const router = createMessageRouter(repository);
  const request = createSignalsUpdatedMessage(
    createUpdateSignals(),
    250,
    "request-signals-success"
  );

  const first = await router.route(request);
  assert.equal(isSignalsUpdatedResponse(first), true);
  assert.deepEqual(first, {
    schemaVersion: SCHEMA_VERSION,
    requestId: request.requestId,
    ok: true,
    data: {
      sessionId: "session-1",
      candidateId: "candidate-1",
      updatedAt: 250,
      changed: true
    }
  });

  const repeated = await router.route(request);
  assert.deepEqual(repeated.data, {
    sessionId: "session-1",
    candidateId: "candidate-1",
    updatedAt: 250,
    changed: false
  });
  assert.deepEqual(
    (await repository.getSession("session-1")).candidates[0].signals,
    createUpdateSignals()
  );
});

test("rejects invalid SIGNALS_UPDATED payload and version before execution", async () => {
  let executionCount = 0;
  const router = createMessageRouter(
    { async listMissedPaths() { return []; } },
    {
      signalsUpdateUseCase: {
        async execute() {
          executionCount += 1;
          return {};
        }
      }
    }
  );
  const valid = createSignalsUpdatedMessage(
    createUpdateSignals(),
    250,
    "request-signals-validation"
  );

  const invalidPayload = await router.route({
    ...valid,
    payload: {
      ...valid.payload,
      signals: { ...valid.payload.signals, visibleMs: -1 }
    }
  });
  assert.equal(executionCount, 0);
  assert.deepEqual(invalidPayload.error, {
    code: RESPONSE_ERROR_CODES.INVALID_REQUEST,
    message: "Invalid SIGNALS_UPDATED payload.",
    retryable: false
  });

  const invalidVersion = await router.route({
    ...valid,
    schemaVersion: SCHEMA_VERSION + 1
  });
  assert.equal(executionCount, 0);
  assert.equal(
    invalidVersion.error.code,
    RESPONSE_ERROR_CODES.SCHEMA_VERSION_UNSUPPORTED
  );
  assert.equal(invalidVersion.requestId, valid.requestId);
});

test("maps signals target conflicts and storage failures", async () => {
  const repository = createRepository(
    createTransactionalMemoryStorageAdapter()
  );
  const conflictRouter = createMessageRouter(repository);
  const request = createSignalsUpdatedMessage(
    createUpdateSignals(),
    250,
    "request-signals-conflict"
  );

  const conflict = await conflictRouter.route(request);
  assert.equal(conflict.requestId, request.requestId);
  assert.deepEqual(conflict.error, {
    code: RESPONSE_ERROR_CODES.SIGNALS_UPDATE_CONFLICT,
    message: "Session not found: session-1",
    retryable: false
  });

  const storageRouter = createMessageRouter({
    async listMissedPaths() {
      return [];
    },
    async mergeCandidateSignalsSnapshot() {
      throw new Error("simulated storage failure");
    }
  });
  const storage = await storageRouter.route({
    ...request,
    requestId: "request-signals-storage"
  });
  assert.deepEqual(storage.error, {
    code: RESPONSE_ERROR_CODES.STORAGE_ERROR,
    message: "Unable to persist Candidate signals.",
    retryable: true
  });
  assert.equal(storage.requestId, "request-signals-storage");
});

test("rejects SIGNALS_UPDATED for a finalized Session", async () => {
  const repository = createRepository(
    createTransactionalMemoryStorageAdapter()
  );
  await repository.mergeDiscoveredCandidates({
    sessionId: "session-1",
    context: createDiscoveryContext(),
    candidates: [createDiscoveryCandidate()],
    discoveredAt: 200
  });
  await repository.finalizeSessionAtomically({
    sessionId: "session-1",
    finalizedAt: 300,
    chosen: [],
    missedPaths: []
  });
  const router = createMessageRouter(repository);
  const request = createSignalsUpdatedMessage(
    createUpdateSignals({
      visibleMs: 0,
      hoverMs: 0,
      hoverCount: 0,
      returnCount: 0
    }),
    350,
    "request-signals-finalized"
  );

  const response = await router.route(request);

  assert.equal(response.requestId, request.requestId);
  assert.equal(response.ok, false);
  assert.equal(
    response.error.code,
    RESPONSE_ERROR_CODES.SIGNALS_UPDATE_CONFLICT
  );
  assert.equal(response.error.retryable, false);
  assert.match(response.error.message, /Cannot update finalized session/u);
});

test("routes SESSION_FINALIZE and preserves clicked/threshold semantics", async () => {
  const repository = createRepository(
    createTransactionalMemoryStorageAdapter()
  );
  await repository.saveSession(
    createFinalizeSession([
      createFinalizeEntry("clicked", 1, {
        visibleMs: 10_000,
        returnCount: 2,
        clicked: true
      }),
      createFinalizeEntry("at-threshold", 2, {
        visibleMs: 10_000,
        returnCount: 2
      }),
      createFinalizeEntry("below-threshold", 3, {
        visibleMs: 9_999,
        returnCount: 2
      })
    ])
  );
  const router = createFinalizeRouter(repository);
  const request = createSessionFinalizeMessage(
    "session-1",
    500,
    "request-finalize-success"
  );

  const first = await router.route(request);
  assert.equal(isSessionFinalizeResponse(first), true);
  assert.equal(first.requestId, request.requestId);
  assert.equal(first.ok, true);
  assert.equal(first.data.sessionId, "session-1");
  assert.equal(first.data.finalizedAt, 500);
  assert.equal(first.data.alreadyFinalized, false);
  assert.deepEqual(
    first.data.chosen.map((record) => record.candidate.id),
    ["clicked"]
  );
  assert.deepEqual(
    first.data.missedPaths.map((record) => record.candidate.id),
    ["at-threshold"]
  );
  assert.equal(first.data.missedPaths[0].status, "MISSED");

  const repeated = await router.route(
    createSessionFinalizeMessage(
      "session-1",
      900,
      "request-finalize-repeat"
    )
  );
  assert.equal(repeated.requestId, "request-finalize-repeat");
  assert.equal(repeated.data.alreadyFinalized, true);
  assert.equal(repeated.data.finalizedAt, 500);
  assert.deepEqual(repeated.data.chosen, first.data.chosen);
  assert.deepEqual(repeated.data.missedPaths, first.data.missedPaths);
  assert.equal((await repository.listChosen()).length, 1);
  assert.equal((await repository.listMissedPaths()).length, 1);
});

test("SESSION_FINALIZE safely settles an empty Session", async () => {
  const repository = createRepository(
    createTransactionalMemoryStorageAdapter()
  );
  await repository.saveSession(createFinalizeSession([]));
  const response = await createFinalizeRouter(repository).route(
    createSessionFinalizeMessage(
      "session-1",
      500,
      "request-finalize-empty"
    )
  );

  assert.deepEqual(response.data, {
    sessionId: "session-1",
    finalizedAt: 500,
    alreadyFinalized: false,
    chosen: [],
    missedPaths: []
  });
  assert.deepEqual(
    await repository.getSessionFinalization("session-1"),
    {
      sessionId: "session-1",
      finalizedAt: 500,
      chosenIds: [],
      missedPathIds: []
    }
  );
});

test("rejects invalid SESSION_FINALIZE payload/version before execution", async () => {
  let executionCount = 0;
  const router = createMessageRouter(
    { async listMissedPaths() { return []; } },
    {
      sessionFinalizeUseCase: {
        async execute() {
          executionCount += 1;
          return {};
        }
      }
    }
  );
  const valid = createSessionFinalizeMessage(
    "session-1",
    500,
    "request-finalize-validation"
  );

  const invalidPayload = await router.route({
    ...valid,
    payload: { sessionId: "session-1", finalizedAt: -1 }
  });
  assert.equal(executionCount, 0);
  assert.deepEqual(invalidPayload.error, {
    code: RESPONSE_ERROR_CODES.INVALID_REQUEST,
    message: "Invalid SESSION_FINALIZE payload.",
    retryable: false
  });

  const invalidVersion = await router.route({
    ...valid,
    schemaVersion: SCHEMA_VERSION + 1
  });
  assert.equal(executionCount, 0);
  assert.equal(
    invalidVersion.error.code,
    RESPONSE_ERROR_CODES.SCHEMA_VERSION_UNSUPPORTED
  );
  assert.equal(invalidVersion.requestId, valid.requestId);
});

test("maps missing Session and atomic finalization failure responses", async () => {
  const missingRepository = createRepository(
    createTransactionalMemoryStorageAdapter()
  );
  const missingRequest = createSessionFinalizeMessage(
    "session-1",
    500,
    "request-finalize-missing"
  );
  const missing = await createFinalizeRouter(missingRepository).route(
    missingRequest
  );
  assert.equal(missing.requestId, missingRequest.requestId);
  assert.deepEqual(missing.error, {
    code: RESPONSE_ERROR_CODES.SESSION_NOT_FOUND,
    message: "Session not found: session-1",
    retryable: false
  });

  const adapter = createTransactionalMemoryStorageAdapter();
  const repository = createRepository(adapter);
  await repository.saveSession(
    createFinalizeSession([
      createFinalizeEntry("missed", 1, {
        visibleMs: 10_000,
        hoverMs: 3_000
      })
    ])
  );
  adapter.failNextCommit(new Error("simulated atomic finalization failure"));
  const failed = await createFinalizeRouter(repository).route(
    createSessionFinalizeMessage(
      "session-1",
      500,
      "request-finalize-storage"
    )
  );
  assert.equal(failed.requestId, "request-finalize-storage");
  assert.deepEqual(failed.error, {
    code: RESPONSE_ERROR_CODES.STORAGE_ERROR,
    message: "Unable to finalize Session.",
    retryable: true
  });
  assert.deepEqual(await repository.listChosen(), []);
  assert.deepEqual(await repository.listMissedPaths(), []);
  assert.equal(await repository.getSessionFinalization("session-1"), null);
});

test("routes ACTIVE_CONTEXT_QUERY for unavailable and available contexts", async () => {
  const repository = createRepository(
    createTransactionalMemoryStorageAdapter()
  );
  const router = createMessageRouter(repository);
  const unavailableRequest = createActiveContextQueryMessage(
    "request-active-unavailable"
  );

  const unavailable = await router.route(unavailableRequest);
  assert.equal(isActiveContextQueryResponse(unavailable), true);
  assert.deepEqual(unavailable, {
    schemaVersion: SCHEMA_VERSION,
    requestId: unavailableRequest.requestId,
    ok: true,
    data: {
      status: ACTIVE_CONTEXT_STATUSES.UNAVAILABLE,
      context: null
    }
  });

  await repository.mergeDiscoveredCandidates({
    sessionId: "session-1",
    context: createDiscoveryContext(),
    candidates: [createDiscoveryCandidate()],
    discoveredAt: 200
  });
  const availableRequest = createActiveContextQueryMessage(
    "request-active-available"
  );
  const available = await router.route(availableRequest);

  assert.equal(isActiveContextQueryResponse(available), true);
  assert.deepEqual(available, {
    schemaVersion: SCHEMA_VERSION,
    requestId: availableRequest.requestId,
    ok: true,
    data: {
      status: ACTIVE_CONTEXT_STATUSES.AVAILABLE,
      context: createDiscoveryContext()
    }
  });
  assert.deepEqual(await router.route(availableRequest), available);
});

test("rejects invalid ACTIVE_CONTEXT_QUERY payload and version before execution", async () => {
  let executionCount = 0;
  const router = createMessageRouter(
    { async listMissedPaths() { return []; } },
    {
      activeContextQueryUseCase: {
        async execute() {
          executionCount += 1;
          return {
            status: ACTIVE_CONTEXT_STATUSES.UNAVAILABLE,
            context: null
          };
        }
      }
    }
  );
  const request = createActiveContextQueryMessage("request-active-invalid");

  const invalidPayload = await router.route({
    ...request,
    payload: { query: "must-not-be-read" }
  });
  assert.equal(executionCount, 0);
  assert.deepEqual(invalidPayload.error, {
    code: RESPONSE_ERROR_CODES.INVALID_REQUEST,
    message: "Invalid ACTIVE_CONTEXT_QUERY payload.",
    retryable: false
  });

  const invalidVersion = await router.route({
    ...request,
    schemaVersion: SCHEMA_VERSION + 1
  });
  assert.equal(executionCount, 0);
  assert.equal(
    invalidVersion.error.code,
    RESPONSE_ERROR_CODES.SCHEMA_VERSION_UNSUPPORTED
  );
  assert.equal(invalidVersion.requestId, request.requestId);
});

test("maps ACTIVE_CONTEXT_QUERY storage failure and echoes requestId", async () => {
  const router = createMessageRouter({
    async listMissedPaths() {
      return [];
    },
    async getActiveContext() {
      throw new Error("simulated storage failure");
    }
  });
  const request = createActiveContextQueryMessage("request-active-storage");

  const response = await router.route(request);

  assert.equal(response.requestId, request.requestId);
  assert.deepEqual(response.error, {
    code: RESPONSE_ERROR_CODES.STORAGE_ERROR,
    message: "Unable to query the current SearchContext.",
    retryable: true
  });
});

test("returns persisted Missed Paths in a shared success response", async () => {
  const repository = createRepository(
    createTransactionalMemoryStorageAdapter()
  );
  const missedPath = createMissedPath();
  await repository.saveMissedPath(missedPath);
  const router = createMessageRouter(repository);
  const request = createMissedPathsQueryMessage("request-success");

  const response = await router.route(request);

  assert.equal(isMissedPathsQueryResponse(response), true);
  assert.deepEqual(response, {
    schemaVersion: SCHEMA_VERSION,
    requestId: "request-success",
    ok: true,
    data: { missedPaths: [missedPath] }
  });
});

test("returns a successful empty list when Repository has no Missed Paths", async () => {
  const repository = createRepository(
    createTransactionalMemoryStorageAdapter()
  );
  const router = createMessageRouter(repository);

  const response = await router.route(
    createMissedPathsQueryMessage("request-empty")
  );

  assert.deepEqual(response, {
    schemaVersion: SCHEMA_VERSION,
    requestId: "request-empty",
    ok: true,
    data: { missedPaths: [] }
  });
});

test("rejects an unknown schemaVersion before reading storage", async () => {
  let queryCount = 0;
  const router = createMessageRouter({
    async listMissedPaths() {
      queryCount += 1;
      return [];
    }
  });
  const request = {
    ...createMissedPathsQueryMessage("request-version"),
    schemaVersion: SCHEMA_VERSION + 1
  };

  const response = await router.route(request);

  assert.equal(queryCount, 0);
  assert.deepEqual(response, {
    schemaVersion: SCHEMA_VERSION,
    requestId: "request-version",
    ok: false,
    error: {
      code: RESPONSE_ERROR_CODES.SCHEMA_VERSION_UNSUPPORTED,
      message: `Unsupported schemaVersion: ${SCHEMA_VERSION + 1}.`,
      retryable: false
    }
  });
});

test("rejects a non-empty query payload before reading storage", async () => {
  let queryCount = 0;
  const router = createMessageRouter({
    async listMissedPaths() {
      queryCount += 1;
      return [];
    }
  });
  const request = {
    ...createMissedPathsQueryMessage("request-payload"),
    payload: { limit: 10 }
  };

  const response = await router.route(request);

  assert.equal(queryCount, 0);
  assert.deepEqual(response, {
    schemaVersion: SCHEMA_VERSION,
    requestId: "request-payload",
    ok: false,
    error: {
      code: RESPONSE_ERROR_CODES.INVALID_REQUEST,
      message: "Invalid MISSED_PATHS_QUERY payload.",
      retryable: false
    }
  });
});

test("converts storage failures into retryable shared error responses", async () => {
  const router = createMessageRouter({
    async listMissedPaths() {
      throw new Error("simulated storage failure");
    }
  });
  const request = createMissedPathsQueryMessage("request-storage");

  const response = await router.route(request);

  assert.deepEqual(response, {
    schemaVersion: SCHEMA_VERSION,
    requestId: "request-storage",
    ok: false,
    error: {
      code: RESPONSE_ERROR_CODES.STORAGE_ERROR,
      message: "Unable to query local Missed Paths.",
      retryable: true
    }
  });
});

test("echoes requestId and rejects requests that cannot be correlated", async () => {
  const router = createMessageRouter({
    async listMissedPaths() {
      return [];
    }
  });
  const request = createMissedPathsQueryMessage("request-correlation");

  const response = await router.route(request);

  assert.equal(response.requestId, request.requestId);
  assert.equal(await router.route({ ...request, requestId: "" }), null);
});

test("routes RE_ENCOUNTER_QUERY success and echoes requestId", async () => {
  const ranked = [{ missedPath: createMissedPath(), score: 0.7, reasons: [] }];
  const router = createMessageRouter(
    { async listMissedPaths() { return []; } },
    {
      reencounterQueryUseCase: {
        async execute() {
          return ranked;
        }
      }
    }
  );
  const request = createReencounterQueryMessage(
    createCurrentContext(),
    3,
    "request-reencounter-success"
  );

  const response = await router.route(request);

  assert.equal(isReencounterQueryResponse(response), true);
  assert.deepEqual(response, {
    schemaVersion: SCHEMA_VERSION,
    requestId: request.requestId,
    ok: true,
    data: { reencounters: ranked }
  });
});

test("rejects illegal RE_ENCOUNTER_QUERY payload before use-case execution", async () => {
  let executionCount = 0;
  const router = createMessageRouter(
    { async listMissedPaths() { return []; } },
    {
      reencounterQueryUseCase: {
        async execute() {
          executionCount += 1;
          return [];
        }
      }
    }
  );
  const request = {
    ...createReencounterQueryMessage(
      createCurrentContext(),
      3,
      "request-reencounter-payload"
    ),
    payload: { context: createCurrentContext(), limit: 4 }
  };

  const response = await router.route(request);

  assert.equal(executionCount, 0);
  assert.deepEqual(response.error, {
    code: RESPONSE_ERROR_CODES.INVALID_REQUEST,
    message: "Invalid RE_ENCOUNTER_QUERY payload.",
    retryable: false
  });
  assert.equal(response.requestId, request.requestId);
});

test("rejects unknown RE_ENCOUNTER_QUERY schemaVersion before execution", async () => {
  let executionCount = 0;
  const router = createMessageRouter(
    { async listMissedPaths() { return []; } },
    {
      reencounterQueryUseCase: {
        async execute() {
          executionCount += 1;
          return [];
        }
      }
    }
  );
  const request = {
    ...createReencounterQueryMessage(
      createCurrentContext(),
      3,
      "request-reencounter-version"
    ),
    schemaVersion: SCHEMA_VERSION + 1
  };

  const response = await router.route(request);

  assert.equal(executionCount, 0);
  assert.equal(
    response.error.code,
    RESPONSE_ERROR_CODES.SCHEMA_VERSION_UNSUPPORTED
  );
  assert.equal(response.requestId, request.requestId);
});

test("maps Re-encounter business failures to a shared error response", async () => {
  const router = createMessageRouter(
    { async listMissedPaths() { return []; } },
    {
      reencounterQueryUseCase: {
        async execute() {
          throw new ReencounterQueryError(
            RESPONSE_ERROR_CODES.REENCOUNTER_QUERY_FAILED,
            "Unable to rank Re-encounter candidates.",
            false
          );
        }
      }
    }
  );
  const request = createReencounterQueryMessage(
    createCurrentContext(),
    3,
    "request-reencounter-business"
  );

  const response = await router.route(request);

  assert.deepEqual(response, {
    schemaVersion: SCHEMA_VERSION,
    requestId: request.requestId,
    ok: false,
    error: {
      code: RESPONSE_ERROR_CODES.REENCOUNTER_QUERY_FAILED,
      message: "Unable to rank Re-encounter candidates.",
      retryable: false
    }
  });
});

test("maps Re-encounter storage failures to retryable shared errors", async () => {
  const router = createMessageRouter({
    async listMissedPaths() {
      return [];
    },
    async listReencounters() {
      throw new Error("simulated storage failure");
    }
  });
  const request = createReencounterQueryMessage(
    createCurrentContext(),
    3,
    "request-reencounter-storage"
  );

  const response = await router.route(request);

  assert.equal(response.requestId, request.requestId);
  assert.deepEqual(response.error, {
    code: RESPONSE_ERROR_CODES.STORAGE_ERROR,
    message: "Unable to query local Re-encounter data.",
    retryable: true
  });
});

test("repeated RE_ENCOUNTER_QUERY requests remain idempotent", async () => {
  let executionCount = 0;
  const router = createMessageRouter(
    { async listMissedPaths() { return []; } },
    {
      reencounterQueryUseCase: {
        async execute() {
          executionCount += 1;
          return [];
        }
      }
    }
  );
  const request = createReencounterQueryMessage(
    createCurrentContext(),
    3,
    "request-reencounter-repeat"
  );

  const first = await router.route(request);
  const second = await router.route(request);

  assert.deepEqual(second, first);
  assert.equal(executionCount, 2);
  assert.equal(first.requestId, request.requestId);
});

function createShownRequest(requestId = "request-shown") {
  return createReencounterShownMessage(
    {
      missedPath: createMissedPath(),
      score: 0.7,
      reasons: [
        {
          code: "CONTEXT_MATCH",
          label: "Context matched.",
          contribution: 0.4
        }
      ]
    },
    createCurrentContext(),
    10_000_000_100,
    requestId
  );
}

test("routes first and repeated RE_ENCOUNTER_SHOWN idempotently", async () => {
  const repository = createRepository(
    createTransactionalMemoryStorageAdapter()
  );
  await repository.saveMissedPath(createMissedPath());
  await repository.mergeDiscoveredCandidates({
    sessionId: "session-1",
    context: createCurrentContext(),
    candidates: [createDiscoveryCandidate()],
    discoveredAt: 10_000_000_000
  });
  const router = createMessageRouter(repository);
  const request = createShownRequest("request-shown-repeat");

  const first = await router.route(request);
  const second = await router.route(request);

  assert.equal(isReencounterShownResponse(first), true);
  assert.equal(first.requestId, request.requestId);
  assert.equal(first.data.created, true);
  assert.equal(second.data.created, false);
  assert.equal((await repository.listReencounters()).length, 1);
});

test("RE_ENCOUNTER_SHOWN rejects invalid payload and unknown version", async () => {
  let executionCount = 0;
  const router = createMessageRouter(
    { async listMissedPaths() { return []; } },
    {
      reencounterShownUseCase: {
        async execute() {
          executionCount += 1;
          return {};
        }
      }
    }
  );
  const request = createShownRequest("request-shown-invalid");
  const invalid = await router.route({
    ...request,
    payload: { ...request.payload, shownAt: -1 }
  });
  const unknownVersion = await router.route({
    ...request,
    schemaVersion: SCHEMA_VERSION + 1
  });

  assert.equal(executionCount, 0);
  assert.equal(invalid.error.code, RESPONSE_ERROR_CODES.INVALID_REQUEST);
  assert.equal(invalid.requestId, request.requestId);
  assert.equal(
    unknownVersion.error.code,
    RESPONSE_ERROR_CODES.SCHEMA_VERSION_UNSUPPORTED
  );
});

test("RE_ENCOUNTER_SHOWN returns explicit unknown Missed Path error", async () => {
  const repository = createRepository(
    createTransactionalMemoryStorageAdapter()
  );
  const router = createMessageRouter(repository);
  const request = createShownRequest("request-shown-unknown");

  const response = await router.route(request);

  assert.equal(response.requestId, request.requestId);
  assert.deepEqual(response.error, {
    code: RESPONSE_ERROR_CODES.MISSED_PATH_NOT_FOUND,
    message: "Missed Path not found: missed-1",
    retryable: false
  });
});

test("RE_ENCOUNTER_SHOWN rejects a late card from a stale context", async () => {
  const repository = createRepository(
    createTransactionalMemoryStorageAdapter()
  );
  await repository.saveMissedPath(createMissedPath());
  await repository.mergeDiscoveredCandidates({
    sessionId: "session-1",
    context: createCurrentContext(),
    candidates: [createDiscoveryCandidate()],
    discoveredAt: 10_000_000_000
  });
  const router = createMessageRouter(repository);
  const request = createReencounterShownMessage(
    {
      missedPath: createMissedPath(),
      score: 0.7,
      reasons: []
    },
    { ...createCurrentContext(), timestamp: 9_000 },
    10_000_000_100,
    "request-shown-stale"
  );

  const response = await router.route(request);

  assert.equal(response.requestId, request.requestId);
  assert.equal(
    response.error.code,
    RESPONSE_ERROR_CODES.REENCOUNTER_SHOWN_STALE
  );
  assert.equal((await repository.listReencounters()).length, 0);
});

test("RE_ENCOUNTER_SHOWN maps storage failure and echoes requestId", async () => {
  const router = createMessageRouter(
    { async listMissedPaths() { return []; } },
    {
      reencounterShownUseCase: {
        async execute() {
          throw new ReencounterShownError(
            RESPONSE_ERROR_CODES.STORAGE_ERROR,
            "Unable to persist shown.",
            true
          );
        }
      }
    }
  );
  const request = createShownRequest("request-shown-storage");

  const response = await router.route(request);

  assert.equal(response.requestId, request.requestId);
  assert.deepEqual(response.error, {
    code: RESPONSE_ERROR_CODES.STORAGE_ERROR,
    message: "Unable to persist shown.",
    retryable: true
  });
});

test("routes repeated RE_ENCOUNTER_FEEDBACK idempotently and rejects conflicts", async () => {
  const repository = createRepository(
    createTransactionalMemoryStorageAdapter()
  );
  const shown = createShownRequest("request-feedback-shown").payload;
  await repository.saveReencounter(shown);
  const router = createMessageRouter(repository);
  const request = createReencounterFeedbackMessage(
    shown.id,
    REENCOUNTER_FEEDBACK_OUTCOMES.LATER,
    10_000_000_200,
    "request-feedback-repeat"
  );

  const first = await router.route(request);
  const second = await router.route({
    ...request,
    requestId: "request-feedback-repeat-2",
    payload: { ...request.payload, feedbackAt: 10_000_000_300 }
  });
  const conflict = await router.route(
    createReencounterFeedbackMessage(
      shown.id,
      REENCOUNTER_FEEDBACK_OUTCOMES.NOT_RELEVANT,
      10_000_000_400,
      "request-feedback-conflict"
    )
  );

  assert.equal(isReencounterFeedbackResponse(first), true);
  assert.equal(first.requestId, request.requestId);
  assert.equal(first.data.updated, true);
  assert.deepEqual(second.data, { ...first.data, updated: false });
  assert.equal(
    conflict.error.code,
    RESPONSE_ERROR_CODES.REENCOUNTER_FEEDBACK_CONFLICT
  );
  assert.deepEqual(await repository.getReencounter(shown.id), {
    ...shown,
    outcome: REENCOUNTER_FEEDBACK_OUTCOMES.LATER,
    feedbackAt: 10_000_000_200
  });
});

test("RE_ENCOUNTER_FEEDBACK rejects invalid payload/version and unknown records", async () => {
  let executionCount = 0;
  const router = createMessageRouter(
    { async listMissedPaths() { return []; } },
    {
      reencounterFeedbackUseCase: {
        async execute() {
          executionCount += 1;
          return {};
        }
      }
    }
  );
  const request = createReencounterFeedbackMessage(
    "shown-missing",
    REENCOUNTER_FEEDBACK_OUTCOMES.OPENED,
    500,
    "request-feedback-invalid"
  );
  const invalid = await router.route({
    ...request,
    payload: { ...request.payload, outcome: "DISMISSED" }
  });
  const unknownVersion = await router.route({
    ...request,
    schemaVersion: SCHEMA_VERSION + 1
  });
  assert.equal(executionCount, 0);
  assert.equal(invalid.error.code, RESPONSE_ERROR_CODES.INVALID_REQUEST);
  assert.equal(
    unknownVersion.error.code,
    RESPONSE_ERROR_CODES.SCHEMA_VERSION_UNSUPPORTED
  );

  const repository = createRepository(
    createTransactionalMemoryStorageAdapter()
  );
  const unknown = await createMessageRouter(repository).route(request);
  assert.equal(unknown.requestId, request.requestId);
  assert.equal(
    unknown.error.code,
    RESPONSE_ERROR_CODES.REENCOUNTER_NOT_FOUND
  );
});

test("RE_ENCOUNTER_FEEDBACK maps storage failure and echoes requestId", async () => {
  const router = createMessageRouter(
    { async listMissedPaths() { return []; } },
    {
      reencounterFeedbackUseCase: {
        async execute() {
          throw new ReencounterFeedbackError(
            RESPONSE_ERROR_CODES.STORAGE_ERROR,
            "Unable to persist feedback.",
            true
          );
        }
      }
    }
  );
  const request = createReencounterFeedbackMessage(
    "shown-1",
    REENCOUNTER_FEEDBACK_OUTCOMES.OPENED,
    500,
    "request-feedback-storage"
  );
  const response = await router.route(request);

  assert.equal(response.requestId, request.requestId);
  assert.deepEqual(response.error, {
    code: RESPONSE_ERROR_CODES.STORAGE_ERROR,
    message: "Unable to persist feedback.",
    retryable: true
  });
});

test("routes MISSED_PATH_DELETE and removes linked Re-encounters idempotently", async () => {
  const repository = createRepository(
    createTransactionalMemoryStorageAdapter()
  );
  await repository.saveMissedPath(createMissedPath());
  await repository.saveReencounter(createShownRequest("shown-for-delete").payload);
  const router = createMessageRouter(repository);
  const firstRequest = createMissedPathDeleteMessage(
    "missed-1",
    700,
    "request-delete-first"
  );
  const repeatedRequest = createMissedPathDeleteMessage(
    "missed-1",
    800,
    "request-delete-repeated"
  );

  const first = await router.route(firstRequest);
  const repeated = await router.route(repeatedRequest);
  assert.equal(isMissedPathDeleteResponse(first), true);
  assert.deepEqual(first.data, { missedPathId: "missed-1", deleted: true });
  assert.deepEqual(repeated.data, {
    missedPathId: "missed-1",
    deleted: false
  });
  assert.deepEqual(await repository.listMissedPaths(), []);
  assert.deepEqual(await repository.listReencounters(), []);
});

test("MISSED_PATH_DELETE rejects invalid payload/version and maps storage failure", async () => {
  let executionCount = 0;
  const router = createMessageRouter(
    { async listMissedPaths() { return []; } },
    {
      missedPathDeleteUseCase: {
        async execute() {
          executionCount += 1;
          throw new MissedPathDeleteError(
            RESPONSE_ERROR_CODES.STORAGE_ERROR,
            "Unable to delete.",
            true
          );
        }
      }
    }
  );
  const request = createMissedPathDeleteMessage(
    "missed-1",
    700,
    "request-delete-invalid"
  );
  const invalid = await router.route({
    ...request,
    payload: { ...request.payload, requestedAt: -1 }
  });
  const unknownVersion = await router.route({
    ...request,
    schemaVersion: SCHEMA_VERSION + 1
  });
  const storage = await router.route(request);

  assert.equal(executionCount, 1);
  assert.equal(invalid.error.code, RESPONSE_ERROR_CODES.INVALID_REQUEST);
  assert.equal(
    unknownVersion.error.code,
    RESPONSE_ERROR_CODES.SCHEMA_VERSION_UNSUPPORTED
  );
  assert.equal(storage.requestId, request.requestId);
  assert.deepEqual(storage.error, {
    code: RESPONSE_ERROR_CODES.STORAGE_ERROR,
    message: "Unable to delete.",
    retryable: true
  });
});

test("routes SETTINGS_UPDATE while preserving complete Settings idempotently", async () => {
  const repository = createRepository(
    createTransactionalMemoryStorageAdapter()
  );
  const custom = {
    ...DEFAULT_SETTINGS_V1,
    allowlist: ["example.com"],
    demoMode: true
  };
  await repository.saveSettings(custom);
  const router = createMessageRouter(repository);
  const pause = createSettingsUpdateMessage(
    false,
    700,
    "request-settings-pause"
  );
  const repeatedPause = createSettingsUpdateMessage(
    false,
    800,
    "request-settings-pause-repeat"
  );
  const resume = createSettingsUpdateMessage(
    true,
    900,
    "request-settings-resume"
  );

  const paused = await router.route(pause);
  const repeated = await router.route(repeatedPause);
  const resumed = await router.route(resume);
  assert.equal(isSettingsUpdateResponse(paused), true);
  assert.deepEqual(paused.data.settings, { ...custom, enabled: false });
  assert.equal(paused.data.updated, true);
  assert.equal(repeated.data.updated, false);
  assert.deepEqual(resumed.data.settings, custom);
  assert.deepEqual(await repository.getSettings(), custom);
});

test("SETTINGS_UPDATE rejects invalid payload/version and maps storage failure", async () => {
  let executionCount = 0;
  const router = createMessageRouter(
    { async listMissedPaths() { return []; } },
    {
      settingsUpdateUseCase: {
        async execute() {
          executionCount += 1;
          throw new SettingsUpdateError(
            RESPONSE_ERROR_CODES.STORAGE_ERROR,
            "Unable to save Settings.",
            true
          );
        }
      }
    }
  );
  const request = createSettingsUpdateMessage(
    false,
    700,
    "request-settings-invalid"
  );
  const invalid = await router.route({
    ...request,
    payload: { ...request.payload, enabled: "no" }
  });
  const unknownVersion = await router.route({
    ...request,
    schemaVersion: SCHEMA_VERSION + 1
  });
  const storage = await router.route(request);
  assert.equal(executionCount, 1);
  assert.equal(invalid.error.code, RESPONSE_ERROR_CODES.INVALID_REQUEST);
  assert.equal(
    unknownVersion.error.code,
    RESPONSE_ERROR_CODES.SCHEMA_VERSION_UNSUPPORTED
  );
  assert.equal(storage.requestId, request.requestId);
  assert.equal(storage.error.code, RESPONSE_ERROR_CODES.STORAGE_ERROR);
  assert.equal(storage.error.retryable, true);
});

test("paused Settings block collection writes but keep queries and deletes available", async () => {
  const repository = createRepository(
    createTransactionalMemoryStorageAdapter()
  );
  await repository.saveSettings({ ...DEFAULT_SETTINGS_V1, enabled: false });
  await repository.saveMissedPath(createMissedPath());
  const router = createMessageRouter(repository);
  const discovery = createCandidatesDiscoveredMessage(
    "session-1",
    createDiscoveryContext(),
    [createDiscoveryCandidate()],
    200,
    "request-paused-discovery"
  );

  const blocked = await router.route(discovery);
  const query = await router.route(
    createMissedPathsQueryMessage("request-paused-query")
  );
  const deletion = await router.route(
    createMissedPathDeleteMessage(
      "missed-1",
      300,
      "request-paused-delete"
    )
  );
  assert.equal(blocked.error.code, RESPONSE_ERROR_CODES.COLLECTION_PAUSED);
  assert.deepEqual(await repository.listSessions(), []);
  assert.equal(query.data.missedPaths.length, 1);
  assert.equal(deletion.data.deleted, true);

  await router.route(
    createSettingsUpdateMessage(true, 400, "request-paused-resume")
  );
  const resumed = await router.route(discovery);
  assert.equal(resumed.ok, true);
  assert.equal((await repository.listSessions()).length, 1);
});

test("routes DATA_DELETE_ALL idempotently and preserves Settings", async () => {
  const repository = createRepository(
    createTransactionalMemoryStorageAdapter()
  );
  const settings = { ...DEFAULT_SETTINGS_V1, enabled: false };
  await repository.saveSettings(settings);
  await repository.saveMissedPath(createMissedPath());
  await repository.saveReencounter(createShownRequest("shown-clear").payload);
  const router = createMessageRouter(repository);
  const first = await router.route(
    createDataDeleteAllMessage(700, "request-clear-first")
  );
  const repeated = await router.route(
    createDataDeleteAllMessage(800, "request-clear-repeated")
  );

  assert.equal(isDataDeleteAllResponse(first), true);
  assert.deepEqual(first.data, { deleted: true });
  assert.deepEqual(repeated.data, { deleted: false });
  assert.deepEqual(await repository.listMissedPaths(), []);
  assert.deepEqual(await repository.listReencounters(), []);
  assert.deepEqual(await repository.getSettings(), settings);
});

test("DATA_DELETE_ALL rejects invalid payload/version and maps storage failure", async () => {
  let executionCount = 0;
  const router = createMessageRouter(
    { async listMissedPaths() { return []; } },
    {
      dataDeleteAllUseCase: {
        async execute() {
          executionCount += 1;
          throw new DataDeleteAllError(
            RESPONSE_ERROR_CODES.STORAGE_ERROR,
            "Unable to clear data.",
            true
          );
        }
      }
    }
  );
  const request = createDataDeleteAllMessage(
    700,
    "request-clear-invalid"
  );
  const invalid = await router.route({
    ...request,
    payload: { ...request.payload, extra: true }
  });
  const unknownVersion = await router.route({
    ...request,
    schemaVersion: SCHEMA_VERSION + 1
  });
  const storage = await router.route(request);
  assert.equal(executionCount, 1);
  assert.equal(invalid.error.code, RESPONSE_ERROR_CODES.INVALID_REQUEST);
  assert.equal(
    unknownVersion.error.code,
    RESPONSE_ERROR_CODES.SCHEMA_VERSION_UNSUPPORTED
  );
  assert.equal(storage.requestId, request.requestId);
  assert.equal(storage.error.code, RESPONSE_ERROR_CODES.STORAGE_ERROR);
  assert.equal(storage.error.retryable, true);
});
