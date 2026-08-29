import assert from "node:assert/strict";
import test from "node:test";

import { createZhihuSearchAdapter } from "../../content/adapters/zhihuSearchAdapter.js";
import { CONTENT_TYPES, LAYOUT_TYPES } from "../../shared/types.js";
import {
  createMutationObserverHarness,
  createZhihuDocumentFixture
} from "./fixtures/zhihuDom.js";

const searchUrl = new URL(
  "https://www.zhihu.com/search?type=content&q=robot%20navigation"
);

function createAdapter(fixture, options = {}) {
  return createZhihuSearchAdapter({
    document: fixture.document,
    sessionIdFactory: () => "zhihu-session-001",
    ...options
  });
}

test("extracts QUESTION, ANSWER and ARTICLE with permanent URLs and namespaced IDs", () => {
  const fixture = createZhihuDocumentFixture({
    candidates: [
      {
        type: "answer",
        title: "  Answer uses   question title  ",
        href: "/question/123/answer/456?utm_source=search#copy"
      },
      {
        type: "question",
        title: "Question result",
        href: "/question/789?utm_medium=search"
      },
      {
        type: "article",
        title: "Article result",
        href: "//zhuanlan.zhihu.com/p/345?zpf=tracking&utm_source=search"
      }
    ]
  });
  const adapter = createAdapter(fixture);

  assert.equal(adapter.canHandle(searchUrl, fixture.document), true);
  assert.deepEqual(adapter.extractCandidates(fixture.document), [
    {
      id: "zhihu:answer:456",
      url: "https://www.zhihu.com/question/123/answer/456",
      title: "Answer uses question title",
      source: "zhihu-search",
      rank: 1,
      sessionId: "zhihu-session-001",
      contentType: CONTENT_TYPES.ANSWER,
      layoutType: LAYOUT_TYPES.TEXT_LIST
    },
    {
      id: "zhihu:question:789",
      url: "https://www.zhihu.com/question/789",
      title: "Question result",
      source: "zhihu-search",
      rank: 2,
      sessionId: "zhihu-session-001",
      contentType: CONTENT_TYPES.QUESTION,
      layoutType: LAYOUT_TYPES.TEXT_LIST
    },
    {
      id: "zhihu:article:345",
      url: "https://zhuanlan.zhihu.com/p/345",
      title: "Article result",
      source: "zhihu-search",
      rank: 3,
      sessionId: "zhihu-session-001",
      contentType: CONTENT_TYPES.ARTICLE,
      layoutType: LAYOUT_TYPES.TEXT_LIST
    }
  ]);
});

test("parses minimal SearchContext and accepts only ordinary content search", () => {
  const fixture = createZhihuDocumentFixture();
  const adapter = createAdapter(fixture, { now: () => 1788019200000 });

  assert.deepEqual(adapter.getContext(fixture.document, searchUrl), {
    query: "robot navigation",
    source: "zhihu-search",
    timestamp: 1788019200000,
    keywords: ["robot", "navigation"]
  });
  assert.equal(
    adapter.canHandle(
      new URL("https://www.zhihu.com/search?q=robot"),
      fixture.document
    ),
    true
  );
  for (const unsupported of [
    "https://www.zhihu.com/search?type=people&q=robot",
    "https://www.zhihu.com/question/123",
    "https://zhuanlan.zhihu.com/search?type=content&q=robot",
    "http://www.zhihu.com/search?type=content&q=robot",
    "https://www.zhihu.com/search?type=content&q="
  ]) {
    assert.equal(adapter.canHandle(new URL(unsupported), fixture.document), false);
  }
});

test("skips advertisements, users, unstable URLs, malformed cards and duplicates", () => {
  const fixture = createZhihuDocumentFixture({
    candidates: [
      { type: "answer", title: "Ad", href: "/question/1/answer/2", ad: true },
      { type: "user", title: "User", href: "/people/example" },
      { type: "answer", title: "Question only", href: "/question/3" },
      { type: "question", title: "Answer mismatch", href: "/question/3/answer/4" },
      { type: "article", title: "Wrong host", href: "https://evil.example/p/5" },
      { type: "article", title: "Bad", href: "javascript:void(0)" },
      { type: "answer", title: "   ", href: "/question/6/answer/7" },
      { type: "answer", title: "Missing link" },
      { type: "answer", title: "Valid", href: "/question/10/answer/20" },
      { type: "answer", title: "Duplicate ID", href: "/question/11/answer/20" },
      { type: "answer", title: "Duplicate URL", href: "/question/10/answer/20?x=1" },
      {
        type: "article",
        title: "Broken selector",
        href: "//zhuanlan.zhihu.com/p/30",
        throwOnQuery: true
      }
    ]
  });
  const adapter = createAdapter(fixture);

  assert.deepEqual(
    adapter.extractCandidates(fixture.document).map((candidate) => ({
      id: candidate.id,
      rank: candidate.rank
    })),
    [{ id: "zhihu:answer:20", rank: 8 }]
  );
});

test("notifies for dynamic additions, supports replacement and ignores duplicates", () => {
  const initial = { type: "question", title: "Initial", href: "/question/1" };
  const dynamic = {
    type: "article",
    title: "Dynamic",
    href: "//zhuanlan.zhihu.com/p/2?zpf=feed"
  };
  const fixture = createZhihuDocumentFixture({ candidates: [initial] });
  const observers = createMutationObserverHarness();
  const events = [];
  const adapter = createAdapter(fixture, {
    MutationObserver: observers.MutationObserver,
    onCandidateBound(binding) {
      events.push(["bound", binding.candidate.id, binding.element]);
    },
    onCandidateUnbound(binding) {
      events.push(["unbound", binding.candidate.id, binding.element]);
    }
  });
  let changes = 0;
  const cleanup = adapter.observeChanges(() => {
    changes += 1;
  });
  const initialElement = fixture.cards[0];

  const dynamicElement = fixture.addCandidate(dynamic);
  observers.notifyAll();
  assert.equal(changes, 1);
  assert.deepEqual(events.at(-1), ["bound", "zhihu:article:2", dynamicElement]);

  fixture.addCandidate({
    type: "article",
    title: "Duplicate",
    href: "//zhuanlan.zhihu.com/p/2?zpf=duplicate"
  });
  fixture.addUnrelatedNode();
  observers.notifyAll();
  assert.equal(changes, 1);

  fixture.replaceCandidates([initial, dynamic]);
  const [replacementInitial, replacementDynamic] = fixture.cards;
  observers.notifyAll();
  assert.equal(changes, 1);
  assert.deepEqual(events.slice(-4), [
    ["unbound", "zhihu:question:1", initialElement],
    ["unbound", "zhihu:article:2", dynamicElement],
    ["bound", "zhihu:question:1", replacementInitial],
    ["bound", "zhihu:article:2", replacementDynamic]
  ]);

  cleanup();
  cleanup();
  assert.equal(observers.instances[0].disconnectCount, 1);
  const eventCount = events.length;
  fixture.addCandidate({ type: "question", title: "Late", href: "/question/9" });
  observers.notifyAll();
  assert.equal(events.length, eventCount);
});

test("query changes create a new Session and clear old bindings", () => {
  const fixture = createZhihuDocumentFixture({
    candidates: [{ type: "question", title: "First", href: "/question/1" }]
  });
  const observers = createMutationObserverHarness();
  let sequence = 0;
  const unbound = [];
  const adapter = createAdapter(fixture, {
    MutationObserver: observers.MutationObserver,
    sessionIdFactory: () => `zhihu-session-${++sequence}`,
    onCandidateUnbound(binding) {
      unbound.push(binding.candidate.id);
    }
  });
  let changes = 0;
  adapter.observeChanges(() => {
    changes += 1;
  });

  fixture.navigate(
    "https://www.zhihu.com/search?type=content&q=second",
    [{ type: "answer", title: "Second", href: "/question/2/answer/3" }]
  );
  observers.notifyAll();
  assert.equal(changes, 1);
  assert.deepEqual(unbound, ["zhihu:question:1"]);
  assert.equal(
    adapter.extractCandidates(fixture.document)[0].sessionId,
    "zhihu-session-2"
  );
});

test("document selector failures safely degrade to no candidates", () => {
  const fixture = createZhihuDocumentFixture();
  fixture.document.querySelectorAll = () => {
    throw new Error("Zhihu selector changed");
  };
  const adapter = createAdapter(fixture);
  assert.deepEqual(adapter.extractCandidates(fixture.document), []);
});
