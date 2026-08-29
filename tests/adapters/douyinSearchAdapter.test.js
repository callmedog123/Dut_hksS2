// @ts-check

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createDouyinSearchAdapter } from "../../content/adapters/douyinSearchAdapter.js";
import { createCandidateClickCollector } from "../../content/eventCollector/click.js";
import { isCandidateChosenMessage } from "../../shared/messages.js";
import {
  createMutationObserverHarness,
  createDouyinSearchDom,
  createVideoCard,
  createNoteCard,
  DOUYIN_SEARCH_URL,
  DOUYIN_SEARCH_URL_VIDEO,
  DOUYIN_SEARCH_URL_USER,
  VIDEO_NUMERIC_ID,
  VIDEO_PERMANENT_URL,
  NOTE_NUMERIC_ID,
  NOTE_PERMANENT_URL,
  HASHTAG_NUMERIC_ID,
  HASHTAG_PERMANENT_URL
} from "./fixtures/douyinDom.js";

describe("DouyinSearchAdapter", () => {
  let adapter;
  let mockDocument;

  beforeEach(() => {
    adapter = createDouyinSearchAdapter({
      document: undefined,
      MutationObserver: undefined,
      now: () => 1234567890,
      sessionIdFactory: () => "test-session-123"
    });
  });

  describe("canHandle", () => {
    it("should handle general search URL", () => {
      const url = new URL(DOUYIN_SEARCH_URL);
      assert.strictEqual(adapter.canHandle(url, {}), true);
    });

    it("should handle video search URL", () => {
      const url = new URL(DOUYIN_SEARCH_URL_VIDEO);
      assert.strictEqual(adapter.canHandle(url, {}), true);
    });

    it("should reject user search URL", () => {
      const url = new URL(DOUYIN_SEARCH_URL_USER);
      assert.strictEqual(adapter.canHandle(url, {}), false);
    });

    it("should reject non-search URL", () => {
      const url = new URL("https://www.douyin.com/video/123");
      assert.strictEqual(adapter.canHandle(url, {}), false);
    });

    it("should reject non-douyin URL", () => {
      const url = new URL("https://www.example.com/search/test");
      assert.strictEqual(adapter.canHandle(url, {}), false);
    });
  });

  describe("getContext", () => {
    it("should extract query from URL pathname", () => {
      const url = new URL(DOUYIN_SEARCH_URL);
      const context = adapter.getContext({}, url);
      assert.strictEqual(context.query, "好吃的");
      assert.strictEqual(context.source, "douyin-search");
      assert.strictEqual(context.timestamp, 1234567890);
    });

    it("should split keywords by whitespace", () => {
      const url = new URL("https://www.douyin.com/search/%E7%BE%8E%E9%A3%9F%20%E6%95%99%E7%A8%8B");
      const context = adapter.getContext({}, url);
      assert.deepStrictEqual(context.keywords, ["美食", "教程"]);
    });
  });

  describe("extractCandidates", () => {
    it("should extract video candidates", () => {
      const dom = createDouyinSearchDom({
        cards: [createVideoCard(VIDEO_NUMERIC_ID, "02:08 Test video title")]
      });
      const candidates = adapter.extractCandidates(dom);
      assert.strictEqual(candidates.length, 1);
      assert.strictEqual(candidates[0].id, `douyin:video:${VIDEO_NUMERIC_ID}`);
      assert.strictEqual(candidates[0].url, VIDEO_PERMANENT_URL);
      assert.strictEqual(candidates[0].contentType, "VIDEO");
      assert.strictEqual(candidates[0].layoutType, "GRID");
    });

    it("should extract note candidates", () => {
      const dom = createDouyinSearchDom({
        cards: [createNoteCard(NOTE_NUMERIC_ID, "图文 Test note title")]
      });
      const candidates = adapter.extractCandidates(dom);
      assert.strictEqual(candidates.length, 1);
      assert.strictEqual(candidates[0].id, `douyin:image_post:${NOTE_NUMERIC_ID}`);
      assert.strictEqual(candidates[0].url, NOTE_PERMANENT_URL);
      assert.strictEqual(candidates[0].contentType, "IMAGE_POST");
    });

    it("should extract hashtags through the dedicated native-tag DTO", () => {
      const dom = createDouyinSearchDom({
        cards: [createVideoCard(HASHTAG_NUMERIC_ID, "08:51 Test #美食 #羊肉 #地方特色美食")]
      });
      const candidates = adapter.extractCandidates(dom);
      assert.strictEqual(candidates.length, 1);
      assert.equal(Object.hasOwn(candidates[0], "nativeTags"), false);
      assert.deepStrictEqual(adapter.extractCandidateTags(dom), [
        {
          candidateId: `douyin:video:${HASHTAG_NUMERIC_ID}`,
          nativeTags: ["地方特色美食", "羊肉", "美食"]
        }
      ]);
    });

    it("returns no tag DTO when a visible card has no hashtag", () => {
      const dom = createDouyinSearchDom({
        cards: [createVideoCard(VIDEO_NUMERIC_ID, "02:08 Test video title")]
      });
      assert.deepStrictEqual(adapter.extractCandidateTags(dom), []);
    });

    it("should deduplicate candidates by ID", () => {
      const dom = createDouyinSearchDom({
        cards: [
          createVideoCard(VIDEO_NUMERIC_ID, "02:08 First"),
          createVideoCard(VIDEO_NUMERIC_ID, "02:08 Duplicate")
        ]
      });
      const candidates = adapter.extractCandidates(dom);
      assert.strictEqual(candidates.length, 1);
    });

    it("should skip cards without valid ID", () => {
      const dom = createDouyinSearchDom({
        cards: [{ id: "invalid_id", title: "02:08 Test", type: "video" }]
      });
      const candidates = adapter.extractCandidates(dom);
      assert.strictEqual(candidates.length, 0);
    });

    it("should skip cards without content type marker", () => {
      const dom = createDouyinSearchDom({
        cards: [{ id: "waterfall_item_1234567890123456789", title: "No type marker", type: "unknown" }]
      });
      const candidates = adapter.extractCandidates(dom);
      assert.strictEqual(candidates.length, 0);
    });
  });

  describe("observeChanges", () => {
    it("handles dynamic results, SPA changes, replacements, and idempotent cleanup", () => {
      const dom = createDouyinSearchDom({
        cards: [createVideoCard(VIDEO_NUMERIC_ID, "02:08 Initial")]
      });
      const observers = createMutationObserverHarness();
      let sequence = 0;
      const unbound = [];
      const dynamicAdapter = createDouyinSearchAdapter({
        document: dom,
        MutationObserver: observers.MutationObserver,
        sessionIdFactory: () => `douyin-session-${++sequence}`,
        onCandidateUnbound(binding) {
          unbound.push(binding.candidate.id);
        }
      });
      let changes = 0;
      const cleanup = dynamicAdapter.observeChanges(() => {
        changes += 1;
      });

      dom.addCard(createNoteCard(NOTE_NUMERIC_ID, "图文 Dynamic"));
      observers.notifyAll();
      assert.equal(changes, 1);
      observers.notifyAll();
      assert.equal(changes, 1);

      dom.replaceCards([
        createVideoCard(VIDEO_NUMERIC_ID, "02:08 Initial"),
        createNoteCard(NOTE_NUMERIC_ID, "图文 Dynamic")
      ]);
      observers.notifyAll();
      assert.equal(changes, 1);
      assert.ok(unbound.includes(`douyin:video:${VIDEO_NUMERIC_ID}`));

      dom.navigate(
        "https://www.douyin.com/search/%E6%96%B0%E6%90%9C%E7%B4%A2",
        [createVideoCard(HASHTAG_NUMERIC_ID, "08:51 Next")]
      );
      observers.notifyAll();
      assert.equal(changes, 2);
      assert.equal(
        dynamicAdapter.extractCandidates(dom)[0].sessionId,
        "douyin-session-2"
      );

      cleanup();
      cleanup();
      assert.equal(observers.instances[0].disconnectCount, 1);
      dom.addCard(createVideoCard(VIDEO_NUMERIC_ID, "02:08 Late"));
      observers.notifyAll();
      assert.equal(changes, 2);
    });
  });

  describe("click collection", () => {
    for (const scenario of [
      { name: "ordinary", type: "click", init: { button: 0 } },
      { name: "middle", type: "auxclick", init: { button: 1 } },
      { name: "Ctrl", type: "click", init: { button: 0, ctrlKey: true } },
      { name: "Cmd", type: "click", init: { button: 0, metaKey: true } }
    ]) {
      it(`does not block ${scenario.name} click navigation`, () => {
        const dom = createDouyinSearchDom({
          cards: [createVideoCard(VIDEO_NUMERIC_ID, "02:08 Clickable")]
        });
        const clickAdapter = createDouyinSearchAdapter({
          document: dom,
          sessionIdFactory: () => "douyin-click-session"
        });
        const [candidate] = clickAdapter.extractCandidates(dom);
        const messages = [];
        const collector = createCandidateClickCollector({
          root: dom,
          now: () => 500,
          sendMessage(message) {
            messages.push(message);
          }
        });
        collector.registerCandidate(candidate, dom.cardElements[0]);

        const event = dom.dispatch(
          scenario.type,
          dom.clickTarget(0),
          scenario.init
        );
        assert.equal(messages.length, 1);
        assert.equal(isCandidateChosenMessage(messages[0]), true);
        assert.equal(messages[0].payload.candidateId, candidate.id);
        assert.equal(event.defaultPrevented, false);
        assert.equal(event.preventDefaultCalls, 0);
      });
    }
  });
});
