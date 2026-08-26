// @ts-check

import { createDemoAdapter } from "./adapters/demoAdapter.js";
import { createCandidateClickCollector } from "./eventCollector/click.js";
import { createHoverTracker } from "./eventCollector/hover.js";
import { createVisibilityTracker } from "./visibility.js";
import {
  MESSAGE_TYPES,
  createCandidatesDiscoveredMessage,
  createSessionFinalizeMessage,
  createSignalsUpdatedMessage,
  isCandidatesDiscoveredResponse,
  isResponseMessage,
  isSessionFinalizeResponse,
  isSignalsUpdatedResponse
} from "../shared/messages.js";

export const DEMO_SCENARIO_ADVANCE_MS = 12_000;
export const DEMO_SCENARIO_HOVER_MS = 3_000;
export const DEMO_SCENARIO_HOVER_COUNT = 4;

export class DemoRuntimeError extends Error {
  constructor(message, cause = null) {
    super(message);
    this.name = "DemoRuntimeError";
    this.cause = cause;
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function candidateKey(candidate) {
  return JSON.stringify([candidate.sessionId, candidate.id]);
}

function createDefaultMessageSender(runtime) {
  if (!isRecord(runtime) || typeof runtime.sendMessage !== "function") {
    throw new TypeError("Demo Runtime requires chrome.runtime.sendMessage().");
  }

  return (message) =>
    new Promise((resolve, reject) => {
      runtime.sendMessage(message, (response) => {
        const runtimeError = runtime.lastError;
        if (runtimeError) {
          reject(new DemoRuntimeError(runtimeError.message));
          return;
        }
        resolve(response);
      });
    });
}

function createEvent(eventFactory, type) {
  if (typeof eventFactory === "function") {
    return eventFactory(type);
  }
  return new Event(type);
}

/**
 * Compose the existing Demo Adapter, Candidate binding bridge and collectors
 * into one local-only Runtime. Persistence remains entirely behind extension
 * messages handled by the Service Worker.
 *
 * @param {{
 *   document?: Document,
 *   url?: URL,
 *   runtime?: object,
 *   sendMessage?: (message: object) => unknown,
 *   wallNow?: () => number,
 *   performanceNow?: () => number,
 *   MutationObserver?: typeof MutationObserver,
 *   IntersectionObserver?: typeof IntersectionObserver,
 *   eventFactory?: (type: string) => Event,
 *   waitForLayout?: () => Promise<void>,
 *   onStatus?: (status: {state: string, message: string, data?: unknown}) => void
 * }} [options]
 */
export function createDemoRuntime(options = {}) {
  if (!isRecord(options)) {
    throw new TypeError("Demo Runtime options must be an object.");
  }

  const runtimeDocument = options.document ?? globalThis.document;
  const runtimeUrl =
    options.url ?? new URL(runtimeDocument?.location?.href ?? globalThis.location.href);
  const wallNow = options.wallNow ?? (() => Date.now());
  const performanceNow =
    options.performanceNow ?? (() => globalThis.performance.now());
  const onStatus = options.onStatus ?? (() => {});
  const eventFactory = options.eventFactory;
  const waitForLayout =
    options.waitForLayout ??
    (() =>
      new Promise((resolve) => {
        if (typeof globalThis.requestAnimationFrame !== "function") {
          resolve();
          return;
        }
        globalThis.requestAnimationFrame(() => {
          globalThis.requestAnimationFrame(() => resolve());
        });
      }));
  const sendMessage =
    options.sendMessage ??
    createDefaultMessageSender(options.runtime ?? globalThis.chrome?.runtime);

  if (
    runtimeDocument === undefined ||
    !(runtimeUrl instanceof URL) ||
    typeof wallNow !== "function" ||
    typeof performanceNow !== "function" ||
    typeof onStatus !== "function" ||
    typeof waitForLayout !== "function" ||
    typeof sendMessage !== "function"
  ) {
    throw new TypeError("Demo Runtime dependencies are invalid.");
  }

  let virtualOffsetMs = 0;
  let lifecycle = "idle";
  let sessionId = "";
  let context = null;
  let observerCleanup = () => {};
  let finalizingPromise = null;
  let finalSignalsPersisted = false;
  let writeTail = Promise.resolve();

  const candidates = new Map();
  const candidateKeysById = new Map();
  const signalsByKey = new Map();
  const registrations = new Map();

  function readWallNow() {
    const timestamp = wallNow();
    if (!Number.isFinite(timestamp) || timestamp < 0) {
      throw new TypeError("Demo wall clock must return a finite non-negative number.");
    }
    return timestamp;
  }

  function readCollectorNow() {
    const timestamp = performanceNow() + virtualOffsetMs;
    if (!Number.isFinite(timestamp)) {
      throw new TypeError("Demo collector clock must return a finite number.");
    }
    return timestamp;
  }

  function emitStatus(state, message, data) {
    onStatus({
      state,
      message,
      ...(data === undefined ? {} : { data })
    });
  }

  function getSignalStateByCandidateId(candidateId) {
    const key = candidateKeysById.get(candidateId);
    return key === undefined ? null : signalsByKey.get(key) ?? null;
  }

  function ensureCandidateState(candidate) {
    const key = candidateKey(candidate);
    candidates.set(key, candidate);
    candidateKeysById.set(candidate.id, key);
    if (!signalsByKey.has(key)) {
      signalsByKey.set(key, {
        candidateId: candidate.id,
        sessionId: candidate.sessionId,
        visibleMs: 0,
        hoverMs: 0,
        hoverCount: 0,
        returnCount: 0,
        clicked: false
      });
    }
    return { key, signals: signalsByKey.get(key) };
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

  async function dispatchValidated(message, validator) {
    let response;
    try {
      response = await sendMessage(message);
    } catch (error) {
      throw new DemoRuntimeError(
        `发送 ${message.type} 失败。`,
        error
      );
    }

    if (!validator(response) || response.requestId !== message.requestId) {
      throw new DemoRuntimeError(`${message.type} 返回了无效响应。`);
    }
    if (response.ok !== true) {
      throw new DemoRuntimeError(
        `${message.type} 失败：${response.error.message}`,
        response.error
      );
    }
    return response;
  }

  function enqueueMessage(message, validator) {
    const operation = writeTail.then(() =>
      dispatchValidated(message, validator)
    );
    writeTail = operation.catch(() => undefined);
    return operation;
  }

  function enqueueSignals(state) {
    const message = createSignalsUpdatedMessage(
      snapshotSignals(state),
      readWallNow()
    );
    return enqueueMessage(message, isSignalsUpdatedResponse);
  }

  function reportBackgroundWrite(operation, label) {
    void operation.catch((error) => {
      emitStatus("error", `${label}同步失败：${error.message}`);
    });
  }

  const visibilityTracker = createVisibilityTracker({
    document: runtimeDocument,
    IntersectionObserver:
      options.IntersectionObserver ?? globalThis.IntersectionObserver,
    now: readCollectorNow,
    onVisibleMsUpdated({ candidateId, visibleMs }) {
      const state = getSignalStateByCandidateId(candidateId);
      if (state === null) {
        return;
      }
      state.visibleMs = Math.max(state.visibleMs, visibleMs);
      if (lifecycle === "collecting" || lifecycle === "finalizing") {
        reportBackgroundWrite(enqueueSignals(state), "可见时长");
      }
    },
    onReturnCountUpdated({ candidateId, returnCount }) {
      const state = getSignalStateByCandidateId(candidateId);
      if (state === null) {
        return;
      }
      state.returnCount = Math.max(state.returnCount, returnCount);
      if (lifecycle === "collecting" || lifecycle === "finalizing") {
        reportBackgroundWrite(enqueueSignals(state), "回访次数");
      }
    }
  });

  const hoverTracker = createHoverTracker({
    now: readCollectorNow,
    onHoverUpdated({ candidateId, hoverMs, hoverCount }) {
      const state = getSignalStateByCandidateId(candidateId);
      if (state === null) {
        return;
      }
      state.hoverMs = Math.max(state.hoverMs, hoverMs);
      state.hoverCount = Math.max(state.hoverCount, hoverCount);
      if (lifecycle === "collecting" || lifecycle === "finalizing") {
        reportBackgroundWrite(enqueueSignals(state), "悬停信号");
      }
    }
  });

  const clickCollector = createCandidateClickCollector({
    root: runtimeDocument,
    now: readWallNow,
    sendMessage(message) {
      const state = getSignalStateByCandidateId(message.payload.candidateId);
      if (state !== null) {
        state.clicked = true;
      }
      const chosenWrite = enqueueMessage(message, isResponseMessage);
      reportBackgroundWrite(chosenWrite, "选择状态");
      if (state !== null) {
        reportBackgroundWrite(enqueueSignals(state), "选择信号");
      }
      return chosenWrite;
    }
  });

  function onCandidateBound(binding) {
    const { key } = ensureCandidateState(binding.candidate);
    if (registrations.has(key)) {
      return;
    }

    registrations.set(key, {
      binding,
      unregisterVisibility: visibilityTracker.registerCandidate(
        binding.candidate.id,
        binding.element
      ),
      unregisterHover: hoverTracker.registerCandidate(
        binding.candidate.id,
        binding.element
      ),
      unregisterClick: clickCollector.registerCandidate(
        binding.candidate,
        binding.element
      )
    });
  }

  function onCandidateUnbound(binding) {
    const key = candidateKey(binding.candidate);
    const registration = registrations.get(key);
    if (registration === undefined) {
      return;
    }

    const visible = registration.unregisterVisibility();
    const hover = registration.unregisterHover();
    registration.unregisterClick();
    registrations.delete(key);

    const state = signalsByKey.get(key);
    if (state !== undefined) {
      if (visible !== null) {
        state.visibleMs = Math.max(state.visibleMs, visible.visibleMs);
      }
      const returnCount = visibilityTracker.getReturnCount(state.candidateId);
      if (returnCount !== null) {
        state.returnCount = Math.max(state.returnCount, returnCount);
      }
      if (hover !== null) {
        state.hoverMs = Math.max(state.hoverMs, hover.hoverMs);
        state.hoverCount = Math.max(state.hoverCount, hover.hoverCount);
      }
    }
  }

  const adapter = createDemoAdapter({
    document: runtimeDocument,
    MutationObserver: options.MutationObserver ?? globalThis.MutationObserver,
    onCandidateBound,
    onCandidateUnbound
  });

  function readCurrentCandidates() {
    const currentCandidates = adapter.extractCandidates(runtimeDocument);
    for (const candidate of currentCandidates) {
      ensureCandidateState(candidate);
    }
    return currentCandidates;
  }

  async function discoverCurrentCandidates() {
    const currentCandidates = readCurrentCandidates();
    if (currentCandidates.length === 0) {
      throw new DemoRuntimeError("Demo 页面没有可发现的候选项。");
    }

    const currentSessionId = currentCandidates[0].sessionId;
    if (
      currentCandidates.some(
        (candidate) => candidate.sessionId !== currentSessionId
      )
    ) {
      throw new DemoRuntimeError("Demo 候选项不属于同一个 Session。");
    }
    if (sessionId && sessionId !== currentSessionId) {
      throw new DemoRuntimeError("Demo Runtime 不允许在当前会话中切换 Session。");
    }
    sessionId = currentSessionId;
    context ??= adapter.getContext(runtimeDocument, runtimeUrl);

    const request = createCandidatesDiscoveredMessage(
      sessionId,
      context,
      currentCandidates,
      readWallNow()
    );
    return enqueueMessage(request, isCandidatesDiscoveredResponse);
  }

  async function sendFinalSignalSnapshots() {
    for (const state of signalsByKey.values()) {
      const visibleMs = visibilityTracker.getVisibleMs(state.candidateId);
      const returnCount = visibilityTracker.getReturnCount(state.candidateId);
      const hover = hoverTracker.getHoverAggregate(state.candidateId);
      if (visibleMs !== null) {
        state.visibleMs = Math.max(state.visibleMs, visibleMs);
      }
      if (returnCount !== null) {
        state.returnCount = Math.max(state.returnCount, returnCount);
      }
      if (hover !== null) {
        state.hoverMs = Math.max(state.hoverMs, hover.hoverMs);
        state.hoverCount = Math.max(state.hoverCount, hover.hoverCount);
      }
      await enqueueSignals(state);
    }
    finalSignalsPersisted = true;
  }

  function cleanupCollectors() {
    observerCleanup();
    observerCleanup = () => {};
    visibilityTracker.cleanup();
    hoverTracker.cleanup();
    clickCollector.cleanup();
  }

  async function start() {
    if (lifecycle !== "idle") {
      throw new DemoRuntimeError("Demo Runtime 已经启动或结束。");
    }
    if (!adapter.canHandle(runtimeUrl, runtimeDocument)) {
      throw new DemoRuntimeError("当前页面不是受支持的本地 Demo 页面。");
    }

    lifecycle = "starting";
    emitStatus("starting", "正在发现并写入本地 Demo 候选项……");
    try {
      const response = await discoverCurrentCandidates();
      observerCleanup = adapter.observeChanges(() => {
        if (lifecycle !== "collecting") {
          return;
        }
        reportBackgroundWrite(
          discoverCurrentCandidates(),
          "动态候选"
        );
      });
      lifecycle = "collecting";
      emitStatus(
        "ready",
        `Demo Runtime 已启动，当前发现 ${response.data.totalCandidateCount} 个候选项。`,
        response.data
      );
      return response.data;
    } catch (error) {
      lifecycle = "start-failed";
      cleanupCollectors();
      emitStatus("error", `Demo Runtime 启动失败：${error.message}`);
      throw error;
    }
  }

  async function advanceScenario(candidateId, advanceMs = DEMO_SCENARIO_ADVANCE_MS) {
    if (lifecycle !== "collecting") {
      throw new DemoRuntimeError("只有采集中的 Demo 会话可以推进场景。");
    }
    if (
      typeof candidateId !== "string" ||
      candidateId.length === 0 ||
      !Number.isFinite(advanceMs) ||
      advanceMs < DEMO_SCENARIO_HOVER_MS
    ) {
      throw new TypeError("推进场景需要候选 ID 和足够的有限模拟时长。");
    }

    emitStatus("advancing", "正在加入动态候选并推进模拟时间……");
    try {
      await discoverCurrentCandidates();
      const key = candidateKeysById.get(candidateId);
      const registration = key === undefined ? null : registrations.get(key);
      if (registration === null || registration === undefined) {
        throw new DemoRuntimeError(`找不到场景候选项：${candidateId}`);
      }
      if (typeof registration.binding.element.dispatchEvent !== "function") {
        throw new DemoRuntimeError("Demo 候选 Element 不支持场景事件。");
      }

      if (typeof registration.binding.element.scrollIntoView === "function") {
        registration.binding.element.scrollIntoView({ block: "center" });
      }
      await waitForLayout();

      const hoverStepMs =
        DEMO_SCENARIO_HOVER_MS / DEMO_SCENARIO_HOVER_COUNT;
      for (let index = 0; index < DEMO_SCENARIO_HOVER_COUNT; index += 1) {
        registration.binding.element.dispatchEvent(
          createEvent(eventFactory, "mouseenter")
        );
        virtualOffsetMs += hoverStepMs;
        registration.binding.element.dispatchEvent(
          createEvent(eventFactory, "mouseleave")
        );
      }
      virtualOffsetMs += advanceMs - DEMO_SCENARIO_HOVER_MS;

      for (const state of signalsByKey.values()) {
        const visibleMs = visibilityTracker.getVisibleMs(state.candidateId);
        if (visibleMs !== null) {
          state.visibleMs = Math.max(state.visibleMs, visibleMs);
        }
        await enqueueSignals(state);
      }

      const state = getSignalStateByCandidateId(candidateId);
      const data = {
        candidateId,
        advancedMs: advanceMs,
        signals: state === null ? null : snapshotSignals(state)
      };
      emitStatus(
        "advanced",
        `场景已推进 ${advanceMs / 1_000} 秒，绝对信号快照已写入。`,
        data
      );
      return data;
    } catch (error) {
      emitStatus("error", `推进场景失败：${error.message}`);
      throw error;
    }
  }

  async function performFinalize() {
    if (lifecycle === "finalized") {
      const repeated = await enqueueMessage(
        createSessionFinalizeMessage(sessionId, readWallNow()),
        isSessionFinalizeResponse
      );
      emitStatus("finalized", "会话已经结算，后台返回首次结算结果。", repeated.data);
      return repeated.data;
    }
    if (
      lifecycle !== "collecting" &&
      lifecycle !== "finalize-failed"
    ) {
      throw new DemoRuntimeError("当前 Demo 会话不能结束。");
    }

    lifecycle = "finalizing";
    emitStatus("finalizing", "正在结算最后信号并等待后台确认……");
    try {
      if (!finalSignalsPersisted) {
        cleanupCollectors();
        await sendFinalSignalSnapshots();
      }
      const response = await enqueueMessage(
        createSessionFinalizeMessage(sessionId, readWallNow()),
        isSessionFinalizeResponse
      );
      lifecycle = "finalized";
      emitStatus("finalized", "会话结算成功，Side Panel 可查询真实结果。", response.data);
      return response.data;
    } catch (error) {
      lifecycle = "finalize-failed";
      emitStatus("error", `会话结算失败：${error.message}`);
      throw error;
    }
  }

  function finalizeSession() {
    if (finalizingPromise !== null) {
      return finalizingPromise;
    }
    finalizingPromise = performFinalize().finally(() => {
      finalizingPromise = null;
    });
    return finalizingPromise;
  }

  function cleanup() {
    if (
      lifecycle === "cleaned" ||
      lifecycle === "finalized" ||
      lifecycle === "start-failed"
    ) {
      return;
    }
    cleanupCollectors();
    lifecycle = "cleaned";
    emitStatus("cleaned", "Demo Runtime 已清理。");
  }

  return Object.freeze({
    start,
    advanceScenario,
    finalizeSession,
    cleanup,
    whenIdle: () => writeTail,
    get lifecycle() {
      return lifecycle;
    }
  });
}
