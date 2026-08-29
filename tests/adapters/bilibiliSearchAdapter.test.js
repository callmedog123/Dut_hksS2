import assert from "node:assert/strict";
import test from "node:test";

import { createBilibiliSearchAdapter } from "../../content/adapters/bilibiliSearchAdapter.js";
import {
  createBilibiliDocumentFixture,
  createMutationObserverHarness
} from "./fixtures/bilibiliDom.js";

const searchUrl = new URL(
  "https://search.bilibili.com/all?keyword=robot%20navigation"
);

function createAdapter(fixture, options = {}) {
  return createBilibiliSearchAdapter({
    document: fixture.document,
    sessionIdFactory: () => "bilibili-session-001",
    ...options
  });
}

test("extracts minimal normalized Candidates with stable video IDs and DOM rank", () => {
  const fixture = createBilibiliDocumentFixture({
    candidates: [
      {
        title: "  Robot   Navigation Basics  ",
        href: "//www.bilibili.com/video/BV1RobotNav01/?utm_source=search&b=2&a=1#reply"
      },
      {
        title: "Visual Navigation",
        href: "https://www.bilibili.com/video/BV1VisualNav2/"
      }
    ]
  });
  const adapter = createAdapter(fixture);

  assert.equal(adapter.canHandle(searchUrl, fixture.document), true);
  assert.deepEqual(adapter.extractCandidates(fixture.document), [
    {
      id: "BV1RobotNav01",
      url: "https://www.bilibili.com/video/BV1RobotNav01/?a=1&b=2",
      title: "Robot Navigation Basics",
      source: "bilibili-search",
      rank: 1,
      sessionId: "bilibili-session-001",
      contentType: "VIDEO",
      layoutType: "GRID"
    },
    {
      id: "BV1VisualNav2",
      url: "https://www.bilibili.com/video/BV1VisualNav2/",
      title: "Visual Navigation",
      source: "bilibili-search",
      rank: 2,
      sessionId: "bilibili-session-001",
      contentType: "VIDEO",
      layoutType: "GRID"
    }
  ]);
});

test("resolves protocol-relative links from location when baseURI is unavailable", () => {
  const fixture = createBilibiliDocumentFixture({
    candidates: [
      {
        title: "Protocol-relative result",
        href: "//www.bilibili.com/video/BV1Relative01/"
      }
    ]
  });
  Object.defineProperty(fixture.document, "baseURI", {
    configurable: true,
    value: undefined
  });
  const adapter = createAdapter(fixture);

  assert.equal(
    adapter.extractCandidates(fixture.document)[0].url,
    "https://www.bilibili.com/video/BV1Relative01/"
  );
});

test("parses minimal SearchContext from the URL without reading page content", () => {
  const fixture = createBilibiliDocumentFixture();
  const adapter = createAdapter(fixture, { now: () => 1787587200000 });

  assert.deepEqual(adapter.getContext(fixture.document, searchUrl), {
    query: "robot navigation",
    source: "bilibili-search",
    timestamp: 1787587200000,
    keywords: ["robot", "navigation"]
  });
});

test("skips ads, non-video or bad links, empty titles, selector failures, and duplicates", () => {
  const fixture = createBilibiliDocumentFixture({
    candidates: [
      {
        title: "Advertisement",
        href: "https://cm.bilibili.com/video/BV1Advert0001/"
      },
      {
        title: "   ",
        href: "https://www.bilibili.com/video/BV1Empty00001/"
      },
      { title: "Bad link", href: "javascript:/video/BV1BadLink001/" },
      { title: "Article", href: "https://www.bilibili.com/read/cv123" },
      { title: "Missing link" },
      {
        title: "Valid result",
        href: "https://www.bilibili.com/video/BV1Valid00001/?a=1&utm_medium=fixture#copy"
      },
      {
        title: "Duplicate stable ID",
        href: "https://www.bilibili.com/video/BV1Valid00001/?a=2"
      },
      {
        title: "Duplicate normalized URL",
        href: "https://www.bilibili.com/video/BV1Valid00001/?utm_source=copy&a=1#other"
      },
      {
        title: "Broken card",
        href: "https://www.bilibili.com/video/BV1Broken0001/",
        throwOnQuery: true
      }
    ]
  });
  const adapter = createAdapter(fixture);

  assert.deepEqual(adapter.extractCandidates(fixture.document), [
    {
      id: "BV1Valid00001",
      url: "https://www.bilibili.com/video/BV1Valid00001/?a=1",
      title: "Valid result",
      source: "bilibili-search",
      rank: 6,
      sessionId: "bilibili-session-001",
      contentType: "VIDEO",
      layoutType: "GRID"
    }
  ]);
});

test("notifies once for dynamically loaded valid results and ignores duplicates", () => {
  const fixture = createBilibiliDocumentFixture({
    candidates: [
      {
        title: "Initial",
        href: "https://www.bilibili.com/video/BV1Initial001/"
      }
    ]
  });
  const observerHarness = createMutationObserverHarness();
  const adapter = createAdapter(fixture, {
    MutationObserver: observerHarness.MutationObserver
  });
  let callbackCount = 0;
  adapter.observeChanges(() => {
    callbackCount += 1;
  });

  fixture.addCandidate({
    title: "Dynamic",
    href: "https://www.bilibili.com/video/BV1Dynamic001/?utm_source=feed"
  });
  observerHarness.notifyAll();
  assert.equal(callbackCount, 1);

  fixture.addCandidate({
    title: "Duplicate dynamic",
    href: "https://www.bilibili.com/video/BV1Dynamic001/?p=2"
  });
  observerHarness.notifyAll();
  fixture.addUnrelatedNode();
  observerHarness.notifyAll();

  assert.equal(callbackCount, 1);
  assert.deepEqual(
    adapter.extractCandidates(fixture.document).map((candidate) => candidate.id),
    ["BV1Initial001", "BV1Dynamic001"]
  );
});

test("treats an SPA query change as a new context and new stable session", () => {
  const fixture = createBilibiliDocumentFixture({
    candidates: [
      {
        title: "First query result",
        href: "https://www.bilibili.com/video/BV1FirstQuery/"
      }
    ]
  });
  const observerHarness = createMutationObserverHarness();
  let sessionSequence = 0;
  const adapter = createAdapter(fixture, {
    MutationObserver: observerHarness.MutationObserver,
    sessionIdFactory: () => `bilibili-session-${++sessionSequence}`,
    now: () => 200
  });
  let callbackCount = 0;
  adapter.observeChanges(() => {
    callbackCount += 1;
  });

  fixture.navigate(
    "https://search.bilibili.com/all?keyword=spatial%20reasoning",
    [
      {
        title: "Second query result",
        href: "https://www.bilibili.com/video/BV1SecondQuer/"
      }
    ]
  );
  observerHarness.notifyAll();

  const currentUrl = new URL(fixture.document.location.href);
  assert.equal(callbackCount, 1);
  assert.deepEqual(adapter.getContext(fixture.document, currentUrl), {
    query: "spatial reasoning",
    source: "bilibili-search",
    timestamp: 200,
    keywords: ["spatial", "reasoning"]
  });
  assert.equal(
    adapter.extractCandidates(fixture.document)[0].sessionId,
    "bilibili-session-2"
  );

  fixture.addUnrelatedNode();
  observerHarness.notifyAll();
  assert.equal(callbackCount, 1);

  fixture.navigate(searchUrl.href, [
    {
      title: "First query revisited",
      href: "https://www.bilibili.com/video/BV1FirstAgain/"
    }
  ]);
  observerHarness.notifyAll();
  assert.equal(callbackCount, 2);
  assert.equal(
    adapter.extractCandidates(fixture.document)[0].sessionId,
    "bilibili-session-3"
  );
});

test("selector failures safely degrade to no candidates", () => {
  const fixture = createBilibiliDocumentFixture();
  const observerHarness = createMutationObserverHarness();
  fixture.document.querySelector = () => {
    throw new Error("Search markup changed");
  };
  const adapter = createAdapter(fixture, {
    MutationObserver: observerHarness.MutationObserver
  });
  let callbackCount = 0;

  assert.deepEqual(adapter.extractCandidates(fixture.document), []);
  const cleanup = adapter.observeChanges(() => {
    callbackCount += 1;
  });
  observerHarness.notifyAll();
  cleanup();

  assert.equal(callbackCount, 0);
});

test("cleanup is idempotent and prevents callbacks after disposal", () => {
  const fixture = createBilibiliDocumentFixture();
  const observerHarness = createMutationObserverHarness();
  const adapter = createAdapter(fixture, {
    MutationObserver: observerHarness.MutationObserver
  });
  let callbackCount = 0;
  const cleanup = adapter.observeChanges(() => {
    callbackCount += 1;
  });

  cleanup();
  cleanup();
  assert.equal(observerHarness.instances[0].disconnectCount, 1);

  fixture.addCandidate({
    title: "After cleanup",
    href: "https://www.bilibili.com/video/BV1AfterClean/"
  });
  observerHarness.notifyAll();
  assert.equal(callbackCount, 0);
});
