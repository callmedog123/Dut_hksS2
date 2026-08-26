import {
  createPingMessage,
  isPongMessage
} from "../shared/messages.js";
import { createDemoRuntime } from "../content/demoRuntime.js";

const pingButton = document.getElementById("ping-button");
const pingStatusElement = document.getElementById("ping-status");
const pingResponseElement = document.getElementById("ping-response");
const runtimeStatusElement = document.getElementById("runtime-status");
const runtimeResponseElement = document.getElementById("runtime-response");
const advanceButton = document.getElementById("advance-scenario-button");
const finalizeButton = document.getElementById("finalize-session-button");
const demoSearchPage = document.getElementById("demo-search-page");
const resultsElement = document.getElementById("demo-results");
const dynamicCandidateTemplate = document.getElementById(
  "dynamic-candidate-template"
);

let dynamicCandidateAdded = false;

function initializeDemoSession() {
  const suffix =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  demoSearchPage.setAttribute("data-demo-session-id", `demo-session-${suffix}`);
  demoSearchPage.setAttribute("data-demo-timestamp", String(Date.now()));
}

function renderFailure(message) {
  pingStatusElement.textContent = "PING 失败";
  pingResponseElement.textContent = message;
  console.error("[The Unclicked][Demo]", message);
}

function sendPing() {
  const ping = createPingMessage("local-demo");
  pingStatusElement.textContent = `正在等待 PONG：${ping.requestId}`;

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

    pingStatusElement.textContent = "PING/PONG 成功";
    pingResponseElement.textContent = JSON.stringify(response, null, 2);
    console.info("[The Unclicked][Demo] PONG received.", response);
  });
}

function renderRuntimeStatus(status) {
  runtimeStatusElement.setAttribute("data-state", status.state);
  runtimeStatusElement.textContent = status.message;
  if (status.data !== undefined) {
    runtimeResponseElement.textContent = JSON.stringify(status.data, null, 2);
  }
}

function appendDynamicCandidate() {
  if (dynamicCandidateAdded) {
    return;
  }
  const fragment = dynamicCandidateTemplate.content.cloneNode(true);
  resultsElement.appendChild(fragment);
  dynamicCandidateAdded = true;
}

initializeDemoSession();
const demoRuntime = createDemoRuntime({
  onStatus: renderRuntimeStatus
});

async function advanceScenario() {
  advanceButton.disabled = true;
  advanceButton.setAttribute("data-state", "working");
  try {
    appendDynamicCandidate();
    const result = await demoRuntime.advanceScenario("demo-candidate-002");
    advanceButton.setAttribute("data-state", "success");
    advanceButton.textContent = "场景已推进";
    runtimeResponseElement.textContent = JSON.stringify(result, null, 2);
  } catch (error) {
    advanceButton.disabled = false;
    advanceButton.setAttribute("data-state", "error");
    runtimeStatusElement.textContent = `推进场景失败：${error.message}`;
  }
}

async function finalizeSession() {
  finalizeButton.disabled = true;
  finalizeButton.setAttribute("data-state", "working");
  try {
    const result = await demoRuntime.finalizeSession();
    finalizeButton.disabled = false;
    finalizeButton.setAttribute("data-state", "success");
    finalizeButton.textContent = "再次结束会话（幂等）";
    advanceButton.disabled = true;
    runtimeResponseElement.textContent = JSON.stringify(result, null, 2);
  } catch (error) {
    finalizeButton.disabled = false;
    finalizeButton.setAttribute("data-state", "error");
    runtimeStatusElement.textContent = `结束会话失败：${error.message}`;
  }
}

async function startDemoRuntime() {
  try {
    await demoRuntime.start();
    advanceButton.disabled = false;
    finalizeButton.disabled = false;
  } catch (error) {
    advanceButton.disabled = true;
    finalizeButton.disabled = true;
    console.error("[The Unclicked][Demo] Runtime startup failed.", error);
  }
}

pingButton.addEventListener("click", sendPing);
advanceButton.addEventListener("click", advanceScenario);
finalizeButton.addEventListener("click", finalizeSession);
sendPing();
void startDemoRuntime();
