import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  QUERY_ERROR_MESSAGE,
  UNKNOWN_REASON_LABEL,
  createSidePanelApp
} from "../../sidepanel/app.js";
import {
  RESPONSE_ERROR_CODES,
  createErrorResponseMessage,
  createSuccessResponseMessage,
  isMissedPathsQueryMessage
} from "../../shared/messages.js";

class FixtureElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.children = [];
    this.className = "";
    this.hidden = false;
    this.listeners = new Map();
    this._textContent = "";
  }

  set textContent(value) {
    this._textContent = String(value);
    this.children = [];
  }

  get textContent() {
    return this._textContent;
  }

  set innerHTML(_value) {
    throw new Error("Unsafe innerHTML rendering is forbidden in this fixture.");
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    this.children = [...children];
    this._textContent = "";
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  click() {
    for (const listener of this.listeners.get("click") ?? []) {
      listener({ type: "click", target: this });
    }
  }
}

class FixtureDocument {
  constructor() {
    this.elements = new Map();
    for (const id of [
      "status",
      "card-list",
      "empty-state",
      "missed-count",
      "retry-button"
    ]) {
      this.elements.set(id, new FixtureElement());
    }
  }

  getElementById(id) {
    return this.elements.get(id) ?? null;
  }

  createElement(tagName) {
    return new FixtureElement(tagName);
  }
}

function findByClass(root, className) {
  if (root.className.split(/\s+/u).includes(className)) {
    return root;
  }
  for (const child of root.children) {
    const match = findByClass(child, className);
    if (match) {
      return match;
    }
  }
  return null;
}

function createMissedPath(overrides = {}) {
  const candidateOverrides = overrides.candidate ?? {};
  return {
    id: "missed-1",
    candidate: {
      id: "candidate-1",
      url: "https://example.com/result",
      title: "Example result",
      source: "local-demo",
      rank: 1,
      sessionId: "session-1",
      ...candidateOverrides
    },
    context: {
      query: "robot navigation",
      source: "local-demo",
      timestamp: 100,
      keywords: ["robot", "navigation"]
    },
    score: 0.7,
    reasons: [
      {
        code: "LONG_EXPOSURE",
        label: "Aggregated visible time contributed to consideration.",
        contribution: 0.3
      }
    ],
    status: "MISSED",
    createdAt: 500,
    ...overrides,
    candidate: {
      id: "candidate-1",
      url: "https://example.com/result",
      title: "Example result",
      source: "local-demo",
      rank: 1,
      sessionId: "session-1",
      ...candidateOverrides
    }
  };
}

function createHarness(respond) {
  const document = new FixtureDocument();
  const sentMessages = [];
  const runtime = {
    lastError: undefined,
    sendMessage(message, callback) {
      sentMessages.push(message);
      respond({ message, callback, runtime, sentMessages });
    }
  };
  const app = createSidePanelApp({ document, runtime });
  return { app, document, runtime, sentMessages };
}

test("shows loading while a Repository response is pending", () => {
  const harness = createHarness(() => {});

  harness.app.loadMissedPaths();

  assert.equal(
    harness.document.getElementById("status").getAttribute("data-state"),
    "loading"
  );
  assert.equal(
    harness.document.getElementById("card-list").getAttribute("aria-busy"),
    "true"
  );
  assert.equal(harness.document.getElementById("retry-button").hidden, true);
});

test("queries and renders a successful Missed Path list", () => {
  const dangerousTitle = '<img src=x onerror="alert(1)">';
  const dangerousUrl = "javascript:alert(1)";
  const dangerousSource = "<b>source</b>";
  const harness = createHarness(({ message, callback }) => {
    callback(
      createSuccessResponseMessage(message.requestId, {
        missedPaths: [
          createMissedPath({
            candidate: {
              title: dangerousTitle,
              url: dangerousUrl,
              source: dangerousSource
            }
          })
        ]
      })
    );
  });

  const request = harness.app.loadMissedPaths();
  const cardList = harness.document.getElementById("card-list");
  const card = cardList.children[0];

  assert.equal(isMissedPathsQueryMessage(request), true);
  assert.equal(harness.sentMessages.length, 1);
  assert.equal(
    harness.document.getElementById("status").getAttribute("data-state"),
    "success"
  );
  assert.equal(harness.document.getElementById("missed-count").textContent, "1");
  assert.equal(findByClass(card, "card-title").textContent, dangerousTitle);
  assert.equal(findByClass(card, "card-url").textContent, dangerousUrl);
  assert.equal(findByClass(card, "card-url").getAttribute("href"), null);
  assert.equal(findByClass(card, "card-source").textContent, dangerousSource);
});

test("renders an empty state for an empty Repository", () => {
  const harness = createHarness(({ message, callback }) => {
    callback(
      createSuccessResponseMessage(message.requestId, { missedPaths: [] })
    );
  });

  harness.app.loadMissedPaths();

  assert.equal(
    harness.document.getElementById("status").getAttribute("data-state"),
    "empty"
  );
  assert.equal(harness.document.getElementById("empty-state").hidden, false);
  assert.equal(harness.document.getElementById("card-list").children.length, 0);
});

test("renders a retryable unified error for storage failure and retries", () => {
  const harness = createHarness(({ message, callback }) => {
    callback(
      createErrorResponseMessage(message.requestId, {
        code: RESPONSE_ERROR_CODES.STORAGE_ERROR,
        message: "Unable to query local Missed Paths.",
        retryable: true
      })
    );
  });

  harness.app.loadMissedPaths();
  const status = harness.document.getElementById("status");
  const retry = harness.document.getElementById("retry-button");

  assert.equal(status.getAttribute("data-state"), "retryable-error");
  assert.equal(status.textContent, QUERY_ERROR_MESSAGE);
  assert.equal(retry.hidden, false);
  retry.click();
  assert.equal(harness.sentMessages.length, 2);
});

test("renders a protocol error for an invalid response", () => {
  const harness = createHarness(({ callback }) => callback({ ok: true }));

  harness.app.loadMissedPaths();

  const status = harness.document.getElementById("status");
  assert.equal(status.getAttribute("data-state"), "protocol-error");
  assert.equal(status.textContent, QUERY_ERROR_MESSAGE);
  assert.equal(harness.document.getElementById("retry-button").hidden, true);
});

test("rejects a response whose requestId does not match", () => {
  const harness = createHarness(({ callback }) => {
    callback(
      createSuccessResponseMessage("different-request", { missedPaths: [] })
    );
  });

  harness.app.loadMissedPaths();

  assert.equal(
    harness.document.getElementById("status").getAttribute("data-state"),
    "protocol-error"
  );
});

test("safely falls back for an unknown reason code", () => {
  const harness = createHarness(({ message, callback }) => {
    callback(
      createSuccessResponseMessage(message.requestId, {
        missedPaths: [
          createMissedPath({
            reasons: [{ code: "FUTURE_REASON", label: "future label" }]
          })
        ]
      })
    );
  });

  harness.app.loadMissedPaths();

  const card = harness.document.getElementById("card-list").children[0];
  const reasonList = findByClass(card, "reason-list");
  assert.equal(reasonList.children[0].textContent, UNKNOWN_REASON_LABEL);
});

test("uses module markup and no direct browser storage API", () => {
  const appSource = readFileSync("sidepanel/app.js", "utf8");
  const htmlSource = readFileSync("sidepanel/index.html", "utf8");

  assert.doesNotMatch(
    appSource,
    /localStorage|indexedDB|chrome\.storage/iu
  );
  assert.match(
    htmlSource,
    /<script\s+type="module"\s+src="\.\/app\.js"><\/script>/u
  );
  assert.match(
    htmlSource,
    /<link\s+rel="stylesheet"\s+href="\.\/styles\.css">/u
  );
  assert.doesNotMatch(
    htmlSource,
    /data-action="(?:open|ignore|delete)"|reset-demo|chosen-count/u
  );
});
