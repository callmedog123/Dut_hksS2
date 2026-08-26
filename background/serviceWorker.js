import {
  MESSAGE_TYPES,
  RESPONSE_ERROR_CODES,
  createErrorResponseMessage,
  createPongMessage,
  createSuccessResponseMessage,
  isCandidateChosenMessage,
  isPingMessage
} from "../shared/messages.js";
import { createIndexedDbStorageAdapter } from "../storage/indexedDbStorageAdapter.js";
import { createRepository } from "../storage/repository.js";
import { createMessageRouter } from "./messageRouter.js";
import { createSessionFinalizeUseCase } from "./sessionFinalize.js";
import { createSessionManager } from "./sessionManager.js";

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

const sessionFinalizeUseCase = createSessionFinalizeUseCase({
  finalizeSession(sessionId, finalizedAt) {
    return getSessionManager().finalizeSession(sessionId, finalizedAt);
  }
});

const messageRouter = createMessageRouter({
  getActiveContext() {
    return getRepository().getActiveContext();
  },
  mergeDiscoveredCandidates(payload) {
    return getRepository().mergeDiscoveredCandidates(payload);
  },
  mergeCandidateSignalsSnapshot(payload) {
    return getRepository().mergeCandidateSignalsSnapshot(payload);
  },
  listMissedPaths() {
    return getRepository().listMissedPaths();
  },
  listReencounters() {
    return getRepository().listReencounters();
  },
  recordReencounterFeedback(payload) {
    return getRepository().recordReencounterFeedback(payload);
  },
  recordReencounterShown(payload) {
    return getRepository().recordReencounterShown(payload);
  }
}, {
  sessionFinalizeUseCase
});

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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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

  if (isCandidateChosenMessage(message)) {
    getSessionManager()
      .recordCandidateChosen(
        message.payload.sessionId,
        message.payload.candidateId,
        message.payload.chosenAt
      )
      .then((candidateChosen) => {
        sendResponse(
          createSuccessResponseMessage(message.requestId, {
            candidateChosen
          })
        );
      })
      .catch((error) => {
        console.error(
          "[The Unclicked] Failed to persist CANDIDATE_CHOSEN.",
          error
        );
        sendResponse(
          createErrorResponseMessage(message.requestId, {
            code: RESPONSE_ERROR_CODES.STORAGE_ERROR,
            message: "Unable to persist the chosen Candidate.",
            retryable: true
          })
        );
      });
    return true;
  }

  if (
    message?.type !== MESSAGE_TYPES.ACTIVE_CONTEXT_QUERY &&
    message?.type !== MESSAGE_TYPES.CANDIDATES_DISCOVERED &&
    message?.type !== MESSAGE_TYPES.MISSED_PATHS_QUERY &&
    message?.type !== MESSAGE_TYPES.RE_ENCOUNTER_FEEDBACK &&
    message?.type !== MESSAGE_TYPES.RE_ENCOUNTER_QUERY &&
    message?.type !== MESSAGE_TYPES.RE_ENCOUNTER_SHOWN &&
    message?.type !== MESSAGE_TYPES.SESSION_FINALIZE &&
    message?.type !== MESSAGE_TYPES.SIGNALS_UPDATED
  ) {
    return false;
  }

  messageRouter.route(message).then(sendResponse);
  return true;
});
