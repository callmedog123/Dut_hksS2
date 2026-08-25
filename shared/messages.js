// @ts-check

import { SCHEMA_VERSION } from "./types.js";

export { SCHEMA_VERSION, SCHEMA_VERSION as MESSAGE_SCHEMA_VERSION };

export const MESSAGE_TYPES = Object.freeze({
  CANDIDATE_CHOSEN: "CANDIDATE_CHOSEN",
  PING: "PING",
  PONG: "PONG"
});

/**
 * @typedef {object} PingMessageV1
 * @property {typeof SCHEMA_VERSION} schemaVersion
 * @property {typeof MESSAGE_TYPES.PING} type
 * @property {string} requestId
 * @property {{source: string, sentAt: number}} payload
 */

/**
 * @typedef {object} PongMessageV1
 * @property {typeof SCHEMA_VERSION} schemaVersion
 * @property {typeof MESSAGE_TYPES.PONG} type
 * @property {string} requestId
 * @property {{
 *   requestSource: string,
 *   responder: string,
 *   receivedSentAt: number,
 *   respondedAt: number
 * }} payload
 */

/**
 * @typedef {object} CandidateChosenMessageV1
 * @property {typeof SCHEMA_VERSION} schemaVersion
 * @property {typeof MESSAGE_TYPES.CANDIDATE_CHOSEN} type
 * @property {string} requestId
 * @property {{
 *   candidateId: string,
 *   sessionId: string,
 *   clicked: true,
 *   chosenAt: number
 * }} payload
 */

const MESSAGE_ENVELOPE_KEYS = Object.freeze([
  "schemaVersion",
  "type",
  "requestId",
  "payload"
]);
const PING_PAYLOAD_KEYS = Object.freeze(["source", "sentAt"]);
const PONG_PAYLOAD_KEYS = Object.freeze([
  "requestSource",
  "responder",
  "receivedSentAt",
  "respondedAt"
]);
const CANDIDATE_CHOSEN_PAYLOAD_KEYS = Object.freeze([
  "candidateId",
  "sessionId",
  "clicked",
  "chosenAt"
]);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  if (!isRecord(value)) {
    return false;
  }

  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.hasOwn(value, key))
  );
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function hasValidEnvelope(message, type) {
  return Boolean(
    hasExactKeys(message, MESSAGE_ENVELOPE_KEYS) &&
      message.schemaVersion === SCHEMA_VERSION &&
      message.type === type &&
      isNonEmptyString(message.requestId) &&
      isRecord(message.payload)
  );
}

function createRequestId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `request-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function requireRequestId(value, label) {
  if (!isNonEmptyString(value)) {
    throw new TypeError(`${label} requestId must be a non-empty string.`);
  }
  return value;
}

/**
 * @param {string} source
 * @param {{requestId?: string, sentAt?: number}} [options]
 * @returns {PingMessageV1}
 */
export function createPingMessage(source, options = {}) {
  if (!isRecord(options)) {
    throw new TypeError("PING options must be an object.");
  }
  if (!isNonEmptyString(source)) {
    throw new TypeError("Ping source must be a non-empty string.");
  }

  const requestId = requireRequestId(
    Object.hasOwn(options, "requestId")
      ? options.requestId
      : createRequestId(),
    "PING"
  );
  const sentAt = Object.hasOwn(options, "sentAt")
    ? options.sentAt
    : Date.now();
  if (!isFiniteNumber(sentAt)) {
    throw new TypeError("PING sentAt must be finite.");
  }

  const message = {
    schemaVersion: SCHEMA_VERSION,
    type: MESSAGE_TYPES.PING,
    requestId,
    payload: { source, sentAt }
  };
  if (!isPingMessage(message)) {
    throw new TypeError("Failed to create a valid PING message.");
  }
  return message;
}

/**
 * @param {unknown} message
 * @returns {message is PingMessageV1}
 */
export function isPingMessage(message) {
  return Boolean(
    hasValidEnvelope(message, MESSAGE_TYPES.PING) &&
      hasExactKeys(message.payload, PING_PAYLOAD_KEYS) &&
      isNonEmptyString(message.payload.source) &&
      isFiniteNumber(message.payload.sentAt)
  );
}

/**
 * @param {PingMessageV1} ping
 * @param {string} responder
 * @param {number} [respondedAt]
 * @returns {PongMessageV1}
 */
export function createPongMessage(
  ping,
  responder,
  respondedAt = Date.now()
) {
  if (!isPingMessage(ping)) {
    throw new TypeError("Cannot create PONG from an invalid PING message.");
  }
  if (!isNonEmptyString(responder)) {
    throw new TypeError("Pong responder must be a non-empty string.");
  }
  if (!isFiniteNumber(respondedAt)) {
    throw new TypeError("PONG respondedAt must be finite.");
  }

  const message = {
    schemaVersion: SCHEMA_VERSION,
    type: MESSAGE_TYPES.PONG,
    requestId: ping.requestId,
    payload: {
      requestSource: ping.payload.source,
      responder,
      receivedSentAt: ping.payload.sentAt,
      respondedAt
    }
  };
  if (!isPongMessage(message)) {
    throw new TypeError("Failed to create a valid PONG message.");
  }
  return message;
}

/**
 * @param {unknown} message
 * @returns {message is PongMessageV1}
 */
export function isPongMessage(message) {
  return Boolean(
    hasValidEnvelope(message, MESSAGE_TYPES.PONG) &&
      hasExactKeys(message.payload, PONG_PAYLOAD_KEYS) &&
      isNonEmptyString(message.payload.requestSource) &&
      isNonEmptyString(message.payload.responder) &&
      isFiniteNumber(message.payload.receivedSentAt) &&
      isFiniteNumber(message.payload.respondedAt)
  );
}

/**
 * Preserve the existing candidate/chosenAt call shape; requestId is an
 * optional third argument so the click collector remains source-compatible.
 *
 * @param {{id: string, sessionId: string}} candidate
 * @param {number} [chosenAt]
 * @param {string} [requestId]
 * @returns {CandidateChosenMessageV1}
 */
export function createCandidateChosenMessage(
  candidate,
  chosenAt = Date.now(),
  requestId = createRequestId()
) {
  if (
    !candidate ||
    !isNonEmptyString(candidate.id) ||
    !isNonEmptyString(candidate.sessionId)
  ) {
    throw new TypeError(
      "CANDIDATE_CHOSEN requires non-empty candidate and session IDs."
    );
  }
  if (!isFiniteNumber(chosenAt)) {
    throw new TypeError("CANDIDATE_CHOSEN chosenAt must be finite.");
  }
  requireRequestId(requestId, "CANDIDATE_CHOSEN");

  const message = {
    schemaVersion: SCHEMA_VERSION,
    type: MESSAGE_TYPES.CANDIDATE_CHOSEN,
    requestId,
    payload: {
      candidateId: candidate.id,
      sessionId: candidate.sessionId,
      clicked: true,
      chosenAt
    }
  };
  if (!isCandidateChosenMessage(message)) {
    throw new TypeError("Failed to create a valid CANDIDATE_CHOSEN message.");
  }
  return message;
}

/**
 * @param {unknown} message
 * @returns {message is CandidateChosenMessageV1}
 */
export function isCandidateChosenMessage(message) {
  return Boolean(
    hasValidEnvelope(message, MESSAGE_TYPES.CANDIDATE_CHOSEN) &&
      hasExactKeys(message.payload, CANDIDATE_CHOSEN_PAYLOAD_KEYS) &&
      isNonEmptyString(message.payload.candidateId) &&
      isNonEmptyString(message.payload.sessionId) &&
      message.payload.clicked === true &&
      isFiniteNumber(message.payload.chosenAt)
  );
}
