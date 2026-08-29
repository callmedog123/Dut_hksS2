// @ts-check

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createDouyinSearchAdapter } from "../../content/adapters/douyinSearchAdapter.js";
import {
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

    it("should extract hashtags as nativeTags", () => {
      const dom = createDouyinSearchDom({
        cards: [createVideoCard(HASHTAG_NUMERIC_ID, "08:51 Test #美食 #羊肉 #地方特色美食")]
      });
      const candidates = adapter.extractCandidates(dom);
      assert.strictEqual(candidates.length, 1);
      assert.deepStrictEqual(candidates[0].nativeTags, ["美食", "羊肉", "地方特色美食"]);
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
    it("should return cleanup function", () => {
      const dom = createDouyinSearchDom({ cards: [] });
      const cleanup = adapter.observeChanges(() => {});
      assert.strictEqual(typeof cleanup, "function");
      cleanup();
    });
  });
});
