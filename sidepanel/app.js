// @ts-check

import {
  createMissedPathsQueryMessage,
  isMissedPathsQueryResponse
} from "../shared/messages.js";

const KNOWN_REASON_CODES = new Set([
  "LONG_EXPOSURE",
  "LONG_HOVER",
  "REPEATED_HOVER",
  "RETURN_VIEW",
  "NOT_CLICKED",
  "CONTEXT_MATCH"
]);

export const UNKNOWN_REASON_LABEL = "存在暂未识别的考虑信号。";
export const QUERY_ERROR_MESSAGE = "暂时无法显示 Missed Path。";

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireDisplayString(value, fieldName) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`MissedPath ${fieldName} must be a non-empty string.`);
  }
  return value.trim();
}

function mapReasonLabel(reason) {
  if (
    !isRecord(reason) ||
    typeof reason.code !== "string" ||
    !KNOWN_REASON_CODES.has(reason.code)
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
    reasons: Object.freeze(missedPath.reasons.map(mapReasonLabel))
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
 *   runtime: {lastError?: {message?: string}, sendMessage: (message: object, callback: (response: unknown) => void) => void}
 * }} dependencies
 */
export function createSidePanelApp({ document: documentRef, runtime }) {
  if (!documentRef || typeof documentRef.getElementById !== "function") {
    throw new TypeError("Side Panel requires a document.");
  }
  if (!runtime || typeof runtime.sendMessage !== "function") {
    throw new TypeError("Side Panel requires chrome.runtime messaging.");
  }

  const statusElement = requireElement(documentRef, "status");
  const cardListElement = requireElement(documentRef, "card-list");
  const emptyElement = requireElement(documentRef, "empty-state");
  const missedCountElement = requireElement(documentRef, "missed-count");
  const retryButton = requireElement(documentRef, "retry-button");
  let activeRequestId = null;

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

  function loadMissedPaths() {
    renderLoading();
    const request = createMissedPathsQueryMessage();
    activeRequestId = request.requestId;

    try {
      runtime.sendMessage(request, (response) => {
        if (activeRequestId !== request.requestId) {
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

  return Object.freeze({ loadMissedPaths });
}

if (
  typeof document !== "undefined" &&
  typeof chrome !== "undefined" &&
  chrome.runtime &&
  typeof chrome.runtime.sendMessage === "function"
) {
  createSidePanelApp({ document, runtime: chrome.runtime }).loadMissedPaths();
}
