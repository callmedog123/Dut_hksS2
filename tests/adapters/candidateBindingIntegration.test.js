import assert from "node:assert/strict";
import test from "node:test";

import { createBilibiliSearchAdapter } from "../../content/adapters/bilibiliSearchAdapter.js";
import { createDemoAdapter } from "../../content/adapters/demoAdapter.js";
import {
  createBilibiliDocumentFixture,
  createMutationObserverHarness as createBilibiliObserverHarness
} from "./fixtures/bilibiliDom.js";
import {
  createDemoDocumentFixture,
  createMutationObserverHarness as createDemoObserverHarness
} from "./fixtures/demoDom.js";

function createBindingEvent(type, binding) {
  return {
    type,
    id: binding.candidate.id,
    sessionId: binding.candidate.sessionId,
    element: binding.element
  };
}

test("Demo Adapter owns initial, dynamic, replacement, removal, and cleanup bindings", () => {
  const initialCandidate = {
    id: "candidate-1",
    title: "Initial result",
    href: "https://knowledge.example/item?id=1"
  };
  const dynamicCandidate = {
    id: "candidate-2",
    title: "Dynamic result",
    href: "https://knowledge.example/item?id=2"
  };
  const fixture = createDemoDocumentFixture({
    candidates: [initialCandidate]
  });
  const observerHarness = createDemoObserverHarness();
  const events = [];
  const adapter = createDemoAdapter({
    document: fixture.document,
    MutationObserver: observerHarness.MutationObserver,
    onCandidateBound(binding) {
      events.push(createBindingEvent("bound", binding));
    },
    onCandidateUnbound(binding) {
      events.push(createBindingEvent("unbound", binding));
    }
  });

  const initialElement = fixture.candidateElements[0];
  const cleanup = adapter.observeChanges(() => {});
  assert.deepEqual(events, [
    {
      type: "bound",
      id: "candidate-1",
      sessionId: "demo-session-001",
      element: initialElement
    }
  ]);

  adapter.extractCandidates(fixture.document);
  assert.equal(events.length, 1);

  const dynamicElement = fixture.addCandidate(dynamicCandidate);
  assert.deepEqual(events.at(-1), {
    type: "bound",
    id: "candidate-2",
    sessionId: "demo-session-001",
    element: dynamicElement
  });

  fixture.replaceCandidates([initialCandidate, dynamicCandidate]);
  const [replacementOne, replacementTwo] = fixture.candidateElements;
  assert.deepEqual(events.slice(-4), [
    {
      type: "unbound",
      id: "candidate-1",
      sessionId: "demo-session-001",
      element: initialElement
    },
    {
      type: "unbound",
      id: "candidate-2",
      sessionId: "demo-session-001",
      element: dynamicElement
    },
    {
      type: "bound",
      id: "candidate-1",
      sessionId: "demo-session-001",
      element: replacementOne
    },
    {
      type: "bound",
      id: "candidate-2",
      sessionId: "demo-session-001",
      element: replacementTwo
    }
  ]);

  fixture.removeCandidate(1);
  assert.deepEqual(events.at(-1), {
    type: "unbound",
    id: "candidate-2",
    sessionId: "demo-session-001",
    element: replacementTwo
  });

  cleanup();
  cleanup();
  assert.deepEqual(events.at(-1), {
    type: "unbound",
    id: "candidate-1",
    sessionId: "demo-session-001",
    element: replacementOne
  });
  const eventCountAfterCleanup = events.length;
  fixture.addCandidate(dynamicCandidate);
  observerHarness.instances[0].notify();
  assert.equal(events.length, eventCountAfterCleanup);
});

test("Bilibili Adapter clears old-session bindings across SPA navigation", () => {
  const firstCandidate = {
    title: "First result",
    href: "https://www.bilibili.com/video/BV1FirstBind/"
  };
  const dynamicCandidate = {
    title: "Dynamic result",
    href: "https://www.bilibili.com/video/BV1DynamicBind/"
  };
  const fixture = createBilibiliDocumentFixture({
    candidates: [firstCandidate]
  });
  const observerHarness = createBilibiliObserverHarness();
  const events = [];
  let sessionSequence = 0;
  const adapter = createBilibiliSearchAdapter({
    document: fixture.document,
    MutationObserver: observerHarness.MutationObserver,
    sessionIdFactory: () => `bilibili-session-${++sessionSequence}`,
    onCandidateBound(binding) {
      events.push(createBindingEvent("bound", binding));
    },
    onCandidateUnbound(binding) {
      events.push(createBindingEvent("unbound", binding));
    }
  });

  const initialElement = fixture.cards[0];
  const cleanup = adapter.observeChanges(() => {});
  assert.deepEqual(events.at(-1), {
    type: "bound",
    id: "BV1FirstBind",
    sessionId: "bilibili-session-1",
    element: initialElement
  });

  adapter.extractCandidates(fixture.document);
  assert.equal(events.length, 1);

  const dynamicElement = fixture.addCandidate(dynamicCandidate);
  observerHarness.notifyAll();
  assert.deepEqual(events.at(-1), {
    type: "bound",
    id: "BV1DynamicBind",
    sessionId: "bilibili-session-1",
    element: dynamicElement
  });

  fixture.removeCandidate(1);
  observerHarness.notifyAll();
  assert.deepEqual(events.at(-1), {
    type: "unbound",
    id: "BV1DynamicBind",
    sessionId: "bilibili-session-1",
    element: dynamicElement
  });

  fixture.replaceCandidates([firstCandidate]);
  const replacementElement = fixture.cards[0];
  observerHarness.notifyAll();
  assert.deepEqual(events.slice(-2), [
    {
      type: "unbound",
      id: "BV1FirstBind",
      sessionId: "bilibili-session-1",
      element: initialElement
    },
    {
      type: "bound",
      id: "BV1FirstBind",
      sessionId: "bilibili-session-1",
      element: replacementElement
    }
  ]);

  fixture.navigate(
    "https://search.bilibili.com/all?keyword=spatial%20reasoning",
    [
      {
        title: "New session result",
        href: "https://www.bilibili.com/video/BV1NewSession/"
      }
    ]
  );
  const newSessionElement = fixture.cards[0];
  observerHarness.notifyAll();
  assert.deepEqual(events.at(-1), {
    type: "unbound",
    id: "BV1FirstBind",
    sessionId: "bilibili-session-1",
    element: replacementElement
  });

  adapter.extractCandidates(fixture.document);
  assert.deepEqual(events.at(-1), {
    type: "bound",
    id: "BV1NewSession",
    sessionId: "bilibili-session-2",
    element: newSessionElement
  });

  cleanup();
  cleanup();
  assert.deepEqual(events.at(-1), {
    type: "unbound",
    id: "BV1NewSession",
    sessionId: "bilibili-session-2",
    element: newSessionElement
  });
  const eventCountAfterCleanup = events.length;
  fixture.addCandidate(dynamicCandidate);
  observerHarness.notifyAll();
  assert.equal(events.length, eventCountAfterCleanup);
});
