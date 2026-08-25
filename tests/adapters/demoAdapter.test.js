import assert from "node:assert/strict";
import test from "node:test";

import { createDemoAdapter } from "../../content/adapters/demoAdapter.js";
import {
  createDemoDocumentFixture,
  createMutationObserverHarness
} from "./fixtures/demoDom.js";

const demoUrl = new URL("chrome-extension://test/demo/index.html");

test("extracts normalized Candidate fields with DOM rank", () => {
  const fixture = createDemoDocumentFixture({
    candidates: [
      {
        id: "candidate-001",
        title: "  Cognitive Maps for Robot Navigation  ",
        href: "https://knowledge.example/paper?id=7&utm_source=demo#abstract"
      },
      {
        id: "candidate-002",
        title: "Planning with World Models",
        href: "https://knowledge.example/paper?z=2&a=1"
      }
    ]
  });
  const adapter = createDemoAdapter({ document: fixture.document });

  assert.equal(adapter.canHandle(demoUrl, fixture.document), true);
  assert.deepEqual(adapter.extractCandidates(fixture.document), [
    {
      id: "candidate-001",
      url: "https://knowledge.example/paper?id=7",
      title: "Cognitive Maps for Robot Navigation",
      source: "local-demo-search",
      rank: 1,
      sessionId: "demo-session-001"
    },
    {
      id: "candidate-002",
      url: "https://knowledge.example/paper?a=1&z=2",
      title: "Planning with World Models",
      source: "local-demo-search",
      rank: 2,
      sessionId: "demo-session-001"
    }
  ]);
});

test("parses the minimal SearchContext", () => {
  const fixture = createDemoDocumentFixture({
    query: "spatial reasoning",
    source: "local-demo-search",
    timestamp: 123456,
    keywords: ["spatial", "reasoning", "robotics"]
  });
  const adapter = createDemoAdapter({ document: fixture.document });

  assert.deepEqual(adapter.getContext(fixture.document, demoUrl), {
    query: "spatial reasoning",
    source: "local-demo-search",
    timestamp: 123456,
    keywords: ["spatial", "reasoning", "robotics"]
  });
});

test("skips empty titles, missing or bad links, and duplicate IDs or URLs", () => {
  const fixture = createDemoDocumentFixture({
    candidates: [
      {
        id: "empty-title",
        title: "   ",
        href: "https://knowledge.example/empty"
      },
      { id: "missing-link", title: "Missing link" },
      {
        id: "bad-link",
        title: "Bad link",
        href: "javascript:alert(1)"
      },
      {
        id: "candidate-001",
        title: "First valid result",
        href: "https://knowledge.example/item?id=1"
      },
      {
        id: "candidate-001",
        title: "Duplicate ID",
        href: "https://knowledge.example/item?id=2"
      },
      {
        id: "candidate-002",
        title: "Duplicate normalized URL",
        href: "https://knowledge.example/item?utm_source=demo&id=1#copy"
      },
      {
        id: "candidate-003",
        title: "Second valid result",
        href: "https://knowledge.example/item?id=3"
      }
    ]
  });
  const adapter = createDemoAdapter({ document: fixture.document });

  assert.deepEqual(adapter.extractCandidates(fixture.document), [
    {
      id: "candidate-001",
      url: "https://knowledge.example/item?id=1",
      title: "First valid result",
      source: "local-demo-search",
      rank: 4,
      sessionId: "demo-session-001"
    },
    {
      id: "candidate-003",
      url: "https://knowledge.example/item?id=3",
      title: "Second valid result",
      source: "local-demo-search",
      rank: 7,
      sessionId: "demo-session-001"
    }
  ]);
});

test("notifies once for a new valid result and ignores duplicate or unrelated mutations", () => {
  const fixture = createDemoDocumentFixture({
    candidates: [
      {
        id: "candidate-001",
        title: "Initial result",
        href: "https://knowledge.example/item?id=1"
      }
    ]
  });
  const observerHarness = createMutationObserverHarness();
  const adapter = createDemoAdapter({
    document: fixture.document,
    MutationObserver: observerHarness.MutationObserver
  });
  let callbackCount = 0;
  adapter.observeChanges(() => {
    callbackCount += 1;
  });

  fixture.addCandidate({
    id: "candidate-002",
    title: "New result",
    href: "https://knowledge.example/item?id=2"
  });
  assert.equal(callbackCount, 1);
  assert.deepEqual(
    adapter.extractCandidates(fixture.document).map((candidate) => candidate.id),
    ["candidate-001", "candidate-002"]
  );

  fixture.addCandidate({
    id: "candidate-002",
    title: "Duplicate ID",
    href: "https://knowledge.example/item?id=3"
  });
  fixture.addCandidate({
    id: "candidate-003",
    title: "Duplicate normalized URL",
    href: "https://knowledge.example/item?utm_source=demo&id=2#copy"
  });
  fixture.addUnrelatedNode();
  assert.equal(callbackCount, 1);
});

test("cleanup is idempotent and prevents later callbacks", () => {
  const fixture = createDemoDocumentFixture();
  const observerHarness = createMutationObserverHarness();
  const adapter = createDemoAdapter({
    document: fixture.document,
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
    id: "candidate-after-cleanup",
    title: "Must not notify",
    href: "https://knowledge.example/item?id=99"
  });
  observerHarness.instances[0].notify();
  assert.equal(callbackCount, 0);
});
