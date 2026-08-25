export const MESSAGE_SCHEMA_VERSION = 1;

export const MESSAGE_TYPES = Object.freeze({
  PING: "PING",
  PONG: "PONG"
});

function createRequestId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `ping-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createPingMessage(source, options = {}) {
  if (typeof source !== "string" || source.length === 0) {
    throw new TypeError("Ping source must be a non-empty string.");
  }

  return {
    schemaVersion: MESSAGE_SCHEMA_VERSION,
    type: MESSAGE_TYPES.PING,
    requestId: options.requestId ?? createRequestId(),
    payload: {
      source,
      sentAt: options.sentAt ?? Date.now()
    }
  };
}

export function isPingMessage(message) {
  return Boolean(
    message &&
      message.schemaVersion === MESSAGE_SCHEMA_VERSION &&
      message.type === MESSAGE_TYPES.PING &&
      typeof message.requestId === "string" &&
      message.requestId.length > 0 &&
      typeof message.payload?.source === "string" &&
      message.payload.source.length > 0 &&
      Number.isFinite(message.payload.sentAt)
  );
}

export function createPongMessage(ping, responder, respondedAt = Date.now()) {
  if (!isPingMessage(ping)) {
    throw new TypeError("Cannot create PONG from an invalid PING message.");
  }

  if (typeof responder !== "string" || responder.length === 0) {
    throw new TypeError("Pong responder must be a non-empty string.");
  }

  return {
    schemaVersion: MESSAGE_SCHEMA_VERSION,
    type: MESSAGE_TYPES.PONG,
    requestId: ping.requestId,
    payload: {
      requestSource: ping.payload.source,
      responder,
      receivedSentAt: ping.payload.sentAt,
      respondedAt
    }
  };
}

export function isPongMessage(message) {
  return Boolean(
    message &&
      message.schemaVersion === MESSAGE_SCHEMA_VERSION &&
      message.type === MESSAGE_TYPES.PONG &&
      typeof message.requestId === "string" &&
      message.requestId.length > 0 &&
      typeof message.payload?.requestSource === "string" &&
      typeof message.payload?.responder === "string" &&
      Number.isFinite(message.payload?.receivedSentAt) &&
      Number.isFinite(message.payload?.respondedAt)
  );
}
