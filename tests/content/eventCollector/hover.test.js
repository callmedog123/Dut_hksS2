import assert from "node:assert/strict";
import test from "node:test";

import { createHoverTracker } from "../../../content/eventCollector/hover.js";

function createHoverHarness() {
  let currentTime = 0;

  function createElement() {
    const listeners = new Map();
    const addCounts = new Map();
    const removeCounts = new Map();

    return {
      addEventListener(type, listener) {
        const typeListeners = listeners.get(type) ?? new Set();
        typeListeners.add(listener);
        listeners.set(type, typeListeners);
        addCounts.set(type, (addCounts.get(type) ?? 0) + 1);
      },
      removeEventListener(type, listener) {
        listeners.get(type)?.delete(listener);
        removeCounts.set(type, (removeCounts.get(type) ?? 0) + 1);
      },
      dispatch(type) {
        for (const listener of listeners.get(type) ?? []) {
          listener({ type, target: this });
        }
      },
      listenerCount(type) {
        return listeners.get(type)?.size ?? 0;
      },
      addCount(type) {
        return addCounts.get(type) ?? 0;
      },
      removeCount(type) {
        return removeCounts.get(type) ?? 0;
      }
    };
  }

  return {
    createElement,
    now: () => currentTime,
    setTime(value) {
      currentTime = value;
    }
  };
}

function setupTracker() {
  const harness = createHoverHarness();
  const updates = [];
  const tracker = createHoverTracker({
    now: harness.now,
    onHoverUpdated(aggregate) {
      updates.push(aggregate);
    }
  });
  return { harness, tracker, updates };
}

test("aggregates one card hover interval", () => {
  const { harness, tracker, updates } = setupTracker();
  const element = harness.createElement();
  tracker.registerCandidate("candidate-1", element);

  harness.setTime(10);
  element.dispatch("mouseenter");
  harness.setTime(65);
  element.dispatch("mouseleave");

  assert.deepEqual(tracker.getHoverAggregate("candidate-1"), {
    candidateId: "candidate-1",
    hoverMs: 55,
    hoverCount: 1
  });
  assert.deepEqual(updates, [
    { candidateId: "candidate-1", hoverMs: 55, hoverCount: 1 }
  ]);
  assert.deepEqual(Object.keys(updates[0]).sort(), [
    "candidateId",
    "hoverCount",
    "hoverMs"
  ]);
});

test("aggregates multiple hover intervals", () => {
  const { harness, tracker, updates } = setupTracker();
  const element = harness.createElement();
  tracker.registerCandidate("candidate-1", element);

  harness.setTime(5);
  element.dispatch("mouseenter");
  harness.setTime(25);
  element.dispatch("mouseleave");
  harness.setTime(40);
  element.dispatch("mouseenter");
  harness.setTime(75);
  element.dispatch("mouseleave");

  assert.deepEqual(tracker.getHoverAggregate("candidate-1"), {
    candidateId: "candidate-1",
    hoverMs: 55,
    hoverCount: 2
  });
  assert.deepEqual(updates, [
    { candidateId: "candidate-1", hoverMs: 20, hoverCount: 1 },
    { candidateId: "candidate-1", hoverMs: 55, hoverCount: 2 }
  ]);
});

test("cleanup settles a hover that has not left and is idempotent", () => {
  const { harness, tracker, updates } = setupTracker();
  const element = harness.createElement();
  tracker.registerCandidate("candidate-1", element);
  element.dispatch("mouseenter");

  harness.setTime(40);
  assert.deepEqual(tracker.cleanup(), [
    { candidateId: "candidate-1", hoverMs: 40, hoverCount: 1 }
  ]);
  assert.equal(element.listenerCount("mouseenter"), 0);
  assert.equal(element.listenerCount("mouseleave"), 0);

  harness.setTime(100);
  element.dispatch("mouseleave");
  assert.deepEqual(tracker.cleanup(), [
    { candidateId: "candidate-1", hoverMs: 40, hoverCount: 1 }
  ]);
  assert.deepEqual(updates, [
    { candidateId: "candidate-1", hoverMs: 40, hoverCount: 1 }
  ]);
});

test("candidate removal settles the active interval and removes listeners", () => {
  const { harness, tracker, updates } = setupTracker();
  const element = harness.createElement();
  const unregister = tracker.registerCandidate("candidate-1", element);
  element.dispatch("mouseenter");

  harness.setTime(25);
  assert.deepEqual(unregister(), {
    candidateId: "candidate-1",
    hoverMs: 25,
    hoverCount: 1
  });
  assert.equal(element.listenerCount("mouseenter"), 0);
  assert.equal(element.listenerCount("mouseleave"), 0);

  harness.setTime(80);
  element.dispatch("mouseleave");
  assert.deepEqual(unregister(), {
    candidateId: "candidate-1",
    hoverMs: 25,
    hoverCount: 1
  });
  assert.equal(updates.length, 1);
});

test("repeated registration installs only one listener pair", () => {
  const { harness, tracker } = setupTracker();
  const element = harness.createElement();
  const firstUnregister = tracker.registerCandidate("candidate-1", element);
  const secondUnregister = tracker.registerCandidate("candidate-1", element);

  assert.equal(firstUnregister, secondUnregister);
  assert.equal(element.addCount("mouseenter"), 1);
  assert.equal(element.addCount("mouseleave"), 1);

  element.dispatch("mouseenter");
  harness.setTime(30);
  element.dispatch("mouseleave");
  assert.deepEqual(tracker.getHoverAggregate("candidate-1"), {
    candidateId: "candidate-1",
    hoverMs: 30,
    hoverCount: 1
  });

  firstUnregister();
  secondUnregister();
  assert.equal(element.removeCount("mouseenter"), 1);
  assert.equal(element.removeCount("mouseleave"), 1);
});

test("a Candidate added later is tracked independently", () => {
  const { harness, tracker } = setupTracker();
  const firstElement = harness.createElement();
  const dynamicElement = harness.createElement();
  tracker.registerCandidate("candidate-1", firstElement);

  harness.setTime(50);
  tracker.registerCandidate("candidate-2", dynamicElement);
  dynamicElement.dispatch("mouseenter");
  harness.setTime(70);
  dynamicElement.dispatch("mouseleave");

  assert.deepEqual(tracker.getHoverAggregate("candidate-1"), {
    candidateId: "candidate-1",
    hoverMs: 0,
    hoverCount: 0
  });
  assert.deepEqual(tracker.getHoverAggregate("candidate-2"), {
    candidateId: "candidate-2",
    hoverMs: 20,
    hoverCount: 1
  });
});
