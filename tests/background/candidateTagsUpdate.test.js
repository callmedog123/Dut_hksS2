import assert from "node:assert/strict";
import test from "node:test";

import {
  CandidateTagsUpdateError,
  createCandidateTagsUpdateUseCase
} from "../../background/candidateTagsUpdate.js";
import { RESPONSE_ERROR_CODES } from "../../shared/messages.js";
import { SESSION_LIFECYCLE_STATUSES } from "../../shared/types.js";
import {
  RepositoryDataError,
  RepositoryVersionError,
  createRepository
} from "../../storage/repository.js";
import { createTransactionalMemoryStorageAdapter } from "../storage/fixtures/memoryStorageAdapter.js";

const SESSION_ID = "session-1";

function createOwner(tabId = 7, documentId = "doc-a", sessionId = SESSION_ID) {
  return { tabId, documentId, frameId: 0, sessionId };
}

function createContext(query = "认知地图 cognitive map") {
  return {
    query,
    source: "bilibili-search",
    timestamp: 1_000,
    keywords: ["认知地图"]
  };
}

function createCandidate(id = "candidate-1", rank = 1, title = "Result one") {
  return {
    id,
    url: `https://www.bilibili.com/video/${id}`,
    title,
    source: "bilibili-search",
    rank,
    sessionId: SESSION_ID
  };
}

function createSession(overrides = {}) {
  return {
    sessionId: SESSION_ID,
    context: createContext(),
    candidates: [
      { candidate: createCandidate(), signals: {} },
      { candidate: createCandidate("candidate-2", 2, "Result two"), signals: {} }
    ],
    updatedAt: 100,
    ...overrides
  };
}

function createFakeRepository(overrides = {}) {
  const savedProfiles = [];
  return {
    savedProfiles,
    async getSessionFinalization() {
      return null;
    },
    async getSession() {
      return createSession();
    },
    async saveCandidateTagProfile(profile) {
      savedProfiles.push(profile);
      return true;
    },
    ...overrides
  };
}

async function createSeededRepository(owner, candidates) {
  const adapter = createTransactionalMemoryStorageAdapter();
  const repository = createRepository(adapter);
  await repository.mergeDiscoveredCandidates(
    {
      sessionId: SESSION_ID,
      context: createContext(),
      candidates,
      discoveredAt: 100
    },
    owner
  );
  return { adapter, repository };
}

test("persists native tags for every accepted Candidate and returns their IDs", async () => {
  const repository = createFakeRepository();
  const useCase = createCandidateTagsUpdateUseCase(repository);

  const result = await useCase.execute({
    sessionId: SESSION_ID,
    tags: [
      { candidateId: "candidate-1", nativeTags: ["#AI", "机器人"] },
      { candidateId: "candidate-2", nativeTags: [] }
    ],
    discoveredAt: 200
  });

  assert.deepEqual(result, {
    sessionId: SESSION_ID,
    acceptedCandidateIds: ["candidate-1", "candidate-2"],
    storedCandidateCount: 2
  });
  assert.equal(repository.savedProfiles.length, 2);
  assert.equal(repository.savedProfiles[0].candidateId, "candidate-1");
  assert.deepEqual(repository.savedProfiles[0].nativeTags, ["机器人", "#AI"].sort());
});

test("uses the Repository title, never a message-supplied title", async () => {
  const repository = createFakeRepository();
  const useCase = createCandidateTagsUpdateUseCase(repository);

  await useCase.execute({
    sessionId: SESSION_ID,
    tags: [{ candidateId: "candidate-1", nativeTags: [], title: "spoofed" }],
    discoveredAt: 200
  });

  const profile = repository.savedProfiles[0];
  // createCandidateTagProfile only reads candidateId/sessionId/title/nativeTags
  // from its input object, and the use case always supplies the Repository
  // title, so a message-supplied title field has no effect.
  assert.equal(Object.hasOwn(profile, "title"), false);
});

test("rejects a Candidate that is not part of the owned Session", async () => {
  const repository = createFakeRepository();
  const useCase = createCandidateTagsUpdateUseCase(repository);

  await assert.rejects(
    () =>
      useCase.execute({
        sessionId: SESSION_ID,
        tags: [{ candidateId: "candidate-not-in-session", nativeTags: [] }],
        discoveredAt: 200
      }),
    (error) =>
      error instanceof CandidateTagsUpdateError &&
      error.code === RESPONSE_ERROR_CODES.CANDIDATE_TAGS_CONFLICT &&
      error.retryable === false
  );
  assert.equal(repository.savedProfiles.length, 0);
});

test("rejects a batch for a Session that does not exist", async () => {
  const repository = createFakeRepository({
    async getSession() {
      return null;
    }
  });
  const useCase = createCandidateTagsUpdateUseCase(repository);

  await assert.rejects(
    () =>
      useCase.execute({
        sessionId: SESSION_ID,
        tags: [{ candidateId: "candidate-1", nativeTags: [] }],
        discoveredAt: 200
      }),
    (error) =>
      error instanceof CandidateTagsUpdateError &&
      error.code === RESPONSE_ERROR_CODES.SESSION_NOT_FOUND
  );
});

test("rejects a late batch for an already finalized Session", async () => {
  const repository = createFakeRepository({
    async getSessionFinalization() {
      return { sessionId: SESSION_ID, finalizedAt: 500 };
    }
  });
  const useCase = createCandidateTagsUpdateUseCase(repository);

  await assert.rejects(
    () =>
      useCase.execute({
        sessionId: SESSION_ID,
        tags: [{ candidateId: "candidate-1", nativeTags: [] }],
        discoveredAt: 600
      }),
    (error) =>
      error instanceof CandidateTagsUpdateError &&
      error.code === RESPONSE_ERROR_CODES.CANDIDATE_TAGS_CONFLICT &&
      error.retryable === false
  );
  assert.equal(repository.savedProfiles.length, 0);
});

test("rejects a batch for a Session that is not OPEN", async () => {
  const repository = createFakeRepository({
    async getSession() {
      return createSession({ status: SESSION_LIFECYCLE_STATUSES.FINALIZING });
    }
  });
  const useCase = createCandidateTagsUpdateUseCase(repository);

  await assert.rejects(
    () =>
      useCase.execute({
        sessionId: SESSION_ID,
        tags: [{ candidateId: "candidate-1", nativeTags: [] }],
        discoveredAt: 200
      }),
    (error) =>
      error instanceof CandidateTagsUpdateError &&
      error.code === RESPONSE_ERROR_CODES.CANDIDATE_TAGS_CONFLICT
  );
});

test("maps Repository version incompatibility to a non-retryable error", async () => {
  const repository = createFakeRepository({
    async getSessionFinalization() {
      throw new RepositoryVersionError(3);
    }
  });
  const useCase = createCandidateTagsUpdateUseCase(repository);

  await assert.rejects(
    () =>
      useCase.execute({
        sessionId: SESSION_ID,
        tags: [{ candidateId: "candidate-1", nativeTags: [] }],
        discoveredAt: 200
      }),
    (error) =>
      error instanceof CandidateTagsUpdateError &&
      error.code === RESPONSE_ERROR_CODES.SCHEMA_VERSION_UNSUPPORTED &&
      error.retryable === false
  );
});

test("maps Repository data errors to a non-retryable conflict", async () => {
  const repository = createFakeRepository({
    async saveCandidateTagProfile() {
      throw new RepositoryDataError("Invalid Candidate tag profile data.");
    }
  });
  const useCase = createCandidateTagsUpdateUseCase(repository);

  await assert.rejects(
    () =>
      useCase.execute({
        sessionId: SESSION_ID,
        tags: [{ candidateId: "candidate-1", nativeTags: [] }],
        discoveredAt: 200
      }),
    (error) =>
      error instanceof CandidateTagsUpdateError &&
      error.code === RESPONSE_ERROR_CODES.CANDIDATE_TAGS_CONFLICT &&
      error.retryable === false
  );
});

test("maps unexpected storage failures to a retryable error", async () => {
  const repository = createFakeRepository({
    async saveCandidateTagProfile() {
      throw new Error("simulated storage failure");
    }
  });
  const useCase = createCandidateTagsUpdateUseCase(repository);

  await assert.rejects(
    () =>
      useCase.execute({
        sessionId: SESSION_ID,
        tags: [{ candidateId: "candidate-1", nativeTags: [] }],
        discoveredAt: 200
      }),
    (error) =>
      error instanceof CandidateTagsUpdateError &&
      error.code === RESPONSE_ERROR_CODES.STORAGE_ERROR &&
      error.retryable === true
  );
});

test("an empty tags array persists nothing and reports zero stored", async () => {
  const repository = createFakeRepository();
  const useCase = createCandidateTagsUpdateUseCase(repository);

  const result = await useCase.execute({
    sessionId: SESSION_ID,
    tags: [],
    discoveredAt: 200
  });

  assert.deepEqual(result, {
    sessionId: SESSION_ID,
    acceptedCandidateIds: [],
    storedCandidateCount: 0
  });
  assert.equal(repository.savedProfiles.length, 0);
});

test("tags are isolated per Session Owner against the real Repository", async () => {
  const ownerA = createOwner(1, "doc-a");
  const ownerB = createOwner(2, "doc-b");
  const candidates = [createCandidate()];
  const adapter = createTransactionalMemoryStorageAdapter();
  const repository = createRepository(adapter);
  for (const owner of [ownerA, ownerB]) {
    await repository.mergeDiscoveredCandidates(
      {
        sessionId: SESSION_ID,
        context: createContext(),
        candidates,
        discoveredAt: 100
      },
      owner
    );
  }
  const useCase = createCandidateTagsUpdateUseCase(repository);

  await useCase.execute(
    {
      sessionId: SESSION_ID,
      tags: [{ candidateId: "candidate-1", nativeTags: ["#AI"] }],
      discoveredAt: 200
    },
    ownerA
  );

  const storedA = await repository.getCandidateTagProfile(
    SESSION_ID,
    "candidate-1",
    ownerA
  );
  const storedB = await repository.getCandidateTagProfile(
    SESSION_ID,
    "candidate-1",
    ownerB
  );
  assert.notEqual(storedA, null);
  assert.equal(storedB, null, "tab B must not see tab A native tags");
});

test("a late batch after real finalize is rejected without mutating tag data", async () => {
  const owner = createOwner();
  const { repository } = await createSeededRepository(owner, [
    createCandidate()
  ]);
  await repository.mergeCandidateSignalsSnapshot(
    {
      signals: {
        candidateId: "candidate-1",
        sessionId: SESSION_ID,
        visibleMs: 6_000,
        hoverMs: 2_000,
        hoverCount: 2,
        returnCount: 1,
        clicked: false
      },
      updatedAt: 150
    },
    owner
  );
  await repository.finalizeSessionAtomically(
    {
      sessionId: SESSION_ID,
      finalizedAt: 500,
      chosen: [],
      missedPaths: [],
      finalizationLeaseId: "lease-1"
    },
    owner
  );
  const useCase = createCandidateTagsUpdateUseCase(repository);

  await assert.rejects(
    () =>
      useCase.execute(
        {
          sessionId: SESSION_ID,
          tags: [{ candidateId: "candidate-1", nativeTags: ["#late"] }],
          discoveredAt: 600
        },
        owner
      ),
    (error) =>
      error instanceof CandidateTagsUpdateError &&
      error.code === RESPONSE_ERROR_CODES.CANDIDATE_TAGS_CONFLICT
  );

  assert.equal(
    await repository.getCandidateTagProfile(SESSION_ID, "candidate-1", owner),
    null
  );
});

test("saving the same native tags twice for one Candidate is idempotent", async () => {
  const owner = createOwner();
  const { adapter, repository } = await createSeededRepository(owner, [
    createCandidate()
  ]);
  const useCase = createCandidateTagsUpdateUseCase(repository);
  const payload = {
    sessionId: SESSION_ID,
    tags: [{ candidateId: "candidate-1", nativeTags: ["#AI"] }],
    discoveredAt: 200
  };

  await useCase.execute(payload, owner);
  const commitsAfterFirst = adapter.commitCount;
  await useCase.execute(payload, owner);

  assert.equal(
    adapter.commitCount,
    commitsAfterFirst,
    "an identical repeated batch must not write again"
  );
});
