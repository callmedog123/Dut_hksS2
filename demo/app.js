import {
  createPingMessage,
  isPongMessage
} from "../shared/messages.js";

const pingButton = document.getElementById("ping-button");
const statusElement = document.getElementById("status");
const responseElement = document.getElementById("response");

function renderFailure(message) {
  statusElement.textContent = "PING 失败";
  responseElement.textContent = message;
  console.error("[The Unclicked][Demo]", message);
}

function sendPing() {
  const ping = createPingMessage("local-demo");
  statusElement.textContent = `正在等待 PONG：${ping.requestId}`;

  chrome.runtime.sendMessage(ping, (response) => {
    const runtimeError = chrome.runtime.lastError;
    if (runtimeError) {
      renderFailure(runtimeError.message);
      return;
    }

    if (!isPongMessage(response) || response.requestId !== ping.requestId) {
      renderFailure("Service Worker 返回了无效的 PONG。");
      return;
    }

    statusElement.textContent = "PING/PONG 成功";
    responseElement.textContent = JSON.stringify(response, null, 2);
    console.info("[The Unclicked][Demo] PONG received.", response);
  });
}

pingButton.addEventListener("click", sendPing);
sendPing();
