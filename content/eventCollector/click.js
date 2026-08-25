// @ts-check

import { createCandidateChosenMessage } from "../../shared/messages.js";

/**
 * @typedef {import("../adapters/types.js").Candidate & {clicked?: boolean}} ClickableCandidate
 */

/**
 * Collect Candidate choices with one delegated listener pair on a shared root.
 * Candidate elements are registered explicitly, so this module contains no
 * site selectors and does not inspect page text.
 *
 * @param {{
 *   root?: EventTarget,
 *   now?: () => number,
 *   sendMessage?: (message: ReturnType<typeof createCandidateChosenMessage>) => unknown
 * }} [options]
 */
export function createCandidateClickCollector(options = {}) {
  const root = options.root ?? globalThis.document;
  const now = options.now ?? (() => Date.now());
  const sendMessage =
    options.sendMessage ??
    ((message) => globalThis.chrome.runtime.sendMessage(message));

  if (
    root === undefined ||
    typeof root.addEventListener !== "function" ||
    typeof root.removeEventListener !== "function"
  ) {
    throw new TypeError("Click collector requires an event root.");
  }
  if (typeof now !== "function" || typeof sendMessage !== "function") {
    throw new TypeError("Click collector callbacks must be functions.");
  }

  const registrations = new Map();
  const candidateByElement = new WeakMap();
  const clickedCandidateKeys = new Set();
  let disposed = false;

  function candidateKey(candidate) {
    return JSON.stringify([candidate.sessionId, candidate.id]);
  }

  function readNow() {
    const timestamp = now();
    if (!Number.isFinite(timestamp)) {
      throw new TypeError("Click collector clock must return a finite number.");
    }
    return timestamp;
  }

  function isChoiceEvent(event) {
    return Boolean(
      (event.type === "click" && event.button === 0) ||
        (event.type === "auxclick" && event.button === 1)
    );
  }

  function findRegistration(target) {
    let current =
      (typeof target === "object" && target !== null) ||
      typeof target === "function"
        ? target
        : null;
    let matchedRegistration = null;

    while (current !== null) {
      matchedRegistration ??= candidateByElement.get(current) ?? null;
      if (current === root) {
        return matchedRegistration;
      }
      current = current.parentNode ?? null;
    }

    return null;
  }

  function handleChoice(event) {
    if (disposed || !isChoiceEvent(event)) {
      return;
    }

    const registration = findRegistration(event.target);
    if (registration === null || registration.clicked) {
      return;
    }

    registration.clicked = true;
    registration.candidate.clicked = true;
    clickedCandidateKeys.add(registration.key);
    sendMessage(
      createCandidateChosenMessage(registration.candidate, readNow())
    );
  }

  root.addEventListener("click", handleChoice);
  root.addEventListener("auxclick", handleChoice);

  /**
   * Register a current or dynamically added Candidate card without attaching
   * listeners to the card itself.
   *
   * @param {ClickableCandidate} candidate
   * @param {object} element
   * @returns {() => void}
   */
  function registerCandidate(candidate, element) {
    if (disposed) {
      throw new Error("Click collector has already been cleaned up.");
    }
    if (
      !candidate ||
      typeof candidate.id !== "string" ||
      candidate.id.length === 0 ||
      typeof candidate.sessionId !== "string" ||
      candidate.sessionId.length === 0
    ) {
      throw new TypeError("Candidate requires non-empty id and sessionId.");
    }
    if (
      (typeof element !== "object" || element === null) &&
      typeof element !== "function"
    ) {
      throw new TypeError("Candidate element must be an object.");
    }

    const key = candidateKey(candidate);
    const existingRegistration = registrations.get(key);
    if (existingRegistration !== undefined) {
      if (existingRegistration.element !== element) {
        throw new Error(`Candidate ${candidate.id} is already registered.`);
      }
      return existingRegistration.unregister;
    }

    const elementRegistration = candidateByElement.get(element);
    if (elementRegistration !== undefined) {
      throw new Error(
        `Candidate element is already registered as ${elementRegistration.candidate.id}.`
      );
    }

    const alreadyClicked =
      clickedCandidateKeys.has(key) || candidate.clicked === true;
    if (alreadyClicked) {
      clickedCandidateKeys.add(key);
      candidate.clicked = true;
    }

    const registration = {
      key,
      candidate,
      element,
      clicked: alreadyClicked,
      unregister: () => unregisterCandidate(key)
    };
    registrations.set(key, registration);
    candidateByElement.set(element, registration);
    return registration.unregister;
  }

  function unregisterCandidate(key) {
    const registration = registrations.get(key);
    if (registration === undefined) {
      return;
    }

    registrations.delete(key);
    candidateByElement.delete(registration.element);
  }

  function cleanup() {
    if (disposed) {
      return;
    }

    disposed = true;
    root.removeEventListener("click", handleChoice);
    root.removeEventListener("auxclick", handleChoice);
    for (const registration of registrations.values()) {
      candidateByElement.delete(registration.element);
    }
    registrations.clear();
  }

  return Object.freeze({
    registerCandidate,
    cleanup
  });
}
