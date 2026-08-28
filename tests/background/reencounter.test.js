import assert from "node:assert/strict";
import test from "node:test";

import {
  REENCOUNTER_REASON_CODES,
  calculateContextSimilarity,
  calculateReencounter,
  calculateReencounterTagSimilarity,
  rankReencounters
} from "../../background/reencounter.js";
import { REENCOUNTER_SCORING_CONFIG } from "../../background/scoringConfig.js";

const NOW = 10_000_000_000;

function createContext(overrides = {}) {
  return {
    query: "robot navigation",
    source: "local-demo",
    timestamp: NOW,
    keywords: ["robot", "navigation"],
    ...overrides
  };
}

function createMissedPath(id, overrides = {}) {
  const candidateOverrides = overrides.candidate ?? {};
  const contextOverrides = overrides.context ?? {};
  const rest = { ...overrides };
  delete rest.candidate;
  delete rest.context;
  return {
    id,
    candidate: {
      id: `candidate-${id}`,
      url: `https://example.com/${id}`,
      title: `Result ${id}`,
      source: "local-demo",
      rank: 1,
      sessionId: "session-1",
      ...candidateOverrides
    },
    context: createContext({
      timestamp: NOW - 1_000,
      ...contextOverrides
    }),
    score: 0.8,
    reasons: [],
    status: "MISSED",
    createdAt: NOW,
    ...rest
  };
}

function createEntry(id, overrides = {}) {
  const missedPathOverrides = overrides.missedPath ?? {};
  const entryOverrides = { ...overrides };
  delete entryOverrides.missedPath;
  return {
    missedPath: createMissedPath(id, missedPathOverrides),
    lastShownAt: null,
    dismissalCount: 0,
    ...entryOverrides
  };
}

test("keeps all provisional Re-encounter heuristics centralized and unvalidated", () => {
  assert.deepEqual(REENCOUNTER_SCORING_CONFIG.weights, {
    contextSimilarity: 0.45,
    tagSimilarity: 0.15,
    priorConsideration: 0.25,
    freshness: 0.15
  });
  assert.deepEqual(REENCOUNTER_SCORING_CONFIG.tagSimilarity, {
    contextProfileWeight: 0.75,
    selectedProfileWeight: 0.25,
    missingEvidenceMode: "LEGACY_KEYWORD_JACCARD"
  });
  assert.equal(REENCOUNTER_SCORING_CONFIG.threshold, 0.6);
  assert.deepEqual(REENCOUNTER_SCORING_CONFIG.resultLimits, {
    default: 3,
    min: 1,
    max: 3
  });
  assert.equal(REENCOUNTER_SCORING_CONFIG.calibration.validated, false);
});

function createCandidateTagProfile(overrides = {}) {
  return {
    candidateId: "candidate-tags",
    sessionId: "session-1",
    nativeTags: [],
    normalizedTags: ["navigation", "robot"],
    ...overrides
  };
}

function createContextTagProfile(overrides = {}) {
  return {
    sessionId: "current-session",
    normalizedTags: ["robot", "vision"],
    ...overrides
  };
}

function createSelectedTagProfile(overrides = {}) {
  return {
    sessionId: "current-session",
    selectedCandidateCount: 1,
    tags: [{ tag: "navigation", candidateCount: 1, weight: 1 }],
    ...overrides
  };
}

test("uses Context tags alone without clicks and blends selected tags at 75/25", () => {
  const candidate = createCandidateTagProfile();
  const context = createContextTagProfile();

  assert.deepEqual(
    calculateReencounterTagSimilarity(candidate, context),
    {
      available: true,
      similarity: 1 / 3,
      contextSimilarity: 1 / 3,
      selectedSimilarity: 0,
      usedSelectedProfile: false
    }
  );

  const withSelection = calculateReencounterTagSimilarity(
    candidate,
    context,
    createSelectedTagProfile()
  );
  assert.equal(withSelection.contextSimilarity, 1 / 3);
  assert.equal(withSelection.selectedSimilarity, 1 / 2);
  assert.equal(withSelection.similarity, 3 / 8);
  assert.equal(withSelection.usedSelectedProfile, true);
});

test("missing tag evidence keeps the legacy keyword/Jaccard score", () => {
  const entry = createEntry("legacy-fallback", {
    missedPath: { score: 0.8 }
  });
  const result = calculateReencounter(entry, createContext(), {
    contextTagProfile: createContextTagProfile()
  });
  const expectedLegacyScore = 0.45 + 0.8 * 0.25 + 0.15;

  assert.equal(result.score, expectedLegacyScore);
  const tagReason = result.reasons.find(
    (reason, index) =>
      index === 1 && reason.code === REENCOUNTER_REASON_CODES.TAG_MATCH
  );
  assert.equal(tagReason.contribution, 0);
  assert.match(tagReason.label, /退回现有搜索词\/Jaccard/);
});

test("Scheme A tag evidence cannot qualify without any keyword overlap", () => {
  const entry = createEntry("tag-only", {
    missedPath: {
      score: 1,
      context: { query: "marine biology", keywords: [] },
      candidate: { id: "candidate-tags" }
    },
    candidateTagProfile: createCandidateTagProfile()
  });
  const result = calculateReencounter(entry, createContext(), {
    contextTagProfile: createContextTagProfile({
      normalizedTags: ["navigation", "robot"]
    })
  });

  assert.equal(result.score, 0.55);
  assert.equal(result.eligible, false);
});

test("platform identity never adds a Re-encounter score bonus", () => {
  const bilibili = createEntry("bilibili", {
    missedPath: {
      candidate: {
        source: "bilibili-search",
        contentType: "VIDEO",
        layoutType: "GRID"
      }
    }
  });
  const zhihu = createEntry("zhihu", {
    missedPath: {
      candidate: {
        source: "zhihu-search",
        contentType: "ARTICLE",
        layoutType: "TEXT_LIST"
      }
    }
  });

  assert.equal(
    calculateReencounter(bilibili, createContext()).score,
    calculateReencounter(zhihu, createContext()).score
  );
});

test("computes normalized keyword Jaccard similarity for related and unrelated contexts", () => {
  assert.equal(
    calculateContextSimilarity(
      createContext({ query: "ROBOT robot", keywords: ["Navigation"] }),
      createContext({ query: "robot navigation", keywords: [] })
    ),
    1
  );
  assert.equal(
    calculateContextSimilarity(
      createContext({ query: "robot vision", keywords: [] }),
      createContext({ query: "robot navigation", keywords: [] })
    ),
    1 / 3
  );
  assert.equal(
    calculateContextSimilarity(
      createContext({ query: "marine biology", keywords: [] }),
      createContext({ query: "robot navigation", keywords: [] })
    ),
    0
  );
  assert.equal(
    calculateContextSimilarity(
      createContext({ query: "", keywords: [] }),
      createContext({ query: "", keywords: [] })
    ),
    0
  );
});

test("returns related candidates and filters unrelated candidates below threshold", () => {
  const results = rankReencounters(
    [
      createEntry("related"),
      createEntry("unrelated", {
        missedPath: {
          context: { query: "marine biology", keywords: [] }
        }
      })
    ],
    createContext()
  );

  assert.deepEqual(
    results.map((result) => result.missedPath.id),
    ["related"]
  );
  assert.equal(results[0].score >= REENCOUNTER_SCORING_CONFIG.threshold, true);
});

test("sorts eligible candidates by descending Re-encounter score", () => {
  const results = rankReencounters(
    [
      createEntry("lower", { missedPath: { score: 0.6 } }),
      createEntry("highest", { missedPath: { score: 1 } }),
      createEntry("middle", { missedPath: { score: 0.8 } })
    ],
    createContext()
  );

  assert.deepEqual(
    results.map((result) => result.missedPath.id),
    ["highest", "middle", "lower"]
  );
  assert.equal(results[0].score > results[1].score, true);
  assert.equal(results[1].score > results[2].score, true);
});

test("returns no more than three results and honors a limit from 1 to 3", () => {
  const entries = [1, 2, 3, 4, 5].map((index) =>
    createEntry(`candidate-${index}`, {
      missedPath: { score: 1 - index / 20 }
    })
  );

  assert.equal(rankReencounters(entries, createContext()).length, 3);
  assert.equal(
    rankReencounters(entries, createContext(), { limit: 1 }).length,
    1
  );
  assert.throws(
    () => rankReencounters(entries, createContext(), { limit: 4 }),
    RangeError
  );
});

test("active cooldown suppresses a result and the exact boundary releases it", () => {
  const duration = REENCOUNTER_SCORING_CONFIG.cooldown.durationMs;
  const cooling = createEntry("cooling", {
    lastShownAt: NOW - duration + 1
  });
  const released = createEntry("released", {
    lastShownAt: NOW - duration
  });

  const coolingScore = calculateReencounter(cooling, createContext());
  assert.equal(coolingScore.score, 0);
  assert.equal(coolingScore.eligible, false);
  assert.equal(
    coolingScore.reasons.find(
      (reason) => reason.code === REENCOUNTER_REASON_CODES.COOLDOWN_PENALTY
    ).contribution,
    -1
  );
  assert.deepEqual(
    rankReencounters([cooling, released], createContext()).map(
      (result) => result.missedPath.id
    ),
    ["released"]
  );
});

test("repeated dismissals apply a capped penalty and can suppress a result", () => {
  const once = calculateReencounter(
    createEntry("once", { dismissalCount: 1 }),
    createContext()
  );
  const repeated = calculateReencounter(
    createEntry("repeated", { dismissalCount: 2 }),
    createContext()
  );
  const capped = calculateReencounter(
    createEntry("capped", { dismissalCount: 100 }),
    createContext()
  );

  assert.equal(once.eligible, true);
  assert.equal(repeated.eligible, false);
  assert.equal(
    repeated.reasons.find(
      (reason) =>
        reason.code ===
        REENCOUNTER_REASON_CODES.REPEATED_DISMISSAL_PENALTY
    ).contribution,
    -0.3
  );
  assert.equal(
    capped.reasons.find(
      (reason) =>
        reason.code ===
        REENCOUNTER_REASON_CODES.REPEATED_DISMISSAL_PENALTY
    ).contribution,
    -REENCOUNTER_SCORING_CONFIG.repeatedDismissal.maximumPenalty
  );
});

test("uses MissedPath id as a stable tie-break independent of input order", () => {
  const left = createEntry("a");
  const right = createEntry("b");

  const forward = rankReencounters([right, left], createContext());
  const reverse = rankReencounters([left, right], createContext());

  assert.deepEqual(
    forward.map((result) => result.missedPath.id),
    ["a", "b"]
  );
  assert.deepEqual(
    reverse.map((result) => result.missedPath.id),
    ["a", "b"]
  );
});

test("reasons explain keyword, tag, history, freshness, cooldown, and feedback", () => {
  const result = calculateReencounter(createEntry("reasons"), createContext());

  assert.deepEqual(
    result.reasons.map((reason) => reason.code),
    [
      REENCOUNTER_REASON_CODES.CONTEXT_MATCH,
      REENCOUNTER_REASON_CODES.TAG_MATCH,
      REENCOUNTER_REASON_CODES.PRIOR_CONSIDERATION,
      REENCOUNTER_REASON_CODES.FRESHNESS,
      REENCOUNTER_REASON_CODES.COOLDOWN_PENALTY,
      REENCOUNTER_REASON_CODES.REPEATED_DISMISSAL_PENALTY
    ]
  );
  assert.match(result.reasons[0].label, /搜索词/);
  assert.match(result.reasons[1].label, /标签/);
  assert.match(result.reasons[2].label, /考虑程度/);
  assert.match(result.reasons[4].label, /冷却/);
  assert.match(result.reasons[5].label, /负反馈/);
  assert.equal(
    result.reasons.reduce(
      (total, reason) => total + reason.contribution,
      0
    ),
    result.score
  );
});

test("ranking is pure and does not mutate inputs", () => {
  const entries = [createEntry("pure")];
  const context = createContext();
  const snapshot = JSON.stringify({ entries, context });

  rankReencounters(entries, context);

  assert.equal(JSON.stringify({ entries, context }), snapshot);
});
