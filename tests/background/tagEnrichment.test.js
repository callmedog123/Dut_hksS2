import assert from "node:assert/strict";
import test from "node:test";

import {
  TAG_ENRICHMENT_CONFIG,
  TAG_SOURCES,
  calculateTagEnrichmentBehaviorScore,
  createTagEnrichmentCoordinator,
  isEligibleForTagEnrichment
} from "../../background/tagEnrichment.js";
import { CONSIDERATION_SCORING_CONFIG } from "../../background/scoringConfig.js";
import { createRepository } from "../../storage/repository.js";
import { createTransactionalMemoryStorageAdapter } from "../storage/fixtures/memoryStorageAdapter.js";
import { createFakeTagProvider } from "./fixtures/fakeTagProvider.js";

const SESSION_ID = "session-tags";

function createOwner(tabId = 7, documentId = "doc-a", sessionId = SESSION_ID) {
  return { tabId, documentId, frameId: 0, sessionId };
}

function createSignals(overrides = {}) {
  return {
    candidateId: "candidate-1",
    sessionId: SESSION_ID,
    visibleMs: 0,
    hoverMs: 0,
    hoverCount: 0,
    returnCount: 0,
    clicked: false,
    ...overrides
  };
}

function createCandidate(id = "candidate-1", title = "Cognitive Map 认知地图") {
  return {
    id,
    url: `https://www.bilibili.com/video/${id}`,
    title,
    source: "bilibili-search",
    rank: 1,
    sessionId: SESSION_ID
  };
}

function createContext(query = "认知地图 cognitive map") {
  return {
    query,
    source: "bilibili-search",
    timestamp: 1_000,
    keywords: ["认知地图"]
  };
}

async function createSessionRepository(owner, candidates) {
  const adapter = createTransactionalMemoryStorageAdapter();
  const repository = createRepository(adapter);
  await repository.mergeDiscoveredCandidates(
    {
      sessionId: SESSION_ID,
      context: createContext(),
      candidates: candidates.map(({ candidate }) => candidate),
      discoveredAt: 1_000
    },
    owner
  );
  for (const { candidate, signals } of candidates) {
    await repository.mergeCandidateSignalsSnapshot(
      {
        signals: { ...signals, candidateId: candidate.id },
        updatedAt: 1_500
      },
      owner
    );
    if (signals.clicked) {
      await repository.markCandidateChosen(
        SESSION_ID,
        candidate.id,
        2_000,
        owner
      );
    }
  }
  return { adapter, repository };
}

test("the approved eligibility bounds are the single configuration source", () => {
  assert.deepEqual(TAG_ENRICHMENT_CONFIG.eligibility, {
    clickedAlwaysQualifies: true,
    minReturnCount: 1,
    minHoverMs: 1_200,
    exposureAloneQualifies: false,
    minBehaviorScore: 0.35
  });
  assert.equal(
    TAG_ENRICHMENT_CONFIG.limits.maxEnrichedCandidatesPerSession,
    12
  );
  assert.equal(TAG_ENRICHMENT_CONFIG.limits.maxAttemptsPerCandidate, 2);
  assert.equal(TAG_ENRICHMENT_CONFIG.backoff.baseMs, 5_000);
  assert.equal(TAG_ENRICHMENT_CONFIG.calibration.validated, false);
});

test("the enrichment bound is independent of the Consideration threshold", () => {
  assert.notEqual(
    TAG_ENRICHMENT_CONFIG.eligibility.minBehaviorScore,
    CONSIDERATION_SCORING_CONFIG.threshold
  );
  assert.ok(
    TAG_ENRICHMENT_CONFIG.eligibility.minBehaviorScore <
      CONSIDERATION_SCORING_CONFIG.threshold
  );
});

test("a clicked Candidate always qualifies", () => {
  assert.equal(isEligibleForTagEnrichment(createSignals({ clicked: true })), true);
});

test("exposure alone never qualifies, even when fully saturated", () => {
  const signals = createSignals({ visibleMs: 10_000_000 });
  const behaviorScore = calculateTagEnrichmentBehaviorScore(signals);

  assert.equal(behaviorScore, CONSIDERATION_SCORING_CONFIG.weights.exposure);
  assert.ok(
    behaviorScore < TAG_ENRICHMENT_CONFIG.eligibility.minBehaviorScore,
    "saturated exposure must stay below the behaviour bound"
  );
  assert.equal(isEligibleForTagEnrichment(signals), false);
});

test("one return view or a long hover qualifies", () => {
  assert.equal(isEligibleForTagEnrichment(createSignals({ returnCount: 1 })), true);
  assert.equal(isEligibleForTagEnrichment(createSignals({ hoverMs: 1_200 })), true);
  assert.equal(isEligibleForTagEnrichment(createSignals({ hoverMs: 1_199 })), false);
});

test("combined behaviour reaching the bound qualifies", () => {
  const signals = createSignals({ visibleMs: 10_000, hoverMs: 600 });
  assert.ok(
    calculateTagEnrichmentBehaviorScore(signals) >=
      TAG_ENRICHMENT_CONFIG.eligibility.minBehaviorScore
  );
  assert.equal(isEligibleForTagEnrichment(signals), true);
});

test("a Candidate below every bound triggers zero provider calls", async () => {
  const owner = createOwner();
  const candidate = createCandidate();
  const signals = createSignals({ visibleMs: 2_000 });
  const { repository } = await createSessionRepository(owner, [
    { candidate, signals }
  ]);
  const provider = createFakeTagProvider({
    tagsByCandidateId: { "candidate-1": ["原生标签"] }
  });
  const coordinator = createTagEnrichmentCoordinator(repository, provider);

  const result = await coordinator.enrichCandidate(
    { candidate, signals },
    owner
  );

  assert.equal(provider.callCount, 0);
  assert.equal(result.eligible, false);
  assert.equal(result.source, TAG_SOURCES.LOCAL_FALLBACK);
  assert.deepEqual(result.profile.nativeTags, []);
  assert.ok(result.profile.normalizedTags.includes("认知地图"));
});

test("an eligible Candidate uses native tags and persists them", async () => {
  const owner = createOwner();
  const candidate = createCandidate();
  const signals = createSignals({ returnCount: 1 });
  const { repository } = await createSessionRepository(owner, [
    { candidate, signals }
  ]);
  const provider = createFakeTagProvider({
    tagsByCandidateId: { "candidate-1": ["#神经科学", "Navigation"] }
  });
  const coordinator = createTagEnrichmentCoordinator(repository, provider);

  const result = await coordinator.enrichCandidate(
    { candidate, signals },
    owner
  );

  assert.equal(provider.callCount, 1);
  assert.equal(result.source, TAG_SOURCES.NATIVE);
  assert.deepEqual(result.profile.nativeTags, ["Navigation", "#神经科学"]);

  const stored = await repository.getCandidateTagProfile(
    SESSION_ID,
    "candidate-1",
    owner
  );
  assert.deepEqual(stored, result.profile);
});

test("concurrent requests for one Candidate are coalesced into one call", async () => {
  const owner = createOwner();
  const candidate = createCandidate();
  const signals = createSignals({ returnCount: 1 });
  const { repository } = await createSessionRepository(owner, [
    { candidate, signals }
  ]);
  const provider = createFakeTagProvider({
    tagsByCandidateId: { "candidate-1": ["神经科学"] }
  });
  const coordinator = createTagEnrichmentCoordinator(repository, provider);

  provider.block();
  const first = coordinator.enrichCandidate({ candidate, signals }, owner);
  const second = coordinator.enrichCandidate({ candidate, signals }, owner);
  provider.release();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(provider.callCount, 1);
  assert.deepEqual(firstResult.profile, secondResult.profile);
});

test("a successful lookup is cached and not repeated", async () => {
  const owner = createOwner();
  const candidate = createCandidate();
  const signals = createSignals({ returnCount: 1 });
  const { repository } = await createSessionRepository(owner, [
    { candidate, signals }
  ]);
  const provider = createFakeTagProvider({
    tagsByCandidateId: { "candidate-1": ["神经科学"] }
  });
  const coordinator = createTagEnrichmentCoordinator(repository, provider);

  await coordinator.enrichCandidate({ candidate, signals }, owner);
  await coordinator.enrichCandidate({ candidate, signals }, owner);

  assert.equal(provider.callCount, 1);
});

test("a provider failure falls back locally and backs off", async () => {
  const owner = createOwner();
  const candidate = createCandidate();
  const signals = createSignals({ returnCount: 1 });
  const { repository } = await createSessionRepository(owner, [
    { candidate, signals }
  ]);
  const provider = createFakeTagProvider({
    failingCandidateIds: ["candidate-1"]
  });
  let currentTime = 0;
  const coordinator = createTagEnrichmentCoordinator(repository, provider, {
    now: () => currentTime
  });

  const failed = await coordinator.enrichCandidate(
    { candidate, signals },
    owner
  );
  assert.equal(provider.callCount, 1);
  assert.equal(failed.source, TAG_SOURCES.LOCAL_FALLBACK);
  assert.ok(failed.profile.normalizedTags.length > 0);

  await coordinator.enrichCandidate({ candidate, signals }, owner);
  assert.equal(provider.callCount, 1, "backoff must suppress an immediate retry");

  currentTime = TAG_ENRICHMENT_CONFIG.backoff.baseMs;
  provider.stopFailing("candidate-1");
  provider.setTags("candidate-1", ["神经科学"]);
  const retried = await coordinator.enrichCandidate(
    { candidate, signals },
    owner
  );

  assert.equal(provider.callCount, 2);
  assert.equal(retried.source, TAG_SOURCES.NATIVE);
});

test("attempts stop at the configured maximum", async () => {
  const owner = createOwner();
  const candidate = createCandidate();
  const signals = createSignals({ returnCount: 1 });
  const { repository } = await createSessionRepository(owner, [
    { candidate, signals }
  ]);
  const provider = createFakeTagProvider({
    failingCandidateIds: ["candidate-1"]
  });
  let currentTime = 0;
  const coordinator = createTagEnrichmentCoordinator(repository, provider, {
    now: () => currentTime
  });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    currentTime += 10 * TAG_ENRICHMENT_CONFIG.backoff.baseMs;
    await coordinator.enrichCandidate({ candidate, signals }, owner);
  }

  assert.equal(
    provider.callCount,
    TAG_ENRICHMENT_CONFIG.limits.maxAttemptsPerCandidate
  );
});

test("the per-session enrichment budget is enforced", async () => {
  const owner = createOwner();
  const entries = Array.from({ length: 15 }, (_, index) => ({
    candidate: createCandidate(`candidate-${index + 1}`, `Title ${index + 1}`),
    signals: createSignals({
      candidateId: `candidate-${index + 1}`,
      returnCount: 1
    })
  }));
  entries.forEach((entry, index) => {
    entry.candidate.rank = index + 1;
  });
  const { repository } = await createSessionRepository(owner, entries);
  const provider = createFakeTagProvider();
  const coordinator = createTagEnrichmentCoordinator(repository, provider);

  for (const entry of entries) {
    await coordinator.enrichCandidate(entry, owner);
  }

  assert.equal(
    provider.callCount,
    TAG_ENRICHMENT_CONFIG.limits.maxEnrichedCandidatesPerSession
  );
});

test("no provider still persists a local fallback profile", async () => {
  const owner = createOwner();
  const candidate = createCandidate();
  const signals = createSignals({ returnCount: 1 });
  const { repository } = await createSessionRepository(owner, [
    { candidate, signals }
  ]);
  const coordinator = createTagEnrichmentCoordinator(repository, null);

  const result = await coordinator.enrichCandidate(
    { candidate, signals },
    owner
  );

  assert.equal(result.source, TAG_SOURCES.LOCAL_FALLBACK);
  assert.deepEqual(result.profile.nativeTags, []);
  assert.ok(result.profile.normalizedTags.includes("cognitive"));
});

test("Zhihu QUESTION, ANSWER and ARTICLE use one durable local TagProfile fallback", async () => {
  const owner = createOwner(18, "zhihu-doc");
  const adapter = createTransactionalMemoryStorageAdapter();
  const repository = createRepository(adapter);
  const candidates = [
    {
      id: "zhihu:question:101",
      url: "https://www.zhihu.com/question/101",
      title: "量子计算 基础问题",
      source: "zhihu-search",
      rank: 1,
      sessionId: SESSION_ID,
      contentType: "QUESTION",
      layoutType: "TEXT_LIST"
    },
    {
      id: "zhihu:answer:202",
      url: "https://www.zhihu.com/question/101/answer/202",
      title: "量子计算 回答",
      source: "zhihu-search",
      rank: 2,
      sessionId: SESSION_ID,
      contentType: "ANSWER",
      layoutType: "TEXT_LIST"
    },
    {
      id: "zhihu:article:303",
      url: "https://zhuanlan.zhihu.com/p/303",
      title: "量子信息 专栏文章",
      source: "zhihu-search",
      rank: 3,
      sessionId: SESSION_ID,
      contentType: "ARTICLE",
      layoutType: "TEXT_LIST"
    }
  ];
  await repository.mergeDiscoveredCandidates(
    {
      sessionId: SESSION_ID,
      context: {
        query: "量子计算",
        source: "zhihu-search",
        timestamp: 1_000,
        keywords: ["量子计算"]
      },
      candidates,
      discoveredAt: 1_000
    },
    owner
  );
  const coordinator = createTagEnrichmentCoordinator(repository, null);

  const results = [];
  for (const candidate of candidates) {
    const signals = {
      ...createSignals({ returnCount: 1 }),
      candidateId: candidate.id
    };
    await repository.mergeCandidateSignalsSnapshot(
      { signals, updatedAt: 1_500 },
      owner
    );
    results.push(
      await coordinator.enrichCandidate({ candidate, signals }, owner)
    );
  }

  assert.deepEqual(
    results.map(({ eligible, source, profile }) => ({
      eligible,
      source,
      candidateId: profile.candidateId,
      nativeTags: profile.nativeTags
    })),
    candidates.map((candidate) => ({
      eligible: true,
      source: TAG_SOURCES.LOCAL_FALLBACK,
      candidateId: candidate.id,
      nativeTags: []
    }))
  );
  assert.equal(
    (await repository.listCandidateTagProfiles(SESSION_ID, owner)).length,
    3
  );
  for (const { profile } of results) {
    assert.ok(profile.normalizedTags.length > 0);
  }

  const restartedRepository = createRepository(adapter);
  assert.equal(
    (await restartedRepository.listCandidateTagProfiles(SESSION_ID, owner))
      .length,
    3,
    "a Worker restart must retain every fallback TagProfile"
  );
});

test("several clicked Candidates raise the weight of a shared tag", async () => {
  const owner = createOwner();
  const entries = [
    {
      candidate: createCandidate("candidate-1", "认知地图 导航"),
      signals: createSignals({ candidateId: "candidate-1", clicked: true })
    },
    {
      candidate: createCandidate("candidate-2", "认知地图 空间"),
      signals: createSignals({ candidateId: "candidate-2", clicked: true })
    },
    {
      candidate: createCandidate("candidate-3", "无关内容"),
      signals: createSignals({ candidateId: "candidate-3", returnCount: 1 })
    }
  ];
  entries.forEach((entry, index) => {
    entry.candidate.rank = index + 1;
  });
  const { repository } = await createSessionRepository(owner, entries);
  const coordinator = createTagEnrichmentCoordinator(repository, null);

  for (const entry of entries) {
    await coordinator.enrichCandidate(entry, owner);
  }
  const selected = await coordinator.refreshSelectedTagProfile(
    SESSION_ID,
    owner
  );

  assert.equal(selected.selectedCandidateCount, 2);
  const shared = selected.tags.find((entry) => entry.tag === "认知地图");
  assert.equal(shared?.candidateCount, 2);
  assert.equal(shared?.weight, 1);
  assert.equal(selected.tags[0].tag, "认知地图");

  const unique = selected.tags.find((entry) => entry.tag === "导航");
  assert.equal(unique?.candidateCount, 1);
  assert.ok(unique.weight < shared.weight);

  assert.ok(
    !selected.tags.some((entry) => entry.tag === "无关内容"),
    "an unclicked Candidate must not enter the selected profile"
  );
});

test("no clicked Candidate yields an explicitly empty selected profile", async () => {
  const owner = createOwner();
  const candidate = createCandidate();
  const signals = createSignals({ returnCount: 1 });
  const { repository } = await createSessionRepository(owner, [
    { candidate, signals }
  ]);
  const coordinator = createTagEnrichmentCoordinator(repository, null);

  const selected = await coordinator.refreshSelectedTagProfile(
    SESSION_ID,
    owner
  );

  assert.deepEqual(selected, {
    sessionId: SESSION_ID,
    selectedCandidateCount: 0,
    tags: []
  });
  const stored = await repository.getSessionSelectedTagProfile(
    SESSION_ID,
    owner
  );
  assert.deepEqual(stored, selected);
});

test("authoritative profiles are readable and default to an empty selection", async () => {
  const owner = createOwner();
  const candidate = createCandidate();
  const signals = createSignals({ returnCount: 1 });
  const { repository } = await createSessionRepository(owner, [
    { candidate, signals }
  ]);
  const coordinator = createTagEnrichmentCoordinator(repository, null);

  await coordinator.recordContextTags(
    { sessionId: SESSION_ID, query: createContext().query },
    owner
  );
  await coordinator.enrichCandidate({ candidate, signals }, owner);

  const profiles = await coordinator.getAuthoritativeTagProfiles(
    SESSION_ID,
    owner
  );

  assert.ok(profiles.contextProfile.normalizedTags.includes("认知地图"));
  assert.equal(profiles.candidateProfiles.length, 1);
  assert.equal(profiles.selectedProfile.selectedCandidateCount, 0);
  assert.deepEqual(profiles.selectedProfile.tags, []);
});

test("two tabs with the same query keep separate tag profiles", async () => {
  const adapter = createTransactionalMemoryStorageAdapter();
  const repository = createRepository(adapter);
  const ownerA = createOwner(1, "doc-a");
  const ownerB = createOwner(2, "doc-b");
  const candidate = createCandidate();

  for (const owner of [ownerA, ownerB]) {
    await repository.mergeDiscoveredCandidates(
      {
        sessionId: SESSION_ID,
        context: createContext(),
        candidates: [candidate],
        discoveredAt: 1_000
      },
      owner
    );
  }

  const coordinator = createTagEnrichmentCoordinator(repository, null);
  await coordinator.enrichCandidate(
    { candidate, signals: createSignals({ returnCount: 1 }) },
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
  assert.equal(storedB, null, "tab B must not see tab A tag data");
});
