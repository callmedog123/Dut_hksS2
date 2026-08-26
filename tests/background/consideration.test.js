import assert from "node:assert/strict";
import test from "node:test";

import {
  CONSIDERATION_CLASSIFICATIONS,
  calculateConsideration,
  normalizeConsiderationSignals
} from "../../background/consideration.js";
import { CONSIDERATION_SCORING_CONFIG } from "../../background/scoringConfig.js";

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

test("keeps provisional normalization caps centralized and unvalidated", () => {
  assert.deepEqual(CONSIDERATION_SCORING_CONFIG.weights, {
    exposure: 0.3,
    hover: 0.3,
    returnView: 0.25,
    repeatedHover: 0.15
  });
  assert.equal(CONSIDERATION_SCORING_CONFIG.threshold, 0.55);
  assert.deepEqual(CONSIDERATION_SCORING_CONFIG.normalizationCaps, {
    exposureMs: 10_000,
    hoverMs: 3_000,
    returnCount: 2,
    repeatedHoverCount: 3
  });
  assert.deepEqual(CONSIDERATION_SCORING_CONFIG.calibration, {
    validated: false,
    status: "UNVALIDATED_PENDING_5_TO_10_PERSON_TEST",
    targetParticipantRange: "5-10"
  });
});

test("normalizes zero and exact cap boundary values", () => {
  assert.deepEqual(normalizeConsiderationSignals(createSignals()), {
    exposure: 0,
    hover: 0,
    returnView: 0,
    repeatedHover: 0
  });

  const caps = CONSIDERATION_SCORING_CONFIG.normalizationCaps;
  assert.deepEqual(
    normalizeConsiderationSignals(
      createSignals({
        visibleMs: caps.exposureMs,
        hoverMs: caps.hoverMs,
        returnCount: caps.returnCount,
        hoverCount: caps.repeatedHoverCount + 1
      })
    ),
    { exposure: 1, hover: 1, returnView: 1, repeatedHover: 1 }
  );
});

test("clips every normalized feature above its cap", () => {
  const normalized = normalizeConsiderationSignals(
    createSignals({
      visibleMs: 100_000,
      hoverMs: 30_000,
      hoverCount: 100,
      returnCount: 100
    })
  );
  assert.deepEqual(normalized, {
    exposure: 1,
    hover: 1,
    returnView: 1,
    repeatedHover: 1
  });

  const result = calculateConsideration(
    createSignals({
      visibleMs: 100_000,
      hoverMs: 30_000,
      hoverCount: 100,
      returnCount: 100
    })
  );
  assert.equal(result.score, 1);
  assert.equal(result.classification, CONSIDERATION_CLASSIFICATIONS.QUALIFIES);
});

test("excludes clicked Candidates regardless of strong signals", () => {
  assert.deepEqual(
    calculateConsideration(
      createSignals({
        visibleMs: 100_000,
        hoverMs: 30_000,
        hoverCount: 100,
        returnCount: 100,
        clicked: true
      })
    ),
    {
      score: 0,
      classification: CONSIDERATION_CLASSIFICATIONS.EXCLUDED_CLICKED,
      reasons: []
    }
  );
});

test("classifies the exact threshold and a value below it", () => {
  const caps = CONSIDERATION_SCORING_CONFIG.normalizationCaps;
  const exactThreshold = calculateConsideration(
    createSignals({
      visibleMs: caps.exposureMs,
      returnCount: caps.returnCount
    })
  );
  assert.equal(exactThreshold.score, 0.55);
  assert.equal(
    exactThreshold.classification,
    CONSIDERATION_CLASSIFICATIONS.QUALIFIES
  );

  const belowThreshold = calculateConsideration(
    createSignals({
      visibleMs: caps.exposureMs,
      returnCount: 1
    })
  );
  assert.equal(belowThreshold.score, 0.425);
  assert.equal(
    belowThreshold.classification,
    CONSIDERATION_CLASSIFICATIONS.BELOW_THRESHOLD
  );
});

test("classifies a score above the threshold", () => {
  const caps = CONSIDERATION_SCORING_CONFIG.normalizationCaps;
  const result = calculateConsideration(
    createSignals({
      visibleMs: caps.exposureMs,
      hoverMs: caps.hoverMs
    })
  );

  assert.equal(result.score, 0.6);
  assert.equal(result.classification, CONSIDERATION_CLASSIFICATIONS.QUALIFIES);
});

test("strong return_view contributes its full frozen weight", () => {
  const result = calculateConsideration(
    createSignals({
      returnCount:
        CONSIDERATION_SCORING_CONFIG.normalizationCaps.returnCount
    })
  );

  assert.equal(result.score, 0.25);
  assert.equal(
    result.classification,
    CONSIDERATION_CLASSIFICATIONS.BELOW_THRESHOLD
  );
  assert.deepEqual(
    result.reasons.find((reason) => reason.code === "RETURN_VIEW"),
    {
      code: "RETURN_VIEW",
      label: "Returning to the Candidate contributed to consideration.",
      contribution: 0.25
    }
  );
});

test("long exposure alone cannot reach the initial threshold", () => {
  const result = calculateConsideration(
    createSignals({
      visibleMs:
        CONSIDERATION_SCORING_CONFIG.normalizationCaps.exposureMs
    })
  );

  assert.equal(result.score, 0.3);
  assert.equal(
    result.classification,
    CONSIDERATION_CLASSIFICATIONS.BELOW_THRESHOLD
  );
  assert.deepEqual(
    result.reasons.map((reason) => reason.code),
    ["LONG_EXPOSURE", "NOT_CLICKED"]
  );
});

test("reasons expose every non-zero formula contribution", () => {
  const caps = CONSIDERATION_SCORING_CONFIG.normalizationCaps;
  const result = calculateConsideration(
    createSignals({
      visibleMs: caps.exposureMs / 2,
      hoverMs: caps.hoverMs / 2,
      returnCount: 1,
      hoverCount: 2
    })
  );

  assert.deepEqual(
    result.reasons.map((reason) => reason.code),
    [
      "LONG_EXPOSURE",
      "LONG_HOVER",
      "RETURN_VIEW",
      "REPEATED_HOVER",
      "NOT_CLICKED"
    ]
  );
  const totalContribution = result.reasons.reduce(
    (sum, reason) => sum + reason.contribution,
    0
  );
  assert.equal(totalContribution, result.score);
  assert.equal(result.score, 0.475);
});

test("rejects signals outside the frozen CandidateSignalsV1 contract", () => {
  assert.throws(
    () => calculateConsideration(createSignals({ visibleMs: -1 })),
    TypeError
  );
  assert.throws(
    () => calculateConsideration(createSignals({ returnCount: 1.5 })),
    TypeError
  );
});
