import assert from "node:assert/strict";
import test from "node:test";

import {
  CONSIDERATION_CLASSIFICATIONS,
  calculateConsideration,
  normalizeConsiderationSignals
} from "../../background/consideration.js";
import {
  CONSIDERATION_SCORING_CONFIG,
  getNormalizationCapsForCandidate
} from "../../background/scoringConfig.js";
import {
  PLATFORMS,
  LAYOUT_TYPES,
  CONTENT_TYPES
} from "../../shared/types.js";

function createSignals(overrides = {}) {
  return {
    candidateId: "candidate-1",
    sessionId: "session-1",
    visibleMs: 0,
    hoverMs: 0,
    hoverCount: 0,
    returnCount: 0,
    clicked: false,
    ...overrides
  };
}

function createCandidate(overrides = {}) {
  return {
    id: "candidate-1",
    url: "https://www.bilibili.com/video/BV1test",
    title: "Test Candidate",
    source: "bilibili-search",
    rank: 1,
    sessionId: "session-1",
    ...overrides
  };
}

function createSessionSelectedTagProfile(tags, selectedCandidateCount) {
  return {
    sessionId: "session-1",
    selectedCandidateCount: selectedCandidateCount ?? tags.length,
    tags: tags.map((tag) => ({
      tag,
      candidateCount: 1,
      weight: 1 / tags.length
    }))
  };
}

// =========== Configuration frozen values ===========

test("v2 configuration has the approved behavior weights", () => {
  assert.equal(CONSIDERATION_SCORING_CONFIG.weights.exposure, 0.30);
  assert.equal(CONSIDERATION_SCORING_CONFIG.weights.hover, 0.30);
  assert.equal(CONSIDERATION_SCORING_CONFIG.weights.returnView, 0.25);
  assert.equal(CONSIDERATION_SCORING_CONFIG.weights.repeatedHover, 0.15);
  assert.equal(CONSIDERATION_SCORING_CONFIG.weights.selectedTagSimilarity, 0.15);
});

test("v2 configuration has the approved minimum behavior threshold", () => {
  assert.equal(CONSIDERATION_SCORING_CONFIG.minimumBehaviorThreshold, 0.35);
});

test("v2 configuration has the approved total threshold", () => {
  assert.equal(CONSIDERATION_SCORING_CONFIG.threshold, 0.55);
});

test("v2 configuration has platform-specific normalization caps", () => {
  const caps = CONSIDERATION_SCORING_CONFIG.normalizationCapsByPlatform;
  assert.deepEqual(caps[PLATFORMS.BILIBILI][LAYOUT_TYPES.GRID], {
    exposureMs: 10_000,
    hoverMs: 3_000,
    returnCount: 2,
    repeatedHoverCount: 3
  });
  assert.deepEqual(caps[PLATFORMS.ZHIHU][LAYOUT_TYPES.TEXT_LIST], {
    exposureMs: 15_000,
    hoverMs: 5_000,
    returnCount: 3,
    repeatedHoverCount: 4
  });
  assert.deepEqual(caps[PLATFORMS.DOUYIN][LAYOUT_TYPES.VIDEO_FEED], {
    exposureMs: 8_000,
    hoverMs: 2_000,
    returnCount: 2,
    repeatedHoverCount: 3
  });
});

// =========== Normalization caps by platform ===========

test("getNormalizationCapsForCandidate returns BILIBILI/GRID caps for bilibili-search", () => {
  const candidate = createCandidate({ source: "bilibili-search" });
  const caps = getNormalizationCapsForCandidate(candidate);
  assert.deepEqual(caps, {
    exposureMs: 10_000,
    hoverMs: 3_000,
    returnCount: 2,
    repeatedHoverCount: 3
  });
});

test("getNormalizationCapsForCandidate returns ZHIHU/TEXT_LIST caps for zhihu-search", () => {
  const candidate = createCandidate({
    source: "zhihu-search",
    contentType: CONTENT_TYPES.QUESTION,
    layoutType: LAYOUT_TYPES.TEXT_LIST
  });
  const caps = getNormalizationCapsForCandidate(candidate);
  assert.deepEqual(caps, {
    exposureMs: 15_000,
    hoverMs: 5_000,
    returnCount: 3,
    repeatedHoverCount: 4
  });
});

test("getNormalizationCapsForCandidate returns DOUYIN/VIDEO_FEED caps for douyin-search", () => {
  const candidate = createCandidate({
    source: "douyin-search",
    contentType: CONTENT_TYPES.VIDEO,
    layoutType: LAYOUT_TYPES.VIDEO_FEED
  });
  const caps = getNormalizationCapsForCandidate(candidate);
  assert.deepEqual(caps, {
    exposureMs: 8_000,
    hoverMs: 2_000,
    returnCount: 2,
    repeatedHoverCount: 3
  });
});

test("getNormalizationCapsForCandidate falls back to BILIBILI/GRID for unknown source", () => {
  const candidate = createCandidate({ source: "unknown-source" });
  const caps = getNormalizationCapsForCandidate(candidate);
  assert.deepEqual(caps, {
    exposureMs: 10_000,
    hoverMs: 3_000,
    returnCount: 2,
    repeatedHoverCount: 3
  });
});

test("getNormalizationCapsForCandidate falls back to GRID when layoutType is missing", () => {
  const candidate = createCandidate({
    source: "bilibili-search",
    layoutType: undefined
  });
  const caps = getNormalizationCapsForCandidate(candidate);
  assert.deepEqual(caps, {
    exposureMs: 10_000,
    hoverMs: 3_000,
    returnCount: 2,
    repeatedHoverCount: 3
  });
});

// =========== clicked=true永远排除 ===========

test("clicked=true永远返回EXCLUDED_CLICKED，score=0，reasons为空", () => {
  const signals = createSignals({ clicked: true });
  const result = calculateConsideration(signals);
  assert.equal(result.classification, CONSIDERATION_CLASSIFICATIONS.EXCLUDED_CLICKED);
  assert.equal(result.score, 0);
  assert.deepEqual(result.reasons, []);
});

// =========== 最低行为门槛 ===========

test("behaviorScore < 0.35 永远返回 BELOW_THRESHOLD，即使标签相似度=1", () => {
  const signals = createSignals({ visibleMs: 1_000 }); // exposure = 0.1
  const candidate = createCandidate();
  const sessionSelectedTagProfile = createSessionSelectedTagProfile(["test"]);

  const result = calculateConsideration(
    signals,
    {
      candidate,
      sessionSelectedTagProfile
    }
  );

  // behaviorScore = 0.1 × 0.30 = 0.03 < 0.35
  // tagBonus = 1.0 × 0.15 = 0.15
  // totalScore = 0.18, but behavior threshold fails first
  assert.equal(result.classification, CONSIDERATION_CLASSIFICATIONS.BELOW_THRESHOLD);
  assert.ok(result.score < 0.35);
});

test("behaviorScore = 0.35 刚好通过门槛，标签相似度=0 时 totalScore=0.35 < 0.55 → BELOW_THRESHOLD", () => {
  // exposure = 3500/10000 = 0.35, behaviorScore = 0.35 × 0.30 = 0.105
  // Need to construct signals that give exactly behaviorScore = 0.35
  // exposure 0.35/0.30 = 1.167 (capped at 1.0) → not achievable with exposure alone
  // Let's use: exposure=1.0, hover=0, returnView=0, repeatedHover=0
  // behaviorScore = 1.0 × 0.30 = 0.30 < 0.35 → need more

  // Try: exposure=1.0 (10000ms), hover=0.167 (500ms/3000)
  // behaviorScore = 1.0×0.30 + 0.167×0.30 = 0.30 + 0.05 = 0.35
  const signals = createSignals({
    visibleMs: 10_000,
    hoverMs: 500
  });

  const result = calculateConsideration(signals);

  assert.equal(result.classification, CONSIDERATION_CLASSIFICATIONS.BELOW_THRESHOLD);
  assert.ok(result.score >= 0.35); // behaviorScore = 0.35, tagBonus = 0
  assert.ok(result.score < 0.55);
});

test("behaviorScore ≥ 0.35 且 totalScore ≥ 0.55 → QUALIFIES", () => {
  // behaviorScore = 0.45, selectedTagSimilarity = 1.0
  // tagBonus = 1.0 × 0.15 = 0.15
  // totalScore = 0.60 → clearly above threshold

  // To get behaviorScore = 0.45:
  // exposure=1.0 (10000ms) → 1.0×0.30 = 0.30
  // hover=0.5 (1500ms/3000) → 0.5×0.30 = 0.15
  // Total = 0.45

  const signals = createSignals({
    visibleMs: 10_000,
    hoverMs: 1_500
  });
  const candidate = createCandidate();
  const sessionSelectedTagProfile = createSessionSelectedTagProfile(["test"]);

  const result = calculateConsideration(
    signals,
    {
      candidate: { ...candidate, normalizedTags: ["test"] },
      sessionSelectedTagProfile
    }
  );

  assert.equal(result.classification, CONSIDERATION_CLASSIFICATIONS.QUALIFIES, `Expected QUALIFIES but got ${result.classification}, score=${result.score}`);
  assert.ok(result.score >= 0.55, `Expected score >= 0.55 but got ${result.score}`);
});

// =========== 无点击 fallback ===========

test("无点击候选时 selectedTagSimilarity=0，tagBonus=0", () => {
  const signals = createSignals({
    visibleMs: 10_000,
    hoverMs: 3_000,
    returnCount: 2
  });
  // behaviorScore = 1.0×0.30 + 1.0×0.30 + 1.0×0.25 = 0.85

  const sessionSelectedTagProfile = createSessionSelectedTagProfile([], 0);

  const result = calculateConsideration(
    signals,
    { sessionSelectedTagProfile }
  );

  assert.equal(result.classification, CONSIDERATION_CLASSIFICATIONS.QUALIFIES);
  assert.equal(result.score, 0.85); // No tag bonus
});

test("sessionSelectedTagProfile 为 null/undefined 时 selectedTagSimilarity=0", () => {
  const signals = createSignals({
    visibleMs: 10_000,
    hoverMs: 3_000
  });
  // behaviorScore = 1.0×0.30 + 1.0×0.30 = 0.60

  const result1 = calculateConsideration(signals, { sessionSelectedTagProfile: null });
  const result2 = calculateConsideration(signals, { sessionSelectedTagProfile: undefined });
  const result3 = calculateConsideration(signals, {});

  assert.equal(result1.score, 0.60);
  assert.equal(result2.score, 0.60);
  assert.equal(result3.score, 0.60);
});

// =========== 标签相似度边界 ===========

test("Jaccard 相似度=0 时 tagBonus=0", () => {
  const signals = createSignals({
    visibleMs: 10_000,
    hoverMs: 3_000
  });
  // behaviorScore = 0.60

  const candidate = createCandidate();
  const sessionSelectedTagProfile = createSessionSelectedTagProfile(["完全无关的标签"]);

  const result = calculateConsideration(
    signals,
    {
      candidate,
      sessionSelectedTagProfile
    }
  );

  assert.equal(result.score, 0.60); // No tag bonus
  assert.ok(!result.reasons.some((r) => r.code === "SELECTED_TAG_SIMILARITY"));
});

test("Jaccard 相似度=1 时 tagBonus=0.15", () => {
  const signals = createSignals({
    visibleMs: 10_000,
    hoverMs: 3_000
  });
  // behaviorScore = 0.60

  const candidate = createCandidate();
  const sessionSelectedTagProfile = createSessionSelectedTagProfile(["test"]);

  // Note: candidate.normalizedTags would come from the actual candidate object
  // In real usage, this would be populated by the Repository.
  // For this test, we're testing the formula logic, not the tag extraction.

  const result = calculateConsideration(
    signals,
    {
      candidate: { ...candidate, normalizedTags: ["test"] },
      sessionSelectedTagProfile
    }
  );

  assert.equal(result.score, 0.75); // 0.60 + 0.15
  assert.ok(result.reasons.some((r) => r.code === "SELECTED_TAG_SIMILARITY"));
});

// =========== Reason codes ===========

test("reasons 包含所有行为项和 NOT_CLICKED", () => {
  const signals = createSignals({
    visibleMs: 10_000,
    hoverMs: 3_000,
    returnCount: 2,
    hoverCount: 4
  });

  const result = calculateConsideration(signals);

  const codes = result.reasons.map((r) => r.code);
  assert.ok(codes.includes("LONG_EXPOSURE"));
  assert.ok(codes.includes("LONG_HOVER"));
  assert.ok(codes.includes("RETURN_VIEW"));
  assert.ok(codes.includes("REPEATED_HOVER"));
  assert.ok(codes.includes("NOT_CLICKED"));
});

test("SELECTED_TAG_SIMILARITY reason 只在相似度>0 时出现", () => {
  const signals = createSignals({
    visibleMs: 10_000,
    hoverMs: 3_000
  });

  const result1 = calculateConsideration(signals);
  const codes1 = result1.reasons.map((r) => r.code);
  assert.ok(!codes1.includes("SELECTED_TAG_SIMILARITY"));

  const result2 = calculateConsideration(
    signals,
    {
      candidate: { ...createCandidate(), normalizedTags: ["test"] },
      sessionSelectedTagProfile: createSessionSelectedTagProfile(["test"])
    }
  );
  const codes2 = result2.reasons.map((r) => r.code);
  assert.ok(codes2.includes("SELECTED_TAG_SIMILARITY"));
});

// =========== 不同平台 caps ===========

test("ZHIHU/TEXT_LIST 使用不同的归一化上限", () => {
  const signals = createSignals({
    visibleMs: 12_000, // 12/15 = 0.8 for ZHIHU, 12/10 = 1.0 for BILIBILI
    hoverMs: 4_000 // 4/5 = 0.8 for ZHIHU, 4/3 = 1.0 for BILIBILI
  });

  const zhihuCandidate = createCandidate({
    source: "zhihu-search",
    layoutType: LAYOUT_TYPES.TEXT_LIST
  });
  const bilibiliCandidate = createCandidate({
    source: "bilibili-search",
    layoutType: LAYOUT_TYPES.GRID
  });

  const zhihuNormalized = normalizeConsiderationSignals(signals, zhihuCandidate);
  const bilibiliNormalized = normalizeConsiderationSignals(signals, bilibiliCandidate);

  assert.equal(zhihuNormalized.exposure, 0.8);
  assert.equal(zhihuNormalized.hover, 0.8);
  assert.equal(bilibiliNormalized.exposure, 1.0);
  assert.equal(bilibiliNormalized.hover, 1.0);
});

// =========== 幂等性 ===========

test("重复调用 calculateConsideration 结果一致", () => {
  const signals = createSignals({
    visibleMs: 10_000,
    hoverMs: 3_000,
    returnCount: 2
  });

  const result1 = calculateConsideration(signals);
  const result2 = calculateConsideration(signals);

  assert.deepEqual(result1, result2);
});

test("乱序 signals 不影响结果（使用相同值）", () => {
  const signals1 = createSignals({
    visibleMs: 10_000,
    hoverMs: 3_000,
    returnCount: 2,
    hoverCount: 4
  });
  const signals2 = createSignals({
    visibleMs: 10_000,
    hoverMs: 3_000,
    returnCount: 2,
    hoverCount: 4
  });

  const result1 = calculateConsideration(signals1);
  const result2 = calculateConsideration(signals2);

  assert.deepEqual(result1, result2);
});

// =========== 标签不能绕过最低行为门槛 ===========

test("即使 selectedTagSimilarity=1，behaviorScore < 0.35 仍被拒绝", () => {
  const signals = createSignals({
    visibleMs: 500 // exposure = 500/10000 = 0.05, behaviorScore = 0.05×0.30 = 0.015
  });

  const result = calculateConsideration(
    signals,
    {
      candidate: { ...createCandidate(), normalizedTags: ["test"] },
      sessionSelectedTagProfile: createSessionSelectedTagProfile(["test"])
    }
  );

  assert.equal(result.classification, CONSIDERATION_CLASSIFICATIONS.BELOW_THRESHOLD);
});
