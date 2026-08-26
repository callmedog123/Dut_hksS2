import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ACTIVE_CONTEXT_ERROR_MESSAGE,
  QUERY_ERROR_MESSAGE,
  REENCOUNTER_ERROR_MESSAGE,
  UNKNOWN_REASON_LABEL,
  createSidePanelApp,
  toMissedPathViewModel,
  toReencounterViewModel
} from "../../sidepanel/app.js";
import {
  ACTIVE_CONTEXT_STATUSES,
  RESPONSE_ERROR_CODES,
  createErrorResponseMessage,
  createSuccessResponseMessage,
  isActiveContextQueryMessage,
  isMissedPathsQueryMessage,
  isReencounterQueryMessage,
  isReencounterShownMessage
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
      "active-context-summary",
      "active-context-status",
      "active-context-retry-button",
      "status",
      "card-list",
      "empty-state",
      "missed-count",
      "retry-button",
      "reencounter-status",
      "reencounter-list",
      "reencounter-empty-state",
      "reencounter-retry-button"
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

function createContext(overrides = {}) {
  return {
    query: "robot navigation",
    source: "local-demo",
    timestamp: 100,
    keywords: ["robot", "navigation"],
    ...overrides
  };
}

function createRankedReencounter(index = 1, overrides = {}) {
  const missedPath =
    overrides.missedPath ??
    createMissedPath({
      id: `missed-${index}`,
      candidate: {
        id: `candidate-${index}`,
        url: `https://example.com/result-${index}`,
        title: `Example result ${index}`,
        source: "local-demo",
        rank: index
      }
    });
  return {
    missedPath,
    score: 0.8,
    reasons: [
      {
        code: "CONTEXT_MATCH",
        label: "Current context matched this path.",
        contribution: 0.45
      }
    ],
    ...overrides,
    missedPath
  };
}

function createHarness(respond, { now = () => 1_000 } = {}) {
  const document = new FixtureDocument();
  const sentMessages = [];
  const shownUiStates = [];
  const runtime = {
    lastError: undefined,
    sendMessage(message, callback) {
      sentMessages.push(message);
      if (isReencounterShownMessage(message)) {
        shownUiStates.push(
          document
            .getElementById("reencounter-status")
            .getAttribute("data-state")
        );
        callback(
          createSuccessResponseMessage(message.requestId, {
            reencounterId: message.payload.id,
            missedPathId: message.payload.missedPathId,
            shownAt: message.payload.shownAt,
            created: true
          })
        );
        return;
      }
      respond({ message, callback, runtime, sentMessages, document });
    }
  };
  const app = createSidePanelApp({ document, runtime, now });
  return { app, document, runtime, sentMessages, shownUiStates };
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

test("treats an unknown reason code in a response as a protocol error", () => {
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

  assert.equal(
    harness.document.getElementById("status").getAttribute("data-state"),
    "protocol-error"
  );
  assert.equal(harness.document.getElementById("card-list").children.length, 0);
});

test("ViewModel mapping safely falls back for an unknown reason code", () => {
  const viewModel = toMissedPathViewModel(
    createMissedPath({
      reasons: [{ code: "FUTURE_REASON", label: "future label" }]
    })
  );

  assert.deepEqual(viewModel.reasons, [UNKNOWN_REASON_LABEL]);
});

test("shows Active Context loading before sending a Re-encounter query", () => {
  const harness = createHarness(() => {});

  const request = harness.app.loadContextualReencounters();

  assert.equal(isActiveContextQueryMessage(request), true);
  assert.equal(harness.sentMessages.length, 1);
  assert.equal(
    harness.document
      .getElementById("active-context-status")
      .getAttribute("data-state"),
    "loading"
  );
  assert.equal(
    harness.document.getElementById("reencounter-status").hidden,
    true
  );
});

test("renders a successful Active Context empty state without querying Re-encounters", () => {
  const harness = createHarness(({ message, callback }) => {
    callback(
      createSuccessResponseMessage(message.requestId, {
        status: ACTIVE_CONTEXT_STATUSES.UNAVAILABLE,
        context: null
      })
    );
  });

  harness.app.loadContextualReencounters();

  assert.equal(harness.sentMessages.length, 1);
  assert.equal(
    harness.document
      .getElementById("active-context-status")
      .getAttribute("data-state"),
    "empty"
  );
  assert.equal(
    harness.document.getElementById("reencounter-list").children.length,
    0
  );
});

test("queries an available context and renders an empty Re-encounter state", () => {
  const context = createContext();
  const harness = createHarness(({ message, callback }) => {
    if (isActiveContextQueryMessage(message)) {
      callback(
        createSuccessResponseMessage(message.requestId, {
          status: ACTIVE_CONTEXT_STATUSES.AVAILABLE,
          context
        })
      );
      return;
    }
    assert.equal(isReencounterQueryMessage(message), true);
    callback(
      createSuccessResponseMessage(message.requestId, { reencounters: [] })
    );
  });

  harness.app.loadContextualReencounters();

  assert.equal(harness.sentMessages.length, 2);
  assert.equal(harness.sentMessages[1].payload.context, context);
  assert.equal(harness.sentMessages[1].payload.limit, 3);
  assert.equal(
    harness.document
      .getElementById("active-context-status")
      .getAttribute("data-state"),
    "ready"
  );
  assert.equal(
    harness.document
      .getElementById("reencounter-status")
      .getAttribute("data-state"),
    "empty"
  );
  assert.equal(
    harness.document.getElementById("reencounter-empty-state").hidden,
    false
  );
});

test("shows Re-encounter loading after Active Context succeeds", () => {
  let reencounterCallback;
  const harness = createHarness(({ message, callback }) => {
    if (isActiveContextQueryMessage(message)) {
      callback(
        createSuccessResponseMessage(message.requestId, {
          status: ACTIVE_CONTEXT_STATUSES.AVAILABLE,
          context: createContext()
        })
      );
      return;
    }
    reencounterCallback = callback;
  });

  harness.app.loadContextualReencounters();

  assert.equal(typeof reencounterCallback, "function");
  assert.equal(
    harness.document
      .getElementById("reencounter-status")
      .getAttribute("data-state"),
    "loading"
  );
  assert.equal(
    harness.document.getElementById("reencounter-list").getAttribute("aria-busy"),
    "true"
  );
});

test("renders one to three ranked Re-encounters as safe display-only cards", () => {
  const dangerousTitle = '<img src=x onerror="alert(1)">';
  const dangerousUrl = "javascript:alert(1)";
  const dangerousSource = "<b>source</b>";
  const dangerousReason = "<svg onload=alert(1)>";
  const ranked = [
    createRankedReencounter(1, {
      missedPath: createMissedPath({
        id: "missed-1",
        candidate: {
          id: "candidate-1",
          title: dangerousTitle,
          url: dangerousUrl,
          source: dangerousSource,
          rank: 1
        }
      }),
      reasons: [
        {
          code: "CONTEXT_MATCH",
          label: dangerousReason,
          contribution: 0.45
        }
      ]
    }),
    createRankedReencounter(2),
    createRankedReencounter(3)
  ];
  let queryCount = 0;
  const harness = createHarness(({ message, callback }) => {
    if (isActiveContextQueryMessage(message)) {
      callback(
        createSuccessResponseMessage(message.requestId, {
          status: ACTIVE_CONTEXT_STATUSES.AVAILABLE,
          context: createContext()
        })
      );
      return;
    }
    queryCount += 1;
    callback(
      createSuccessResponseMessage(message.requestId, {
        reencounters: queryCount === 1 ? ranked.slice(0, 1) : ranked
      })
    );
  });

  harness.app.loadContextualReencounters();

  const list = harness.document.getElementById("reencounter-list");
  const firstCard = list.children[0];
  assert.equal(list.children.length, 1);
  assert.equal(
    harness.document
      .getElementById("reencounter-status")
      .getAttribute("data-state"),
    "ready"
  );
  assert.equal(findByClass(firstCard, "card-title").textContent, dangerousTitle);
  assert.equal(findByClass(firstCard, "card-url").textContent, dangerousUrl);
  assert.equal(findByClass(firstCard, "card-url").getAttribute("href"), null);
  assert.equal(findByClass(firstCard, "card-source").textContent, dangerousSource);
  assert.equal(
    findByClass(firstCard, "reason-list").children[0].textContent,
    dangerousReason
  );
  let shownMessages = harness.sentMessages.filter(isReencounterShownMessage);
  assert.equal(shownMessages.length, 1);
  assert.equal(shownMessages[0].payload.missedPathId, "missed-1");
  assert.deepEqual(shownMessages[0].payload.triggerContext, createContext());
  assert.equal(shownMessages[0].payload.shownAt, 1_000);
  assert.deepEqual(harness.shownUiStates, ["ready"]);

  harness.app.loadContextualReencounters();
  assert.equal(list.children.length, 3);
  shownMessages = harness.sentMessages.filter(isReencounterShownMessage);
  assert.equal(shownMessages.length, 4);
  assert.deepEqual(harness.shownUiStates, ["ready", "ready", "ready", "ready"]);
});

test("does not report shown when a query result cannot enter ready UI", () => {
  const harness = createHarness(({ message, callback }) => {
    callback(
      isActiveContextQueryMessage(message)
        ? createSuccessResponseMessage(message.requestId, {
            status: ACTIVE_CONTEXT_STATUSES.AVAILABLE,
            context: createContext()
          })
        : createSuccessResponseMessage(message.requestId, {
            reencounters: [
              {
                ...createRankedReencounter(),
                score: Number.NaN
              }
            ]
          })
    );
  });

  harness.app.loadContextualReencounters();

  assert.equal(
    harness.document
      .getElementById("reencounter-status")
      .getAttribute("data-state"),
    "protocol-error"
  );
  assert.equal(
    harness.sentMessages.filter(isReencounterShownMessage).length,
    0
  );
});

test("renders retryable errors independently for both query stages", () => {
  const activeFailure = createHarness(({ message, callback }) => {
    callback(
      createErrorResponseMessage(message.requestId, {
        code: RESPONSE_ERROR_CODES.STORAGE_ERROR,
        message: "Unable to query active context.",
        retryable: true
      })
    );
  });
  activeFailure.app.loadContextualReencounters();
  assert.equal(
    activeFailure.document
      .getElementById("active-context-status")
      .getAttribute("data-state"),
    "retryable-error"
  );
  assert.equal(
    activeFailure.document.getElementById("active-context-status").textContent,
    ACTIVE_CONTEXT_ERROR_MESSAGE
  );
  assert.equal(
    activeFailure.document.getElementById("active-context-retry-button").hidden,
    false
  );
  activeFailure.document.getElementById("active-context-retry-button").click();
  assert.equal(activeFailure.sentMessages.length, 2);

  const reencounterFailure = createHarness(({ message, callback }) => {
    callback(
      isActiveContextQueryMessage(message)
        ? createSuccessResponseMessage(message.requestId, {
            status: ACTIVE_CONTEXT_STATUSES.AVAILABLE,
            context: createContext()
          })
        : createErrorResponseMessage(message.requestId, {
            code: RESPONSE_ERROR_CODES.STORAGE_ERROR,
            message: "Unable to query Re-encounters.",
            retryable: true
          })
    );
  });
  reencounterFailure.app.loadContextualReencounters();
  assert.equal(
    reencounterFailure.document
      .getElementById("reencounter-status")
      .getAttribute("data-state"),
    "retryable-error"
  );
  assert.equal(
    reencounterFailure.document.getElementById("reencounter-status").textContent,
    REENCOUNTER_ERROR_MESSAGE
  );
  assert.equal(
    reencounterFailure.document.getElementById("reencounter-retry-button").hidden,
    false
  );
});

test("renders protocol errors for invalid responses and mismatched requestIds", () => {
  const invalidActive = createHarness(({ callback }) => callback({ ok: true }));
  invalidActive.app.loadContextualReencounters();
  assert.equal(
    invalidActive.document
      .getElementById("active-context-status")
      .getAttribute("data-state"),
    "protocol-error"
  );

  const mismatchedActive = createHarness(({ callback }) => {
    callback(
      createSuccessResponseMessage("different-request", {
        status: ACTIVE_CONTEXT_STATUSES.UNAVAILABLE,
        context: null
      })
    );
  });
  mismatchedActive.app.loadContextualReencounters();
  assert.equal(
    mismatchedActive.document
      .getElementById("active-context-status")
      .getAttribute("data-state"),
    "protocol-error"
  );

  const mismatchedReencounter = createHarness(({ message, callback }) => {
    if (isActiveContextQueryMessage(message)) {
      callback(
        createSuccessResponseMessage(message.requestId, {
          status: ACTIVE_CONTEXT_STATUSES.AVAILABLE,
          context: createContext()
        })
      );
      return;
    }
    callback(
      createSuccessResponseMessage("different-request", {
        reencounters: []
      })
    );
  });
  mismatchedReencounter.app.loadContextualReencounters();
  assert.equal(
    mismatchedReencounter.document
      .getElementById("reencounter-status")
      .getAttribute("data-state"),
    "protocol-error"
  );
});

test("ignores a late Re-encounter response after the active context changes", () => {
  const pending = [];
  const harness = createHarness(({ message, callback }) => {
    pending.push({ message, callback });
  });
  const firstContext = createContext({ query: "first context" });
  const secondContext = createContext({ query: "second context", timestamp: 200 });

  harness.app.loadContextualReencounters();
  pending[0].callback(
    createSuccessResponseMessage(pending[0].message.requestId, {
      status: ACTIVE_CONTEXT_STATUSES.AVAILABLE,
      context: firstContext
    })
  );
  assert.equal(isReencounterQueryMessage(pending[1].message), true);

  harness.app.loadContextualReencounters();
  pending[2].callback(
    createSuccessResponseMessage(pending[2].message.requestId, {
      status: ACTIVE_CONTEXT_STATUSES.AVAILABLE,
      context: secondContext
    })
  );
  pending[3].callback(
    createSuccessResponseMessage(pending[3].message.requestId, {
      reencounters: [createRankedReencounter(2)]
    })
  );
  pending[1].callback(
    createSuccessResponseMessage(pending[1].message.requestId, {
      reencounters: [createRankedReencounter(1)]
    })
  );

  const cards = harness.document.getElementById("reencounter-list").children;
  assert.equal(cards.length, 1);
  assert.equal(findByClass(cards[0], "card-title").textContent, "Example result 2");
  assert.match(
    harness.document.getElementById("active-context-summary").textContent,
    /second context/u
  );
  const shownMessages = harness.sentMessages.filter(isReencounterShownMessage);
  assert.equal(shownMessages.length, 1);
  assert.equal(shownMessages[0].payload.missedPathId, "missed-2");
  assert.deepEqual(shownMessages[0].payload.triggerContext, secondContext);
});

test("Re-encounter ViewModel mapping safely falls back for unknown reasons", () => {
  const viewModel = toReencounterViewModel(
    createRankedReencounter(1, {
      reasons: [{ code: "FUTURE_REASON", label: "future label" }]
    })
  );

  assert.deepEqual(viewModel.reasons, [UNKNOWN_REASON_LABEL]);
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
