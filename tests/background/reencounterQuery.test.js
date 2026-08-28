import assert from "node:assert/strict";
import test from "node:test";

import {
  REENCOUNTER_QUERY_FAILURE_CODES,
  ReencounterQueryError,
  createReencounterQueryUseCase
} from "../../background/reencounterQuery.js";
import { REENCOUNTER_SCORING_CONFIG } from "../../background/scoringConfig.js";
import {
  createRepository,
  createSessionOwnerKey
} from "../../storage/repository.js";
import { createTransactionalMemoryStorageAdapter } from "../storage/fixtures/memoryStorageAdapter.js";

const NOW = 10_000_000_000;

function createContext(timestamp = NOW) {
  return {
    query: "robot navigation",
    source: "local-demo",
    timestamp,
    keywords: ["robot", "navigation"]
  };
}

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
    context: createContext(NOW - 1_000),
    score: 0.8,
    reasons: [
      {
        code: "LONG_EXPOSURE",
        label: "Aggregated visible time contributed.",
        contribution: 0.3
      }
    ],
    status: "MISSED",
    createdAt: NOW - 1_000
  };
}

function createHistory(id, shownAt, outcome) {
  return {
    id,
    missedPathId: "missed-1",
    triggerContext: createContext(shownAt),
    score: 0.7,
    reasons: [
      {
        code: "CONTEXT_MATCH",
        label: "Context keywords matched.",
        contribution: 0.45
      }
    ],
    shownAt,
    outcome
  };
}

test("reads Repository state and returns ranked candidates without writing", async () => {
  const adapter = createTransactionalMemoryStorageAdapter();
  const repository = createRepository(adapter);
  await repository.saveMissedPath(createMissedPath());
  await repository.saveReencounter(
    createHistory(
      "history-1",
      NOW - REENCOUNTER_SCORING_CONFIG.cooldown.durationMs - 1,
      "DISMISSED"
    )
  );
  const commitsBeforeQuery = adapter.commitCount;
  const useCase = createReencounterQueryUseCase(repository);

  const result = await useCase.execute({
    context: createContext(),
    limit: 3
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].missedPath.id, "missed-1");
  assert.equal(result[0].score >= REENCOUNTER_SCORING_CONFIG.threshold, true);
  assert.equal(adapter.commitCount, commitsBeforeQuery);
});

test("loads historical and active-tab tag profiles without crossing tab owners", async () => {
  const adapter = createTransactionalMemoryStorageAdapter();
  const repository = createRepository(adapter);
  const historicalOwner = {
    tabId: 3,
    documentId: "historical-document",
    frameId: 0,
    sessionId: "session-1"
  };
  const currentOwner = {
    tabId: 7,
    documentId: "current-document",
    frameId: 0,
    sessionId: "current-session"
  };
  const missedPathId = `${encodeURIComponent(
    createSessionOwnerKey(historicalOwner)
  )}:${encodeURIComponent("candidate-1")}`;
  await repository.saveMissedPath({
    ...createMissedPath(),
    id: missedPathId,
    candidate: {
      ...createMissedPath().candidate,
      source: "bilibili-search",
      contentType: "VIDEO",
      layoutType: "GRID"
    },
    createdAt: NOW
  });
  await repository.saveCandidateTagProfile(
    {
      candidateId: "candidate-1",
      sessionId: "session-1",
      nativeTags: [],
      normalizedTags: ["robot"]
    },
    historicalOwner
  );
  const currentContext = createContext();
  await repository.mergeDiscoveredCandidates(
    {
      sessionId: "current-session",
      context: currentContext,
      candidates: [
        {
          id: "current-candidate",
          url: "https://example.com/current",
          title: "Current result",
          source: "local-demo",
          rank: 1,
          sessionId: "current-session"
        }
      ],
      discoveredAt: NOW
    },
    currentOwner
  );
  await repository.saveContextTagProfile(
    {
      sessionId: "current-session",
      normalizedTags: ["robot"]
    },
    currentOwner
  );
  await repository.saveSessionSelectedTagProfile(
    {
      sessionId: "current-session",
      selectedCandidateCount: 1,
      tags: [{ tag: "robot", candidateCount: 1, weight: 1 }]
    },
    currentOwner
  );

  const useCase = createReencounterQueryUseCase(repository);
  const tagged = await useCase.execute(
    { context: currentContext, limit: 3 },
    currentOwner.tabId
  );
  const otherTab = await useCase.execute(
    { context: currentContext, limit: 3 },
    8
  );

  assert.equal(tagged.length, 1);
  assert.equal(Math.abs(tagged[0].score - 0.95) < Number.EPSILON, true);
  assert.equal(tagged[0].missedPath.candidate.url, createMissedPath().candidate.url);
  assert.equal(tagged[0].missedPath.candidate.source, "bilibili-search");
  assert.equal(tagged[0].missedPath.candidate.contentType, "VIDEO");
  assert.equal(tagged[0].missedPath.candidate.layoutType, "GRID");
  assert.equal(tagged[0].reasons[1].contribution, 0.15);
  assert.match(tagged[0].reasons[1].label, /已选择偏好/);
  assert.equal(otherTab[0].score, 0.8);
  assert.equal(otherTab[0].reasons[1].contribution, 0);
});

test("uses LATER feedbackAt for cooldown and NOT_RELEVANT as a penalty", async () => {
  let receivedEntries;
  const repository = {
    async listMissedPaths() {
      return [createMissedPath()];
    },
    async listReencounters() {
      return [
        createHistory("history-1", 100, "DISMISSED"),
        {
          ...createHistory("history-2", 300, "LATER"),
          feedbackAt: 500
        },
        createHistory("history-3", 200, "OPENED"),
        {
          ...createHistory("history-4", 400, "NOT_RELEVANT"),
          feedbackAt: 450
        }
      ];
    }
  };
  const useCase = createReencounterQueryUseCase(repository, {
    ranker(entries) {
      receivedEntries = entries;
      return [];
    }
  });

  await useCase.execute({ context: createContext(), limit: 3 });

  assert.equal(receivedEntries[0].lastShownAt, 500);
  assert.equal(receivedEntries[0].dismissalCount, 2);
});

test("returns an empty list when there are no Missed Paths", async () => {
  const useCase = createReencounterQueryUseCase({
    async listMissedPaths() {
      return [];
    },
    async listReencounters() {
      return [];
    }
  });

  assert.deepEqual(
    await useCase.execute({ context: createContext(), limit: 3 }),
    []
  );
});

test("surfaces storage failures as retryable use-case errors", async () => {
  const failure = new Error("simulated storage failure");
  const useCase = createReencounterQueryUseCase({
    async listMissedPaths() {
      throw failure;
    },
    async listReencounters() {
      return [];
    }
  });

  await assert.rejects(
    () => useCase.execute({ context: createContext(), limit: 3 }),
    (error) =>
      error instanceof ReencounterQueryError &&
      error.code === REENCOUNTER_QUERY_FAILURE_CODES.STORAGE &&
      error.retryable === true &&
      error.cause === failure
  );
});

test("surfaces ranking failures as non-retryable business errors", async () => {
  const failure = new Error("simulated ranking failure");
  const useCase = createReencounterQueryUseCase(
    {
      async listMissedPaths() {
        return [createMissedPath()];
      },
      async listReencounters() {
        return [];
      }
    },
    {
      ranker() {
        throw failure;
      }
    }
  );

  await assert.rejects(
    () => useCase.execute({ context: createContext(), limit: 3 }),
    (error) =>
      error instanceof ReencounterQueryError &&
      error.code === REENCOUNTER_QUERY_FAILURE_CODES.BUSINESS &&
      error.retryable === false &&
      error.cause === failure
  );
});

test("repeated requests are read-only and return the same result", async () => {
  const adapter = createTransactionalMemoryStorageAdapter();
  const repository = createRepository(adapter);
  await repository.saveMissedPath(createMissedPath());
  const commitsBeforeQuery = adapter.commitCount;
  const useCase = createReencounterQueryUseCase(repository);
  const payload = { context: createContext(), limit: 3 };

  const first = await useCase.execute(payload);
  const second = await useCase.execute(payload);

  assert.deepEqual(second, first);
  assert.equal(adapter.commitCount, commitsBeforeQuery);
  assert.deepEqual(await repository.listReencounters(), []);
});
