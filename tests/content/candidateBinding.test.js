import assert from "node:assert/strict";
import test from "node:test";

import { createCandidateBindingRegistry } from "../../content/candidateBinding.js";

function createCandidate(overrides = {}) {
  return {
    id: "candidate-1",
    url: "https://example.com/result-1",
    title: "Result one",
    source: "local-demo",
    rank: 1,
    sessionId: "session-1",
    ...overrides
  };
}

test("binds an initial Candidate and keeps repeated scans idempotent", () => {
  const bound = [];
  const unbound = [];
  const registry = createCandidateBindingRegistry({
    onBound(binding) {
      bound.push(binding);
    },
    onUnbound(binding) {
      unbound.push(binding);
    }
  });
  const element = {};
  const candidate = createCandidate();

  const initial = registry.sync([{ candidate, element }]);
  const repeated = registry.sync([
    { candidate: createCandidate({ rank: 2 }), element }
  ]);

  assert.equal(initial.bound.length, 1);
  assert.equal(initial.unbound.length, 0);
  assert.deepEqual(repeated, { bound: [], unbound: [] });
  assert.equal(bound.length, 1);
  assert.equal(unbound.length, 0);
  assert.equal(registry.size, 1);
  assert.equal(
    registry.getBinding("session-1", "candidate-1").element,
    element
  );
});

test("unbinds the old card before binding a replacement Element", () => {
  const events = [];
  const registry = createCandidateBindingRegistry({
    onBound(binding) {
      events.push(["bound", binding.element]);
    },
    onUnbound(binding) {
      events.push(["unbound", binding.element]);
    }
  });
  const firstElement = {};
  const replacementElement = {};
  const candidate = createCandidate();

  registry.sync([{ candidate, element: firstElement }]);
  registry.sync([{ candidate, element: replacementElement }]);

  assert.deepEqual(events, [
    ["bound", firstElement],
    ["unbound", firstElement],
    ["bound", replacementElement]
  ]);
  assert.equal(
    registry.getBinding("session-1", "candidate-1").element,
    replacementElement
  );
});

test("removes missing Candidates and treats the same ID in a new Session separately", () => {
  const unbound = [];
  const registry = createCandidateBindingRegistry({
    onUnbound(binding) {
      unbound.push(binding.candidate.sessionId);
    }
  });
  const firstElement = {};
  const secondElement = {};
  registry.sync([
    { candidate: createCandidate(), element: firstElement },
    {
      candidate: createCandidate({
        sessionId: "session-2",
        url: "https://example.com/result-2"
      }),
      element: secondElement
    }
  ]);

  registry.sync([
    {
      candidate: createCandidate({
        sessionId: "session-2",
        url: "https://example.com/result-2"
      }),
      element: secondElement
    }
  ]);

  assert.deepEqual(unbound, ["session-1"]);
  assert.equal(registry.size, 1);
  assert.equal(registry.getBinding("session-1", "candidate-1"), null);
  assert.equal(
    registry.getBinding("session-2", "candidate-1").element,
    secondElement
  );
});

test("clear is idempotent and unregisters every active binding", () => {
  let unboundCount = 0;
  const registry = createCandidateBindingRegistry({
    onUnbound() {
      unboundCount += 1;
    }
  });
  registry.sync([
    { candidate: createCandidate(), element: {} },
    {
      candidate: createCandidate({
        id: "candidate-2",
        url: "https://example.com/result-2",
        rank: 2
      }),
      element: {}
    }
  ]);

  assert.equal(registry.clear(), 2);
  assert.equal(registry.clear(), 0);
  assert.equal(unboundCount, 2);
  assert.equal(registry.size, 0);
});

test("rejects duplicate Candidate keys, shared Elements, and invalid bindings", () => {
  const registry = createCandidateBindingRegistry();
  const sharedElement = {};

  assert.throws(
    () =>
      registry.sync([
        { candidate: createCandidate(), element: {} },
        { candidate: createCandidate(), element: {} }
      ]),
    /Duplicate Candidate binding/u
  );
  assert.throws(
    () =>
      registry.sync([
        { candidate: createCandidate(), element: sharedElement },
        {
          candidate: createCandidate({
            id: "candidate-2",
            url: "https://example.com/result-2",
            rank: 2
          }),
          element: sharedElement
        }
      ]),
    /multiple Candidates/u
  );
  assert.throws(
    () => registry.sync([{ candidate: createCandidate(), element: null }]),
    /valid Candidate and DOM Element/u
  );
});
