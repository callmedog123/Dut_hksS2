// @ts-check

import {
  ACTIVE_CONTEXT_STATUSES,
  REENCOUNTER_FEEDBACK_OUTCOMES,
  createActiveContextQueryMessage,
  createMissedPathsQueryMessage,
  createReencounterQueryMessage,
  createReencounterFeedbackMessage,
  createReencounterShownMessage,
  isActiveContextQueryResponse,
  isMissedPathsQueryResponse,
  isReencounterQueryResponse,
  isReencounterFeedbackResponse,
  isReencounterShownResponse
} from "../shared/messages.js";
import { normalizeCandidateUrl } from "../shared/url.js";

const KNOWN_CONSIDERATION_REASON_CODES = new Set([
  "LONG_EXPOSURE",
  "LONG_HOVER",
  "REPEATED_HOVER",
  "RETURN_VIEW",
  "NOT_CLICKED"
]);
const KNOWN_REENCOUNTER_REASON_CODES = new Set([
  "CONTEXT_MATCH",
  "PRIOR_CONSIDERATION",
  "NOVELTY_OR_DIVERGENCE_P0_ZERO",
  "FRESHNESS",
  "COOLDOWN_PENALTY",
  "REPEATED_DISMISSAL_PENALTY"
]);

export const UNKNOWN_REASON_LABEL = "存在暂未识别的考虑信号。";
export const QUERY_ERROR_MESSAGE = "暂时无法显示 Missed Path。";
export const ACTIVE_CONTEXT_ERROR_MESSAGE = "暂时无法确认当前搜索情境。";
export const REENCOUNTER_ERROR_MESSAGE = "暂时无法显示情境化重逢。";

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function openCandidateUrl(url) {
  if (typeof globalThis.chrome?.tabs?.create === "function") {
    return globalThis.chrome.tabs.create({ url });
  }
  if (typeof globalThis.window?.open === "function") {
    return globalThis.window.open(url, "_blank", "noopener,noreferrer") !== null;
  }
  return false;
}

function requireDisplayString(value, fieldName) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`MissedPath ${fieldName} must be a non-empty string.`);
  }
  return value.trim();
}

function mapReasonLabel(reason, knownCodes) {
  if (
    !isRecord(reason) ||
    typeof reason.code !== "string" ||
    !knownCodes.has(reason.code)
  ) {
    return UNKNOWN_REASON_LABEL;
  }
  if (typeof reason.label !== "string" || reason.label.trim().length === 0) {
    return UNKNOWN_REASON_LABEL;
  }
  return reason.label.trim();
}

/**
 * Map a persisted MissedPath to display-only data. Business score, status and
 * reason calculation remain owned by the background layer.
 *
 * @param {unknown} missedPath
 * @returns {{id: string, title: string, url: string, source: string, reasons: readonly string[]}}
 */
export function toMissedPathViewModel(missedPath) {
  if (!isRecord(missedPath) || !isRecord(missedPath.candidate)) {
    throw new TypeError("Expected a displayable MissedPath.");
  }
  if (!Array.isArray(missedPath.reasons)) {
    throw new TypeError("MissedPath reasons must be an array.");
  }

  return Object.freeze({
    id: requireDisplayString(missedPath.id, "id"),
    title: requireDisplayString(missedPath.candidate.title, "candidate.title"),
    url: requireDisplayString(missedPath.candidate.url, "candidate.url"),
    source: requireDisplayString(
      missedPath.candidate.source,
      "candidate.source"
    ),
    reasons: Object.freeze(
      missedPath.reasons.map((reason) =>
        mapReasonLabel(reason, KNOWN_CONSIDERATION_REASON_CODES)
      )
    )
  });
}

/**
 * Map one already-ranked Re-encounter result to display-only data. Ranking,
 * score and reason calculation remain owned by the background layer.
 *
 * @param {unknown} rankedReencounter
 * @returns {{id: string, title: string, url: string, source: string, reasons: readonly string[]}}
 */
export function toReencounterViewModel(rankedReencounter) {
  if (
    !isRecord(rankedReencounter) ||
    !isRecord(rankedReencounter.missedPath) ||
    !isRecord(rankedReencounter.missedPath.candidate) ||
    !Array.isArray(rankedReencounter.reasons)
  ) {
    throw new TypeError("Expected a displayable RankedReencounterV1.");
  }

  const { missedPath } = rankedReencounter;
  return Object.freeze({
    id: requireDisplayString(missedPath.id, "id"),
    title: requireDisplayString(missedPath.candidate.title, "candidate.title"),
    url: requireDisplayString(missedPath.candidate.url, "candidate.url"),
    source: requireDisplayString(
      missedPath.candidate.source,
      "candidate.source"
    ),
    reasons: Object.freeze(
      rankedReencounter.reasons.map((reason) =>
        mapReasonLabel(reason, KNOWN_REENCOUNTER_REASON_CODES)
      )
    )
  });
}

function requireElement(documentRef, id) {
  const element = documentRef.getElementById(id);
  if (element === null) {
    throw new TypeError(`Side Panel element #${id} is required.`);
  }
  return element;
}

/**
 * @param {{
 *   document: Document,
 *   runtime: {lastError?: {message?: string}, sendMessage: (message: object, callback: (response: unknown) => void) => void},
 *   now?: () => number,
 *   openUrl?: (url: string) => unknown
 * }} dependencies
 */
export function createSidePanelApp({
  document: documentRef,
  runtime,
  now = Date.now,
  openUrl = openCandidateUrl
}) {
  if (!documentRef || typeof documentRef.getElementById !== "function") {
    throw new TypeError("Side Panel requires a document.");
  }
  if (!runtime || typeof runtime.sendMessage !== "function") {
    throw new TypeError("Side Panel requires chrome.runtime messaging.");
  }
  if (typeof now !== "function") {
    throw new TypeError("Side Panel now dependency must be a function.");
  }
  if (typeof openUrl !== "function") {
    throw new TypeError("Side Panel openUrl dependency must be a function.");
  }

  const statusElement = requireElement(documentRef, "status");
  const cardListElement = requireElement(documentRef, "card-list");
  const emptyElement = requireElement(documentRef, "empty-state");
  const missedCountElement = requireElement(documentRef, "missed-count");
  const retryButton = requireElement(documentRef, "retry-button");
  const activeContextSummaryElement = requireElement(
    documentRef,
    "active-context-summary"
  );
  const activeContextStatusElement = requireElement(
    documentRef,
    "active-context-status"
  );
  const activeContextRetryButton = requireElement(
    documentRef,
    "active-context-retry-button"
  );
  const reencounterStatusElement = requireElement(
    documentRef,
    "reencounter-status"
  );
  const reencounterListElement = requireElement(
    documentRef,
    "reencounter-list"
  );
  const reencounterEmptyElement = requireElement(
    documentRef,
    "reencounter-empty-state"
  );
  const reencounterRetryButton = requireElement(
    documentRef,
    "reencounter-retry-button"
  );
  let activeMissedPathsRequestId = null;
  let contextLoadGeneration = 0;

  function setState(state, message, retryable = false) {
    statusElement.setAttribute("data-state", state);
    statusElement.textContent = message;
    retryButton.hidden = !retryable;
    cardListElement.setAttribute("aria-busy", "false");
  }

  function clearResults() {
    cardListElement.replaceChildren();
    missedCountElement.textContent = "0";
    emptyElement.hidden = true;
  }

  function renderLoading() {
    clearResults();
    statusElement.setAttribute("data-state", "loading");
    statusElement.textContent = "正在读取本地 Missed Path…";
    retryButton.hidden = true;
    cardListElement.setAttribute("aria-busy", "true");
  }

  function renderError(state, retryable) {
    clearResults();
    setState(state, QUERY_ERROR_MESSAGE, retryable);
  }

  function createCard(viewModel) {
    const card = documentRef.createElement("article");
    card.className = "card";
    card.setAttribute("data-missed-path-id", viewModel.id);

    const kind = documentRef.createElement("p");
    kind.className = "card-kind";
    kind.textContent = "未选择路径";

    const title = documentRef.createElement("h3");
    title.className = "card-title";
    title.textContent = viewModel.title;

    const source = documentRef.createElement("p");
    source.className = "card-source";
    source.textContent = viewModel.source;

    const url = documentRef.createElement("p");
    url.className = "card-url";
    url.textContent = viewModel.url;

    card.appendChild(kind);
    card.appendChild(title);
    card.appendChild(source);
    card.appendChild(url);

    if (viewModel.reasons.length > 0) {
      const reasonBox = documentRef.createElement("div");
      reasonBox.className = "card-reason";

      const reasonLabel = documentRef.createElement("p");
      reasonLabel.className = "reason-label";
      reasonLabel.textContent = "为什么被记录";

      const reasonList = documentRef.createElement("ul");
      reasonList.className = "reason-list";
      for (const reason of viewModel.reasons) {
        const item = documentRef.createElement("li");
        item.textContent = reason;
        reasonList.appendChild(item);
      }

      reasonBox.appendChild(reasonLabel);
      reasonBox.appendChild(reasonList);
      card.appendChild(reasonBox);
    }

    return card;
  }

  function createReencounterCard(viewModel, onFeedback) {
    const card = documentRef.createElement("article");
    card.className = "card card-reencounter";
    card.setAttribute("data-missed-path-id", viewModel.id);

    const kind = documentRef.createElement("p");
    kind.className = "card-kind";
    kind.textContent = "情境化重逢";

    const title = documentRef.createElement("h3");
    title.className = "card-title";
    title.textContent = viewModel.title;

    const source = documentRef.createElement("p");
    source.className = "card-source";
    source.textContent = viewModel.source;

    const url = documentRef.createElement("p");
    url.className = "card-url";
    url.textContent = viewModel.url;

    card.appendChild(kind);
    card.appendChild(title);
    card.appendChild(source);
    card.appendChild(url);

    if (viewModel.reasons.length > 0) {
      const reasonBox = documentRef.createElement("div");
      reasonBox.className = "card-reason";

      const reasonLabel = documentRef.createElement("p");
      reasonLabel.className = "reason-label";
      reasonLabel.textContent = "为什么此刻重逢";

      const reasonList = documentRef.createElement("ul");
      reasonList.className = "reason-list";
      for (const reason of viewModel.reasons) {
        const item = documentRef.createElement("li");
        item.textContent = reason;
        reasonList.appendChild(item);
      }

      reasonBox.appendChild(reasonLabel);
      reasonBox.appendChild(reasonList);
      card.appendChild(reasonBox);
    }

    const feedbackStatus = documentRef.createElement("p");
    feedbackStatus.className = "feedback-status";
    feedbackStatus.setAttribute("data-state", "waiting-shown");
    feedbackStatus.textContent = "正在确认本次展示…";

    const actions = documentRef.createElement("div");
    actions.className = "feedback-actions";
    const buttonDefinitions = [
      [REENCOUNTER_FEEDBACK_OUTCOMES.OPENED, "打开"],
      [REENCOUNTER_FEEDBACK_OUTCOMES.LATER, "稍后"],
      [REENCOUNTER_FEEDBACK_OUTCOMES.NOT_RELEVANT, "不相关"]
    ];
    const buttons = new Map();
    for (const [outcome, label] of buttonDefinitions) {
      const button = documentRef.createElement("button");
      button.setAttribute("type", "button");
      button.setAttribute("data-outcome", outcome);
      button.className = "btn feedback-button";
      button.textContent = label;
      button.disabled = true;
      buttons.set(outcome, button);
      actions.appendChild(button);
    }
    card.appendChild(feedbackStatus);
    card.appendChild(actions);

    let reencounterId = null;
    let ready = false;
    let pending = false;
    let completed = false;
    let retryOutcome = null;

    function updateButtons() {
      for (const [outcome, button] of buttons) {
        button.disabled = Boolean(
          !ready ||
            pending ||
            completed ||
            (retryOutcome !== null && retryOutcome !== outcome)
        );
      }
    }

    const controller = Object.freeze({
      element: card,
      get reencounterId() {
        return reencounterId;
      },
      markShown(id) {
        reencounterId = id;
        ready = true;
        card.setAttribute("data-reencounter-id", id);
        feedbackStatus.setAttribute("data-state", "ready");
        feedbackStatus.textContent = "可选择本次重逢的结果。";
        updateButtons();
      },
      markShownFailed() {
        feedbackStatus.setAttribute("data-state", "error");
        feedbackStatus.textContent = "展示记录失败，请重新加载后再试。";
        updateButtons();
      },
      beginFeedback() {
        if (!ready || pending || completed) {
          return false;
        }
        pending = true;
        feedbackStatus.setAttribute("data-state", "pending");
        feedbackStatus.textContent = "正在记录反馈…";
        updateButtons();
        return true;
      },
      feedbackFailed(outcome, message = "记录失败，请重试。") {
        pending = false;
        retryOutcome = outcome;
        feedbackStatus.setAttribute("data-state", "error");
        feedbackStatus.textContent = message;
        updateButtons();
      },
      feedbackSucceeded(outcome) {
        pending = false;
        completed = true;
        feedbackStatus.setAttribute("data-state", "success");
        feedbackStatus.textContent =
          outcome === REENCOUNTER_FEEDBACK_OUTCOMES.OPENED
            ? "已记录为打开。"
            : outcome === REENCOUNTER_FEEDBACK_OUTCOMES.LATER
              ? "已延后，本地冷却已更新。"
              : "已记录为不相关。";
        updateButtons();
      }
    });

    for (const [outcome, button] of buttons) {
      button.addEventListener("click", () => {
        if (!button.disabled) {
          onFeedback(controller, outcome, viewModel);
        }
      });
    }

    return controller;
  }

  function renderSuccess(viewModels) {
    cardListElement.replaceChildren(
      ...viewModels.map((viewModel) => createCard(viewModel))
    );
    missedCountElement.textContent = String(viewModels.length);
    emptyElement.hidden = viewModels.length !== 0;
    setState(
      viewModels.length === 0 ? "empty" : "success",
      viewModels.length === 0
        ? "本地 Repository 暂无 Missed Path。"
        : `已加载 ${viewModels.length} 条 Missed Path。`
    );
  }

  function clearReencounters() {
    reencounterListElement.replaceChildren();
    reencounterEmptyElement.hidden = true;
    reencounterListElement.setAttribute("aria-busy", "false");
  }

  function renderReencounterInactive() {
    clearReencounters();
    reencounterStatusElement.hidden = true;
    reencounterStatusElement.setAttribute("data-state", "inactive");
    reencounterRetryButton.hidden = true;
  }

  function renderActiveContextLoading() {
    activeContextSummaryElement.textContent = "等待 B 线提供当前搜索情境";
    activeContextStatusElement.hidden = false;
    activeContextStatusElement.setAttribute("data-state", "loading");
    activeContextStatusElement.textContent = "正在确认当前搜索情境…";
    activeContextRetryButton.hidden = true;
    renderReencounterInactive();
  }

  function renderActiveContextEmpty() {
    activeContextSummaryElement.textContent = "当前没有可用搜索情境";
    activeContextStatusElement.hidden = false;
    activeContextStatusElement.setAttribute("data-state", "empty");
    activeContextStatusElement.textContent =
      "打开并使用受支持的搜索页后，这里会出现情境化重逢。";
    activeContextRetryButton.hidden = false;
    renderReencounterInactive();
  }

  function renderActiveContextReady(context) {
    const query = context.query.length > 0 ? context.query : "（无查询词）";
    activeContextSummaryElement.textContent =
      `当前情境：${query} · ${context.source}`;
    activeContextStatusElement.hidden = false;
    activeContextStatusElement.setAttribute("data-state", "ready");
    activeContextStatusElement.textContent = "已从 B 线获取当前搜索情境。";
    activeContextRetryButton.hidden = true;
  }

  function renderActiveContextError(state, retryable) {
    activeContextSummaryElement.textContent = "当前搜索情境不可用";
    activeContextStatusElement.hidden = false;
    activeContextStatusElement.setAttribute("data-state", state);
    activeContextStatusElement.textContent = ACTIVE_CONTEXT_ERROR_MESSAGE;
    activeContextRetryButton.hidden = !retryable;
    renderReencounterInactive();
  }

  function renderReencounterLoading() {
    clearReencounters();
    reencounterStatusElement.hidden = false;
    reencounterStatusElement.setAttribute("data-state", "loading");
    reencounterStatusElement.textContent = "正在查找与当前情境相关的余路…";
    reencounterListElement.setAttribute("aria-busy", "true");
    reencounterRetryButton.hidden = true;
  }

  function renderReencounterError(state, retryable) {
    clearReencounters();
    reencounterStatusElement.hidden = false;
    reencounterStatusElement.setAttribute("data-state", state);
    reencounterStatusElement.textContent = REENCOUNTER_ERROR_MESSAGE;
    reencounterRetryButton.hidden = !retryable;
  }

  function renderReencounterSuccess(viewModels) {
    reencounterListElement.replaceChildren(
      ...viewModels.map((viewModel) => createReencounterCard(viewModel))
    );
    reencounterListElement.setAttribute("aria-busy", "false");
    reencounterEmptyElement.hidden = viewModels.length !== 0;
    reencounterStatusElement.hidden = false;
    reencounterStatusElement.setAttribute(
      "data-state",
      viewModels.length === 0 ? "empty" : "ready"
    );
    reencounterStatusElement.textContent =
      viewModels.length === 0
        ? "当前情境下没有需要重逢的余路。"
        : `找到 ${viewModels.length} 条情境化重逢。`;
    reencounterRetryButton.hidden = true;
  }

  function reportReencountersShown(reencounters, context, generation) {
    if (reencounters.length === 0 || generation !== contextLoadGeneration) {
      return;
    }
    const shownAt = now();
    if (
      typeof shownAt !== "number" ||
      !Number.isFinite(shownAt) ||
      shownAt < 0
    ) {
      console.error("[The Unclicked] Invalid RE_ENCOUNTER_SHOWN timestamp.");
      return;
    }

    for (const reencounter of reencounters) {
      let request;
      try {
        request = createReencounterShownMessage(
          reencounter,
          context,
          shownAt
        );
        runtime.sendMessage(request, (response) => {
          if (generation !== contextLoadGeneration) {
            return;
          }
          const runtimeError = runtime.lastError;
          if (
            runtimeError ||
            !isReencounterShownResponse(response) ||
            response.requestId !== request.requestId ||
            response.ok === false
          ) {
            console.error(
              "[The Unclicked] RE_ENCOUNTER_SHOWN was not acknowledged."
            );
          }
        });
      } catch {
        console.error("[The Unclicked] Failed to send RE_ENCOUNTER_SHOWN.");
      }
    }
  }

  function queryReencounters(context, generation) {
    if (generation !== contextLoadGeneration) {
      return null;
    }
    renderReencounterLoading();
    let request;
    try {
      request = createReencounterQueryMessage(context, 3);
      runtime.sendMessage(request, (response) => {
        if (generation !== contextLoadGeneration) {
          return;
        }
        const runtimeError = runtime.lastError;
        if (runtimeError) {
          renderReencounterError("retryable-error", true);
          return;
        }
        if (
          !isReencounterQueryResponse(response) ||
          response.requestId !== request.requestId
        ) {
          renderReencounterError("protocol-error", false);
          return;
        }
        if (response.ok === false) {
          renderReencounterError(
            response.error.retryable ? "retryable-error" : "error",
            response.error.retryable
          );
          return;
        }

        try {
          const reencounters = response.data.reencounters;
          renderReencounterSuccess(
            reencounters.map(toReencounterViewModel)
          );
          reportReencountersShown(reencounters, context, generation);
        } catch {
          renderReencounterError("protocol-error", false);
        }
      });
    } catch {
      renderReencounterError("retryable-error", true);
      return null;
    }
    return request;
  }

  function loadContextualReencounters() {
    contextLoadGeneration += 1;
    const generation = contextLoadGeneration;
    renderActiveContextLoading();
    const request = createActiveContextQueryMessage();

    try {
      runtime.sendMessage(request, (response) => {
        if (generation !== contextLoadGeneration) {
          return;
        }
        const runtimeError = runtime.lastError;
        if (runtimeError) {
          renderActiveContextError("retryable-error", true);
          return;
        }
        if (
          !isActiveContextQueryResponse(response) ||
          response.requestId !== request.requestId
        ) {
          renderActiveContextError("protocol-error", false);
          return;
        }
        if (response.ok === false) {
          renderActiveContextError(
            response.error.retryable ? "retryable-error" : "error",
            response.error.retryable
          );
          return;
        }
        if (response.data.status === ACTIVE_CONTEXT_STATUSES.UNAVAILABLE) {
          renderActiveContextEmpty();
          return;
        }

        renderActiveContextReady(response.data.context);
        queryReencounters(response.data.context, generation);
      });
    } catch {
      renderActiveContextError("retryable-error", true);
    }
    return request;
  }

  function loadMissedPaths() {
    renderLoading();
    const request = createMissedPathsQueryMessage();
    activeMissedPathsRequestId = request.requestId;

    try {
      runtime.sendMessage(request, (response) => {
        if (activeMissedPathsRequestId !== request.requestId) {
          return;
        }

        const runtimeError = runtime.lastError;
        if (runtimeError) {
          renderError("retryable-error", true);
          return;
        }
        if (
          !isMissedPathsQueryResponse(response) ||
          response.requestId !== request.requestId
        ) {
          renderError("protocol-error", false);
          return;
        }
        if (response.ok === false) {
          renderError(
            response.error.retryable ? "retryable-error" : "error",
            response.error.retryable
          );
          return;
        }

        try {
          renderSuccess(
            response.data.missedPaths.map(toMissedPathViewModel)
          );
        } catch {
          renderError("protocol-error", false);
        }
      });
    } catch {
      renderError("retryable-error", true);
    }

    return request;
  }

  retryButton.addEventListener("click", loadMissedPaths);
  activeContextRetryButton.addEventListener(
    "click",
    loadContextualReencounters
  );
  reencounterRetryButton.addEventListener(
    "click",
    loadContextualReencounters
  );

  return Object.freeze({
    load() {
      loadMissedPaths();
      loadContextualReencounters();
    },
    loadContextualReencounters,
    loadMissedPaths
  });
}

if (
  typeof document !== "undefined" &&
  typeof chrome !== "undefined" &&
  chrome.runtime &&
  typeof chrome.runtime.sendMessage === "function"
) {
  createSidePanelApp({ document, runtime: chrome.runtime }).load();
}
