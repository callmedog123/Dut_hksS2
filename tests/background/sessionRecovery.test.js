import assert from "node:assert/strict";
import test from "node:test";

import {
  SESSION_RECOVERY_CONFIG,
  createSessionRecoveryCoordinator
} from "../../background/sessionRecovery.js";
import { createSessionManager } from "../../background/sessionManager.js";
import { SESSION_LIFECYCLE_STATUSES } from "../../shared/types.js";
import { createRepository } from "../../storage/repository.js";
import { createTransactionalMemoryStorageAdapter } from "../storage/fixtures/memoryStorageAdapter.js";

function createOwner(tabId, sessionId) {
  return {
    tabId,
    documentId: `document-${tabId}`,
    frameId: 0,
    sessionId
  };
}

function createContext(query, timestamp) {
  return {
    query,
    source: "local-demo",
    timestamp,
    keywords: query.split(" ")
  };
}

function createCandidate(sessionId, id, rank) {
  return {
    id,
    url: `https://example.com/${id}`,
    title: `Result ${id}`,
    source: "local-demo",
    rank,
    sessionId
  };
}

async function discover(repository, sessionId, discoveredAt, owner, count = 1) {
  const candidates = Array.from({ length: count }, (_, index) =>
    createCandidate(sessionId, `candidate-${index + 1}`, index + 1)
  );
  await repository.mergeDiscoveredCandidates(
    {
      sessionId,
      context: createContext(`query ${sessionId}`, discoveredAt),
      candidates,
      discoveredAt
    },
    owner
  );
  return candidates;
}

function createCoordinator(repository, nowRef, leasePrefix = "recovery") {
  let leaseSequence = 0;
  const manager = createSessionManager(repository, {
    leaseIdFactory: () => `manager-${++leaseSequence}`
  });
  return createSessionRecoveryCoordinator(repository, manager, {
    now: () => nowRef.value,
    leaseIdFactory: () => `${leasePrefix}-${++leaseSequence}`
  });
}

function createCoordinatorWithPageCheck(
  repository,
  nowRef,
  isPageInstanceActive
) {
  const manager = createSessionManager(repository, {
    leaseIdFactory: () => "manager-page-check"
  });
  return createSessionRecoveryCoordinator(repository, manager, {
    now: () => nowRef.value,
    leaseIdFactory: () => "recovery-page-check",
    isPageInstanceActive
  });
}

test("recovers persisted Chosen and Missed Paths once after a forced exit", async () => {
  const adapter = createTransactionalMemoryStorageAdapter();
  const repository = createRepository(adapter);
  const owner = createOwner(1, "session-1");
  const candidates = await discover(repository, "session-1", 1_000, owner, 2);
  await repository.mergeCandidateSignalsSnapshot(
    {
      signals: {
        candidateId: candidates[0].id,
        sessionId: "session-1",
        visibleMs: 10_000,
        hoverMs: 3_000,
        hoverCount: 4,
        returnCount: 2,
        clicked: true
      },
      updatedAt: 2_000
    },
    owner
  );
  await repository.mergeCandidateSignalsSnapshot(
    {
      signals: {
        candidateId: candidates[1].id,
        sessionId: "session-1",
        visibleMs: 10_000,
        hoverMs: 3_000,
        hoverCount: 4,
        returnCount: 2,
        clicked: false
      },
      updatedAt: 2_000
    },
    owner
  );

  const nowRef = { value: 2_000 + SESSION_RECOVERY_CONFIG.recoveryWindowMs };
  const coordinator = createCoordinator(repository, nowRef);
  const first = await coordinator.scan();
  assert.deepEqual(first.finalized, ["session-1"]);
  assert.deepEqual(first.abandoned, []);
  assert.deepEqual(first.failed, []);
  assert.equal((await repository.listChosen()).length, 1);
  assert.equal((await repository.listMissedPaths()).length, 1);
  assert.notEqual(
    (await repository.listMissedPaths())[0].candidate.id,
    candidates[0].id
  );
  assert.equal(
    (await repository.getSession("session-1", owner)).status,
    SESSION_LIFECYCLE_STATUSES.FINALIZED
  );

  const restarted = createCoordinator(createRepository(adapter), nowRef);
  const repeated = await restarted.scan();
  assert.deepEqual(repeated.finalized, []);
  assert.equal((await repository.listChosen()).length, 1);
  assert.equal((await repository.listMissedPaths()).length, 1);
});

test("takes over only an expired FINALIZING lease", async () => {
  const repository = createRepository(
    createTransactionalMemoryStorageAdapter()
  );
  const owner = createOwner(1, "session-lease");
  const [candidate] = await discover(
    repository,
    "session-lease",
    1_000,
    owner
  );
  await repository.mergeCandidateSignalsSnapshot(
    {
      signals: {
        candidateId: candidate.id,
        sessionId: "session-lease",
        visibleMs: 10_000,
        hoverMs: 3_000,
        hoverCount: 2,
        returnCount: 1,
        clicked: false
      },
      updatedAt: 2_000
    },
    owner
  );
  await repository.claimSessionFinalizationLease(
    {
      sessionId: "session-lease",
      finalizationLeaseId: "interrupted-worker",
      claimedAt: 3_000,
      leaseUntil: 4_000
    },
    owner
  );

  const nowRef = { value: 3_999 };
  const coordinator = createCoordinator(repository, nowRef, "takeover");
  assert.deepEqual((await coordinator.scan()).finalized, []);
  nowRef.value = 4_000;
  assert.deepEqual((await coordinator.scan()).finalized, ["session-lease"]);
  assert.equal((await repository.listMissedPaths()).length, 1);
});

test("concurrent Worker scans converge on one durable finalization", async () => {
  const adapter = createTransactionalMemoryStorageAdapter();
  const firstRepository = createRepository(adapter);
  const owner = createOwner(1, "session-race");
  const [candidate] = await discover(
    firstRepository,
    "session-race",
    1_000,
    owner
  );
  await firstRepository.mergeCandidateSignalsSnapshot(
    {
      signals: {
        candidateId: candidate.id,
        sessionId: "session-race",
        visibleMs: 10_000,
        hoverMs: 3_000,
        hoverCount: 2,
        returnCount: 1,
        clicked: false
      },
      updatedAt: 2_000
    },
    owner
  );
  const nowRef = { value: 2_000 + SESSION_RECOVERY_CONFIG.recoveryWindowMs };
  const secondRepository = createRepository(adapter);
  const [first, second] = await Promise.all([
    createCoordinator(firstRepository, nowRef, "worker-a").scan(),
    createCoordinator(secondRepository, nowRef, "worker-b").scan()
  ]);

  assert.equal(first.finalized.length + second.finalized.length, 1);
  assert.equal((await firstRepository.listMissedPaths()).length, 1);
  assert.notEqual(
    await firstRepository.getSessionFinalization("session-race", owner),
    null
  );
  assert.equal(
    (await firstRepository.getSession("session-race", owner)).status,
    SESSION_LIFECYCLE_STATUSES.FINALIZED
  );
});

test("abandons empty or zero-signal Sessions and clears their contexts", async () => {
  const repository = createRepository(
    createTransactionalMemoryStorageAdapter()
  );
  const owner = createOwner(1, "session-zero");
  const emptyOwner = createOwner(2, "session-empty");
  await discover(repository, "session-zero", 1_000, owner);
  await repository.saveSession({
    sessionId: "session-empty",
    owner: emptyOwner,
    context: createContext("query session-empty", 1_000),
    candidates: [],
    updatedAt: 1_000,
    status: SESSION_LIFECYCLE_STATUSES.OPEN
  });
  const nowRef = { value: 1_000 + SESSION_RECOVERY_CONFIG.recoveryWindowMs };

  const recovered = await createCoordinator(repository, nowRef).scan();
  assert.deepEqual(recovered.abandoned.sort(), ["session-empty", "session-zero"]);
  assert.equal(
    (await repository.getSession("session-zero", owner)).status,
    SESSION_LIFECYCLE_STATUSES.ABANDONED
  );
  assert.equal(await repository.getActiveContextForTab(owner.tabId), null);
  assert.deepEqual(await repository.listChosen(), []);
  assert.deepEqual(await repository.listMissedPaths(), []);
  assert.deepEqual(
    await repository.getSessionFinalization("session-zero", owner),
    {
      sessionId: "session-zero",
      owner,
      finalizedAt: nowRef.value,
      chosenIds: [],
      missedPathIds: [],
      status: SESSION_LIFECYCLE_STATUSES.ABANDONED
    }
  );

  const restartedManager = createSessionManager(repository, {
    leaseIdFactory: () => "must-not-be-used"
  });
  assert.deepEqual(
    await restartedManager.finalizeSession(
      "session-zero",
      nowRef.value + 1,
      owner,
      { abandonIfNoMeaningful: true }
    ),
    {
      sessionId: "session-zero",
      abandonedAt: nowRef.value,
      abandoned: true,
      alreadyFinalized: true,
      chosen: [],
      missedPaths: []
    }
  );
});

test("ordinary recovery skips the exact living page instance", async () => {
  const repository = createRepository(
    createTransactionalMemoryStorageAdapter()
  );
  const owner = createOwner(7, "session-live-context");
  await discover(repository, owner.sessionId, 1_000, owner);
  const nowRef = { value: 1_000 + SESSION_RECOVERY_CONFIG.recoveryWindowMs };
  const checkedOwners = [];
  const coordinator = createCoordinatorWithPageCheck(
    repository,
    nowRef,
    async (session) => {
      checkedOwners.push(session.owner);
      return true;
    }
  );

  const result = await coordinator.scan();

  assert.deepEqual(checkedOwners, [owner]);
  assert.deepEqual(result.skipped, [owner.sessionId]);
  assert.deepEqual(result.finalized, []);
  assert.deepEqual(result.abandoned, []);
  assert.equal(
    (await repository.getSession(owner.sessionId, owner)).status,
    SESSION_LIFECYCLE_STATUSES.OPEN
  );
  assert.equal(
    await repository.getSessionFinalization(owner.sessionId, owner),
    null
  );
});

test("isolates two tabs and skips a recently re-registered Session", async () => {
  const repository = createRepository(
    createTransactionalMemoryStorageAdapter()
  );
  const staleOwner = createOwner(1, "session-stale");
  const liveOwner = createOwner(2, "session-live");
  await discover(repository, "session-stale", 1_000, staleOwner);
  const [liveCandidate] = await discover(
    repository,
    "session-live",
    1_000,
    liveOwner
  );
  const nowRef = { value: 50_000 };
  await repository.mergeDiscoveredCandidates(
    {
      sessionId: "session-live",
      context: createContext("query session-live", 1_000),
      candidates: [liveCandidate],
      discoveredAt: 49_000
    },
    liveOwner
  );

  const result = await createCoordinator(repository, nowRef).scan();
  assert.deepEqual(result.abandoned, ["session-stale"]);
  assert.equal(
    (await repository.getSession("session-live", liveOwner)).status,
    SESSION_LIFECYCLE_STATUSES.OPEN
  );
  assert.notEqual(await repository.getActiveContextForTab(2), null);
});

test("rolls back a failed recovery write and retries after a restart", async () => {
  const adapter = createTransactionalMemoryStorageAdapter();
  const repository = createRepository(adapter);
  const owner = createOwner(1, "session-retry");
  const [candidate] = await discover(
    repository,
    "session-retry",
    1_000,
    owner
  );
  await repository.mergeCandidateSignalsSnapshot(
    {
      signals: {
        candidateId: candidate.id,
        sessionId: "session-retry",
        visibleMs: 10_000,
        hoverMs: 3_000,
        hoverCount: 2,
        returnCount: 1,
        clicked: false
      },
      updatedAt: 2_000
    },
    owner
  );
  await repository.claimSessionFinalizationLease(
    {
      sessionId: "session-retry",
      finalizationLeaseId: "recovery-retry-1",
      claimedAt: 3_000,
      leaseUntil: 4_000
    },
    owner
  );
  const nowRef = { value: 4_000 };
  const coordinator = createCoordinator(repository, nowRef, "recovery-retry");
  adapter.failNextCommit(new Error("simulated recovery transaction failure"));

  const failed = await coordinator.scan();
  assert.equal(failed.failed.length, 1);
  assert.deepEqual(await repository.listMissedPaths(), []);
  assert.equal(await repository.getSessionFinalization("session-retry", owner), null);
  assert.equal(
    (await repository.getSession("session-retry", owner)).status,
    SESSION_LIFECYCLE_STATUSES.OPEN
  );

  nowRef.value += SESSION_RECOVERY_CONFIG.recoveryWindowMs;
  const restarted = createCoordinator(createRepository(adapter), nowRef);
  assert.deepEqual((await restarted.scan()).finalized, ["session-retry"]);
  assert.equal((await repository.listMissedPaths()).length, 1);
});
