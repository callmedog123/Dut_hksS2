import assert from "node:assert/strict";
import test from "node:test";

import { createTagEnrichmentCoordinator } from "../../background/tagEnrichment.js";
import {
  RepositoryDataError,
  REPOSITORY_KINDS,
  createRepository
} from "../../storage/repository.js";
import { createTransactionalMemoryStorageAdapter } from "./fixtures/memoryStorageAdapter.js";

const SESSION_ID = "session-tag-store";

function createOwner(tabId = 3, documentId = "doc-a", sessionId = SESSION_ID) {
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

function createCandidate(id = "candidate-1", rank = 1) {
  return {
    id,
    url: `https://www.bilibili.com/video/${id}`,
    title: `Cognitive Map ${id}`,
    source: "bilibili-search",
    rank,
    sessionId: SESSION_ID
  };
}

function createSignals(candidateId = "candidate-1", overrides = {}) {
  return {
    candidateId,
    sessionId: SESSION_ID,
    visibleMs: 6_000,
    hoverMs: 2_000,
    hoverCount: 2,
    returnCount: 1,
    clicked: false,
    ...overrides
  };
}

function contextProfile(sessionId = SESSION_ID) {
  return { sessionId, normalizedTags: ["cognitive", "认知地图"] };
}

function candidateProfile(candidateId = "candidate-1") {
  return {
    candidateId,
    sessionId: SESSION_ID,
    nativeTags: ["#神经科学"],
    normalizedTags: ["神经科学"]
  };
}

function selectedProfile() {
  return {
    sessionId: SESSION_ID,
    selectedCandidateCount: 2,
    tags: [
      { tag: "认知地图", candidateCount: 2, weight: 1 },
      { tag: "导航", candidateCount: 1, weight: 0.5 }
    ]
  };
}

async function createSeededRepository(owner, candidates = [createCandidate()]) {
  const adapter = createTransactionalMemoryStorageAdapter();
  const repository = createRepository(adapter);
  await repository.mergeDiscoveredCandidates(
    {
      sessionId: SESSION_ID,
      context: createContext(),
      candidates,
      discoveredAt: 1_000
    },
    owner
  );
  return { adapter, repository };
}

test("tag profiles round-trip through the Repository", async () => {
  const owner = createOwner();
  const { repository } = await createSeededRepository(owner);

  assert.equal(await repository.saveContextTagProfile(contextProfile(), owner), true);
  assert.equal(
    await repository.saveCandidateTagProfile(candidateProfile(), owner),
    true
  );
  assert.equal(
    await repository.saveSessionSelectedTagProfile(selectedProfile(), owner),
    true
  );

  assert.deepEqual(
    await repository.getContextTagProfile(SESSION_ID, owner),
    contextProfile()
  );
  assert.deepEqual(
    await repository.getCandidateTagProfile(SESSION_ID, "candidate-1", owner),
    candidateProfile()
  );
  assert.deepEqual(
    await repository.getSessionSelectedTagProfile(SESSION_ID, owner),
    selectedProfile()
  );
});

test("re-saving identical tag data performs no extra commit", async () => {
  const owner = createOwner();
  const { adapter, repository } = await createSeededRepository(owner);

  await repository.saveContextTagProfile(contextProfile(), owner);
  const commitsAfterFirstWrite = adapter.commitCount;
  assert.equal(
    await repository.saveContextTagProfile(contextProfile(), owner),
    false
  );

  assert.equal(adapter.commitCount, commitsAfterFirstWrite);
});

test("invalid tag data is rejected", async () => {
  const owner = createOwner();
  const { repository } = await createSeededRepository(owner);

  await assert.rejects(
    () =>
      repository.saveContextTagProfile(
        { sessionId: SESSION_ID, normalizedTags: ["认知地图", "cognitive"] },
        owner
      ),
    RepositoryDataError,
    "unsorted normalized tags must be rejected"
  );
  await assert.rejects(
    () =>
      repository.saveCandidateTagProfile(
        {
          candidateId: "candidate-1",
          sessionId: SESSION_ID,
          nativeTags: ["#神经科学"],
          normalizedTags: []
        },
        owner
      ),
    RepositoryDataError,
    "a native tag without its normalized form must be rejected"
  );
  await assert.rejects(
    () =>
      repository.saveSessionSelectedTagProfile(
        {
          sessionId: SESSION_ID,
          selectedCandidateCount: 0,
          tags: [{ tag: "认知地图", candidateCount: 1, weight: 1 }]
        },
        owner
      ),
    RepositoryDataError,
    "tags without any selected Candidate must be rejected"
  );
});

test("tag records are isolated per Session Owner", async () => {
  const adapter = createTransactionalMemoryStorageAdapter();
  const repository = createRepository(adapter);
  const ownerA = createOwner(1, "doc-a");
  const ownerB = createOwner(2, "doc-b");
  const ownerSameTabNewDocument = createOwner(1, "doc-b");

  for (const owner of [ownerA, ownerB, ownerSameTabNewDocument]) {
    await repository.mergeDiscoveredCandidates(
      {
        sessionId: SESSION_ID,
        context: createContext(),
        candidates: [createCandidate()],
        discoveredAt: 1_000
      },
      owner
    );
  }

  await repository.saveCandidateTagProfile(candidateProfile(), ownerA);

  assert.notEqual(
    await repository.getCandidateTagProfile(SESSION_ID, "candidate-1", ownerA),
    null
  );
  assert.equal(
    await repository.getCandidateTagProfile(SESSION_ID, "candidate-1", ownerB),
    null
  );
  assert.equal(
    await repository.getCandidateTagProfile(
      SESSION_ID,
      "candidate-1",
      ownerSameTabNewDocument
    ),
    null,
    "a newer document in the same tab must not read the older document tags"
  );
});

test("listCandidateTagProfiles returns only the owned Session", async () => {
  const adapter = createTransactionalMemoryStorageAdapter();
  const repository = createRepository(adapter);
  const ownerA = createOwner(1, "doc-a");
  const ownerB = createOwner(2, "doc-b");
  const candidates = [createCandidate("candidate-1", 1), createCandidate("candidate-2", 2)];

  for (const owner of [ownerA, ownerB]) {
    await repository.mergeDiscoveredCandidates(
      {
        sessionId: SESSION_ID,
        context: createContext(),
        candidates,
        discoveredAt: 1_000
      },
      owner
    );
  }

  await repository.saveCandidateTagProfile(candidateProfile("candidate-1"), ownerA);
  await repository.saveCandidateTagProfile(candidateProfile("candidate-2"), ownerA);
  await repository.saveCandidateTagProfile(candidateProfile("candidate-1"), ownerB);

  const ownedProfiles = await repository.listCandidateTagProfiles(
    SESSION_ID,
    ownerA
  );

  assert.equal(ownedProfiles.length, 2);
  assert.deepEqual(
    ownedProfiles.map((profile) => profile.candidateId),
    ["candidate-1", "candidate-2"]
  );
});

test("a candidate id containing the key separator stays addressable", async () => {
  const owner = createOwner();
  const trickyId = "candidate:1:tag-context";
  const { repository } = await createSeededRepository(owner, [
    { ...createCandidate(trickyId), rank: 1 }
  ]);

  await repository.saveCandidateTagProfile(candidateProfile(trickyId), owner);

  assert.deepEqual(
    await repository.getCandidateTagProfile(SESSION_ID, trickyId, owner),
    candidateProfile(trickyId)
  );
  const listed = await repository.listCandidateTagProfiles(SESSION_ID, owner);
  assert.equal(listed.length, 1);
});

test("deleteSessionTagProfiles removes every kind in one commit", async () => {
  const owner = createOwner();
  const { adapter, repository } = await createSeededRepository(owner, [
    createCandidate("candidate-1", 1),
    createCandidate("candidate-2", 2)
  ]);

  await repository.saveContextTagProfile(contextProfile(), owner);
  await repository.saveCandidateTagProfile(candidateProfile("candidate-1"), owner);
  await repository.saveCandidateTagProfile(candidateProfile("candidate-2"), owner);
  await repository.saveSessionSelectedTagProfile(selectedProfile(), owner);

  const commitsBefore = adapter.commitCount;
  assert.equal(await repository.deleteSessionTagProfiles(SESSION_ID, owner), true);

  assert.equal(adapter.commitCount, commitsBefore + 1);
  assert.equal(await repository.getContextTagProfile(SESSION_ID, owner), null);
  assert.equal(
    (await repository.listCandidateTagProfiles(SESSION_ID, owner)).length,
    0
  );
  assert.equal(
    await repository.getSessionSelectedTagProfile(SESSION_ID, owner),
    null
  );
  assert.equal(
    await repository.deleteSessionTagProfiles(SESSION_ID, owner),
    false,
    "a repeated delete must be idempotent"
  );
});

test("deleteSession cascades tag profiles for that owner only", async () => {
  const adapter = createTransactionalMemoryStorageAdapter();
  const repository = createRepository(adapter);
  const ownerA = createOwner(1, "doc-a");
  const ownerB = createOwner(2, "doc-b");

  for (const owner of [ownerA, ownerB]) {
    await repository.mergeDiscoveredCandidates(
      {
        sessionId: SESSION_ID,
        context: createContext(),
        candidates: [createCandidate()],
        discoveredAt: 1_000
      },
      owner
    );
    await repository.saveContextTagProfile(contextProfile(), owner);
    await repository.saveCandidateTagProfile(candidateProfile(), owner);
  }

  await repository.deleteSession(SESSION_ID, ownerA);

  assert.equal(await repository.getContextTagProfile(SESSION_ID, ownerA), null);
  assert.equal(
    await repository.getCandidateTagProfile(SESSION_ID, "candidate-1", ownerA),
    null
  );
  assert.notEqual(
    await repository.getContextTagProfile(SESSION_ID, ownerB),
    null,
    "the other tab must keep its tag data"
  );
});

test("deleting one Missed Path keeps Session tag profiles", async () => {
  const owner = createOwner();
  const { repository } = await createSeededRepository(owner);
  await repository.saveContextTagProfile(contextProfile(), owner);
  await repository.saveCandidateTagProfile(candidateProfile(), owner);

  await repository.saveMissedPath({
    id: "missed-1",
    candidate: createCandidate(),
    context: createContext(),
    score: 0.7,
    reasons: [{ code: "LONG_HOVER", label: "长悬停" }],
    status: "MISSED",
    createdAt: 3_000
  });
  assert.equal(await repository.deleteMissedPath("missed-1"), true);

  assert.notEqual(await repository.getContextTagProfile(SESSION_ID, owner), null);
  assert.notEqual(
    await repository.getCandidateTagProfile(SESSION_ID, "candidate-1", owner),
    null,
    "remaining Missed Paths of the Session still rely on the tag profiles"
  );
});

test("deleteAll clears tag records and keeps Settings", async () => {
  const owner = createOwner();
  const { adapter, repository } = await createSeededRepository(owner);
  await repository.saveSettings({
    enabled: false,
    allowlist: [],
    blocklist: [],
    thresholds: { consideration: 0.55, reencounter: 0.6 },
    demoMode: false
  });
  await repository.saveContextTagProfile(contextProfile(), owner);
  await repository.saveCandidateTagProfile(candidateProfile(), owner);
  await repository.saveSessionSelectedTagProfile(selectedProfile(), owner);

  assert.equal(await repository.deleteAll(), true);

  assert.equal(
    adapter
      .snapshot()
      .some(({ key }) => key.startsWith("tag-")),
    false
  );
  assert.equal((await repository.getSettings()).enabled, false);
});

test("a Worker restart reads tag profiles from storage", async () => {
  const owner = createOwner();
  const { adapter, repository } = await createSeededRepository(owner);
  await repository.saveContextTagProfile(contextProfile(), owner);
  await repository.saveCandidateTagProfile(candidateProfile(), owner);

  const restarted = createRepository(adapter);
  const coordinator = createTagEnrichmentCoordinator(restarted, null);
  const profiles = await coordinator.getAuthoritativeTagProfiles(
    SESSION_ID,
    owner
  );

  assert.deepEqual(profiles.contextProfile, contextProfile());
  assert.equal(profiles.candidateProfiles.length, 1);
  assert.equal(profiles.selectedProfile.selectedCandidateCount, 0);
});

test("a failed commit leaves no partial tag state", async () => {
  const owner = createOwner();
  const { adapter, repository } = await createSeededRepository(owner);

  adapter.failNextCommit(new Error("storage offline"));
  await assert.rejects(
    () => repository.saveContextTagProfile(contextProfile(), owner),
    /storage offline/u
  );

  assert.equal(await repository.getContextTagProfile(SESSION_ID, owner), null);
  assert.equal(
    await repository.saveContextTagProfile(contextProfile(), owner),
    true,
    "a retry after failure must succeed"
  );
});

test("tag kinds are registered exactly once", () => {
  assert.equal(REPOSITORY_KINDS.TAG_CONTEXT, "tag-context");
  assert.equal(REPOSITORY_KINDS.TAG_CANDIDATE, "tag-candidate");
  assert.equal(REPOSITORY_KINDS.TAG_SELECTED, "tag-selected");
});
