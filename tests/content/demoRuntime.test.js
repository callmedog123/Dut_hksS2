import assert from "node:assert/strict";
import test from "node:test";

import { createMessageRouter } from "../../background/messageRouter.js";
import { createSessionFinalizeUseCase } from "../../background/sessionFinalize.js";
import { createSessionManager } from "../../background/sessionManager.js";
import {
  DEMO_SCENARIO_ADVANCE_MS,
  createDemoRuntime
} from "../../content/demoRuntime.js";
import {
  MESSAGE_TYPES,
  RESPONSE_ERROR_CODES,
  createErrorResponseMessage,
  createMissedPathsQueryMessage,
  createSuccessResponseMessage
} from "../../shared/messages.js";
import { createRepository } from "../../storage/repository.js";
import {
  createDemoDocumentFixture,
  createIntersectionObserverHarness,
  createMutationObserverHarness
} from "../adapters/fixtures/demoDom.js";
import { createTransactionalMemoryStorageAdapter } from "../storage/fixtures/memoryStorageAdapter.js";

const DEMO_URL = new URL("chrome-extension://test/demo/index.html");

function createBackend(storageAdapter) {
  const repository = createRepository(storageAdapter);
  const sessionManager = createSessionManager(repository);
  const router = createMessageRouter(repository, {
    sessionFinalizeUseCase: createSessionFinalizeUseCase(sessionManager)
  });
  const messages = [];

  return {
    messages,
    repository,
    router,
    async sendMessage(message) {
      messages.push(message);
      if (message.type === MESSAGE_TYPES.CANDIDATE_CHOSEN) {
        const candidateChosen = await sessionManager.recordCandidateChosen(
          message.payload.sessionId,
          message.payload.candidateId,
          message.payload.chosenAt
        );
        return createSuccessResponseMessage(message.requestId, {
          candidateChosen
        });
      }
      return router.route(message);
    }
  };
}

function createRuntimeHarness({ sendMessage, statuses = [] } = {}) {
  const fixture = createDemoDocumentFixture({
    candidates: [
      {
        id: "demo-candidate-001",
        title: "Chosen result",
        href: "https://knowledge.example/result?id=1"
      },
      {
        id: "demo-candidate-002",
        title: "High consideration result",
        href: "https://knowledge.example/result?id=2"
      }
    ]
  });
  const mutation = createMutationObserverHarness();
  const intersection = createIntersectionObserverHarness();
  let wallTime = 100;
  const runtime = createDemoRuntime({
    document: fixture.document,
    url: DEMO_URL,
    sendMessage,
    wallNow: () => (wallTime += 1),
    performanceNow: () => 0,
    MutationObserver: mutation.MutationObserver,
    IntersectionObserver: intersection.IntersectionObserver,
    eventFactory: (type) => ({ type, bubbles: false }),
    onStatus(status) {
      statuses.push(status);
    }
  });
  return { fixture, mutation, intersection, runtime, statuses };
}

function dispatchChoice(element, scenario = {}) {
  let preventDefaultCalls = 0;
  const event = {
    type: scenario.type ?? "click",
    button: scenario.button ?? 0,
    ctrlKey: scenario.ctrlKey ?? false,
    metaKey: scenario.metaKey ?? false,
    shiftKey: false,
    bubbles: true,
    defaultPrevented: false,
    preventDefault() {
      preventDefaultCalls += 1;
      this.defaultPrevented = true;
    }
  };
  element.dispatchEvent(event);
  return { event, get preventDefaultCalls() { return preventDefaultCalls; } };
}

test("runs the local Demo through discovery, signals, finalization and restart-safe query", async () => {
  const storageAdapter = createTransactionalMemoryStorageAdapter();
  const backend = createBackend(storageAdapter);
  const harness = createRuntimeHarness({
    sendMessage: (message) => backend.sendMessage(message)
  });

  const started = await harness.runtime.start();
  assert.equal(started.totalCandidateCount, 2);
  assert.equal(backend.messages[0].type, MESSAGE_TYPES.CANDIDATES_DISCOVERED);

  const chosenLink = harness.fixture.candidateElements[0].querySelector(
    "[data-demo-link]"
  );
  const choice = dispatchChoice(chosenLink, { ctrlKey: true });
  assert.equal(choice.event.defaultPrevented, false);
  assert.equal(choice.preventDefaultCalls, 0);

  const highElement = harness.fixture.candidateElements[1];
  harness.intersection.setVisible(highElement, false);
  harness.intersection.setVisible(highElement, true);
  harness.intersection.setVisible(highElement, false);
  harness.intersection.setVisible(highElement, true);

  const advanced = await harness.runtime.advanceScenario(
    "demo-candidate-002"
  );
  assert.equal(advanced.advancedMs, DEMO_SCENARIO_ADVANCE_MS);
  assert.deepEqual(advanced.signals, {
    candidateId: "demo-candidate-002",
    sessionId: "demo-session-001",
    visibleMs: 12_000,
    hoverMs: 3_000,
    hoverCount: 4,
    returnCount: 2,
    clicked: false
  });

  const lowSignalElement = harness.fixture.addCandidate({
    id: "demo-candidate-003",
    title: "Dynamic low-signal result",
    href: "https://knowledge.example/result?id=3"
  });
  harness.intersection.setVisible(lowSignalElement, false);
  harness.intersection.setVisible(lowSignalElement, true);
  harness.intersection.setVisible(lowSignalElement, false);
  harness.intersection.setVisible(lowSignalElement, true);

  const finalization = await harness.runtime.finalizeSession();
  assert.equal(finalization.alreadyFinalized, false);
  assert.deepEqual(
    finalization.chosen.map((chosen) => chosen.candidate.id),
    ["demo-candidate-001"]
  );
  assert.deepEqual(
    finalization.missedPaths.map((missedPath) => missedPath.candidate.id),
    ["demo-candidate-002"]
  );
  assert.equal(
    finalization.missedPaths.some(
      (missedPath) => missedPath.candidate.id === "demo-candidate-003"
    ),
    false
  );

  const session = await backend.repository.getSession("demo-session-001");
  assert.equal(session.candidates.length, 3);
  assert.equal(session.candidates[0].signals.clicked, true);
  assert.deepEqual(session.candidates[1].signals, advanced.signals);
  assert.equal(session.candidates[2].signals.visibleMs, 0);
  assert.equal(session.candidates[2].signals.hoverMs, 0);
  assert.equal(session.candidates[2].signals.returnCount, 2);

  const repeated = await harness.runtime.finalizeSession();
  assert.equal(repeated.alreadyFinalized, true);
  assert.equal(repeated.finalizedAt, finalization.finalizedAt);
  assert.deepEqual(repeated.missedPaths, finalization.missedPaths);

  const restartedBackend = createBackend(storageAdapter);
  const sidePanelQuery = createMissedPathsQueryMessage("request-after-restart");
  const queryResponse = await restartedBackend.router.route(sidePanelQuery);
  assert.equal(queryResponse.ok, true);
  assert.deepEqual(
    queryResponse.data.missedPaths.map(
      (missedPath) => missedPath.candidate.id
    ),
    ["demo-candidate-002"]
  );
  assert.equal(harness.runtime.lifecycle, "finalized");
  assert.equal(harness.fixture.document.listenerCount("click"), 0);
  assert.equal(harness.fixture.document.listenerCount("auxclick"), 0);
  assert.equal(harness.intersection.instances[0].disconnectCount, 1);
});

test("does not finalize until the last absolute signal snapshot succeeds", async () => {
  let failSignals = true;
  let finalizeCalls = 0;
  const messages = [];
  const statuses = [];
  const harness = createRuntimeHarness({
    statuses,
    async sendMessage(message) {
      messages.push(message);
      if (message.type === MESSAGE_TYPES.CANDIDATES_DISCOVERED) {
        return createSuccessResponseMessage(message.requestId, {
          sessionId: "demo-session-001",
          acceptedCandidateIds: message.payload.candidates.map(
            (candidate) => candidate.id
          ),
          totalCandidateCount: message.payload.candidates.length,
          updatedAt: message.payload.discoveredAt
        });
      }
      if (message.type === MESSAGE_TYPES.SIGNALS_UPDATED) {
        if (failSignals) {
          return createErrorResponseMessage(message.requestId, {
            code: RESPONSE_ERROR_CODES.STORAGE_ERROR,
            message: "Synthetic signal failure.",
            retryable: true
          });
        }
        return createSuccessResponseMessage(message.requestId, {
          sessionId: message.payload.signals.sessionId,
          candidateId: message.payload.signals.candidateId,
          updatedAt: message.payload.updatedAt,
          changed: true
        });
      }
      if (message.type === MESSAGE_TYPES.SESSION_FINALIZE) {
        finalizeCalls += 1;
        return createSuccessResponseMessage(message.requestId, {
          sessionId: message.payload.sessionId,
          finalizedAt: message.payload.finalizedAt,
          alreadyFinalized: false,
          chosen: [],
          missedPaths: []
        });
      }
      throw new Error(`Unexpected message: ${message.type}`);
    }
  });

  await harness.runtime.start();
  await assert.rejects(
    harness.runtime.finalizeSession(),
    /SIGNALS_UPDATED 失败/u
  );
  assert.equal(finalizeCalls, 0);
  assert.equal(harness.runtime.lifecycle, "finalize-failed");
  assert.equal(statuses.at(-1).state, "error");

  failSignals = false;
  const retried = await harness.runtime.finalizeSession();
  assert.equal(retried.alreadyFinalized, false);
  assert.equal(finalizeCalls, 1);
  assert.equal(harness.runtime.lifecycle, "finalized");
  const lastSignalIndex = messages.findLastIndex(
    (message) => message.type === MESSAGE_TYPES.SIGNALS_UPDATED
  );
  const finalizeIndex = messages.findLastIndex(
    (message) => message.type === MESSAGE_TYPES.SESSION_FINALIZE
  );
  assert.ok(lastSignalIndex < finalizeIndex);
});

test("cleanup is idempotent and prevents later dynamic collection", async () => {
  const messages = [];
  const harness = createRuntimeHarness({
    async sendMessage(message) {
      messages.push(message);
      return createSuccessResponseMessage(message.requestId, {
        sessionId: "demo-session-001",
        acceptedCandidateIds: message.payload.candidates.map(
          (candidate) => candidate.id
        ),
        totalCandidateCount: message.payload.candidates.length,
        updatedAt: message.payload.discoveredAt
      });
    }
  });

  await harness.runtime.start();
  harness.runtime.cleanup();
  harness.runtime.cleanup();
  const messageCount = messages.length;
  harness.fixture.addCandidate({
    id: "demo-candidate-003",
    title: "Ignored after cleanup",
    href: "https://knowledge.example/result?id=3"
  });
  harness.mutation.instances[0].notify();
  await harness.runtime.whenIdle();

  assert.equal(harness.runtime.lifecycle, "cleaned");
  assert.equal(messages.length, messageCount);
  assert.equal(harness.fixture.document.listenerCount("click"), 0);
  assert.equal(harness.fixture.document.listenerCount("auxclick"), 0);
  assert.equal(harness.intersection.instances[0].disconnectCount, 1);
});

test("enters a paused state without writes and can restart after resume", async () => {
  let enabled = false;
  const messages = [];
  const statuses = [];
  const harness = createRuntimeHarness({
    statuses,
    async sendMessage(message) {
      messages.push(message);
      if (!enabled) {
        return createErrorResponseMessage(message.requestId, {
          code: RESPONSE_ERROR_CODES.COLLECTION_PAUSED,
          message: "Collection is paused.",
          retryable: false
        });
      }
      return createSuccessResponseMessage(message.requestId, {
        sessionId: message.payload.sessionId,
        acceptedCandidateIds: message.payload.candidates.map(
          (candidate) => candidate.id
        ),
        totalCandidateCount: message.payload.candidates.length,
        updatedAt: message.payload.discoveredAt
      });
    }
  });

  await assert.rejects(
    () => harness.runtime.start(),
    /Collection is paused/u
  );
  assert.equal(harness.runtime.lifecycle, "paused");
  assert.equal(messages.length, 1);
  assert.equal(statuses.at(-1).state, "paused");

  enabled = true;
  await harness.runtime.start();
  assert.equal(harness.runtime.lifecycle, "collecting");
  assert.equal(messages.length, 2);
  harness.runtime.cleanup();
});
