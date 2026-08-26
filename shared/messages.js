// @ts-check

import { SCHEMA_VERSION, isSearchContextV1 } from "./types.js";

export { SCHEMA_VERSION, SCHEMA_VERSION as MESSAGE_SCHEMA_VERSION };

export const MESSAGE_TYPES = Object.freeze({
  CANDIDATE_CHOSEN: "CANDIDATE_CHOSEN",
  MISSED_PATHS_QUERY: "MISSED_PATHS_QUERY",
  PING: "PING",
  PONG: "PONG",
  RE_ENCOUNTER_QUERY: "RE_ENCOUNTER_QUERY"
});

export const RESPONSE_ERROR_CODES = Object.freeze({
  INVALID_REQUEST: "INVALID_REQUEST",
  REENCOUNTER_QUERY_FAILED: "REENCOUNTER_QUERY_FAILED",
  SCHEMA_VERSION_UNSUPPORTED: "SCHEMA_VERSION_UNSUPPORTED",
  STORAGE_ERROR: "STORAGE_ERROR"
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
 * @typedef {object} MissedPathsQueryMessageV1
 * @property {typeof SCHEMA_VERSION} schemaVersion
 * @property {typeof MESSAGE_TYPES.MISSED_PATHS_QUERY} type
 * @property {string} requestId
 * @property {Record<string, never>} payload
 */

/**
 * @typedef {object} ReencounterQueryMessageV1
 * @property {typeof SCHEMA_VERSION} schemaVersion
 * @property {typeof MESSAGE_TYPES.RE_ENCOUNTER_QUERY} type
 * @property {string} requestId
 * @property {{
 *   context: import("./types.js").SearchContextV1,
 *   limit: number
 * }} payload
 */

/**
 * @template T
 * @typedef {{
 *   schemaVersion: typeof SCHEMA_VERSION,
 *   requestId: string,
 *   ok: true,
 *   data: T
 * } | {
 *   schemaVersion: typeof SCHEMA_VERSION,
 *   requestId: string,
 *   ok: false,
 *   error: {code: string, message: string, retryable: boolean}
 * }} ResponseMessage
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
const REENCOUNTER_QUERY_PAYLOAD_KEYS = Object.freeze([
  "context",
  "limit"
]);
const SUCCESS_RESPONSE_KEYS = Object.freeze([
  "schemaVersion",
  "requestId",
  "ok",
  "data"
]);
const ERROR_RESPONSE_KEYS = Object.freeze([
  "schemaVersion",
  "requestId",
  "ok",
  "error"
]);
const RESPONSE_ERROR_KEYS = Object.freeze([
  "code",
  "message",
  "retryable"
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

/**
 * @param {string} [requestId]
 * @returns {MissedPathsQueryMessageV1}
 */
export function createMissedPathsQueryMessage(requestId = createRequestId()) {
  requireRequestId(requestId, "MISSED_PATHS_QUERY");
  const message = {
    schemaVersion: SCHEMA_VERSION,
    type: MESSAGE_TYPES.MISSED_PATHS_QUERY,
    requestId,
    payload: {}
  };
  if (!isMissedPathsQueryMessage(message)) {
    throw new TypeError("Failed to create a valid MISSED_PATHS_QUERY message.");
  }
  return message;
}

/**
 * @param {unknown} message
 * @returns {message is MissedPathsQueryMessageV1}
 */
export function isMissedPathsQueryMessage(message) {
  return Boolean(
    hasValidEnvelope(message, MESSAGE_TYPES.MISSED_PATHS_QUERY) &&
      hasExactKeys(message.payload, [])
  );
}

/**
 * @param {import("./types.js").SearchContextV1} context
 * @param {number} limit
 * @param {string} [requestId]
 * @returns {ReencounterQueryMessageV1}
 */
export function createReencounterQueryMessage(
  context,
  limit,
  requestId = createRequestId()
) {
  requireRequestId(requestId, "RE_ENCOUNTER_QUERY");
  const message = {
    schemaVersion: SCHEMA_VERSION,
    type: MESSAGE_TYPES.RE_ENCOUNTER_QUERY,
    requestId,
    payload: { context, limit }
  };
  if (!isReencounterQueryMessage(message)) {
    throw new TypeError("Failed to create a valid RE_ENCOUNTER_QUERY message.");
  }
  return message;
}

/**
 * @param {unknown} message
 * @returns {message is ReencounterQueryMessageV1}
 */
export function isReencounterQueryMessage(message) {
  return Boolean(
    hasValidEnvelope(message, MESSAGE_TYPES.RE_ENCOUNTER_QUERY) &&
      hasExactKeys(message.payload, REENCOUNTER_QUERY_PAYLOAD_KEYS) &&
      isSearchContextV1(message.payload.context) &&
      Number.isInteger(message.payload.limit) &&
      message.payload.limit >= 1 &&
      message.payload.limit <= 3
  );
}

/**
 * @template T
 * @param {string} requestId
 * @param {T} data
 * @returns {ResponseMessage<T>}
 */
export function createSuccessResponseMessage(requestId, data) {
  requireRequestId(requestId, "Response");
  if (data === undefined) {
    throw new TypeError("Success response data must be defined.");
  }
  const response = {
    schemaVersion: SCHEMA_VERSION,
    requestId,
    ok: true,
    data
  };
  if (!isResponseMessage(response)) {
    throw new TypeError("Failed to create a valid success response.");
  }
  return response;
}

/**
 * @param {string} requestId
 * @param {{code: string, message: string, retryable: boolean}} error
 * @returns {ResponseMessage<never>}
 */
export function createErrorResponseMessage(requestId, error) {
  requireRequestId(requestId, "Response");
  const response = {
    schemaVersion: SCHEMA_VERSION,
    requestId,
    ok: false,
    error
  };
  if (!isResponseMessage(response)) {
    throw new TypeError("Failed to create a valid error response.");
  }
  return response;
}

/**
 * @param {unknown} message
 * @returns {message is ResponseMessage<unknown>}
 */
export function isResponseMessage(message) {
  if (!isRecord(message) || message.schemaVersion !== SCHEMA_VERSION) {
    return false;
  }
  if (!isNonEmptyString(message.requestId)) {
    return false;
  }
  if (message.ok === true) {
    return hasExactKeys(message, SUCCESS_RESPONSE_KEYS) &&
      message.data !== undefined;
  }
  return Boolean(
    message.ok === false &&
      hasExactKeys(message, ERROR_RESPONSE_KEYS) &&
      hasExactKeys(message.error, RESPONSE_ERROR_KEYS) &&
      isNonEmptyString(message.error.code) &&
      isNonEmptyString(message.error.message) &&
      typeof message.error.retryable === "boolean"
  );
}

/**
 * Validate the query-specific response data without duplicating Repository DTO
 * validation. Repository remains the authority for each MissedPath record.
 *
 * @param {unknown} message
 * @returns {boolean}
 */
export function isMissedPathsQueryResponse(message) {
  if (!isResponseMessage(message)) {
    return false;
  }
  if (message.ok === false) {
    return true;
  }
  return Boolean(
    hasExactKeys(message.data, ["missedPaths"]) &&
      Array.isArray(message.data.missedPaths)
  );
}

/**
 * @param {unknown} message
 * @returns {boolean}
 */
export function isReencounterQueryResponse(message) {
  if (!isResponseMessage(message)) {
    return false;
  }
  if (message.ok === false) {
    return true;
  }
  return Boolean(
    hasExactKeys(message.data, ["reencounters"]) &&
      Array.isArray(message.data.reencounters)
  );
}
