import assert from "node:assert/strict";
import test from "node:test";

import { createCandidateClickCollector } from "../../../content/eventCollector/click.js";
import { isCandidateChosenMessage } from "../../../shared/messages.js";

function createNode(parentNode = null) {
  return { parentNode };
}

function createEventRoot() {
  const root = createNode();
  const listeners = new Map();
  const addCounts = new Map();
  const removeCounts = new Map();

  root.addEventListener = (type, listener) => {
    const typeListeners = listeners.get(type) ?? new Set();
    typeListeners.add(listener);
    listeners.set(type, typeListeners);
    addCounts.set(type, (addCounts.get(type) ?? 0) + 1);
  };
  root.removeEventListener = (type, listener) => {
    listeners.get(type)?.delete(listener);
    removeCounts.set(type, (removeCounts.get(type) ?? 0) + 1);
  };
  root.dispatch = (type, target, init = {}) => {
    let preventDefaultCalls = 0;
    const event = {
      type,
      target,
      button: init.button ?? 0,
      ctrlKey: init.ctrlKey ?? false,
      metaKey: init.metaKey ?? false,
      shiftKey: init.shiftKey ?? false,
      defaultPrevented: false,
      preventDefault() {
        preventDefaultCalls += 1;
        this.defaultPrevented = true;
      },
      get preventDefaultCalls() {
        return preventDefaultCalls;
      }
    };

    for (const listener of listeners.get(type) ?? []) {
      listener(event);
    }
    return event;
  };
  root.addCount = (type) => addCounts.get(type) ?? 0;
  root.removeCount = (type) => removeCounts.get(type) ?? 0;
  root.listenerTypes = () => [...listeners.keys()];
  return root;
}

function createCandidate(id) {
  return {
    id,
    url: `https://example.com/${id}`,
    title: `Title ${id}`,
    source: "test",
    rank: 1,
    sessionId: "session-1"
  };
}

function setupCollector() {
  const root = createEventRoot();
  const messages = [];
  const collector = createCandidateClickCollector({
    root,
    now: () => 500,
    sendMessage(message) {
      messages.push(message);
    }
  });
  return { root, messages, collector };
}

const clickScenarios = [
  { name: "ordinary left click", type: "click", init: { button: 0 } },
  {
    name: "Ctrl+click",
    type: "click",
    init: { button: 0, ctrlKey: true }
  },
  {
    name: "Cmd+click",
    type: "click",
    init: { button: 0, metaKey: true }
  },
  { name: "middle auxclick", type: "auxclick", init: { button: 1 } }
];

for (const scenario of clickScenarios) {
  test(`captures ${scenario.name} without preventing navigation`, () => {
    const { root, messages, collector } = setupCollector();
    const candidate = createCandidate("candidate-1");
    const card = createNode(root);
    collector.registerCandidate(candidate, card);

    const event = root.dispatch(scenario.type, card, scenario.init);

    assert.equal(candidate.clicked, true);
    assert.equal(messages.length, 1);
    assert.equal(isCandidateChosenMessage(messages[0]), true);
    assert.deepEqual(messages[0].payload, {
      candidateId: "candidate-1",
      sessionId: "session-1",
      clicked: true,
      chosenAt: 500
    });
    assert.equal(event.defaultPrevented, false);
    assert.equal(event.preventDefaultCalls, 0);
  });
}

test("resolves a nested click target to its registered Candidate card", () => {
  const { root, messages, collector } = setupCollector();
  const candidate = createCandidate("candidate-1");
  const card = createNode(root);
  const nestedElement = createNode(card);
  collector.registerCandidate(candidate, card);

  root.dispatch("click", nestedElement, { button: 0 });

  assert.equal(candidate.clicked, true);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].payload.candidateId, "candidate-1");
});

test("sends only once when a Candidate receives duplicate events", () => {
  const { root, messages, collector } = setupCollector();
  const candidate = createCandidate("candidate-1");
  const card = createNode(root);
  collector.registerCandidate(candidate, card);

  root.dispatch("click", card, { button: 0, ctrlKey: true });
  root.dispatch("click", card, { button: 0 });
  root.dispatch("auxclick", card, { button: 1 });

  assert.equal(candidate.clicked, true);
  assert.equal(messages.length, 1);
});

test("ignores events outside registered Candidate cards", () => {
  const { root, messages } = setupCollector();
  const unrelatedElement = createNode(root);

  root.dispatch("click", unrelatedElement, { button: 0 });
  root.dispatch("auxclick", unrelatedElement, { button: 1 });
  root.dispatch("auxclick", unrelatedElement, { button: 2 });

  assert.deepEqual(messages, []);
});

test("uses one safe delegated listener pair for dynamically added cards", () => {
  const { root, messages, collector } = setupCollector();
  const firstCard = createNode(root);
  const dynamicCard = createNode(root);
  collector.registerCandidate(createCandidate("candidate-1"), firstCard);
  collector.registerCandidate(createCandidate("candidate-2"), dynamicCard);

  assert.equal(root.addCount("click"), 1);
  assert.equal(root.addCount("auxclick"), 1);
  assert.deepEqual(root.listenerTypes().sort(), ["auxclick", "click"]);

  root.dispatch("click", dynamicCard, { button: 0 });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].payload.candidateId, "candidate-2");

  collector.cleanup();
  collector.cleanup();
  assert.equal(root.removeCount("click"), 1);
  assert.equal(root.removeCount("auxclick"), 1);
});
