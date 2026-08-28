import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  TAG_LIMITS,
  TAG_STOP_WORDS,
  createCandidateTagProfile,
  createContextTagProfile,
  extractLocalTags,
  isCanonicalNativeTag,
  isNormalizedTag,
  normalizeNativeTag,
  normalizeNativeTags,
  normalizeTag
} from "../../shared/tags.js";

test("freezes the central tag limits and small stop-word list", () => {
  assert.equal(Object.isFrozen(TAG_LIMITS), true);
  assert.equal(Object.isFrozen(TAG_STOP_WORDS), true);
  assert.equal(TAG_LIMITS.maxTags, 12);
  assert.ok(TAG_STOP_WORDS.length < 40);
});

test("normalizes Unicode, case, whitespace, full-width forms and hashtags", () => {
  assert.equal(normalizeTag("  ＃ＡＩ　Research  "), "ai research");
  assert.equal(normalizeTag("Cafe\u0301"), "café");
  assert.equal(normalizeTag("  机器\n学习  "), "机器 学习");
});

test("rejects empty, noisy, stop-word and invalid tag values safely", () => {
  for (const value of [null, 1, "", "  ", "###", "THE", "的", "\u0000", "\ud800"]) {
    assert.equal(normalizeTag(value), null);
  }
  assert.deepEqual(extractLocalTags(null), []);
  assert.deepEqual(normalizeNativeTags("not-an-array"), []);
});

test("extracts Chinese, English, numeric and hashtag tags", () => {
  assert.deepEqual(
    extractLocalTags("The 机器人 #AI GPT-4 2026 和 #机器学习"),
    ["2026", "4", "ai", "gpt", "机器人", "机器学习"]
  );
});

test("deduplicates tags and returns deterministic ordering", () => {
  const first = extractLocalTags("Beta ALPHA beta #Alpha 机器人");
  const second = extractLocalTags("机器人 #alpha beta ALPHA Beta");

  assert.deepEqual(first, ["alpha", "beta", "机器人"]);
  assert.deepEqual(second, first);
  assert.equal(Object.isFrozen(first), true);
});

test("applies central source, tag-length and count limits", () => {
  const manyTags = Array.from({ length: 30 }, (_, index) => `tag${index}`).join(" ");
  const tags = extractLocalTags(manyTags);
  const longTag = normalizeTag("A".repeat(TAG_LIMITS.maxTagCodePoints + 20));

  assert.equal(tags.length, TAG_LIMITS.maxTags);
  assert.equal(Array.from(longTag).length, TAG_LIMITS.maxTagCodePoints);
  assert.deepEqual(
    extractLocalTags(`${"x".repeat(TAG_LIMITS.maxSourceCodePoints)} beyond`),
    ["x".repeat(TAG_LIMITS.maxTagCodePoints)]
  );
});

test("keeps canonical native labels separate from normalized tags", () => {
  assert.equal(normalizeNativeTag("  ＃ＡＩ  "), "#AI");
  assert.equal(isCanonicalNativeTag("#AI"), true);
  assert.equal(isCanonicalNativeTag(" #AI "), false);
  assert.equal(isNormalizedTag("ai"), true);
  assert.equal(isNormalizedTag("AI"), false);
  assert.deepEqual(
    normalizeNativeTags([" #AI ", "ai", " 机器学习 ", "", null, "Ｂ站"]),
    ["#AI", "B站", "机器学习"]
  );
});

test("creates an immutable ContextTagProfile without mutating input", () => {
  const input = { sessionId: "session-1", query: "Robot 机器人 #AI" };
  const snapshot = structuredClone(input);
  const profile = createContextTagProfile(input);

  assert.deepEqual(profile, {
    sessionId: "session-1",
    normalizedTags: ["ai", "robot", "机器人"]
  });
  assert.deepEqual(input, snapshot);
  assert.equal(Object.isFrozen(profile), true);
  assert.equal(Object.isFrozen(profile.normalizedTags), true);
});

test("creates an immutable CandidateTagProfile with native and local tags", () => {
  const nativeTags = ["#AI", "机器人", "ai"];
  const input = {
    candidateId: "candidate-1",
    sessionId: "session-1",
    title: "Planning with World Models 2026",
    nativeTags
  };
  const snapshot = structuredClone(input);
  const profile = createCandidateTagProfile(input);

  assert.deepEqual(profile, {
    candidateId: "candidate-1",
    sessionId: "session-1",
    nativeTags: ["#AI", "机器人"],
    normalizedTags: [
      "2026",
      "ai",
      "models",
      "planning",
      "world",
      "机器人"
    ]
  });
  assert.deepEqual(input, snapshot);
  assert.equal(Object.isFrozen(profile), true);
  assert.equal(Object.isFrozen(profile.nativeTags), true);
  assert.equal(Object.isFrozen(profile.normalizedTags), true);
});

test("reserves normalized profile capacity for every retained native tag", () => {
  const nativeTags = Array.from(
    { length: TAG_LIMITS.maxNativeTags },
    (_, index) => `Native ${index}`
  );
  const profile = createCandidateTagProfile({
    candidateId: "candidate-1",
    sessionId: "session-1",
    title: "alpha beta gamma delta",
    nativeTags
  });

  assert.equal(profile.normalizedTags.length, TAG_LIMITS.maxTags);
  for (const nativeTag of profile.nativeTags) {
    assert.ok(profile.normalizedTags.includes(normalizeTag(nativeTag)));
  }
});

test("rejects invalid profile identifiers and accepts empty text safely", () => {
  assert.throws(() => createContextTagProfile(null), TypeError);
  assert.throws(
    () => createContextTagProfile({ sessionId: "", query: "robot" }),
    TypeError
  );
  assert.throws(
    () =>
      createCandidateTagProfile({
        candidateId: "",
        sessionId: "session-1",
        title: "robot"
      }),
    TypeError
  );
  assert.deepEqual(
    createContextTagProfile({ sessionId: "session-1", query: null })
      .normalizedTags,
    []
  );
});

test("tag extraction is deterministic and has no browser or nondeterministic API", async () => {
  const input = "#AI Robot 机器人 2026";
  assert.deepEqual(extractLocalTags(input), extractLocalTags(input));

  const source = await readFile(new URL("../../shared/tags.js", import.meta.url), "utf8");
  assert.doesNotMatch(
    source,
    /\b(?:chrome|document|window|localStorage|indexedDB|fetch|XMLHttpRequest|Date|performance)\b/u
  );
  assert.doesNotMatch(source, /Math\.random/u);
});
