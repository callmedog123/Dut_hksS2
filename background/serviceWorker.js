import {
  createPongMessage,
  isPingMessage
} from "../shared/messages.js";

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
  if (!isPingMessage(message)) {
    return false;
  }

  const response = createPongMessage(message, "service-worker");
  console.info("[The Unclicked] PING received.", {
    requestId: message.requestId,
    source: message.payload.source,
    senderUrl: sender.url ?? null
  });
  sendResponse(response);
  return false;
});
