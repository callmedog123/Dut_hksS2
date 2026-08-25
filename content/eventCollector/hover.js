// @ts-check

/**
 * @typedef {object} HoverAggregate
 * @property {string} candidateId
 * @property {number} hoverMs
 * @property {number} hoverCount
 */

/**
 * Aggregate card-level hover intervals without retaining pointer events,
 * coordinates, or individual interval timestamps.
 *
 * @param {{
 *   now?: () => number,
 *   onHoverUpdated?: (aggregate: HoverAggregate) => void
 * }} [options]
 */
export function createHoverTracker(options = {}) {
  const now = options.now ?? (() => globalThis.performance.now());
  const onHoverUpdated = options.onHoverUpdated ?? (() => {});

  if (typeof now !== "function" || typeof onHoverUpdated !== "function") {
    throw new TypeError("Hover tracker callbacks must be functions.");
  }

  const registrations = new Map();
  const candidateByElement = new WeakMap();
  const finalizedAggregates = new Map();
  let disposed = false;

  function readNow() {
    const timestamp = now();
    if (!Number.isFinite(timestamp)) {
      throw new TypeError("Hover clock must return a finite number.");
    }
    return timestamp;
  }

  function toAggregate(state, activeTimestamp = null) {
    const activeMs =
      state.hoverStartedAt === null || activeTimestamp === null
        ? 0
        : Math.max(0, activeTimestamp - state.hoverStartedAt);

    return {
      candidateId: state.candidateId,
      hoverMs: state.hoverMs + activeMs,
      hoverCount: state.hoverCount
    };
  }

  function settleHoverInterval(state, timestamp) {
    if (state.hoverStartedAt === null) {
      return;
    }

    state.hoverMs += Math.max(0, timestamp - state.hoverStartedAt);
    state.hoverStartedAt = null;
    onHoverUpdated(toAggregate(state));
  }

  function snapshotFinalized() {
    return [...finalizedAggregates.values()].map((aggregate) => ({
      ...aggregate
    }));
  }

  /**
   * Register a Candidate card. This can be called as dynamic cards are added.
   * Re-registering the same Candidate and element reuses the existing cleanup.
   *
   * @param {string} candidateId
   * @param {{
   *   addEventListener: (type: string, listener: EventListener) => void,
   *   removeEventListener: (type: string, listener: EventListener) => void
   * }} element
   * @returns {() => HoverAggregate | null}
   */
  function registerCandidate(candidateId, element) {
    if (disposed) {
      throw new Error("Hover tracker has already been cleaned up.");
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
    if (
      typeof element.addEventListener !== "function" ||
      typeof element.removeEventListener !== "function"
    ) {
      throw new TypeError("Candidate element must support event listeners.");
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
    if (finalizedAggregates.has(candidateId)) {
      throw new Error(`Candidate ${candidateId} has already been finalized.`);
    }

    const state = {
      candidateId,
      element,
      hoverMs: 0,
      hoverCount: 0,
      hoverStartedAt: null,
      handleEnter: () => {
        if (state.hoverStartedAt !== null) {
          return;
        }
        state.hoverCount += 1;
        state.hoverStartedAt = readNow();
      },
      handleLeave: () => settleHoverInterval(state, readNow()),
      unregister: () => unregisterCandidate(candidateId)
    };

    registrations.set(candidateId, state);
    candidateByElement.set(element, candidateId);
    element.addEventListener("mouseenter", state.handleEnter);
    element.addEventListener("mouseleave", state.handleLeave);
    return state.unregister;
  }

  /**
   * Settle and remove one Candidate, for example when its card is removed.
   *
   * @param {string} candidateId
   * @returns {HoverAggregate | null}
   */
  function unregisterCandidate(candidateId) {
    const state = registrations.get(candidateId);
    if (state === undefined) {
      const finalized = finalizedAggregates.get(candidateId);
      return finalized === undefined ? null : { ...finalized };
    }

    settleHoverInterval(state, readNow());
    state.element.removeEventListener("mouseenter", state.handleEnter);
    state.element.removeEventListener("mouseleave", state.handleLeave);
    registrations.delete(candidateId);
    candidateByElement.delete(state.element);

    const aggregate = toAggregate(state);
    finalizedAggregates.set(candidateId, aggregate);
    return { ...aggregate };
  }

  /**
   * Read the cumulative aggregate without ending an active hover interval.
   *
   * @param {string} candidateId
   * @returns {HoverAggregate | null}
   */
  function getHoverAggregate(candidateId) {
    const state = registrations.get(candidateId);
    if (state !== undefined) {
      return toAggregate(state, readNow());
    }

    const finalized = finalizedAggregates.get(candidateId);
    return finalized === undefined ? null : { ...finalized };
  }

  function cleanup() {
    if (disposed) {
      return snapshotFinalized();
    }

    const timestamp = readNow();
    for (const state of registrations.values()) {
      settleHoverInterval(state, timestamp);
      state.element.removeEventListener("mouseenter", state.handleEnter);
      state.element.removeEventListener("mouseleave", state.handleLeave);
      candidateByElement.delete(state.element);
      finalizedAggregates.set(state.candidateId, toAggregate(state));
    }
    registrations.clear();
    disposed = true;
    return snapshotFinalized();
  }

  return Object.freeze({
    registerCandidate,
    unregisterCandidate,
    getHoverAggregate,
    cleanup
  });
}
