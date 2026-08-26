import assert from "node:assert/strict";
import test from "node:test";

import { createMessageRouter } from "../../background/messageRouter.js";
import { ReencounterQueryError } from "../../background/reencounterQuery.js";
import {
  RESPONSE_ERROR_CODES,
  SCHEMA_VERSION,
  createMissedPathsQueryMessage,
  createReencounterQueryMessage,
  isMissedPathsQueryResponse,
  isReencounterQueryResponse
} from "../../shared/messages.js";
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
        label: "Aggregated visible time contributed to consideration.",
        contribution: 0.3
      },
      {
        code: "NOT_CLICKED",
        label: "The Candidate was not chosen in this session.",
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
