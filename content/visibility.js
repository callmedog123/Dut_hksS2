// @ts-check

export const VISIBLE_RATIO_THRESHOLD = 0.5;

/**
 * @typedef {object} VisibilitySnapshot
 * @property {string} candidateId
 * @property {number} visibleMs
 */

/**
 * @typedef {object} ReturnCountSnapshot
 * @property {string} candidateId
 * @property {number} returnCount
 */

/**
 * Track aggregated visible time for registered Candidate elements.
 *
 * @param {{
 *   document?: Document,
 *   IntersectionObserver?: typeof IntersectionObserver,
 *   now?: () => number,
 *   onVisibleMsUpdated?: (snapshot: VisibilitySnapshot) => void,
 *   onReturnCountUpdated?: (snapshot: ReturnCountSnapshot) => void
 * }} [options]
 */
export function createVisibilityTracker(options = {}) {
  const trackerDocument = options.document ?? globalThis.document;
  const IntersectionObserverConstructor =
    options.IntersectionObserver ?? globalThis.IntersectionObserver;
  const now = options.now ?? (() => globalThis.performance.now());
  const onVisibleMsUpdated = options.onVisibleMsUpdated ?? (() => {});
  const onReturnCountUpdated = options.onReturnCountUpdated ?? (() => {});

  if (
    trackerDocument === undefined ||
    typeof trackerDocument.addEventListener !== "function" ||
    typeof trackerDocument.removeEventListener !== "function"
  ) {
    throw new TypeError("A document with visibility events is required.");
  }
  if (typeof IntersectionObserverConstructor !== "function") {
    throw new TypeError("IntersectionObserver is required.");
  }
  if (
    typeof now !== "function" ||
    typeof onVisibleMsUpdated !== "function" ||
    typeof onReturnCountUpdated !== "function"
  ) {
    throw new TypeError("Visibility tracker callbacks must be functions.");
  }

  const registrations = new Map();
  const candidateByElement = new WeakMap();
  const finalizedVisibleMs = new Map();
  const finalizedReturnCounts = new Map();
  let disposed = false;

  function readNow() {
    const timestamp = now();
    if (!Number.isFinite(timestamp)) {
      throw new TypeError("Visibility clock must return a finite number.");
    }
    return timestamp;
  }

  function emitSnapshot(state) {
    onVisibleMsUpdated({
      candidateId: state.candidateId,
      visibleMs: state.visibleMs
    });
  }

  function settleVisibleInterval(state, timestamp) {
    if (state.visibleStartedAt === null) {
      return;
    }

    const elapsedMs = Math.max(0, timestamp - state.visibleStartedAt);
    state.visibleStartedAt = null;
    if (elapsedMs === 0) {
      return;
    }

    state.visibleMs += elapsedMs;
    emitSnapshot(state);
  }

  function updateActiveInterval(state, shouldBeVisible, timestamp) {
    if (shouldBeVisible && state.visibleStartedAt === null) {
      state.visibleStartedAt = timestamp;
      return;
    }

    if (!shouldBeVisible) {
      settleVisibleInterval(state, timestamp);
    }
  }

  function updateReturnCount(state, nextMeetsThreshold) {
    if (!nextMeetsThreshold || state.meetsThreshold) {
      return;
    }

    if (!state.hasEnteredViewport) {
      state.hasEnteredViewport = true;
      return;
    }

    state.returnCount += 1;
    onReturnCountUpdated({
      candidateId: state.candidateId,
      returnCount: state.returnCount
    });
  }

  const observer = new IntersectionObserverConstructor(
    (entries) => {
      if (disposed) {
        return;
      }

      const timestamp = readNow();
      for (const entry of entries) {
        const candidateId = candidateByElement.get(entry.target);
        if (candidateId === undefined) {
          continue;
        }

        const state = registrations.get(candidateId);
        if (state === undefined) {
          continue;
        }

        const nextMeetsThreshold = Boolean(
          entry.isIntersecting &&
            entry.intersectionRatio >= VISIBLE_RATIO_THRESHOLD
        );
        updateReturnCount(state, nextMeetsThreshold);
        state.meetsThreshold = nextMeetsThreshold;
        updateActiveInterval(
          state,
          !trackerDocument.hidden && state.meetsThreshold,
          timestamp
        );
      }
    },
    { threshold: [0, VISIBLE_RATIO_THRESHOLD] }
  );

  function handleVisibilityChange() {
    if (disposed) {
      return;
    }

    const timestamp = readNow();
    for (const state of registrations.values()) {
      updateActiveInterval(
        state,
        !trackerDocument.hidden && state.meetsThreshold,
        timestamp
      );
    }
  }

  trackerDocument.addEventListener(
    "visibilitychange",
    handleVisibilityChange
  );

  /**
   * @param {string} candidateId
   * @param {Element} element
   * @returns {() => VisibilitySnapshot | null}
   */
  function registerCandidate(candidateId, element) {
    if (disposed) {
      throw new Error("Visibility tracker has already been cleaned up.");
    }
    if (typeof candidateId !== "string" || candidateId.length === 0) {
      throw new TypeError("candidateId must be a non-empty string.");
    }
    if (
      (typeof element !== "object" || element === null) &&
      typeof element !== "function"
    ) {
      throw new TypeError("Candidate element must be an object.");
    }

    const existingState = registrations.get(candidateId);
    if (existingState !== undefined) {
      if (existingState.element !== element) {
        throw new Error(`Candidate ${candidateId} is already registered.`);
      }
      return existingState.unregister;
    }

    const elementCandidateId = candidateByElement.get(element);
    if (elementCandidateId !== undefined) {
      throw new Error(
        `Candidate element is already registered as ${elementCandidateId}.`
      );
    }
    if (finalizedVisibleMs.has(candidateId)) {
      throw new Error(`Candidate ${candidateId} has already been finalized.`);
    }

    const state = {
      candidateId,
      element,
      visibleMs: 0,
      visibleStartedAt: null,
      meetsThreshold: false,
      hasEnteredViewport: false,
      returnCount: 0,
      unregister: () => unregisterCandidate(candidateId)
    };
    registrations.set(candidateId, state);
    candidateByElement.set(element, candidateId);
    observer.observe(element);
    return state.unregister;
  }

  /**
   * Settle and remove one Candidate, for example when its DOM node disappears.
   *
   * @param {string} candidateId
   * @returns {VisibilitySnapshot | null}
   */
  function unregisterCandidate(candidateId) {
    const state = registrations.get(candidateId);
    if (state === undefined) {
      return finalizedVisibleMs.has(candidateId)
        ? { candidateId, visibleMs: finalizedVisibleMs.get(candidateId) }
        : null;
    }

    settleVisibleInterval(state, readNow());
    observer.unobserve(state.element);
    registrations.delete(candidateId);
    candidateByElement.delete(state.element);
    finalizedVisibleMs.set(candidateId, state.visibleMs);
    finalizedReturnCounts.set(candidateId, state.returnCount);
    return { candidateId, visibleMs: state.visibleMs };
  }

  /**
   * Read the aggregate without ending a currently visible interval.
   *
   * @param {string} candidateId
   * @returns {number | null}
   */
  function getVisibleMs(candidateId) {
    const state = registrations.get(candidateId);
    if (state !== undefined) {
      const activeElapsed =
        state.visibleStartedAt === null
          ? 0
          : Math.max(0, readNow() - state.visibleStartedAt);
      return state.visibleMs + activeElapsed;
    }

    return finalizedVisibleMs.get(candidateId) ?? null;
  }

  /**
   * Read how many times a Candidate re-entered after its first viewport entry.
   *
   * @param {string} candidateId
   * @returns {number | null}
   */
  function getReturnCount(candidateId) {
    const state = registrations.get(candidateId);
    if (state !== undefined) {
      return state.returnCount;
    }

    return finalizedReturnCounts.get(candidateId) ?? null;
  }

  function snapshotFinalized() {
    return [...finalizedVisibleMs].map(([candidateId, visibleMs]) => ({
      candidateId,
      visibleMs
    }));
  }

  function stopTracking() {
    if (disposed) {
      return snapshotFinalized();
    }

    const timestamp = readNow();
    for (const state of registrations.values()) {
      settleVisibleInterval(state, timestamp);
      finalizedVisibleMs.set(state.candidateId, state.visibleMs);
      finalizedReturnCounts.set(state.candidateId, state.returnCount);
      candidateByElement.delete(state.element);
    }
    registrations.clear();
    disposed = true;
    observer.disconnect();
    trackerDocument.removeEventListener(
      "visibilitychange",
      handleVisibilityChange
    );
    return snapshotFinalized();
  }

  return Object.freeze({
    registerCandidate,
    unregisterCandidate,
    getVisibleMs,
    getReturnCount,
    endSession: stopTracking,
    cleanup: stopTracking
  });
}
