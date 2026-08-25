import assert from "node:assert/strict";
import test from "node:test";

import {
  SCHEMA_VERSION,
  isCandidateSignalsV1,
  isCandidateV1,
  isSearchContextV1
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

test("uses one shared schemaVersion constant fixed at 1", () => {
  assert.equal(SCHEMA_VERSION, 1);
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
