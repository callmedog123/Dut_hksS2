// @ts-check

import { isCandidateV1 } from "../shared/types.js";

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isElementLike(value) {
  return typeof value === "object" && value !== null;
}

function bindingKey(candidate) {
  return JSON.stringify([candidate.sessionId, candidate.id]);
}

function validateBinding(binding) {
  if (
    !isRecord(binding) ||
    Object.keys(binding).length !== 2 ||
    !Object.hasOwn(binding, "candidate") ||
    !Object.hasOwn(binding, "element") ||
    !isCandidateV1(binding.candidate) ||
    !isElementLike(binding.element)
  ) {
    throw new TypeError(
      "Candidate binding must contain one valid Candidate and DOM Element."
    );
  }
}

/**
 * Keep Candidate/Element identity entirely in page memory. Adapters replace
 * the registry with each scan, making removal and DOM replacement explicit
 * without adding Element fields to shared Candidate data.
 *
 * @param {{
 *   onBound?: (binding: import("./adapters/types.js").CandidateBinding) => void,
 *   onUnbound?: (binding: import("./adapters/types.js").CandidateBinding) => void
 * }} [options]
 */
export function createCandidateBindingRegistry(options = {}) {
  if (!isRecord(options)) {
    throw new TypeError("Candidate binding options must be an object.");
  }
  const onBound = options.onBound ?? (() => {});
  const onUnbound = options.onUnbound ?? (() => {});
  if (typeof onBound !== "function" || typeof onUnbound !== "function") {
    throw new TypeError("Candidate binding callbacks must be functions.");
  }

  /** @type {Map<string, import("./adapters/types.js").CandidateBinding>} */
  let activeBindings = new Map();

  return Object.freeze({
    /**
     * Synchronize one complete Adapter scan with current bindings.
     *
     * @param {import("./adapters/types.js").CandidateBinding[]} bindings
     */
    sync(bindings) {
      if (!Array.isArray(bindings)) {
        throw new TypeError("Candidate bindings must be an array.");
      }

      const nextBindings = new Map();
      const nextElements = new Set();
      for (const binding of bindings) {
        validateBinding(binding);
        const key = bindingKey(binding.candidate);
        if (nextBindings.has(key)) {
          throw new TypeError(
            `Duplicate Candidate binding: ${binding.candidate.id}`
          );
        }
        if (nextElements.has(binding.element)) {
          throw new TypeError(
            "One DOM Element cannot represent multiple Candidates."
          );
        }
        nextBindings.set(key, binding);
        nextElements.add(binding.element);
      }

      const unbound = [];
      const bound = [];
      for (const [key, previous] of activeBindings) {
        const next = nextBindings.get(key);
        if (next === undefined || next.element !== previous.element) {
          unbound.push(previous);
        }
      }
      for (const [key, next] of nextBindings) {
        const previous = activeBindings.get(key);
        if (previous === undefined || previous.element !== next.element) {
          bound.push(next);
        }
      }

      activeBindings = nextBindings;
      for (const binding of unbound) {
        onUnbound(binding);
      }
      for (const binding of bound) {
        onBound(binding);
      }

      return Object.freeze({
        bound: Object.freeze([...bound]),
        unbound: Object.freeze([...unbound])
      });
    },

    /** Remove all active bindings while keeping the registry reusable. */
    clear() {
      if (activeBindings.size === 0) {
        return 0;
      }
      const previous = [...activeBindings.values()];
      activeBindings = new Map();
      for (const binding of previous) {
        onUnbound(binding);
      }
      return previous.length;
    },

    /**
     * @param {string} sessionId
     * @param {string} candidateId
     */
    getBinding(sessionId, candidateId) {
      return activeBindings.get(
        JSON.stringify([sessionId, candidateId])
      ) ?? null;
    },

    get size() {
      return activeBindings.size;
    }
  });
}
