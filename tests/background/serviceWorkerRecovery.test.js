import assert from "node:assert/strict";
import test from "node:test";

import { createSessionManager } from "../../background/sessionManager.js";
import {
  ACTIVE_CONTEXT_STATUSES,
  REENCOUNTER_FEEDBACK_OUTCOMES,
  SCHEMA_VERSION,
  createActiveContextQueryMessage,
  createCandidateChosenMessage,
  createCandidatesDiscoveredMessage,
  createDataDeleteAllMessage,
  createMissedPathDeleteMessage,
  createMissedPathsQueryMessage,
  createReencounterQueryMessage,
  createReencounterFeedbackMessage,
  createReencounterShownMessage,
  createSessionFinalizeMessage,
  createSettingsUpdateMessage,
  createSignalsUpdatedMessage,
  isActiveContextQueryResponse
} from "../../shared/messages.js";
import { createIndexedDbStorageAdapter } from "../../storage/indexedDbStorageAdapter.js";
import { createRepository } from "../../storage/repository.js";
import { createFakeIndexedDB } from "../storage/fixtures/fakeIndexedDB.js";

const NOW = 10_000_000_000;
const DEFAULT_OWNER = Object.freeze({
  tabId: 1,
  documentId: "document-1",
  frameId: 0,
  sessionId: "session-1"
});

function createContext(timestamp = 100) {
  return {
    query: "robot navigation",
    source: "local-demo",
    timestamp,
    keywords: ["robot", "navigation"]
  };
}

function createCandidate(overrides = {}) {
  return {
    id: "candidate-1",
    url: "https://example.com/result",
    title: "Considered result",
    source: "local-demo",
    rank: 1,
    sessionId: "session-1",
    ...overrides
  };
}

function createSignals(clicked = false) {
  return {
    candidateId: "candidate-1",
    sessionId: "session-1",
    visibleMs: 10_000,
    hoverMs: 3_000,
    hoverCount: 4,
    returnCount: 2,
    clicked
  };
}

function createSession() {
  return {
    sessionId: "session-1",
    context: createContext(),
    candidates: [
      { candidate: createCandidate(), signals: createSignals() }
    ],
    updatedAt: 200
  };
}

function createMissedPath() {
  return {
    id: "missed-1",
    candidate: createCandidate(),
    context: createContext(NOW - 1_000),
    score: 0.9,
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

function createReencounter() {
  return {
    id: "reencounter-1",
    missedPathId: "missed-1",
    triggerContext: createContext(NOW - 1),
    score: 0.9,
    reasons: [
      {
        code: "CONTEXT_MATCH",
        label: "Context keywords matched.",
        contribution: 0.45
      }
    ],
    shownAt: NOW - 1,
    outcome: "LATER"
  };
}

async function loadServiceWorker(label, activeTabId = DEFAULT_OWNER.tabId) {
  let messageListener;
  globalThis.chrome = {
    runtime: {
      onInstalled: { addListener() {} },
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
    },
    tabs: {
      async query(queryInfo) {
        assert.deepEqual(queryInfo, {
          active: true,
          lastFocusedWindow: true
        });
        return [{ id: activeTabId }];
      }
    }
  };

  await import(
    `../../background/serviceWorker.js?recovery-${label}-${Date.now()}-${Math.random()}`
  );
  assert.equal(typeof messageListener, "function");
  return messageListener;
}

function dispatchAsync(listener, message, sender = {
  url: "https://search.bilibili.com/all?keyword=robot",
  tab: { id: DEFAULT_OWNER.tabId },
  documentId: DEFAULT_OWNER.documentId,
  frameId: DEFAULT_OWNER.frameId
}) {
  return new Promise((resolve) => {
    const keepAlive = listener(message, sender, resolve);
    assert.equal(keepAlive, true);
  });
}

test("Worker migrates v1 IndexedDB data before recovery queries", async () => {
  const indexedDB = createFakeIndexedDB();
  globalThis.indexedDB = indexedDB;
  const adapter = createIndexedDbStorageAdapter({ indexedDB });
  const missedPath = createMissedPath();
  const settings = {
    enabled: false,
    allowlist: ["example.com"],
    blocklist: [],
    thresholds: { consideration: 0.55, reencounter: 0.6 },
    demoMode: false
  };
  await adapter.commit({
    puts: [
      { key: "meta:schema", value: { schemaVersion: 1 } },
      {
        key: `missed-path:${missedPath.id}`,
        value: {
          schemaVersion: 1,
          kind: "missed-path",
          id: missedPath.id,
          data: missedPath
        }
      },
      {
        key: "settings:current",
        value: {
          schemaVersion: 1,
          kind: "settings",
          id: "current",
          data: settings
        }
      }
    ]
  });

  try {
    const firstWorker = await loadServiceWorker("v1-migration-first");
    const firstResponse = await dispatchAsync(
      firstWorker,
      createMissedPathsQueryMessage("request-v1-migration-first")
    );
    assert.deepEqual(firstResponse.data, { missedPaths: [missedPath] });

    const restartedWorker = await loadServiceWorker("v1-migration-restarted");
    const restartedResponse = await dispatchAsync(
      restartedWorker,
      createMissedPathsQueryMessage("request-v1-migration-restarted")
    );
    assert.deepEqual(restartedResponse.data, { missedPaths: [missedPath] });
    assert.equal(
      (await adapter.entries()).every(
        ({ value }) => value.schemaVersion === SCHEMA_VERSION
      ),
      true
    );
  } finally {
    delete globalThis.chrome;
    delete globalThis.indexedDB;
  }
});

test("CANDIDATES_DISCOVERED merges persisted Sessions after Worker restart", async () => {
  const indexedDB = createFakeIndexedDB();
  globalThis.indexedDB = indexedDB;

  try {
    const firstWorker = await loadServiceWorker("discovery-first");
    const firstResponse = await dispatchAsync(
      firstWorker,
      createCandidatesDiscoveredMessage(
        "session-1",
        createContext(),
        [createCandidate()],
        200,
        "request-discovery-first"
      )
    );
    assert.deepEqual(firstResponse.data, {
      sessionId: "session-1",
      acceptedCandidateIds: ["candidate-1"],
      totalCandidateCount: 1,
      updatedAt: 200
    });

    const repository = createRepository(
      createIndexedDbStorageAdapter({ indexedDB })
    );
    await repository.mergeCandidateSignalsSnapshot(
      {
        signals: {
          ...createSignals(true),
          visibleMs: 777,
          hoverMs: 0,
          hoverCount: 0,
          returnCount: 0
        },
        updatedAt: 250
      },
      DEFAULT_OWNER
    );

    const restartedWorker = await loadServiceWorker("discovery-restarted");
    const secondCandidate = createCandidate({
      id: "candidate-2",
      url: "https://example.com/result-2",
      title: "Second result",
      rank: 2
    });
    const restartedResponse = await dispatchAsync(
      restartedWorker,
      createCandidatesDiscoveredMessage(
        "session-1",
        createContext(),
        [createCandidate(), secondCandidate],
        300,
        "request-discovery-restarted"
      )
    );
    assert.deepEqual(restartedResponse.data, {
      sessionId: "session-1",
      acceptedCandidateIds: ["candidate-2"],
      totalCandidateCount: 2,
      updatedAt: 300
    });

    const restartedRepository = createRepository(
      createIndexedDbStorageAdapter({ indexedDB })
    );
    const persisted = await restartedRepository.getSession(
      "session-1",
      DEFAULT_OWNER
    );
    assert.equal(persisted.candidates.length, 2);
    assert.deepEqual(persisted.candidates[0].signals, {
      candidateId: "candidate-1",
      sessionId: "session-1",
      visibleMs: 777,
      hoverMs: 0,
      hoverCount: 0,
      returnCount: 0,
      clicked: true
    });
    assert.deepEqual(persisted.candidates[1].signals, {
      candidateId: "candidate-2",
      sessionId: "session-1",
      visibleMs: 0,
      hoverMs: 0,
      hoverCount: 0,
      returnCount: 0,
      clicked: false
    });
  } finally {
    delete globalThis.chrome;
    delete globalThis.indexedDB;
  }
});

test("Service Worker rejects forged owners and child frames, then trusts MessageSender", async () => {
  const indexedDB = createFakeIndexedDB();
  globalThis.indexedDB = indexedDB;

  try {
    const worker = await loadServiceWorker("owner-authority");
    const message = createCandidatesDiscoveredMessage(
      "session-1",
      createContext(),
      [createCandidate()],
      200,
      "request-owner-authority"
    );
    const authoritativeSender = {
      url: "https://search.bilibili.com/all?keyword=robot",
      tab: { id: 42 },
      documentId: "document-authoritative",
      frameId: 0
    };

    const forged = await dispatchAsync(
      worker,
      {
        ...message,
        requestId: "request-owner-forged",
        payload: {
          ...message.payload,
          owner: {
            tabId: 999,
            documentId: "document-forged",
            frameId: 0,
            sessionId: "session-1"
          }
        }
      },
      authoritativeSender
    );
    assert.equal(forged.error.code, "INVALID_REQUEST");

    const childFrame = await dispatchAsync(
      worker,
      { ...message, requestId: "request-owner-child-frame" },
      { ...authoritativeSender, frameId: 2 }
    );
    assert.equal(childFrame.error.code, "INVALID_REQUEST");

    const accepted = await dispatchAsync(
      worker,
      { ...message, requestId: "request-owner-accepted" },
      authoritativeSender
    );
    assert.equal(accepted.ok, true);

    const repository = createRepository(
      createIndexedDbStorageAdapter({ indexedDB })
    );
    const authoritativeOwner = {
      tabId: 42,
      documentId: "document-authoritative",
      frameId: 0,
      sessionId: "session-1"
    };
    assert.deepEqual(
      (await repository.getSession("session-1", authoritativeOwner)).owner,
      authoritativeOwner
    );
    assert.equal(
      await repository.getSession("session-1", {
        ...authoritativeOwner,
        tabId: 999
      }),
      null
    );
  } finally {
    delete globalThis.chrome;
    delete globalThis.indexedDB;
  }
});

test("ACTIVE_CONTEXT_QUERY restores and switches context after Worker restart", async () => {
  const indexedDB = createFakeIndexedDB();
  globalThis.indexedDB = indexedDB;

  try {
    const firstWorker = await loadServiceWorker("active-context-first");
    const unavailable = await dispatchAsync(
      firstWorker,
      createActiveContextQueryMessage("request-active-empty")
    );
    assert.deepEqual(unavailable.data, {
      status: ACTIVE_CONTEXT_STATUSES.UNAVAILABLE,
      context: null
    });

    await dispatchAsync(
      firstWorker,
      createCandidatesDiscoveredMessage(
        "session-1",
        createContext(),
        [createCandidate()],
        200,
        "request-active-discovery-first"
      )
    );

    const restartedWorker = await loadServiceWorker(
      "active-context-restarted"
    );
    const restored = await dispatchAsync(
      restartedWorker,
      createActiveContextQueryMessage("request-active-restored")
    );
    assert.equal(isActiveContextQueryResponse(restored), true);
    assert.equal(restored.requestId, "request-active-restored");
    assert.deepEqual(restored.data, {
      status: ACTIVE_CONTEXT_STATUSES.AVAILABLE,
      context: createContext()
    });

    const switchedContext = {
      query: "world models",
      source: "local-demo",
      timestamp: 300,
      keywords: ["world", "models"]
    };
    await dispatchAsync(
      restartedWorker,
      createCandidatesDiscoveredMessage(
        "session-2",
        switchedContext,
        [
          createCandidate({
            id: "candidate-2",
            url: "https://example.com/world-models",
            title: "World models",
            sessionId: "session-2"
          })
        ],
        300,
        "request-active-discovery-switch"
      )
    );

    const secondRestart = await loadServiceWorker(
      "active-context-second-restart"
    );
    const switched = await dispatchAsync(
      secondRestart,
      createActiveContextQueryMessage("request-active-switched")
    );
    assert.deepEqual(switched.data, {
      status: ACTIVE_CONTEXT_STATUSES.AVAILABLE,
      context: switchedContext
    });
  } finally {
    delete globalThis.chrome;
    delete globalThis.indexedDB;
  }
});

test("ACTIVE_CONTEXT_QUERY follows the active tab and one tab finalize preserves the other", async () => {
  const indexedDB = createFakeIndexedDB();
  globalThis.indexedDB = indexedDB;

  try {
    const firstWorker = await loadServiceWorker("multi-tab-writes", 1);
    const firstContext = createContext(100);
    const secondContext = createContext(101);
    const firstSender = {
      url: "https://search.bilibili.com/all?keyword=robot",
      tab: { id: 1 },
      documentId: "document-tab-1",
      frameId: 0
    };
    const secondSender = {
      ...firstSender,
      tab: { id: 2 },
      documentId: "document-tab-2"
    };

    await dispatchAsync(
      firstWorker,
      createCandidatesDiscoveredMessage(
        "session-1",
        firstContext,
        [createCandidate()],
        100,
        "request-tab-1-discovery"
      ),
      firstSender
    );
    await dispatchAsync(
      firstWorker,
      createCandidatesDiscoveredMessage(
        "session-1",
        secondContext,
        [createCandidate()],
        101,
        "request-tab-2-discovery"
      ),
      secondSender
    );

    const tabTwoWorker = await loadServiceWorker("multi-tab-query-2", 2);
    const tabTwoContext = await dispatchAsync(
      tabTwoWorker,
      createActiveContextQueryMessage("request-tab-2-context")
    );
    assert.deepEqual(tabTwoContext.data.context, secondContext);

    const tabOneWorker = await loadServiceWorker("multi-tab-query-1", 1);
    const tabOneContext = await dispatchAsync(
      tabOneWorker,
      createActiveContextQueryMessage("request-tab-1-context")
    );
    assert.deepEqual(tabOneContext.data.context, firstContext);
    const finalized = await dispatchAsync(
      tabOneWorker,
      createSessionFinalizeMessage(
        "session-1",
        200,
        "request-tab-1-finalize"
      ),
      firstSender
    );
    assert.equal(finalized.ok, true);

    const restartedTabTwoWorker = await loadServiceWorker(
      "multi-tab-query-2-restarted",
      2
    );
    const preserved = await dispatchAsync(
      restartedTabTwoWorker,
      createActiveContextQueryMessage("request-tab-2-preserved")
    );
    assert.deepEqual(preserved.data.context, secondContext);

    const repository = createRepository(
      createIndexedDbStorageAdapter({ indexedDB })
    );
    assert.equal((await repository.listSessions()).length, 2);
  } finally {
    delete globalThis.chrome;
    delete globalThis.indexedDB;
  }
});

test("SIGNALS_UPDATED continues fieldwise merging after Worker restart", async () => {
  const indexedDB = createFakeIndexedDB();
  globalThis.indexedDB = indexedDB;

  try {
    const firstWorker = await loadServiceWorker("signals-first");
    await dispatchAsync(
      firstWorker,
      createCandidatesDiscoveredMessage(
        "session-1",
        createContext(),
        [createCandidate()],
        200,
        "request-signals-discovery"
      )
    );
    const firstResponse = await dispatchAsync(
      firstWorker,
      createSignalsUpdatedMessage(
        {
          candidateId: "candidate-1",
          sessionId: "session-1",
          visibleMs: 1_000,
          hoverMs: 200,
          hoverCount: 2,
          returnCount: 1,
          clicked: true
        },
        300,
        "request-signals-first"
      )
    );
    assert.deepEqual(firstResponse.data, {
      sessionId: "session-1",
      candidateId: "candidate-1",
      updatedAt: 300,
      changed: true
    });

    const restartedWorker = await loadServiceWorker("signals-restarted");
    const restartedResponse = await dispatchAsync(
      restartedWorker,
      createSignalsUpdatedMessage(
        {
          candidateId: "candidate-1",
          sessionId: "session-1",
          visibleMs: 500,
          hoverMs: 500,
          hoverCount: 1,
          returnCount: 3,
          clicked: false
        },
        250,
        "request-signals-restarted"
      )
    );
    assert.equal(restartedResponse.requestId, "request-signals-restarted");
    assert.deepEqual(restartedResponse.data, {
      sessionId: "session-1",
      candidateId: "candidate-1",
      updatedAt: 300,
      changed: true
    });

    const restartedRepository = createRepository(
      createIndexedDbStorageAdapter({ indexedDB })
    );
    const persisted = await restartedRepository.getSession(
      "session-1",
      DEFAULT_OWNER
    );
    assert.equal(persisted.updatedAt, 300);
    assert.deepEqual(persisted.candidates[0].signals, {
      candidateId: "candidate-1",
      sessionId: "session-1",
      visibleMs: 1_000,
      hoverMs: 500,
      hoverCount: 2,
      returnCount: 3,
      clicked: true
    });
  } finally {
    delete globalThis.chrome;
    delete globalThis.indexedDB;
  }
});

test("SESSION_FINALIZE recovers the first durable result after Worker restart", async () => {
  const indexedDB = createFakeIndexedDB();
  globalThis.indexedDB = indexedDB;

  try {
    const repository = createRepository(
      createIndexedDbStorageAdapter({ indexedDB })
    );
    await repository.mergeDiscoveredCandidates(
      {
        sessionId: "session-1",
        context: createContext(),
        candidates: [createCandidate()],
        discoveredAt: 200
      },
      DEFAULT_OWNER
    );
    await repository.mergeCandidateSignalsSnapshot(
      { signals: createSignals(), updatedAt: 200 },
      DEFAULT_OWNER
    );

    const firstWorker = await loadServiceWorker("finalize-first");
    const firstResponse = await dispatchAsync(
      firstWorker,
      createSessionFinalizeMessage(
        "session-1",
        500,
        "request-finalize-first"
      )
    );
    assert.equal(firstResponse.requestId, "request-finalize-first");
    assert.equal(firstResponse.ok, true);
    assert.equal(firstResponse.data.alreadyFinalized, false);
    assert.equal(firstResponse.data.finalizedAt, 500);
    assert.deepEqual(firstResponse.data.chosen, []);
    assert.equal(firstResponse.data.missedPaths.length, 1);

    const restartedWorker = await loadServiceWorker("finalize-restarted");
    const restartedResponse = await dispatchAsync(
      restartedWorker,
      createSessionFinalizeMessage(
        "session-1",
        900,
        "request-finalize-restarted"
      )
    );
    assert.equal(restartedResponse.requestId, "request-finalize-restarted");
    assert.equal(restartedResponse.ok, true);
    assert.equal(restartedResponse.data.alreadyFinalized, true);
    assert.equal(restartedResponse.data.finalizedAt, 500);
    assert.deepEqual(
      restartedResponse.data.missedPaths,
      firstResponse.data.missedPaths
    );

    const restartedRepository = createRepository(
      createIndexedDbStorageAdapter({ indexedDB })
    );
    assert.equal((await restartedRepository.listMissedPaths()).length, 1);
    assert.deepEqual(
      await restartedRepository.getSessionFinalization(
        "session-1",
        DEFAULT_OWNER
      ),
      {
        sessionId: "session-1",
        owner: DEFAULT_OWNER,
        finalizedAt: 500,
        chosenIds: [],
        missedPathIds: [firstResponse.data.missedPaths[0].id]
      }
    );
  } finally {
    delete globalThis.chrome;
    delete globalThis.indexedDB;
  }
});

test("CANDIDATE_CHOSEN persists aggregates and excludes Missed after Worker restart", async () => {
  const indexedDB = createFakeIndexedDB();
  globalThis.indexedDB = indexedDB;

  try {
    const repository = createRepository(
      createIndexedDbStorageAdapter({ indexedDB })
    );
    await repository.mergeDiscoveredCandidates(
      {
        sessionId: "session-1",
        context: createContext(),
        candidates: [createCandidate()],
        discoveredAt: 200
      },
      DEFAULT_OWNER
    );
    await repository.mergeCandidateSignalsSnapshot(
      { signals: createSignals(), updatedAt: 200 },
      DEFAULT_OWNER
    );

    const firstWorker = await loadServiceWorker("chosen-first");
    const chosenMessage = createCandidateChosenMessage(
      createCandidate(),
      450,
      "request-chosen-first"
    );
    const firstResponse = await dispatchAsync(firstWorker, chosenMessage);
    assert.deepEqual(firstResponse.data, {
      candidateChosen: {
        sessionId: "session-1",
        candidateId: "candidate-1",
        updated: true
      }
    });

    const afterFirstWorker = createRepository(
      createIndexedDbStorageAdapter({ indexedDB })
    );
    const persisted = await afterFirstWorker.getSession(
      "session-1",
      DEFAULT_OWNER
    );
    assert.deepEqual(persisted.candidates[0].signals, createSignals(true));

    const restartedWorker = await loadServiceWorker("chosen-restarted");
    const duplicateResponse = await dispatchAsync(
      restartedWorker,
      createCandidateChosenMessage(
        createCandidate(),
        900,
        "request-chosen-restarted"
      )
    );
    assert.equal(duplicateResponse.data.candidateChosen.updated, false);

    const restartedRepository = createRepository(
      createIndexedDbStorageAdapter({ indexedDB })
    );
    const finalized = await createSessionManager(
      restartedRepository
    ).finalizeSession("session-1", 500, DEFAULT_OWNER);
    assert.equal(finalized.chosen.length, 1);
    assert.deepEqual(finalized.missedPaths, []);

    const afterSecondRestart = createSessionManager(
      createRepository(createIndexedDbStorageAdapter({ indexedDB }))
    );
    const repeated = await afterSecondRestart.finalizeSession(
      "session-1",
      1_000,
      DEFAULT_OWNER
    );
    assert.equal(repeated.alreadyFinalized, true);
    assert.equal(repeated.finalizedAt, 500);
    assert.equal(repeated.chosen.length, 1);
    assert.deepEqual(repeated.missedPaths, []);
  } finally {
    delete globalThis.chrome;
    delete globalThis.indexedDB;
  }
});

test("persisted Re-encounter cooldown remains active after Worker restart", async () => {
  const indexedDB = createFakeIndexedDB();
  globalThis.indexedDB = indexedDB;

  try {
    const repository = createRepository(
      createIndexedDbStorageAdapter({ indexedDB })
    );
    const context = createContext(NOW);
    await repository.saveMissedPath(createMissedPath());
    await repository.mergeDiscoveredCandidates(
      {
        sessionId: "session-1",
        context,
        candidates: [createCandidate()],
        discoveredAt: NOW
      },
      DEFAULT_OWNER
    );
    const firstWorker = await loadServiceWorker("cooldown-first");
    const firstResponse = await dispatchAsync(
      firstWorker,
      createReencounterQueryMessage(
        context,
        3,
        "request-cooldown-first"
      )
    );
    assert.equal(firstResponse.data.reencounters.length, 1);
    const shownRequest = createReencounterShownMessage(
      firstResponse.data.reencounters[0],
      context,
      NOW,
      "request-shown-first"
    );
    const shownResponse = await dispatchAsync(firstWorker, shownRequest);
    assert.equal(shownResponse.requestId, shownRequest.requestId);
    assert.equal(shownResponse.data.created, true);

    const restartedWorker = await loadServiceWorker("cooldown-restarted");
    const restartedResponse = await dispatchAsync(
      restartedWorker,
      createReencounterQueryMessage(
        createContext(NOW),
        3,
        "request-cooldown-restarted"
      )
    );
    assert.deepEqual(restartedResponse.data, { reencounters: [] });

    const restartedRepository = createRepository(
      createIndexedDbStorageAdapter({ indexedDB })
    );
    const restoredShown = await restartedRepository.listReencounters();
    assert.equal(restoredShown.length, 1);
    assert.equal(restoredShown[0].id, shownRequest.payload.id);
    assert.equal(restoredShown[0].missedPathId, "missed-1");
    assert.equal(restoredShown[0].shownAt, NOW);
    assert.deepEqual(restoredShown[0].triggerContext, context);
  } finally {
    delete globalThis.chrome;
    delete globalThis.indexedDB;
  }
});

test("RE_ENCOUNTER_FEEDBACK survives Worker restart and keeps LATER cooldown", async () => {
  const indexedDB = createFakeIndexedDB();
  globalThis.indexedDB = indexedDB;

  try {
    const repository = createRepository(
      createIndexedDbStorageAdapter({ indexedDB })
    );
    await repository.saveMissedPath(createMissedPath());
    const { outcome: _legacyOutcome, ...shown } = createReencounter();
    await repository.saveReencounter({
      ...shown,
      shownAt: 1,
      triggerContext: createContext(1)
    });

    const firstWorker = await loadServiceWorker("feedback-first");
    const feedbackRequest = createReencounterFeedbackMessage(
      shown.id,
      REENCOUNTER_FEEDBACK_OUTCOMES.LATER,
      NOW,
      "request-feedback-first"
    );
    const feedbackResponse = await dispatchAsync(firstWorker, feedbackRequest);
    assert.equal(feedbackResponse.requestId, feedbackRequest.requestId);
    assert.equal(feedbackResponse.data.updated, true);

    const restartedWorker = await loadServiceWorker("feedback-restarted");
    const repeated = await dispatchAsync(
      restartedWorker,
      createReencounterFeedbackMessage(
        shown.id,
        REENCOUNTER_FEEDBACK_OUTCOMES.LATER,
        NOW + 1_000,
        "request-feedback-repeated"
      )
    );
    assert.deepEqual(repeated.data, {
      reencounterId: shown.id,
      outcome: REENCOUNTER_FEEDBACK_OUTCOMES.LATER,
      feedbackAt: NOW,
      updated: false
    });

    const queryResponse = await dispatchAsync(
      restartedWorker,
      createReencounterQueryMessage(
        createContext(NOW),
        3,
        "request-feedback-cooldown"
      )
    );
    assert.deepEqual(queryResponse.data, { reencounters: [] });
  } finally {
    delete globalThis.chrome;
    delete globalThis.indexedDB;
  }
});

test("MISSED_PATH_DELETE remains deleted after Worker restart", async () => {
  const indexedDB = createFakeIndexedDB();
  globalThis.indexedDB = indexedDB;

  try {
    const repository = createRepository(
      createIndexedDbStorageAdapter({ indexedDB })
    );
    await repository.saveMissedPath(createMissedPath());
    await repository.saveReencounter(createReencounter());

    const firstWorker = await loadServiceWorker("delete-first");
    const request = createMissedPathDeleteMessage(
      "missed-1",
      NOW,
      "request-delete-first"
    );
    const response = await dispatchAsync(firstWorker, request);
    assert.deepEqual(response.data, {
      missedPathId: "missed-1",
      deleted: true
    });

    const restartedWorker = await loadServiceWorker("delete-restarted");
    const repeated = await dispatchAsync(
      restartedWorker,
      createMissedPathDeleteMessage(
        "missed-1",
        NOW + 1,
        "request-delete-repeated"
      )
    );
    assert.equal(repeated.data.deleted, false);
    const restoredRepository = createRepository(
      createIndexedDbStorageAdapter({ indexedDB })
    );
    assert.deepEqual(await restoredRepository.listMissedPaths(), []);
    assert.deepEqual(await restoredRepository.listReencounters(), []);
  } finally {
    delete globalThis.chrome;
    delete globalThis.indexedDB;
  }
});

test("paused Settings survive Worker restart and block every collection write", async () => {
  const indexedDB = createFakeIndexedDB();
  globalThis.indexedDB = indexedDB;

  try {
    const repository = createRepository(
      createIndexedDbStorageAdapter({ indexedDB })
    );
    await repository.saveMissedPath(createMissedPath());
    const firstWorker = await loadServiceWorker("settings-pause-first");
    const paused = await dispatchAsync(
      firstWorker,
      createSettingsUpdateMessage(
        false,
        NOW,
        "request-settings-pause"
      )
    );
    assert.equal(paused.data.settings.enabled, false);

    const restartedWorker = await loadServiceWorker("settings-pause-restarted");
    const discovery = createCandidatesDiscoveredMessage(
      "session-paused",
      createContext(NOW),
      [createCandidate({ sessionId: "session-paused" })],
      NOW,
      "request-paused-discovery"
    );
    const blockedMessages = [
      discovery,
      createSignalsUpdatedMessage(
        { ...createSignals(), sessionId: "session-paused" },
        NOW,
        "request-paused-signals"
      ),
      createSessionFinalizeMessage(
        "session-paused",
        NOW,
        "request-paused-finalize"
      ),
      createCandidateChosenMessage(
        { id: "candidate-1", sessionId: "session-paused" },
        NOW,
        "request-paused-chosen"
      )
    ];
    for (const message of blockedMessages) {
      const response = await dispatchAsync(restartedWorker, message);
      assert.equal(
        response.error.code,
        "COLLECTION_PAUSED",
        message.type
      );
    }
    const query = await dispatchAsync(
      restartedWorker,
      createMissedPathsQueryMessage("request-paused-existing-query")
    );
    assert.equal(query.data.missedPaths.length, 1);
    assert.deepEqual(await repository.listSessions(), []);

    const resumed = await dispatchAsync(
      restartedWorker,
      createSettingsUpdateMessage(
        true,
        NOW + 1,
        "request-settings-resume"
      )
    );
    assert.equal(resumed.data.settings.enabled, true);
    const afterResumeWorker = await loadServiceWorker(
      "settings-resume-restarted"
    );
    const accepted = await dispatchAsync(afterResumeWorker, discovery);
    assert.equal(accepted.ok, true);
    assert.equal((await repository.listSessions()).length, 1);
  } finally {
    delete globalThis.chrome;
    delete globalThis.indexedDB;
  }
});

test("DATA_DELETE_ALL stays empty after restart and preserves Settings", async () => {
  const indexedDB = createFakeIndexedDB();
  globalThis.indexedDB = indexedDB;

  try {
    const repository = createRepository(
      createIndexedDbStorageAdapter({ indexedDB })
    );
    await repository.mergeDiscoveredCandidates(
      {
        sessionId: "session-1",
        context: createContext(),
        candidates: [createCandidate()],
        discoveredAt: 200
      },
      DEFAULT_OWNER
    );
    await repository.mergeCandidateSignalsSnapshot(
      { signals: createSignals(), updatedAt: 200 },
      DEFAULT_OWNER
    );
    await createSessionManager(repository).finalizeSession(
      "session-1",
      500,
      DEFAULT_OWNER
    );
    await repository.saveReencounter(createReencounter());
    await repository.saveSettings({
      enabled: false,
      allowlist: ["example.com"],
      blocklist: [],
      thresholds: { consideration: 0.55, reencounter: 0.6 },
      demoMode: false
    });

    const firstWorker = await loadServiceWorker("clear-first");
    const first = await dispatchAsync(
      firstWorker,
      createDataDeleteAllMessage(NOW, "request-clear-first")
    );
    assert.equal(first.data.deleted, true);

    const restartedWorker = await loadServiceWorker("clear-restarted");
    const repeated = await dispatchAsync(
      restartedWorker,
      createDataDeleteAllMessage(NOW + 1, "request-clear-repeated")
    );
    assert.equal(repeated.data.deleted, false);
    const restored = createRepository(
      createIndexedDbStorageAdapter({ indexedDB })
    );
    assert.deepEqual(await restored.listSessions(), []);
    assert.deepEqual(await restored.listChosen(), []);
    assert.deepEqual(await restored.listMissedPaths(), []);
    assert.deepEqual(await restored.listReencounters(), []);
    assert.equal(await restored.getActiveContext(), null);
    assert.equal(await restored.getSessionFinalization("session-1"), null);
    assert.deepEqual(await restored.getSettings(), {
      enabled: false,
      allowlist: ["example.com"],
      blocklist: [],
      thresholds: { consideration: 0.55, reencounter: 0.6 },
      demoMode: false
    });
  } finally {
    delete globalThis.chrome;
    delete globalThis.indexedDB;
  }
});
