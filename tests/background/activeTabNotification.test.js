import assert from "node:assert/strict";
import test from "node:test";

import { isActiveTabChangedMessage } from "../../shared/messages.js";

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("Background broadcasts authoritative active tab and focused-window changes", async () => {
  let tabActivatedListener;
  let windowFocusChangedListener;
  const notifications = [];
  const tabQueries = [];

  globalThis.chrome = {
    runtime: {
      onInstalled: { addListener() {} },
      onMessage: { addListener() {} },
      async sendMessage(message) {
        notifications.push(message);
      }
    },
    sidePanel: {
      setPanelBehavior() {
        return Promise.resolve();
      }
    },
    tabs: {
      onActivated: {
        addListener(listener) {
          tabActivatedListener = listener;
        }
      },
      async query(queryInfo) {
        tabQueries.push(queryInfo);
        return [{ id: 23 }];
      }
    },
    windows: {
      onFocusChanged: {
        addListener(listener) {
          windowFocusChangedListener = listener;
        }
      }
    }
  };

  try {
    await import(
      `../../background/serviceWorker.js?active-tab-notification-${Date.now()}-${Math.random()}`
    );
    assert.equal(typeof tabActivatedListener, "function");
    assert.equal(typeof windowFocusChangedListener, "function");

    tabActivatedListener({ tabId: 12, windowId: 7 });
    await nextTurn();
    assert.equal(notifications.length, 1);
    assert.equal(isActiveTabChangedMessage(notifications[0]), true);
    assert.deepEqual(notifications[0].payload, {
      tabId: 12,
      windowId: 7,
      changedAt: notifications[0].payload.changedAt
    });

    windowFocusChangedListener(8);
    await nextTurn();
    await nextTurn();
    assert.deepEqual(tabQueries, [{ active: true, windowId: 8 }]);
    assert.equal(notifications.length, 2);
    assert.equal(isActiveTabChangedMessage(notifications[1]), true);
    assert.equal(notifications[1].payload.tabId, 23);
    assert.equal(notifications[1].payload.windowId, 8);

    windowFocusChangedListener(-1);
    await nextTurn();
    assert.equal(tabQueries.length, 1);
    assert.equal(notifications.length, 2);
  } finally {
    delete globalThis.chrome;
  }
});
