import assert from "node:assert/strict";
import test from "node:test";

import { createBilibiliSearchAdapter } from "../../content/adapters/bilibiliSearchAdapter.js";
import { createCandidateClickCollector } from "../../content/eventCollector/click.js";
import { isCandidateChosenMessage } from "../../shared/messages.js";
import { createBilibiliDocumentFixture } from "./fixtures/bilibiliDom.js";

const clickScenarios = [
  { name: "ordinary click", type: "click", init: { button: 0 } },
  { name: "middle click", type: "auxclick", init: { button: 1 } },
  {
    name: "Ctrl+click",
    type: "click",
    init: { button: 0, ctrlKey: true }
  },
  {
    name: "Cmd+click",
    type: "click",
    init: { button: 0, metaKey: true }
  }
];

for (const scenario of clickScenarios) {
  test(`reuses the delegated click collector for ${scenario.name}`, () => {
    const fixture = createBilibiliDocumentFixture({
      candidates: [
        {
          title: "Clickable result",
          href: "https://www.bilibili.com/video/BV1Clickable1/"
        }
      ]
    });
    const adapter = createBilibiliSearchAdapter({
      document: fixture.document,
      sessionIdFactory: () => "bilibili-click-session"
    });
    const [candidate] = adapter.extractCandidates(fixture.document);
    const messages = [];
    const collector = createCandidateClickCollector({
      root: fixture.document,
      now: () => 500,
      sendMessage(message) {
        messages.push(message);
      }
    });
    collector.registerCandidate(candidate, fixture.cards[0]);

    const event = fixture.document.dispatch(
      scenario.type,
      fixture.clickTarget(0),
      scenario.init
    );

    assert.equal(messages.length, 1);
    assert.equal(isCandidateChosenMessage(messages[0]), true);
    assert.deepEqual(messages[0].payload, {
      candidateId: "BV1Clickable1",
      sessionId: "bilibili-click-session",
      clicked: true,
      chosenAt: 500
    });
    assert.equal(event.defaultPrevented, false);
    assert.equal(event.preventDefaultCalls, 0);
  });
}
