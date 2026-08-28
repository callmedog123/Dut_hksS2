// @ts-check

import {
  RESPONSE_ERROR_CODES,
  createCandidatesDiscoveredMessage,
  createSessionFinalizeMessage,
  createSignalsUpdatedMessage,
  isCandidatesDiscoveredResponse,
  isResponseMessage,
  isSessionFinalizeResponse,
  isSignalsUpdatedResponse
} from "../shared/messages.js";
import { createCandidateClickCollector } from "./eventCollector/click.js";
import { createHoverTracker } from "./eventCollector/hover.js";
import { createVisibilityTracker } from "./visibility.js";

export class SiteRuntimeError extends Error {
  constructor(message, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "SiteRuntimeError";
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createDefaultMessageSender(runtime, RuntimeError, siteLabel) {
  if (!runtime || typeof runtime.sendMessage !== "function") {
    throw new TypeError(
      `${siteLabel} Runtime requires chrome.runtime.sendMessage().`
    );
  }

  return (message) =>
    new Promise((resolve, reject) => {
      runtime.sendMessage(message, (response) => {
        const runtimeError = runtime.lastError;
        if (runtimeError) {
          reject(new RuntimeError(runtimeError.message));
          return;
        }
        resolve(response);
      });
    });
}

function candidateKey(candidate) {
  return JSON.stringify([candidate.sessionId, candidate.id]);
}

function contextIdentity(context) {
  return JSON.stringify([
    context.source,
    context.query,
    Array.isArray(context.keywords) ? context.keywords : []
  ]);
}

const REQUIRED_ADAPTER_METHODS = Object.freeze([
  "canHandle",
  "getContext",
  "extractCandidates",
  "observeChanges"
]);

/**
 * @param {unknown} adapter
 * @returns {asserts adapter is import("./adapters/types.js").SiteAdapter}
 */
function assertRuntimeAdapter(adapter) {
  if (!isRecord(adapter)) {
    throw new TypeError("Site Runtime Adapter must be an object.");
  }
  for (const method of REQUIRED_ADAPTER_METHODS) {
    if (typeof adapter[method] !== "function") {
      throw new TypeError(`Site Runtime Adapter must implement ${method}().`);
    }
  }
}

/**
 * Compose one Site Adapter, page-memory bindings and the shared collectors.
 * Scoring and persistence remain entirely in the background.
 *
 * @param {{
 *   document?: Document,
 *   pageLifecycle?: EventTarget,
 *   runtime?: object,
 *   siteLabel?: string,
 *   RuntimeError?: typeof SiteRuntimeError,
 *   createAdapter: (options: {
 *     document: Document,
 *     MutationObserver: typeof MutationObserver,
 *     now: () => number,
 *     sessionIdFactory?: (contextKey: string) => string,
 *     onCandidateBound: (binding: import("./adapters/types.js").CandidateBinding) => void,
 *     onCandidateUnbound: (binding: import("./adapters/types.js").CandidateBinding) => void
 *   }) => import("./adapters/types.js").SiteAdapter,
 *   sendMessage?: (message: object) => unknown,
 *   readUrl?: () => URL,
 *   wallNow?: () => number,
 *   performanceNow?: () => number,
 *   MutationObserver?: typeof MutationObserver,
 *   IntersectionObserver?: typeof IntersectionObserver,
 *   sessionIdFactory?: (contextKey: string) => string,
 *   eventFactory?: (type: string) => Event,
 *   onStatus?: (status: {state: string, message: string, data?: unknown}) => void
 * }} [options]
 */
export function createSiteRuntime(options = {}) {
  if (!isRecord(options)) {
    throw new TypeError("Site Runtime options must be an object.");
  }

  const siteLabel = options.siteLabel ?? "Site";
  const RuntimeError = options.RuntimeError ?? SiteRuntimeError;
  const runtimeDocument = options.document ?? globalThis.document;
  const pageLifecycle = options.pageLifecycle ?? globalThis.window;
  const wallNow = options.wallNow ?? (() => Date.now());
  const performanceNow =
    options.performanceNow ?? (() => globalThis.performance.now());
  const onStatus = options.onStatus ?? (() => {});
  const sendMessage =
    options.sendMessage ??
    createDefaultMessageSender(
      options.runtime ?? globalThis.chrome?.runtime,
      RuntimeError,
      siteLabel
    );
  const readUrl =
    options.readUrl ??
    (() => new URL(runtimeDocument.location.href));

  if (
    !runtimeDocument ||
    typeof runtimeDocument.addEventListener !== "function" ||
    typeof runtimeDocument.removeEventListener !== "function" ||
    !pageLifecycle ||
    typeof pageLifecycle.addEventListener !== "function" ||
    typeof pageLifecycle.removeEventListener !== "function" ||
    typeof wallNow !== "function" ||
    typeof performanceNow !== "function" ||
    typeof onStatus !== "function" ||
    typeof sendMessage !== "function" ||
    typeof readUrl !== "function" ||
    typeof options.createAdapter !== "function" ||
    typeof siteLabel !== "string" ||
    siteLabel.trim().length === 0 ||
    typeof RuntimeError !== "function"
  ) {
    throw new TypeError(`${siteLabel} Runtime dependencies are invalid.`);
  }

  let lifecycle = "idle";
  let collectionEnabled = true;
  let disposed = false;
  let activeSession = null;
  let observerCleanup = () => {};
  let writeTail = Promise.resolve();
  let transitionTail = Promise.resolve();
  const pendingBindings = new Map();

  function readWallNow() {
    const timestamp = wallNow();
    if (!Number.isFinite(timestamp) || timestamp < 0) {
      throw new TypeError(
        `${siteLabel} wall clock must be finite and non-negative.`
      );
    }
    return timestamp;
  }

  function readCollectorNow() {
    const timestamp = performanceNow();
    if (!Number.isFinite(timestamp)) {
      throw new TypeError(`${siteLabel} collector clock must be finite.`);
    }
    return timestamp;
  }

  function readCurrentUrl() {
    try {
      const url = readUrl();
      return url instanceof URL ? url : null;
    } catch {
      return null;
    }
  }

  function emitStatus(state, message, data) {
    onStatus({
      state,
      message,
      ...(data === undefined ? {} : { data })
    });
  }

  function reportBackgroundWrite(operation, label) {
    void operation.catch((error) => {
      if (error?.cause?.code === RESPONSE_ERROR_CODES.COLLECTION_PAUSED) {
        return;
      }
      emitStatus("degraded", `${label}同步失败：${error.message}`);
    });
  }

  function snapshotSignals(state) {
    return {
      candidateId: state.candidateId,
      sessionId: state.sessionId,
      visibleMs: state.visibleMs,
      hoverMs: state.hoverMs,
      hoverCount: state.hoverCount,
      returnCount: state.returnCount,
      clicked: state.clicked
    };
  }

  function ensureCandidateState(session, candidate) {
    const key = candidateKey(candidate);
    session.candidates.set(key, candidate);
    if (!session.signals.has(candidate.id)) {
      session.signals.set(candidate.id, {
        candidateId: candidate.id,
        sessionId: candidate.sessionId,
        visibleMs: 0,
        hoverMs: 0,
        hoverCount: 0,
        returnCount: 0,
        clicked: false
      });
    }
    return session.signals.get(candidate.id);
  }

  function mergeVisibility(session, candidateId, visibleMs, returnCount) {
    const state = session.signals.get(candidateId);
    const registration = session.registrations.get(candidateId);
    if (state === undefined || registration === undefined) {
      return;
    }
    if (visibleMs !== null) {
      state.visibleMs = Math.max(
        state.visibleMs,
        registration.base.visibleMs + visibleMs
      );
    }
    if (returnCount !== null) {
      state.returnCount = Math.max(
        state.returnCount,
        registration.base.returnCount + returnCount
      );
    }
  }

  function mergeHover(session, candidateId, aggregate) {
    const state = session.signals.get(candidateId);
    const registration = session.registrations.get(candidateId);
    if (state === undefined || registration === undefined || aggregate === null) {
      return;
    }
    state.hoverMs = Math.max(
      state.hoverMs,
      registration.base.hoverMs + aggregate.hoverMs
    );
    state.hoverCount = Math.max(
      state.hoverCount,
      registration.base.hoverCount + aggregate.hoverCount
    );
  }

  function enqueueSignals(session, state) {
    return enqueueMessage(
      createSignalsUpdatedMessage(snapshotSignals(state), readWallNow()),
      isSignalsUpdatedResponse,
      session
    );
  }

  function shouldReportSignals(session) {
    return Boolean(
      !disposed &&
        collectionEnabled &&
        activeSession === session &&
        (lifecycle === "collecting" || lifecycle === "finalizing")
    );
  }

  function createCollectorGroup(session) {
    if (session.collectors !== null || disposed || !collectionEnabled) {
      return;
    }

    const visibility = createVisibilityTracker({
      document: runtimeDocument,
      IntersectionObserver:
        options.IntersectionObserver ?? globalThis.IntersectionObserver,
      now: readCollectorNow,
      onVisibleMsUpdated({ candidateId, visibleMs }) {
        mergeVisibility(session, candidateId, visibleMs, null);
        const state = session.signals.get(candidateId);
        if (state !== undefined && shouldReportSignals(session)) {
          reportBackgroundWrite(
            enqueueSignals(session, state),
            `${siteLabel} 可见时长`
          );
        }
      },
      onReturnCountUpdated({ candidateId, returnCount }) {
        mergeVisibility(session, candidateId, null, returnCount);
        const state = session.signals.get(candidateId);
        if (state !== undefined && shouldReportSignals(session)) {
          reportBackgroundWrite(
            enqueueSignals(session, state),
            `${siteLabel} 回访次数`
          );
        }
      }
    });

    const hover = createHoverTracker({
      now: readCollectorNow,
      onHoverUpdated(aggregate) {
        mergeHover(session, aggregate.candidateId, aggregate);
        const state = session.signals.get(aggregate.candidateId);
        if (state !== undefined && shouldReportSignals(session)) {
          reportBackgroundWrite(
            enqueueSignals(session, state),
            `${siteLabel} 悬停信号`
          );
        }
      }
    });

    const click = createCandidateClickCollector({
      root: runtimeDocument,
      now: readWallNow,
      sendMessage(message) {
        if (!shouldReportSignals(session)) {
          return null;
        }
        const state = session.signals.get(message.payload.candidateId);
        if (state !== undefined) {
          state.clicked = true;
        }
        const chosenWrite = enqueueMessage(
          message,
          isResponseMessage,
          session
        );
        reportBackgroundWrite(chosenWrite, `${siteLabel} 选择状态`);
        if (state !== undefined) {
          reportBackgroundWrite(
            enqueueSignals(session, state),
            `${siteLabel} 选择信号`
          );
        }
        return chosenWrite;
      }
    });

    session.collectors = { visibility, hover, click };
  }

  function registerBinding(session, binding) {
    if (
      session.collectors === null ||
      !session.acceptedCandidateIds.has(binding.candidate.id) ||
      binding.candidate.sessionId !== session.sessionId
    ) {
      return;
    }

    const existing = session.registrations.get(binding.candidate.id);
    if (existing !== undefined) {
      if (existing.binding.element === binding.element) {
        return;
      }
      rebuildCollectorGroup(session);
      return;
    }

    const state = ensureCandidateState(session, binding.candidate);
    binding.candidate.clicked = state.clicked;
    const base = {
      visibleMs: state.visibleMs,
      hoverMs: state.hoverMs,
      hoverCount: state.hoverCount,
      returnCount: state.returnCount
    };
    const registration = { binding, base };
    session.registrations.set(binding.candidate.id, registration);

    try {
      registration.unregisterVisibility =
        session.collectors.visibility.registerCandidate(
          binding.candidate.id,
          binding.element
        );
      registration.unregisterHover =
        session.collectors.hover.registerCandidate(
          binding.candidate.id,
          binding.element
        );
      registration.unregisterClick =
        session.collectors.click.registerCandidate(
          binding.candidate,
          binding.element
        );
    } catch (error) {
      session.registrations.delete(binding.candidate.id);
      throw error;
    }
  }

  function registerAcceptedBindings(session) {
    if (session.collectors === null) {
      createCollectorGroup(session);
    }
    for (const binding of session.bindings.values()) {
      registerBinding(session, binding);
    }
  }

  function unregisterBinding(session, binding) {
    const registration = session.registrations.get(binding.candidate.id);
    if (registration === undefined) {
      return;
    }

    const visible = registration.unregisterVisibility?.() ?? null;
    const returnCount =
      session.collectors?.visibility.getReturnCount(binding.candidate.id) ?? null;
    const hover = registration.unregisterHover?.() ?? null;
    registration.unregisterClick?.();
    mergeVisibility(
      session,
      binding.candidate.id,
      visible?.visibleMs ?? null,
      returnCount
    );
    mergeHover(session, binding.candidate.id, hover);
    session.registrations.delete(binding.candidate.id);
    session.retiredCandidateIds.add(binding.candidate.id);
  }

  function cleanupCollectorGroup(session) {
    const collectors = session.collectors;
    if (collectors === null) {
      return;
    }

    session.collectors = null;
    collectors.visibility.cleanup();
    collectors.hover.cleanup();
    collectors.click.cleanup();
    session.registrations.clear();
  }

  function rebuildCollectorGroup(session) {
    cleanupCollectorGroup(session);
    session.retiredCandidateIds.clear();
    if (
      !disposed &&
      collectionEnabled &&
      activeSession === session &&
      !session.finalized
    ) {
      createCollectorGroup(session);
      registerAcceptedBindings(session);
    }
  }

  function pauseCollection(session) {
    collectionEnabled = false;
    if (session !== null) {
      cleanupCollectorGroup(session);
    }
    lifecycle = "paused";
    emitStatus("paused", `${siteLabel} 采集已暂停；页面数据不会继续写入。`);
  }

  async function dispatchValidated(message, validator, session) {
    let response;
    try {
      response = await sendMessage(message);
    } catch (error) {
      throw new RuntimeError(`发送 ${message.type} 失败。`, error);
    }

    if (!validator(response) || response.requestId !== message.requestId) {
      throw new RuntimeError(`${message.type} 返回了无效响应。`);
    }
    if (response.ok !== true) {
      if (response.error.code === RESPONSE_ERROR_CODES.COLLECTION_PAUSED) {
        pauseCollection(session);
      }
      throw new RuntimeError(
        `${message.type} 失败：${response.error.message}`,
        response.error
      );
    }

    collectionEnabled = true;
    return response;
  }

  function enqueueMessage(message, validator, session) {
    const operation = writeTail.then(() =>
      dispatchValidated(message, validator, session)
    );
    writeTail = operation.catch(() => undefined);
    return operation;
  }

  function createSession(sessionId, context) {
    return {
      sessionId,
      context,
      contextIdentity: contextIdentity(context),
      candidates: new Map(),
      signals: new Map(),
      bindings: new Map(),
      acceptedCandidateIds: new Set(),
      retiredCandidateIds: new Set(),
      registrations: new Map(),
      collectors: null,
      finalized: false,
      finalization: null,
      finalizingPromise: null
    };
  }

  function adoptPendingBindings(session) {
    for (const [key, binding] of pendingBindings) {
      if (binding.candidate.sessionId !== session.sessionId) {
        continue;
      }
      session.bindings.set(key, binding);
      ensureCandidateState(session, binding.candidate);
      pendingBindings.delete(key);
    }
  }

  function onCandidateBound(binding) {
    const key = candidateKey(binding.candidate);
    if (
      activeSession === null ||
      binding.candidate.sessionId !== activeSession.sessionId
    ) {
      pendingBindings.set(key, binding);
      return;
    }

    activeSession.bindings.set(key, binding);
    ensureCandidateState(activeSession, binding.candidate);
    if (activeSession.retiredCandidateIds.has(binding.candidate.id)) {
      rebuildCollectorGroup(activeSession);
      return;
    }
    registerBinding(activeSession, binding);
  }

  function onCandidateUnbound(binding) {
    const key = candidateKey(binding.candidate);
    pendingBindings.delete(key);
    if (
      activeSession === null ||
      binding.candidate.sessionId !== activeSession.sessionId
    ) {
      return;
    }
    unregisterBinding(activeSession, binding);
    activeSession.bindings.delete(key);
  }

  const adapter = options.createAdapter({
    document: runtimeDocument,
    MutationObserver: options.MutationObserver ?? globalThis.MutationObserver,
    now: readWallNow,
    sessionIdFactory: options.sessionIdFactory,
    onCandidateBound,
    onCandidateUnbound
  });
  assertRuntimeAdapter(adapter);

  async function flushSessionSignals(session) {
    if (session.collectors !== null) {
      for (const [candidateId, registration] of session.registrations) {
        mergeVisibility(
          session,
          candidateId,
          session.collectors.visibility.getVisibleMs(candidateId),
          session.collectors.visibility.getReturnCount(candidateId)
        );
        mergeHover(
          session,
          candidateId,
          session.collectors.hover.getHoverAggregate(candidateId)
        );
        if (registration.binding.candidate.clicked === true) {
          session.signals.get(candidateId).clicked = true;
        }
      }
    }

    for (const state of session.signals.values()) {
      await enqueueSignals(session, state);
    }
  }

  function finalizeSession(session, reason) {
    if (session.finalizingPromise !== null) {
      return session.finalizingPromise;
    }
    if (session.finalized) {
      return Promise.resolve(session.finalization);
    }

    session.finalizingPromise = (async () => {
      lifecycle = "finalizing";
      cleanupCollectorGroup(session);
      await flushSessionSignals(session);
      const response = await enqueueMessage(
        createSessionFinalizeMessage(session.sessionId, readWallNow()),
        isSessionFinalizeResponse,
        session
      );
      session.finalized = true;
      session.finalization = response.data;
      emitStatus(
        "finalized",
        `${siteLabel} Session 已因 ${reason} 完成结算。`,
        response.data
      );
      return response.data;
    })()
      .catch((error) => {
        if (error?.cause?.code !== RESPONSE_ERROR_CODES.COLLECTION_PAUSED) {
          lifecycle = "degraded";
          emitStatus(
            "degraded",
            `${siteLabel} Session 结算失败：${error.message}`
          );
        }
        throw error;
      })
      .finally(() => {
        session.finalizingPromise = null;
      });
    return session.finalizingPromise;
  }

  async function discoverCandidates(candidates, context) {
    const sessionIds = new Set(candidates.map((candidate) => candidate.sessionId));
    if (sessionIds.size !== 1) {
      throw new RuntimeError(`${siteLabel} Candidates 不属于同一 Session。`);
    }
    const [sessionId] = sessionIds;

    if (activeSession !== null && activeSession.sessionId !== sessionId) {
      await finalizeSession(activeSession, "Session 切换");
      activeSession = null;
    }
    if (activeSession === null) {
      activeSession = createSession(sessionId, context);
      adoptPendingBindings(activeSession);
    }

    for (const candidate of candidates) {
      ensureCandidateState(activeSession, candidate);
    }
    const response = await enqueueMessage(
      createCandidatesDiscoveredMessage(
        activeSession.sessionId,
        activeSession.context,
        candidates,
        readWallNow()
      ),
      isCandidatesDiscoveredResponse,
      activeSession
    );
    // A successful idempotent discovery means every Candidate in this batch
    // exists durably, even when a retry reports no newly accepted IDs.
    for (const candidate of candidates) {
      activeSession.acceptedCandidateIds.add(candidate.id);
    }
    registerAcceptedBindings(activeSession);
    lifecycle = "collecting";
    emitStatus(
      "collecting",
      `${siteLabel} Runtime 正在采集 ${response.data.totalCandidateCount} 个候选项。`,
      response.data
    );
    return response.data;
  }

  async function reconcileCurrentPage(reason) {
    if (disposed) {
      return null;
    }
    const url = readCurrentUrl();
    if (url === null || !adapter.canHandle(url, runtimeDocument)) {
      if (activeSession !== null && !activeSession.finalized) {
        await finalizeSession(activeSession, "离开受支持的搜索情境");
        activeSession = null;
      }
      lifecycle = "inactive";
      emitStatus(
        "inactive",
        `当前页面不是受支持的 ${siteLabel} 搜索情境。`
      );
      return null;
    }

    let context;
    try {
      context = adapter.getContext(runtimeDocument, url);
    } catch (error) {
      lifecycle = "degraded";
      emitStatus(
        "degraded",
        `${siteLabel} 上下文读取失败：${error.message}`
      );
      return null;
    }

    const nextContextIdentity = contextIdentity(context);
    if (
      activeSession !== null &&
      activeSession.contextIdentity !== nextContextIdentity
    ) {
      await finalizeSession(activeSession, "SPA 搜索词变化");
      activeSession = null;
    }

    let candidates;
    try {
      candidates = adapter.extractCandidates(runtimeDocument);
    } catch (error) {
      lifecycle = "degraded";
      emitStatus("degraded", `${siteLabel} DOM 提取失败：${error.message}`);
      return null;
    }
    if (candidates.length === 0) {
      lifecycle = activeSession === null ? "waiting" : lifecycle;
      emitStatus(
        "waiting",
        `${siteLabel} 暂无可采集候选项（${reason}），等待页面动态结果。`
      );
      return null;
    }

    return discoverCandidates(candidates, context);
  }

  function scheduleReconcile(reason) {
    const operation = transitionTail.then(() => reconcileCurrentPage(reason));
    transitionTail = operation.catch((error) => {
      if (error?.cause?.code !== RESPONSE_ERROR_CODES.COLLECTION_PAUSED) {
        lifecycle = "degraded";
        emitStatus("degraded", `${siteLabel} Runtime 降级：${error.message}`);
      }
      return null;
    });
    return operation;
  }

  function scheduleActiveFinalize(reason) {
    const operation = transitionTail.then(() =>
      activeSession === null
        ? null
        : finalizeSession(activeSession, reason)
    );
    transitionTail = operation.catch((error) => {
      if (error?.cause?.code !== RESPONSE_ERROR_CODES.COLLECTION_PAUSED) {
        lifecycle = "degraded";
        emitStatus(
          "degraded",
          `${siteLabel} Session 结算降级：${error.message}`
        );
      }
      return null;
    });
    return operation;
  }

  function handleVisibilityChange() {
    if (
      runtimeDocument.hidden === true &&
      activeSession !== null &&
      !activeSession.finalized &&
      collectionEnabled
    ) {
      reportBackgroundWrite(
        flushSessionSignals(activeSession),
        `${siteLabel} 页面隐藏信号`
      );
    }
  }

  function handlePageExit() {
    if (activeSession !== null && !activeSession.finalized) {
      reportBackgroundWrite(
        scheduleActiveFinalize("页面隐藏或卸载"),
        `${siteLabel} 页面结算`
      );
    }
  }

  async function start() {
    if (lifecycle !== "idle") {
      throw new RuntimeError(`${siteLabel} Runtime 已经启动或结束。`);
    }
    lifecycle = "starting";
    runtimeDocument.addEventListener("visibilitychange", handleVisibilityChange);
    pageLifecycle.addEventListener("pagehide", handlePageExit);
    pageLifecycle.addEventListener("beforeunload", handlePageExit);

    try {
      observerCleanup = adapter.observeChanges(() => {
        if (!disposed) {
          reportBackgroundWrite(
            scheduleReconcile("DOM 或 SPA 变化"),
            `${siteLabel} 页面变化`
          );
        }
      });
    } catch (error) {
      lifecycle = "degraded";
      emitStatus(
        "degraded",
        `${siteLabel} Adapter 无法观察页面：${error.message}`
      );
      return null;
    }

    try {
      return await scheduleReconcile("首次加载");
    } catch (error) {
      if (error?.cause?.code === RESPONSE_ERROR_CODES.COLLECTION_PAUSED) {
        return null;
      }
      lifecycle = "degraded";
      emitStatus(
        "degraded",
        `${siteLabel} Runtime 启动降级：${error.message}`
      );
      return null;
    }
  }

  function cleanup() {
    if (disposed) {
      return;
    }
    disposed = true;
    lifecycle = "cleaning";
    observerCleanup();
    observerCleanup = () => {};
    runtimeDocument.removeEventListener(
      "visibilitychange",
      handleVisibilityChange
    );
    pageLifecycle.removeEventListener("pagehide", handlePageExit);
    pageLifecycle.removeEventListener("beforeunload", handlePageExit);
    if (activeSession !== null) {
      cleanupCollectorGroup(activeSession);
    }
    pendingBindings.clear();
    activeSession = null;
    lifecycle = "cleaned";
    emitStatus("cleaned", `${siteLabel} Runtime 已清理。`);
  }

  async function whenIdle() {
    await transitionTail;
    await writeTail;
  }

  return Object.freeze({
    start,
    cleanup,
    whenIdle,
    flushCurrentSignals() {
      return activeSession === null
        ? Promise.resolve(null)
        : flushSessionSignals(activeSession);
    },
    finalizeCurrentSession(reason = "显式结算") {
      return scheduleActiveFinalize(reason);
    },
    get lifecycle() {
      return lifecycle;
    },
    get activeSessionId() {
      return activeSession?.sessionId ?? null;
    }
  });
}

export function startSiteRuntime(options = {}) {
  const runtime = createSiteRuntime(options);
  void runtime.start();
  return runtime;
}
