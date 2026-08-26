import assert from "node:assert/strict";
import test from "node:test";

import { createSessionManager } from "../../background/sessionManager.js";
import {
  createCandidateChosenMessage,
  createReencounterQueryMessage
} from "../../shared/messages.js";
import { createIndexedDbStorageAdapter } from "../../storage/indexedDbStorageAdapter.js";
import { createRepository } from "../../storage/repository.js";
import { createFakeIndexedDB } from "../storage/fixtures/fakeIndexedDB.js";

const NOW = 10_000_000_000;

function createContext(timestamp = 100) {
  return {
    query: "robot navigation",
    source: "local-demo",
    timestamp,
    keywords: ["robot", "navigation"]
  };
}

function createCandidate() {
  return {
    id: "candidate-1",
    url: "https://example.com/result",
    title: "Considered result",
    source: "local-demo",
    rank: 1,
    sessionId: "session-1"
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

async function loadServiceWorker(label) {
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
    }
  };

  await import(
    `../../background/serviceWorker.js?recovery-${label}-${Date.now()}-${Math.random()}`
  );
  assert.equal(typeof messageListener, "function");
  return messageListener;
}

function dispatchAsync(listener, message) {
  return new Promise((resolve) => {
    const keepAlive = listener(
      message,
      { url: "chrome-extension://test/content.js" },
      resolve
    );
    assert.equal(keepAlive, true);
  });
}

test("CANDIDATE_CHOSEN persists aggregates and excludes Missed after Worker restart", async () => {
  const indexedDB = createFakeIndexedDB();
  globalThis.indexedDB = indexedDB;

  try {
    const repository = createRepository(
      createIndexedDbStorageAdapter({ indexedDB })
    );
    await repository.saveSession(createSession());

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
    const persisted = await afterFirstWorker.getSession("session-1");
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
    ).finalizeSession("session-1", 500);
    assert.equal(finalized.chosen.length, 1);
    assert.deepEqual(finalized.missedPaths, []);

    const afterSecondRestart = createSessionManager(
      createRepository(createIndexedDbStorageAdapter({ indexedDB }))
    );
    const repeated = await afterSecondRestart.finalizeSession(
      "session-1",
      1_000
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
    await repository.saveMissedPath(createMissedPath());
    await repository.saveReencounter(createReencounter());
    const request = createReencounterQueryMessage(
      createContext(NOW),
      3,
      "request-cooldown-first"
    );

    const firstWorker = await loadServiceWorker("cooldown-first");
    const firstResponse = await dispatchAsync(firstWorker, request);
    assert.deepEqual(firstResponse.data, { reencounters: [] });

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
    assert.equal((await restartedRepository.listReencounters()).length, 1);
  } finally {
    delete globalThis.chrome;
    delete globalThis.indexedDB;
  }
});
