import assert from "node:assert/strict";
import test from "node:test";

import { createZhihuSearchAdapter } from "../../content/adapters/zhihuSearchAdapter.js";
import { createCandidateClickCollector } from "../../content/eventCollector/click.js";
import { isCandidateChosenMessage } from "../../shared/messages.js";
import { createZhihuDocumentFixture } from "./fixtures/zhihuDom.js";

const scenarios = [
  { name: "ordinary click", type: "click", init: { button: 0 } },
  { name: "middle click", type: "auxclick", init: { button: 1 } },
  { name: "Ctrl+click", type: "click", init: { button: 0, ctrlKey: true } },
  { name: "Cmd+click", type: "click", init: { button: 0, metaKey: true } }
];

for (const scenario of scenarios) {
  test(`Zhihu reuses delegated click collection for ${scenario.name}`, () => {
    const fixture = createZhihuDocumentFixture({
      candidates: [
        {
          type: "answer",
          title: "Clickable answer",
          href: "/question/123/answer/456"
        }
      ]
    });
    const adapter = createZhihuSearchAdapter({
      document: fixture.document,
      sessionIdFactory: () => "zhihu-click-session"
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
    assert.equal(messages[0].payload.candidateId, "zhihu:answer:456");
    assert.equal(messages[0].payload.sessionId, "zhihu-click-session");
    assert.equal(event.defaultPrevented, false);
    assert.equal(event.preventDefaultCalls, 0);
  });
}
