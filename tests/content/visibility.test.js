import assert from "node:assert/strict";
import test from "node:test";

import {
  VISIBLE_RATIO_THRESHOLD,
  createVisibilityTracker
} from "../../content/visibility.js";

function createVisibilityHarness() {
  let currentTime = 0;
  const listeners = new Map();
  const observerInstances = [];

  const document = {
    hidden: false,
    addEventListener(type, listener) {
      const typeListeners = listeners.get(type) ?? new Set();
      typeListeners.add(listener);
      listeners.set(type, typeListeners);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    setHidden(hidden) {
      this.hidden = hidden;
      for (const listener of listeners.get("visibilitychange") ?? []) {
        listener();
      }
    },
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0;
    }
  };

  class FixtureIntersectionObserver {
    constructor(callback, options) {
      this.callback = callback;
      this.options = options;
      this.observed = new Set();
      this.observeCount = 0;
      this.unobserveCount = 0;
      this.disconnectCount = 0;
      this.disconnected = false;
      observerInstances.push(this);
    }

    observe(element) {
      this.observeCount += 1;
      this.observed.add(element);
    }

    unobserve(element) {
      this.unobserveCount += 1;
      this.observed.delete(element);
    }

    disconnect() {
      this.disconnectCount += 1;
      this.disconnected = true;
      this.observed.clear();
    }

    emit(element, intersectionRatio, isIntersecting = intersectionRatio > 0) {
      if (this.disconnected || !this.observed.has(element)) {
        return;
      }
      this.callback([{ target: element, intersectionRatio, isIntersecting }]);
    }
  }

  return {
    document,
    IntersectionObserver: FixtureIntersectionObserver,
    now: () => currentTime,
    setTime(value) {
      currentTime = value;
    },
    get observer() {
      return observerInstances[0];
    }
  };
}

function setupTracker() {
  const harness = createVisibilityHarness();
  const updates = [];
  const returnUpdates = [];
  const tracker = createVisibilityTracker({
    document: harness.document,
    IntersectionObserver: harness.IntersectionObserver,
    now: harness.now,
    onVisibleMsUpdated(snapshot) {
      updates.push(snapshot);
    },
    onReturnCountUpdated(snapshot) {
      returnUpdates.push(snapshot);
    }
  });
  return { harness, tracker, updates, returnUpdates };
}

test("does not count the first viewport entry as a return", () => {
  const { harness, tracker, returnUpdates } = setupTracker();
  const element = {};
  tracker.registerCandidate("candidate-1", element);

  harness.observer.emit(element, 0.7);

  assert.equal(tracker.getReturnCount("candidate-1"), 0);
  assert.deepEqual(returnUpdates, []);
});

test("ignores repeated observer callbacks without a real leave", () => {
  const { harness, tracker, returnUpdates } = setupTracker();
  const element = {};
  tracker.registerCandidate("candidate-1", element);

  harness.observer.emit(element, 0.7);
  harness.observer.emit(element, 0.8);
  harness.observer.emit(element, 0.5);

  assert.equal(tracker.getReturnCount("candidate-1"), 0);
  assert.deepEqual(returnUpdates, []);
});

test("counts one return after leaving and re-entering", () => {
  const { harness, tracker, returnUpdates } = setupTracker();
  const element = {};
  tracker.registerCandidate("candidate-1", element);

  harness.observer.emit(element, 0.7);
  harness.observer.emit(element, 0.2);
  harness.observer.emit(element, 0.6);

  assert.equal(tracker.getReturnCount("candidate-1"), 1);
  assert.deepEqual(returnUpdates, [
    { candidateId: "candidate-1", returnCount: 1 }
  ]);
});

test("counts multiple leave and re-enter transitions", () => {
  const { harness, tracker, returnUpdates } = setupTracker();
  const element = {};
  tracker.registerCandidate("candidate-1", element);

  harness.observer.emit(element, 0.9);
  harness.observer.emit(element, 0, false);
  harness.observer.emit(element, 0.7);
  harness.observer.emit(element, 0.1);
  harness.observer.emit(element, 0.8);

  assert.equal(tracker.getReturnCount("candidate-1"), 2);
  assert.deepEqual(returnUpdates, [
    { candidateId: "candidate-1", returnCount: 1 },
    { candidateId: "candidate-1", returnCount: 2 }
  ]);
});

test("preserves returnCount when a Candidate is unregistered", () => {
  const { harness, tracker, returnUpdates } = setupTracker();
  const element = {};
  const unregister = tracker.registerCandidate("candidate-1", element);

  harness.observer.emit(element, 0.8);
  harness.observer.emit(element, 0, false);
  harness.observer.emit(element, 0.6);
  unregister();

  harness.observer.emit(element, 0, false);
  harness.observer.emit(element, 0.9);
  assert.equal(tracker.getReturnCount("candidate-1"), 1);
  assert.deepEqual(returnUpdates, [
    { candidateId: "candidate-1", returnCount: 1 }
  ]);
});

test("counts the first interval at exactly the 50% threshold", () => {
  const { harness, tracker } = setupTracker();
  const element = {};
  tracker.registerCandidate("candidate-1", element);

  assert.deepEqual(harness.observer.options.threshold, [
    0,
    VISIBLE_RATIO_THRESHOLD
  ]);
  harness.observer.emit(element, 0.5);
  harness.setTime(125);
  harness.observer.emit(element, 0, false);

  assert.equal(tracker.getVisibleMs("candidate-1"), 125);
});

test("does not count visibility below 50%", () => {
  const { harness, tracker } = setupTracker();
  const element = {};
  tracker.registerCandidate("candidate-1", element);

  harness.observer.emit(element, 0.49);
  harness.setTime(100);
  harness.observer.emit(element, 0, false);

  assert.equal(tracker.getVisibleMs("candidate-1"), 0);
});

test("accumulates visibleMs across multiple visible intervals", () => {
  const { harness, tracker } = setupTracker();
  const element = {};
  tracker.registerCandidate("candidate-1", element);

  harness.observer.emit(element, 0.8);
  harness.setTime(100);
  harness.observer.emit(element, 0.2);
  harness.setTime(150);
  harness.observer.emit(element, 0.75);
  harness.setTime(230);
  harness.observer.emit(element, 0, false);

  assert.equal(tracker.getVisibleMs("candidate-1"), 180);
});

test("settles on page hide and resumes when the visible page still intersects", () => {
  const { harness, tracker, updates } = setupTracker();
  const element = {};
  tracker.registerCandidate("candidate-1", element);

  harness.observer.emit(element, 0.9);
  harness.setTime(75);
  harness.document.setHidden(true);
  assert.equal(tracker.getVisibleMs("candidate-1"), 75);

  harness.setTime(175);
  harness.document.setHidden(false);
  harness.setTime(225);
  harness.observer.emit(element, 0, false);

  assert.equal(tracker.getVisibleMs("candidate-1"), 125);
  assert.deepEqual(updates.map((update) => update.visibleMs), [75, 125]);
});

test("settles and unobserves a Candidate when its node is removed", () => {
  const { harness, tracker } = setupTracker();
  const element = {};
  const unregister = tracker.registerCandidate("candidate-1", element);

  harness.observer.emit(element, 0.5);
  harness.setTime(40);
  assert.deepEqual(unregister(), {
    candidateId: "candidate-1",
    visibleMs: 40
  });
  assert.equal(harness.observer.unobserveCount, 1);

  harness.setTime(100);
  harness.observer.emit(element, 0.9);
  assert.equal(tracker.getVisibleMs("candidate-1"), 40);
});

test("repeated registration observes and accumulates only once", () => {
  const { harness, tracker } = setupTracker();
  const element = {};
  const firstUnregister = tracker.registerCandidate("candidate-1", element);
  const secondUnregister = tracker.registerCandidate("candidate-1", element);

  assert.equal(firstUnregister, secondUnregister);
  assert.equal(harness.observer.observeCount, 1);

  harness.observer.emit(element, 0.7);
  harness.setTime(50);
  assert.deepEqual(firstUnregister(), {
    candidateId: "candidate-1",
    visibleMs: 50
  });
  assert.deepEqual(secondUnregister(), {
    candidateId: "candidate-1",
    visibleMs: 50
  });
  assert.equal(harness.observer.unobserveCount, 1);
});

test("cleanup settles active intervals and is idempotent", () => {
  const { harness, tracker } = setupTracker();
  const element = {};
  tracker.registerCandidate("candidate-1", element);
  harness.observer.emit(element, 0.6);

  harness.setTime(60);
  assert.deepEqual(tracker.cleanup(), [
    { candidateId: "candidate-1", visibleMs: 60 }
  ]);
  assert.equal(harness.observer.disconnectCount, 1);
  assert.equal(harness.document.listenerCount("visibilitychange"), 0);

  harness.setTime(120);
  harness.observer.emit(element, 0.8);
  harness.document.setHidden(true);
  assert.deepEqual(tracker.cleanup(), [
    { candidateId: "candidate-1", visibleMs: 60 }
  ]);
  assert.equal(harness.observer.disconnectCount, 1);
});

test("endSession settles the current interval", () => {
  const { harness, tracker } = setupTracker();
  const element = {};
  tracker.registerCandidate("candidate-1", element);
  harness.observer.emit(element, 0.8);

  harness.setTime(30);
  assert.deepEqual(tracker.endSession(), [
    { candidateId: "candidate-1", visibleMs: 30 }
  ]);
  assert.equal(tracker.getVisibleMs("candidate-1"), 30);
});
