import {
  MESSAGE_TYPES,
  RESPONSE_ERROR_CODES,
  SCHEMA_VERSION,
  createErrorResponseMessage,
  createPongMessage,
  createSchemaVersionUnsupportedResponse,
  createSuccessResponseMessage,
  isCandidateChosenMessage,
  isPingMessage
} from "../shared/messages.js";
import { createIndexedDbStorageAdapter } from "../storage/indexedDbStorageAdapter.js";
import { createRepository } from "../storage/repository.js";
import { createMessageRouter } from "./messageRouter.js";
import { createSessionFinalizeUseCase } from "./sessionFinalize.js";
import { createSessionManager } from "./sessionManager.js";
import { createSessionRecoveryCoordinator } from "./sessionRecovery.js";
import {
  SessionOwnerError,
  createSessionOwnerFromSender
} from "./sessionOwner.js";

let repository;
function getRepository() {
  if (repository === undefined) {
    repository = createRepository(createIndexedDbStorageAdapter());
  }
  return repository;
}

let sessionManager;
function getSessionManager() {
  if (sessionManager === undefined) {
    sessionManager = createSessionManager(getRepository());
  }
  return sessionManager;
}

let sessionRecoveryCoordinator;
function getSessionRecoveryCoordinator() {
  if (sessionRecoveryCoordinator === undefined) {
    sessionRecoveryCoordinator = createSessionRecoveryCoordinator(
      getRepository(),
      getSessionManager()
    );
  }
  return sessionRecoveryCoordinator;
}

async function runSessionRecovery(includeOpen) {
  try {
    const result = await getSessionRecoveryCoordinator().scan({ includeOpen });
    for (const failure of result.failed) {
      console.error(
        `[The Unclicked] Failed to recover Session ${failure.sessionId}.`,
        failure.error
      );
    }
    return result;
  } catch (error) {
    console.error("[The Unclicked] Session recovery scan failed.", error);
    return null;
  }
}

const sessionFinalizeUseCase = createSessionFinalizeUseCase({
  finalizeSession(sessionId, finalizedAt, owner) {
    return getSessionManager().finalizeSession(
      sessionId,
      finalizedAt,
      owner
    );
  }
});

const messageRouter = createMessageRouter({
  getActiveContextForTab(tabId) {
    return getRepository().getActiveContextForTab(tabId);
  },
  getSettings() {
    return getRepository().getSettings();
  },
  saveSettings(settings) {
    return getRepository().saveSettings(settings);
  },
  mergeDiscoveredCandidates(payload, owner) {
    return getRepository().mergeDiscoveredCandidates(payload, owner);
  },
  mergeCandidateSignalsSnapshot(payload, owner) {
    return getRepository().mergeCandidateSignalsSnapshot(payload, owner);
  },
  listMissedPaths() {
    return getRepository().listMissedPaths();
  },
  deleteMissedPath(id) {
    return getRepository().deleteMissedPath(id);
  },
  deleteAll() {
    return getRepository().deleteAll();
  },
  listReencounters() {
    return getRepository().listReencounters();
  },
  recordReencounterFeedback(payload) {
    return getRepository().recordReencounterFeedback(payload);
  },
  recordReencounterShown(payload, tabId) {
    return getRepository().recordReencounterShown(payload, tabId);
  }
}, {
  sessionFinalizeUseCase
});

async function queryActiveTabId() {
  if (typeof chrome.tabs?.query !== "function") {
    throw new Error("Chrome Tabs query is unavailable.");
  }
  const tabs = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  });
  const tabId = tabs.find((tab) => Number.isInteger(tab?.id))?.id;
  if (!Number.isInteger(tabId) || tabId < 0) {
    throw new Error("The active tab does not have an ID.");
  }
  return tabId;
}

function getMessageSessionId(message) {
  return message?.type === MESSAGE_TYPES.SIGNALS_UPDATED
    ? message?.payload?.signals?.sessionId
    : message?.payload?.sessionId;
}

function requiresSessionOwner(message) {
  return (
    message?.type === MESSAGE_TYPES.CANDIDATE_CHOSEN ||
    message?.type === MESSAGE_TYPES.CANDIDATES_DISCOVERED ||
    message?.type === MESSAGE_TYPES.SESSION_FINALIZE ||
    message?.type === MESSAGE_TYPES.SIGNALS_UPDATED
  );
}

async function handleCurrentMessage(message, sender) {
  try {
    const routingContext = {};
    if (requiresSessionOwner(message)) {
      routingContext.sessionOwner = createSessionOwnerFromSender(
        sender,
        getMessageSessionId(message)
      );
    }
    if (
      message?.type === MESSAGE_TYPES.ACTIVE_CONTEXT_QUERY ||
      message?.type === MESSAGE_TYPES.RE_ENCOUNTER_SHOWN
    ) {
      routingContext.activeTabId = await queryActiveTabId();
    }

    if (message?.type === MESSAGE_TYPES.CANDIDATE_CHOSEN) {
      if (!isCandidateChosenMessage(message)) {
        return createErrorResponseMessage(message.requestId, {
          code: RESPONSE_ERROR_CODES.INVALID_REQUEST,
          message: `Invalid ${MESSAGE_TYPES.CANDIDATE_CHOSEN} payload.`,
          retryable: false
        });
      }
      const settings = await getRepository().getSettings();
      if (!settings.enabled) {
        return createErrorResponseMessage(message.requestId, {
          code: RESPONSE_ERROR_CODES.COLLECTION_PAUSED,
          message: "Collection is paused in Settings.",
          retryable: false
        });
      }
      const candidateChosen = await getSessionManager().recordCandidateChosen(
        message.payload.sessionId,
        message.payload.candidateId,
        message.payload.chosenAt,
        routingContext.sessionOwner
      );
      return createSuccessResponseMessage(message.requestId, {
        candidateChosen
      });
    }

    return await messageRouter.route(message, routingContext);
  } catch (error) {
    if (error instanceof SessionOwnerError) {
      return createErrorResponseMessage(message.requestId, {
        code: RESPONSE_ERROR_CODES.INVALID_REQUEST,
        message: error.message,
        retryable: false
      });
    }
    console.error("[The Unclicked] Background request failed.", error);
    return createErrorResponseMessage(message.requestId, {
      code: RESPONSE_ERROR_CODES.STORAGE_ERROR,
      message:
        message?.type === MESSAGE_TYPES.ACTIVE_CONTEXT_QUERY ||
        message?.type === MESSAGE_TYPES.RE_ENCOUNTER_SHOWN
          ? "Unable to determine the current active tab."
          : "Unable to persist the chosen Candidate.",
      retryable: true
    });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .then(() => {
      console.info("[The Unclicked] Side Panel action is ready.");
    })
    .catch((error) => {
      console.error("[The Unclicked] Failed to configure Side Panel.", error);
    });
});

chrome.runtime.onStartup?.addListener(() => {
  return runSessionRecovery(true);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (
    Object.values(MESSAGE_TYPES).includes(message?.type) &&
    typeof message?.requestId === "string" &&
    message.requestId.length > 0 &&
    message.schemaVersion !== SCHEMA_VERSION
  ) {
    sendResponse(
      createSchemaVersionUnsupportedResponse(
        message.requestId,
        message.schemaVersion
      )
    );
    return false;
  }

  if (isPingMessage(message)) {
    const response = createPongMessage(message, "service-worker");
    console.info("[The Unclicked] PING received.", {
      requestId: message.requestId,
      source: message.payload.source,
      senderUrl: sender.url ?? null
    });
    sendResponse(response);
    return false;
  }

  if (
    message?.type !== MESSAGE_TYPES.CANDIDATE_CHOSEN &&
    message?.type !== MESSAGE_TYPES.ACTIVE_CONTEXT_QUERY &&
    message?.type !== MESSAGE_TYPES.CANDIDATES_DISCOVERED &&
    message?.type !== MESSAGE_TYPES.DATA_DELETE_ALL &&
    message?.type !== MESSAGE_TYPES.MISSED_PATH_DELETE &&
    message?.type !== MESSAGE_TYPES.MISSED_PATHS_QUERY &&
    message?.type !== MESSAGE_TYPES.RE_ENCOUNTER_FEEDBACK &&
    message?.type !== MESSAGE_TYPES.RE_ENCOUNTER_QUERY &&
    message?.type !== MESSAGE_TYPES.RE_ENCOUNTER_SHOWN &&
    message?.type !== MESSAGE_TYPES.SESSION_FINALIZE &&
    message?.type !== MESSAGE_TYPES.SETTINGS_UPDATE &&
    message?.type !== MESSAGE_TYPES.SIGNALS_UPDATED
  ) {
    return false;
  }

  handleCurrentMessage(message, sender).then(sendResponse);
  return true;
});

// A newly evaluated Worker may safely take over only expired FINALIZING
// leases. Stale OPEN Sessions are handled on browser startup, leaving a living
// page free to re-register after an ordinary MV3 Worker sleep/wake cycle.
if (globalThis.indexedDB !== undefined) {
  void runSessionRecovery(false);
}
