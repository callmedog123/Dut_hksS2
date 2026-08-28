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
  DEFAULT_SETTINGS_V1,
  REENCOUNTER_FEEDBACK_OUTCOMES,
  RESPONSE_ERROR_CODES,
  createErrorResponseMessage,
  createActiveTabChangedMessage,
  createSuccessResponseMessage,
  isActiveContextQueryMessage,
  isDataDeleteAllMessage,
  isMissedPathDeleteMessage,
  isMissedPathsQueryMessage,
  isReencounterQueryMessage,
  isReencounterFeedbackMessage,
  isReencounterShownMessage,
  isSettingsUpdateMessage
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
      "reencounter-retry-button",
      "settings-status",
      "pause-collection-button",
      "resume-collection-button",
      "data-delete-all-status",
      "data-delete-all-button",
      "data-delete-all-confirmation",
      "data-delete-all-confirm-button",
      "data-delete-all-cancel-button"
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

function findByAttribute(root, name, value) {
  if (root.getAttribute(name) === value) {
    return root;
  }
  for (const child of root.children) {
    const match = findByAttribute(child, name, value);
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
        label: "较长的累计可见时间表明你曾认真考虑该结果。",
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

function createHarness(
  respond,
  {
    now = () => 1_000,
    openUrl = () => true,
    respondToShown = null
  } = {}
) {
  const document = new FixtureDocument();
  const sentMessages = [];
  const shownUiStates = [];
  let runtimeMessageListener = null;
  const runtime = {
    lastError: undefined,
    onMessage: {
      addListener(listener) {
        runtimeMessageListener = listener;
      },
      removeListener(listener) {
        if (runtimeMessageListener === listener) {
          runtimeMessageListener = null;
        }
      }
    },
    sendMessage(message, callback) {
      sentMessages.push(message);
      if (isReencounterShownMessage(message)) {
        shownUiStates.push(
          document
            .getElementById("reencounter-status")
            .getAttribute("data-state")
        );
        if (respondToShown !== null) {
          respondToShown({ message, callback, runtime, document });
        } else {
          callback(
            createSuccessResponseMessage(message.requestId, {
              reencounterId: message.payload.id,
              missedPathId: message.payload.missedPathId,
              shownAt: message.payload.shownAt,
              created: true
            })
          );
        }
        return;
      }
      respond({ message, callback, runtime, sentMessages, document });
    }
  };
  const app = createSidePanelApp({ document, runtime, now, openUrl });
  return {
    app,
    document,
    runtime,
    sentMessages,
    shownUiStates,
    emitRuntimeMessage(message) {
      assert.equal(typeof runtimeMessageListener, "function");
      return runtimeMessageListener(message);
    }
  };
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

test("waits for MISSED_PATH_DELETE acknowledgement before removing a card", () => {
  let pendingDelete = null;
  const harness = createHarness(({ message, callback }) => {
    if (isMissedPathsQueryMessage(message)) {
      callback(
        createSuccessResponseMessage(message.requestId, {
          missedPaths: [createMissedPath()]
        })
      );
    } else if (isMissedPathDeleteMessage(message)) {
      pendingDelete = { message, callback };
    } else if (isActiveContextQueryMessage(message)) {
      callback(
        createSuccessResponseMessage(message.requestId, {
          status: ACTIVE_CONTEXT_STATUSES.UNAVAILABLE,
          context: null
        })
      );
    }
  });
  harness.app.loadMissedPaths();
  const list = harness.document.getElementById("card-list");
  const card = list.children[0];
  const deleteButton = findByAttribute(
    card,
    "data-action",
    "delete-missed-path"
  );

  deleteButton.click();
  assert.equal(isMissedPathDeleteMessage(pendingDelete.message), true);
  assert.equal(list.children.length, 1);
  assert.equal(deleteButton.disabled, true);
  assert.equal(findByClass(card, "delete-status").textContent, "正在删除…");

  pendingDelete.callback(
    createSuccessResponseMessage(pendingDelete.message.requestId, {
      missedPathId: "missed-1",
      deleted: true
    })
  );
  assert.equal(list.children.length, 0);
  assert.equal(harness.document.getElementById("missed-count").textContent, "0");
  assert.equal(harness.document.getElementById("empty-state").hidden, false);
});

test("keeps a Missed Path card when deletion fails and permits retry", () => {
  let attempt = 0;
  const harness = createHarness(({ message, callback }) => {
    if (isMissedPathsQueryMessage(message)) {
      callback(
        createSuccessResponseMessage(message.requestId, {
          missedPaths: [createMissedPath()]
        })
      );
    } else if (isMissedPathDeleteMessage(message)) {
      attempt += 1;
      callback(
        createErrorResponseMessage(message.requestId, {
          code: RESPONSE_ERROR_CODES.STORAGE_ERROR,
          message: "Delete failed.",
          retryable: true
        })
      );
    }
  });
  harness.app.loadMissedPaths();
  const list = harness.document.getElementById("card-list");
  const card = list.children[0];
  const deleteButton = findByAttribute(
    card,
    "data-action",
    "delete-missed-path"
  );

  deleteButton.click();
  assert.equal(attempt, 1);
  assert.equal(list.children.length, 1);
  assert.equal(deleteButton.disabled, false);
  assert.equal(
    findByClass(card, "delete-status").textContent,
    "删除失败，请重试。"
  );
  deleteButton.click();
  assert.equal(attempt, 2);
});

test("waits for SETTINGS_UPDATE acknowledgement for pause and resume", () => {
  const pending = [];
  const harness = createHarness(({ message, callback }) => {
    if (isSettingsUpdateMessage(message)) {
      pending.push({ message, callback });
    }
  });
  const pauseButton = harness.document.getElementById(
    "pause-collection-button"
  );
  const resumeButton = harness.document.getElementById(
    "resume-collection-button"
  );
  const status = harness.document.getElementById("settings-status");

  pauseButton.click();
  assert.equal(pending[0].message.payload.enabled, false);
  assert.equal(pauseButton.disabled, true);
  assert.equal(resumeButton.disabled, true);
  assert.equal(status.textContent, "正在暂停采集…");
  pending[0].callback(
    createSuccessResponseMessage(pending[0].message.requestId, {
      settings: { ...DEFAULT_SETTINGS_V1, enabled: false },
      updated: true
    })
  );
  assert.equal(status.textContent, "采集已暂停，已有数据仍可查看和删除。");
  assert.equal(pauseButton.disabled, false);

  resumeButton.click();
  assert.equal(pending[1].message.payload.enabled, true);
  pending[1].callback(
    createSuccessResponseMessage(pending[1].message.requestId, {
      settings: DEFAULT_SETTINGS_V1,
      updated: true
    })
  );
  assert.equal(status.textContent, "采集已恢复。");
  assert.equal(resumeButton.disabled, false);
});

test("keeps Settings controls retryable after a failed update", () => {
  const harness = createHarness(({ message, callback }) => {
    if (isSettingsUpdateMessage(message)) {
      callback(
        createErrorResponseMessage(message.requestId, {
          code: RESPONSE_ERROR_CODES.STORAGE_ERROR,
          message: "Unable to save Settings.",
          retryable: true
        })
      );
    }
  });
  const pauseButton = harness.document.getElementById(
    "pause-collection-button"
  );
  pauseButton.click();
  assert.equal(pauseButton.disabled, false);
  assert.equal(
    harness.document.getElementById("settings-status").textContent,
    "设置保存失败，请重试。"
  );
});

test("requires explicit second confirmation and cancellation sends nothing", () => {
  const harness = createHarness(() => {});
  const clearButton = harness.document.getElementById("data-delete-all-button");
  const confirmation = harness.document.getElementById(
    "data-delete-all-confirmation"
  );

  clearButton.click();
  assert.equal(confirmation.hidden, false);
  assert.equal(clearButton.disabled, true);
  assert.equal(harness.sentMessages.length, 0);
  harness.document.getElementById("data-delete-all-cancel-button").click();
  assert.equal(confirmation.hidden, true);
  assert.equal(clearButton.disabled, false);
  assert.equal(harness.sentMessages.length, 0);
  assert.equal(
    harness.document.getElementById("data-delete-all-status").textContent,
    "已取消清空，现有数据未改变。"
  );
});

test("keeps data visible until DATA_DELETE_ALL succeeds then requeries empty state", () => {
  let pendingClear = null;
  const harness = createHarness(({ message, callback }) => {
    if (isMissedPathsQueryMessage(message)) {
      callback(
        createSuccessResponseMessage(message.requestId, {
          missedPaths: pendingClear === null ? [createMissedPath()] : []
        })
      );
    } else if (isDataDeleteAllMessage(message)) {
      pendingClear = { message, callback };
    } else if (isActiveContextQueryMessage(message)) {
      callback(
        createSuccessResponseMessage(message.requestId, {
          status: ACTIVE_CONTEXT_STATUSES.UNAVAILABLE,
          context: null
        })
      );
    }
  });
  harness.app.loadMissedPaths();
  const list = harness.document.getElementById("card-list");
  harness.document.getElementById("data-delete-all-button").click();
  harness.document.getElementById("data-delete-all-confirm-button").click();

  assert.equal(isDataDeleteAllMessage(pendingClear.message), true);
  assert.equal(list.children.length, 1);
  assert.equal(
    harness.document.getElementById("data-delete-all-status").textContent,
    "正在清空本地数据…"
  );
  pendingClear.callback(
    createSuccessResponseMessage(pendingClear.message.requestId, {
      deleted: true
    })
  );
  assert.equal(list.children.length, 0);
  assert.equal(harness.document.getElementById("empty-state").hidden, false);
  assert.equal(
    harness.document.getElementById("data-delete-all-status").textContent,
    "本地业务数据已清空，采集设置已保留。"
  );
});

test("does not clear the UI when DATA_DELETE_ALL fails", () => {
  const harness = createHarness(({ message, callback }) => {
    if (isMissedPathsQueryMessage(message)) {
      callback(
        createSuccessResponseMessage(message.requestId, {
          missedPaths: [createMissedPath()]
        })
      );
    } else if (isDataDeleteAllMessage(message)) {
      callback(
        createErrorResponseMessage(message.requestId, {
          code: RESPONSE_ERROR_CODES.STORAGE_ERROR,
          message: "Unable to clear data.",
          retryable: true
        })
      );
    }
  });
  harness.app.loadMissedPaths();
  harness.document.getElementById("data-delete-all-button").click();
  harness.document.getElementById("data-delete-all-confirm-button").click();

  assert.equal(
    harness.document.getElementById("card-list").children.length,
    1
  );
  assert.equal(
    harness.document.getElementById("data-delete-all-confirmation").hidden,
    false
  );
  assert.equal(
    harness.document.getElementById("data-delete-all-status").textContent,
    "清空失败，现有数据显示未改变。"
  );
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

test("ViewModel localizes persisted English consideration reason labels", () => {
  const viewModel = toMissedPathViewModel(
    createMissedPath({
      reasons: [
        { code: "LONG_EXPOSURE", label: "legacy English label" },
        { code: "LONG_HOVER", label: "legacy English label" },
        { code: "RETURN_VIEW", label: "legacy English label" },
        { code: "REPEATED_HOVER", label: "legacy English label" },
        { code: "NOT_CLICKED", label: "legacy English label" }
      ]
    })
  );

  assert.deepEqual(viewModel.reasons, [
    "较长的累计可见时间表明你曾认真考虑该结果。",
    "较长的累计悬停时间表明你曾认真考虑该结果。",
    "再次回看表明你曾认真考虑该结果。",
    "多次悬停表明你曾反复考虑该结果。",
    "你在本次搜索中最终没有选择该结果。"
  ]);
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
  assert.equal(
    findByAttribute(
      firstCard,
      "data-outcome",
      REENCOUNTER_FEEDBACK_OUTCOMES.OPENED
    ).disabled,
    false
  );
  assert.equal(
    findByClass(firstCard, "feedback-status").getAttribute("data-state"),
    "ready"
  );

  harness.app.loadContextualReencounters();
  assert.equal(list.children.length, 3);
  shownMessages = harness.sentMessages.filter(isReencounterShownMessage);
  assert.equal(shownMessages.length, 4);
  assert.deepEqual(harness.shownUiStates, ["ready", "ready", "ready", "ready"]);
});

test("waits for feedback acknowledgement before safely opening a normalized URL", () => {
  const ranked = createRankedReencounter(1, {
    missedPath: createMissedPath({
      candidate: {
        url: "https://example.com/item?utm_source=mail&z=2&a=1#details"
      }
    })
  });
  let pendingFeedback = null;
  const opened = [];
  const harness = createHarness(
    ({ message, callback }) => {
      if (isActiveContextQueryMessage(message)) {
        callback(
          createSuccessResponseMessage(message.requestId, {
            status: ACTIVE_CONTEXT_STATUSES.AVAILABLE,
            context: createContext()
          })
        );
      } else if (isReencounterQueryMessage(message)) {
        callback(
          createSuccessResponseMessage(message.requestId, {
            reencounters: [ranked]
          })
        );
      } else if (isReencounterFeedbackMessage(message)) {
        pendingFeedback = { message, callback };
      }
    },
    { openUrl: (url) => opened.push(url) }
  );

  harness.app.loadContextualReencounters();
  const card = harness.document.getElementById("reencounter-list").children[0];
  const openButton = findByAttribute(
    card,
    "data-outcome",
    REENCOUNTER_FEEDBACK_OUTCOMES.OPENED
  );
  openButton.click();

  assert.equal(isReencounterFeedbackMessage(pendingFeedback.message), true);
  assert.equal(pendingFeedback.message.payload.outcome, "OPENED");
  assert.deepEqual(opened, []);
  assert.equal(findByClass(card, "feedback-status").textContent, "正在记录反馈…");

  pendingFeedback.callback(
    createSuccessResponseMessage(pendingFeedback.message.requestId, {
      reencounterId: pendingFeedback.message.payload.reencounterId,
      outcome: pendingFeedback.message.payload.outcome,
      feedbackAt: pendingFeedback.message.payload.feedbackAt,
      updated: true
    })
  );

  assert.deepEqual(opened, ["https://example.com/item?a=1&z=2"]);
  assert.equal(findByClass(card, "feedback-status").textContent, "已记录为打开。");
  assert.equal(openButton.disabled, true);
});

test("records LATER and NOT_RELEVANT without opening a URL", () => {
  for (const outcome of [
    REENCOUNTER_FEEDBACK_OUTCOMES.LATER,
    REENCOUNTER_FEEDBACK_OUTCOMES.NOT_RELEVANT
  ]) {
    const opened = [];
    const harness = createHarness(
      ({ message, callback }) => {
        if (isActiveContextQueryMessage(message)) {
          callback(
            createSuccessResponseMessage(message.requestId, {
              status: ACTIVE_CONTEXT_STATUSES.AVAILABLE,
              context: createContext()
            })
          );
        } else if (isReencounterQueryMessage(message)) {
          callback(
            createSuccessResponseMessage(message.requestId, {
              reencounters: [createRankedReencounter()]
            })
          );
        } else if (isReencounterFeedbackMessage(message)) {
          callback(
            createSuccessResponseMessage(message.requestId, {
              ...message.payload,
              updated: true
            })
          );
        }
      },
      { openUrl: (url) => opened.push(url) }
    );
    harness.app.loadContextualReencounters();
    const card = harness.document.getElementById("reencounter-list").children[0];
    findByAttribute(card, "data-outcome", outcome).click();

    assert.deepEqual(opened, []);
    assert.equal(
      findByClass(card, "feedback-status").getAttribute("data-state"),
      "success"
    );
    const feedbackMessages = harness.sentMessages.filter(
      isReencounterFeedbackMessage
    );
    assert.equal(feedbackMessages.length, 1);
    assert.equal(feedbackMessages[0].payload.outcome, outcome);
  }
});

test("keeps failed feedback retryable without pretending completion", () => {
  let feedbackAttempt = 0;
  const harness = createHarness(({ message, callback }) => {
    if (isActiveContextQueryMessage(message)) {
      callback(
        createSuccessResponseMessage(message.requestId, {
          status: ACTIVE_CONTEXT_STATUSES.AVAILABLE,
          context: createContext()
        })
      );
    } else if (isReencounterQueryMessage(message)) {
      callback(
        createSuccessResponseMessage(message.requestId, {
          reencounters: [createRankedReencounter()]
        })
      );
    } else if (isReencounterFeedbackMessage(message)) {
      feedbackAttempt += 1;
      callback(
        feedbackAttempt === 1
          ? createErrorResponseMessage(message.requestId, {
              code: RESPONSE_ERROR_CODES.STORAGE_ERROR,
              message: "Storage unavailable.",
              retryable: true
            })
          : createSuccessResponseMessage(message.requestId, {
              ...message.payload,
              updated: true
            })
      );
    }
  });
  harness.app.loadContextualReencounters();
  const card = harness.document.getElementById("reencounter-list").children[0];
  const laterButton = findByAttribute(
    card,
    "data-outcome",
    REENCOUNTER_FEEDBACK_OUTCOMES.LATER
  );
  const openedButton = findByAttribute(
    card,
    "data-outcome",
    REENCOUNTER_FEEDBACK_OUTCOMES.OPENED
  );

  laterButton.click();
  assert.equal(findByClass(card, "feedback-status").textContent, "记录失败，请重试。");
  assert.equal(laterButton.disabled, false);
  assert.equal(openedButton.disabled, true);
  laterButton.click();
  assert.equal(feedbackAttempt, 2);
  assert.equal(
    findByClass(card, "feedback-status").getAttribute("data-state"),
    "success"
  );
});

test("never reports OPENED or opens a disallowed URL", () => {
  const opened = [];
  const harness = createHarness(
    ({ message, callback }) => {
      callback(
        isActiveContextQueryMessage(message)
          ? createSuccessResponseMessage(message.requestId, {
              status: ACTIVE_CONTEXT_STATUSES.AVAILABLE,
              context: createContext()
            })
          : createSuccessResponseMessage(message.requestId, {
              reencounters: [
                createRankedReencounter(1, {
                  missedPath: createMissedPath({
                    candidate: { url: "javascript:alert(1)" }
                  })
                })
              ]
            })
      );
    },
    { openUrl: (url) => opened.push(url) }
  );
  harness.app.loadContextualReencounters();
  const card = harness.document.getElementById("reencounter-list").children[0];
  findByAttribute(
    card,
    "data-outcome",
    REENCOUNTER_FEEDBACK_OUTCOMES.OPENED
  ).click();

  assert.equal(
    harness.sentMessages.filter(isReencounterFeedbackMessage).length,
    0
  );
  assert.deepEqual(opened, []);
  assert.equal(
    findByClass(card, "feedback-status").textContent,
    "链接不安全或无效，未记录为打开。"
  );
});

test("keeps feedback disabled when RE_ENCOUNTER_SHOWN is rejected", () => {
  const harness = createHarness(
    ({ message, callback }) => {
      callback(
        isActiveContextQueryMessage(message)
          ? createSuccessResponseMessage(message.requestId, {
              status: ACTIVE_CONTEXT_STATUSES.AVAILABLE,
              context: createContext()
            })
          : createSuccessResponseMessage(message.requestId, {
              reencounters: [createRankedReencounter()]
            })
      );
    },
    {
      respondToShown({ message, callback }) {
        callback(
          createErrorResponseMessage(message.requestId, {
            code: RESPONSE_ERROR_CODES.STORAGE_ERROR,
            message: "Unable to persist shown.",
            retryable: true
          })
        );
      }
    }
  );
  harness.app.loadContextualReencounters();
  const card = harness.document.getElementById("reencounter-list").children[0];
  const openButton = findByAttribute(
    card,
    "data-outcome",
    REENCOUNTER_FEEDBACK_OUTCOMES.OPENED
  );

  assert.equal(openButton.disabled, true);
  assert.equal(
    findByClass(card, "feedback-status").textContent,
    "展示记录失败，请重新加载后再试。"
  );
  openButton.click();
  assert.equal(
    harness.sentMessages.filter(isReencounterFeedbackMessage).length,
    0
  );
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

test("follows rapid Background tab notifications and ignores late A/B responses", () => {
  const pending = [];
  const harness = createHarness(({ message, callback }) => {
    if (isMissedPathsQueryMessage(message)) {
      callback(
        createSuccessResponseMessage(message.requestId, {
          missedPaths: [createMissedPath()]
        })
      );
      return;
    }
    pending.push({ message, callback });
  });
  const firstContext = createContext({ query: "tab A" });
  const secondContext = createContext({ query: "tab B", timestamp: 200 });
  const thirdContext = createContext({ query: "tab C", timestamp: 300 });

  harness.app.load();
  assert.equal(isActiveContextQueryMessage(pending[0].message), true);
  harness.emitRuntimeMessage(
    createActiveTabChangedMessage(2, 1, 1_001, "tab-b-notification")
  );
  harness.emitRuntimeMessage(
    createActiveTabChangedMessage(3, 1, 1_002, "tab-c-notification")
  );
  assert.equal(pending.length, 3);

  pending[2].callback(
    createSuccessResponseMessage(pending[2].message.requestId, {
      status: ACTIVE_CONTEXT_STATUSES.AVAILABLE,
      context: thirdContext
    })
  );
  assert.equal(isReencounterQueryMessage(pending[3].message), true);
  pending[3].callback(
    createSuccessResponseMessage(pending[3].message.requestId, {
      reencounters: [createRankedReencounter(3)]
    })
  );
  pending[1].callback(
    createSuccessResponseMessage(pending[1].message.requestId, {
      status: ACTIVE_CONTEXT_STATUSES.AVAILABLE,
      context: secondContext
    })
  );
  pending[0].callback(
    createSuccessResponseMessage(pending[0].message.requestId, {
      status: ACTIVE_CONTEXT_STATUSES.AVAILABLE,
      context: firstContext
    })
  );

  const cards = harness.document.getElementById("reencounter-list").children;
  assert.equal(cards.length, 1);
  assert.equal(findByClass(cards[0], "card-title").textContent, "Example result 3");
  assert.match(
    harness.document.getElementById("active-context-summary").textContent,
    /tab C/u
  );
  assert.equal(
    harness.document.getElementById("card-list").children.length,
    1,
    "historical Missed Paths remain visible across tab changes"
  );
  const shownMessages = harness.sentMessages.filter(isReencounterShownMessage);
  assert.equal(shownMessages.length, 1);
  assert.deepEqual(shownMessages[0].payload.triggerContext, thirdContext);
});

test("tab change immediately invalidates old SHOWN and FEEDBACK card actions", () => {
  const context = createContext({ query: "tab A" });
  let activeContextQueryCount = 0;
  const harness = createHarness(({ message, callback }) => {
    if (isActiveContextQueryMessage(message)) {
      activeContextQueryCount += 1;
      if (activeContextQueryCount > 1) {
        return;
      }
      callback(
        createSuccessResponseMessage(message.requestId, {
          status: ACTIVE_CONTEXT_STATUSES.AVAILABLE,
          context
        })
      );
    } else if (isReencounterQueryMessage(message)) {
      callback(
        createSuccessResponseMessage(message.requestId, {
          reencounters: [createRankedReencounter()]
        })
      );
    }
  });

  harness.app.loadContextualReencounters();
  const oldCard = harness.document.getElementById("reencounter-list").children[0];
  const oldLaterButton = findByAttribute(
    oldCard,
    "data-outcome",
    REENCOUNTER_FEEDBACK_OUTCOMES.LATER
  );
  assert.equal(oldLaterButton.disabled, false);

  harness.emitRuntimeMessage(
    createActiveTabChangedMessage(2, 1, 1_001, "tab-switch")
  );
  assert.equal(
    harness.document
      .getElementById("active-context-status")
      .getAttribute("data-state"),
    "loading"
  );
  oldLaterButton.click();

  assert.equal(
    harness.sentMessages.filter(isReencounterFeedbackMessage).length,
    0
  );
});

test("tab notification renders unsupported-page empty state without clearing history", () => {
  let activeContextQueries = 0;
  const harness = createHarness(({ message, callback }) => {
    if (isMissedPathsQueryMessage(message)) {
      callback(
        createSuccessResponseMessage(message.requestId, {
          missedPaths: [createMissedPath()]
        })
      );
    } else if (isActiveContextQueryMessage(message)) {
      activeContextQueries += 1;
      callback(
        createSuccessResponseMessage(message.requestId, {
          status: ACTIVE_CONTEXT_STATUSES.UNAVAILABLE,
          context: null
        })
      );
    }
  });

  harness.app.load();
  harness.emitRuntimeMessage(
    createActiveTabChangedMessage(9, 1, 1_001, "unsupported-tab")
  );

  assert.equal(activeContextQueries, 2);
  assert.equal(
    harness.document
      .getElementById("active-context-status")
      .getAttribute("data-state"),
    "empty"
  );
  assert.match(
    harness.document.getElementById("active-context-status").textContent,
    /受支持的搜索页/u
  );
  assert.equal(harness.document.getElementById("card-list").children.length, 1);
});

test("Re-encounter ViewModel mapping safely falls back for unknown reasons", () => {
  const viewModel = toReencounterViewModel(
    createRankedReencounter(1, {
      reasons: [{ code: "FUTURE_REASON", label: "future label" }]
    })
  );

  assert.deepEqual(viewModel.reasons, [UNKNOWN_REASON_LABEL]);
});

test("uses module markup and no webpage inspection or direct storage API", () => {
  const appSource = readFileSync("sidepanel/app.js", "utf8");
  const htmlSource = readFileSync("sidepanel/index.html", "utf8");

  assert.doesNotMatch(
    appSource,
    /localStorage|indexedDB|chrome\.storage/iu
  );
  assert.doesNotMatch(
    appSource,
    /chrome\.tabs\.(?:query|get|getCurrent)|chrome\.scripting|window\.location/iu
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
