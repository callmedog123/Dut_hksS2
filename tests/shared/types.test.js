import assert from "node:assert/strict";
import test from "node:test";

import {
  CONSIDERATION_REASON_CODES,
  DEFAULT_SETTINGS_V1,
  MISSED_PATH_STATUSES,
  REENCOUNTER_FEEDBACK_OUTCOMES,
  REENCOUNTER_OUTCOMES,
  REENCOUNTER_REASON_CODES,
  SCHEMA_VERSION,
  SESSION_LIFECYCLE_STATUSES,
  isCandidateSignalsV1,
  isCandidateV1,
  isConsiderationReasonV1,
  isMissedPathV1,
  isRankedReencounterV1,
  isReencounterFeedbackV1,
  isReencounterRecordV1,
  isReencounterReasonV1,
  isSearchContextV1,
  isSessionLifecycleStatusV2,
  isSettingsV1
} from "../../shared/types.js";
import { MESSAGE_SCHEMA_VERSION } from "../../shared/messages.js";

const validCandidate = Object.freeze({
  id: "candidate-1",
  url: "https://example.com/result",
  title: "Example result",
  source: "local-demo",
  rank: 1,
  sessionId: "session-1"
});

const validContext = Object.freeze({
  query: "robot navigation",
  source: "local-demo",
  timestamp: 100
});

const validSignals = Object.freeze({
  candidateId: "candidate-1",
  sessionId: "session-1",
  visibleMs: 100,
  hoverMs: 25.5,
  hoverCount: 2,
  returnCount: 1,
  clicked: false
});

const validConsiderationReason = Object.freeze({
  code: CONSIDERATION_REASON_CODES.LONG_EXPOSURE,
  label: "Visible time contributed.",
  contribution: 0.3
});

const validMissedPath = Object.freeze({
  id: "missed-1",
  candidate: validCandidate,
  context: validContext,
  score: 0.7,
  reasons: [validConsiderationReason],
  status: MISSED_PATH_STATUSES.MISSED,
  createdAt: 200
});

const validReencounterReason = Object.freeze({
  code: REENCOUNTER_REASON_CODES.CONTEXT_MATCH,
  label: "Context keywords matched.",
  contribution: 0.4
});

const validRankedReencounter = Object.freeze({
  missedPath: validMissedPath,
  score: 0.8,
  reasons: [validReencounterReason]
});

const validReencounterRecord = Object.freeze({
  id: "shown-1",
  missedPathId: "missed-1",
  triggerContext: validContext,
  score: 0.8,
  reasons: [validReencounterReason],
  shownAt: 300
});

test("uses one shared schemaVersion constant fixed at 2", () => {
  assert.equal(SCHEMA_VERSION, 2);
  assert.equal(MESSAGE_SCHEMA_VERSION, SCHEMA_VERSION);
});

test("accepts an exact valid CandidateV1", () => {
  assert.equal(isCandidateV1(validCandidate), true);
});

test("rejects invalid or extra CandidateV1 fields", () => {
  const invalidCandidates = [
    null,
    { ...validCandidate, id: "" },
    { ...validCandidate, url: "" },
    { ...validCandidate, title: "" },
    { ...validCandidate, source: "" },
    { ...validCandidate, rank: 0 },
    { ...validCandidate, rank: 1.5 },
    { ...validCandidate, sessionId: "" },
    { ...validCandidate, extra: true },
    Object.fromEntries(
      Object.entries(validCandidate).filter(([key]) => key !== "title")
    )
  ];

  for (const candidate of invalidCandidates) {
    assert.equal(isCandidateV1(candidate), false);
  }
});

test("accepts SearchContextV1 with optional keywords", () => {
  assert.equal(isSearchContextV1(validContext), true);
  assert.equal(isSearchContextV1({ ...validContext, query: "" }), true);
  assert.equal(
    isSearchContextV1({ ...validContext, keywords: ["robot", "navigation"] }),
    true
  );
  assert.equal(isSearchContextV1({ ...validContext, keywords: [] }), true);
});

test("rejects invalid or extra SearchContextV1 fields", () => {
  const invalidContexts = [
    null,
    { ...validContext, query: 1 },
    { ...validContext, source: "" },
    { ...validContext, timestamp: Number.NaN },
    { ...validContext, timestamp: Number.POSITIVE_INFINITY },
    { ...validContext, keywords: "robot" },
    { ...validContext, keywords: ["robot", ""] },
    { ...validContext, extra: true },
    { query: validContext.query, timestamp: validContext.timestamp }
  ];

  for (const context of invalidContexts) {
    assert.equal(isSearchContextV1(context), false);
  }
});

test("accepts an exact valid CandidateSignalsV1", () => {
  assert.equal(isCandidateSignalsV1(validSignals), true);
  assert.equal(
    isCandidateSignalsV1({ ...validSignals, visibleMs: 0, hoverMs: 0 }),
    true
  );
});

test("rejects negative, non-integer, or extra CandidateSignalsV1 fields", () => {
  const invalidSignals = [
    null,
    { ...validSignals, candidateId: "" },
    { ...validSignals, sessionId: "" },
    { ...validSignals, visibleMs: -1 },
    { ...validSignals, visibleMs: Number.NaN },
    { ...validSignals, hoverMs: -1 },
    { ...validSignals, hoverMs: Number.POSITIVE_INFINITY },
    { ...validSignals, hoverCount: -1 },
    { ...validSignals, hoverCount: 1.5 },
    { ...validSignals, returnCount: -1 },
    { ...validSignals, returnCount: 1.5 },
    { ...validSignals, clicked: "false" },
    { ...validSignals, extra: true },
    Object.fromEntries(
      Object.entries(validSignals).filter(([key]) => key !== "clicked")
    )
  ];

  for (const signals of invalidSignals) {
    assert.equal(isCandidateSignalsV1(signals), false);
  }
});

test("freezes the shared v1 DTO enums", () => {
  assert.equal(Object.isFrozen(CONSIDERATION_REASON_CODES), true);
  assert.equal(Object.isFrozen(MISSED_PATH_STATUSES), true);
  assert.equal(Object.isFrozen(REENCOUNTER_REASON_CODES), true);
  assert.deepEqual(Object.values(MISSED_PATH_STATUSES).sort(), [
    "ARCHIVED",
    "ELIGIBLE",
    "MISSED",
    "REENCOUNTERED"
  ]);
});

test("freezes and strictly validates persistent Session lifecycle states", () => {
  assert.equal(Object.isFrozen(SESSION_LIFECYCLE_STATUSES), true);
  assert.deepEqual(SESSION_LIFECYCLE_STATUSES, {
    OPEN: "OPEN",
    FINALIZING: "FINALIZING",
    FINALIZED: "FINALIZED",
    ABANDONED: "ABANDONED"
  });
  for (const status of Object.values(SESSION_LIFECYCLE_STATUSES)) {
    assert.equal(isSessionLifecycleStatusV2(status), true);
  }
  assert.equal(isSessionLifecycleStatusV2("finalized"), false);
  assert.equal(isSessionLifecycleStatusV2("UNKNOWN"), false);
});

test("validates strict ConsiderationReasonV1 with optional nonnegative contribution", () => {
  assert.equal(isConsiderationReasonV1(validConsiderationReason), true);
  assert.equal(
    isConsiderationReasonV1({
      code: CONSIDERATION_REASON_CODES.NOT_CLICKED,
      label: "The Candidate was not clicked."
    }),
    true
  );

  const invalidReasons = [
    null,
    { ...validConsiderationReason, code: "UNKNOWN" },
    { ...validConsiderationReason, label: "" },
    { ...validConsiderationReason, contribution: -0.1 },
    { ...validConsiderationReason, contribution: Number.NaN },
    { ...validConsiderationReason, contribution: Number.POSITIVE_INFINITY },
    { ...validConsiderationReason, extra: true },
    { label: validConsiderationReason.label }
  ];
  for (const reason of invalidReasons) {
    assert.equal(isConsiderationReasonV1(reason), false);
  }
});

test("validates strict MissedPathV1 fields, statuses, and unit score", () => {
  assert.equal(isMissedPathV1(validMissedPath), true);
  for (const status of Object.values(MISSED_PATH_STATUSES)) {
    assert.equal(isMissedPathV1({ ...validMissedPath, status }), true);
  }

  const invalidMissedPaths = [
    { ...validMissedPath, id: "" },
    { ...validMissedPath, score: -0.1 },
    { ...validMissedPath, score: 1.1 },
    { ...validMissedPath, score: Number.NaN },
    { ...validMissedPath, status: "UNKNOWN" },
    {
      ...validMissedPath,
      reasons: [validReencounterReason]
    },
    { ...validMissedPath, createdAt: -1 },
    { ...validMissedPath, extra: true },
    Object.fromEntries(
      Object.entries(validMissedPath).filter(([key]) => key !== "context")
    )
  ];
  for (const missedPath of invalidMissedPaths) {
    assert.equal(isMissedPathV1(missedPath), false);
  }
});

test("validates ReencounterReasonV1 including finite negative penalties", () => {
  assert.equal(isReencounterReasonV1(validReencounterReason), true);
  assert.equal(
    isReencounterReasonV1({
      code: REENCOUNTER_REASON_CODES.COOLDOWN_PENALTY,
      label: "Cooldown reduced relevance.",
      contribution: -0.25
    }),
    true
  );
  assert.equal(
    isReencounterReasonV1({
      code: REENCOUNTER_REASON_CODES.FRESHNESS,
      label: "Freshness was evaluated."
    }),
    true
  );

  const invalidReasons = [
    { ...validReencounterReason, code: "UNKNOWN" },
    { ...validReencounterReason, label: "" },
    { ...validReencounterReason, contribution: Number.NaN },
    { ...validReencounterReason, contribution: Number.NEGATIVE_INFINITY },
    { ...validReencounterReason, extra: true },
    { code: validReencounterReason.code }
  ];
  for (const reason of invalidReasons) {
    assert.equal(isReencounterReasonV1(reason), false);
  }
});

test("validates strict RankedReencounterV1 separately from persisted records", () => {
  assert.equal(isRankedReencounterV1(validRankedReencounter), true);

  const invalidRanked = [
    { ...validRankedReencounter, score: -0.1 },
    { ...validRankedReencounter, score: 1.1 },
    { ...validRankedReencounter, score: Number.NaN },
    {
      ...validRankedReencounter,
      reasons: [{ ...validReencounterReason, code: "UNKNOWN" }]
    },
    { ...validRankedReencounter, extra: true },
    {
      id: "persistent-record",
      missedPathId: "missed-1",
      triggerContext: validContext,
      score: 0.8,
      reasons: [validReencounterReason],
      shownAt: 300
    }
  ];
  for (const ranked of invalidRanked) {
    assert.equal(isRankedReencounterV1(ranked), false);
  }
});

test("validates strict durable ReencounterRecordV1 with optional outcome", () => {
  assert.equal(isReencounterRecordV1(validReencounterRecord), true);
  for (const outcome of Object.values(REENCOUNTER_OUTCOMES)) {
    assert.equal(
      isReencounterRecordV1({ ...validReencounterRecord, outcome }),
      true
    );
  }

  const invalidRecords = [
    { ...validReencounterRecord, id: "" },
    { ...validReencounterRecord, missedPathId: "" },
    { ...validReencounterRecord, score: 1.1 },
    { ...validReencounterRecord, shownAt: -1 },
    { ...validReencounterRecord, shownAt: Number.NaN },
    { ...validReencounterRecord, outcome: "UNKNOWN" },
    { ...validReencounterRecord, extra: true },
    Object.fromEntries(
      Object.entries(validReencounterRecord).filter(([key]) => key !== "shownAt")
    )
  ];
  for (const record of invalidRecords) {
    assert.equal(isReencounterRecordV1(record), false);
  }
});

test("provides and validates one strict default SettingsV1", () => {
  assert.equal(isSettingsV1(DEFAULT_SETTINGS_V1), true);
  assert.deepEqual(DEFAULT_SETTINGS_V1, {
    enabled: true,
    allowlist: [],
    blocklist: [],
    thresholds: { consideration: 0.55, reencounter: 0.6 },
    demoMode: false
  });
  for (const settings of [
    { ...DEFAULT_SETTINGS_V1, enabled: "yes" },
    { ...DEFAULT_SETTINGS_V1, allowlist: [""] },
    {
      ...DEFAULT_SETTINGS_V1,
      thresholds: { ...DEFAULT_SETTINGS_V1.thresholds, consideration: 2 }
    },
    { ...DEFAULT_SETTINGS_V1, extra: true }
  ]) {
    assert.equal(isSettingsV1(settings), false);
  }
});

test("validates strict feedback and backward-compatible Reencounter records", () => {
  const feedback = {
    reencounterId: "shown-1",
    outcome: REENCOUNTER_FEEDBACK_OUTCOMES.NOT_RELEVANT,
    feedbackAt: 400
  };
  assert.equal(isReencounterFeedbackV1(feedback), true);
  assert.equal(
    isReencounterRecordV1({
      ...validReencounterRecord,
      outcome: feedback.outcome,
      feedbackAt: feedback.feedbackAt
    }),
    true
  );

  for (const invalid of [
    { ...feedback, reencounterId: "" },
    { ...feedback, outcome: REENCOUNTER_OUTCOMES.DISMISSED },
    { ...feedback, feedbackAt: -1 },
    { ...feedback, extra: true }
  ]) {
    assert.equal(isReencounterFeedbackV1(invalid), false);
  }
  assert.equal(
    isReencounterRecordV1({ ...validReencounterRecord, feedbackAt: 400 }),
    false
  );
});
