// @ts-check

import { isSessionOwnerV1 } from "../shared/types.js";

export class SessionOwnerError extends Error {
  constructor(message) {
    super(message);
    this.name = "SessionOwnerError";
    this.code = "SESSION_OWNER_INVALID";
  }
}

/**
 * Derive ownership only from Chrome's trusted MessageSender plus the validated
 * Session ID already present in the message payload.
 *
 * @param {unknown} sender
 * @param {unknown} sessionId
 * @returns {import("../shared/types.js").SessionOwnerV1}
 */
export function createSessionOwnerFromSender(sender, sessionId) {
  const owner = {
    tabId: sender?.tab?.id,
    documentId: sender?.documentId,
    frameId: sender?.frameId,
    sessionId
  };
  if (!isSessionOwnerV1(owner)) {
    throw new SessionOwnerError(
      "Session writes require tabId, documentId, frameId, and sessionId from MessageSender."
    );
  }
  if (owner.frameId !== 0) {
    throw new SessionOwnerError(
      "Session writes are accepted only from the main frame."
    );
  }
  return Object.freeze(owner);
}
