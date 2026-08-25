import assert from "node:assert/strict";
import test from "node:test";

import { normalizeCandidateUrl } from "../../shared/url.js";

test("normalizes an absolute string URL", () => {
  assert.equal(
    normalizeCandidateUrl("https://example.com/articles/42"),
    "https://example.com/articles/42"
  );
});

test("accepts a URL object without mutating it", () => {
  const input = new URL(
    "https://example.com/paper/?z=2&utm_source=newsletter&a=1#notes"
  );

  assert.equal(
    normalizeCandidateUrl(input),
    "https://example.com/paper/?a=1&z=2"
  );
  assert.equal(
    input.href,
    "https://example.com/paper/?z=2&utm_source=newsletter&a=1#notes"
  );
});

test("resolves a relative URL only when an explicit base is provided", () => {
  assert.equal(normalizeCandidateUrl("../paper?id=42"), null);
  assert.equal(
    normalizeCandidateUrl(
      "../paper?id=42",
      "https://demo.example/search/results/"
    ),
    "https://demo.example/search/paper?id=42"
  );
});

test("removes the fragment", () => {
  assert.equal(
    normalizeCandidateUrl("https://example.com/path/?id=7#section-2"),
    "https://example.com/path/?id=7"
  );
});

test("removes explicitly listed tracking parameters case-insensitively", () => {
  assert.equal(
    normalizeCandidateUrl(
      "https://example.com/item?utm_source=mail&UTM_MEDIUM=email&fbclid=f&GCLID=g&dclid=d&msclkid=m&mc_cid=c&mc_eid=e&id=42"
    ),
    "https://example.com/item?id=42"
  );
});

test("preserves business parameters and the path trailing slash", () => {
  assert.equal(
    normalizeCandidateUrl(
      "https://example.com/search/?sort=recent&q=robotics&page=2&lang=zh"
    ),
    "https://example.com/search/?lang=zh&page=2&q=robotics&sort=recent"
  );
});

test("sorts query keys stably while retaining duplicate value order", () => {
  assert.equal(
    normalizeCandidateUrl("https://example.com/?z=2&a=3&b=1&a=1"),
    "https://example.com/?a=3&a=1&b=1&z=2"
  );
});

test("returns null for unparseable input", () => {
  assert.equal(normalizeCandidateUrl("not a valid absolute URL"), null);
  assert.equal(normalizeCandidateUrl("http://[invalid"), null);
  assert.equal(normalizeCandidateUrl(null), null);
});

test("returns null for disallowed protocols", () => {
  assert.equal(normalizeCandidateUrl("javascript:alert(1)"), null);
  assert.equal(normalizeCandidateUrl("mailto:student@example.com"), null);
  assert.equal(normalizeCandidateUrl("data:text/plain,hello"), null);
});
