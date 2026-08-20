import assert from "node:assert/strict";
import test from "node:test";

import {
  createBackgroundMessageHandler,
  createBackgroundMessageListener,
} from "../background-logic.mjs";

const STORAGE_KEY = "latestUndoOperation";

function createFakeBrowser() {
  const calls = [];
  let storedTransaction = null;
  let nextId = 1;
  let recentlyClosed = [];
  let removeTabImpl = async () => {};
  let restoreSessionImpl = async () => {
    throw new Error("Session restore was not expected.");
  };
  let createTabImpl = async () => ({ id: 100 });
  let getWindowImpl = async (windowId) => ({
    id: windowId,
    type: "normal",
    incognito: false,
  });
  let getNormalWindowsImpl = async () => [];
  let queryWindowTabsImpl = async () => [];
  let moveTabsImpl = async () => [];
  let moveTabsToWindowImpl = async () => [];
  let setTabPinnedImpl = async () => ({});
  let groupTabsImpl = async () => 1;
  let updateTabGroupImpl = async () => ({});
  let ungroupTabsImpl = async () => ({});
  let getTabGroupImpl = async () => ({
    title: "",
    color: "grey",
    collapsed: false,
  });
  let onSet;

  const browser = {
    calls,
    get storedTransaction() {
      return storedTransaction;
    },
    set storedTransaction(value) {
      storedTransaction = value;
    },
    set recentlyClosed(value) {
      recentlyClosed = value;
    },
    set removeTabImpl(value) {
      removeTabImpl = value;
    },
    set restoreSessionImpl(value) {
      restoreSessionImpl = value;
    },
    set createTabImpl(value) {
      createTabImpl = value;
    },
    set getWindowImpl(value) {
      getWindowImpl = value;
    },
    set getNormalWindowsImpl(value) {
      getNormalWindowsImpl = value;
    },
    set queryWindowTabsImpl(value) {
      queryWindowTabsImpl = value;
    },
    set moveTabsImpl(value) {
      moveTabsImpl = value;
    },
    set moveTabsToWindowImpl(value) {
      moveTabsToWindowImpl = value;
    },
    set setTabPinnedImpl(value) {
      setTabPinnedImpl = value;
    },
    set groupTabsImpl(value) {
      groupTabsImpl = value;
    },
    set updateTabGroupImpl(value) {
      updateTabGroupImpl = value;
    },
    set ungroupTabsImpl(value) {
      ungroupTabsImpl = value;
    },
    set getTabGroupImpl(value) {
      getTabGroupImpl = value;
    },
    set onSet(value) {
      onSet = value;
    },
    generateId() {
      const id = `transaction-${nextId}`;
      nextId += 1;
      calls.push(["generateId"]);
      return id;
    },
    async getSessionValue(key) {
      calls.push(["getSessionValue", key]);
      return key === STORAGE_KEY ? storedTransaction : undefined;
    },
    async setSessionValue(key, value) {
      calls.push(["setSessionValue", key, value]);
      if (key === STORAGE_KEY) {
        storedTransaction = value;
      }
      onSet?.(key, value);
    },
    async removeSessionValue(key) {
      calls.push(["removeSessionValue", key]);
      if (key === STORAGE_KEY) {
        storedTransaction = null;
      }
    },
    async removeTab(tabId) {
      calls.push(["removeTab", tabId]);
      return removeTabImpl(tabId);
    },
    async getRecentlyClosed(maxResults) {
      calls.push(["getRecentlyClosed", maxResults]);
      return recentlyClosed;
    },
    async restoreSession(sessionId) {
      calls.push(["restoreSession", sessionId]);
      return restoreSessionImpl(sessionId);
    },
    async getWindow(windowId) {
      calls.push(["getWindow", windowId]);
      return getWindowImpl(windowId);
    },
    async getNormalWindows() {
      calls.push(["getNormalWindows"]);
      return getNormalWindowsImpl();
    },
    async queryWindowTabs(windowId) {
      calls.push(["queryWindowTabs", windowId]);
      return queryWindowTabsImpl(windowId);
    },
    async moveTabs(tabIds, index) {
      calls.push(["moveTabs", tabIds, index]);
      return moveTabsImpl(tabIds, index);
    },
    async moveTabsToWindow(tabIds, windowId) {
      calls.push(["moveTabsToWindow", tabIds, windowId]);
      return moveTabsToWindowImpl(tabIds, windowId);
    },
    async setTabPinned(tabId, pinned) {
      calls.push(["setTabPinned", tabId, pinned]);
      return setTabPinnedImpl(tabId, pinned);
    },
    async groupTabs(tabIds) {
      calls.push(["groupTabs", tabIds]);
      return groupTabsImpl(tabIds);
    },
    async updateTabGroup(groupId, properties) {
      calls.push(["updateTabGroup", groupId, properties]);
      return updateTabGroupImpl(groupId, properties);
    },
    async ungroupTabs(tabIds) {
      calls.push(["ungroupTabs", tabIds]);
      return ungroupTabsImpl(tabIds);
    },
    async getTabGroup(groupId) {
      calls.push(["getTabGroup", groupId]);
      return getTabGroupImpl(groupId);
    },
    async createTab(options) {
      calls.push(["createTab", options]);
      return createTabImpl(options);
    },
  };

  return browser;
}

function sendMessage(listener, message) {
  return new Promise((resolve) => {
    const keepsChannelOpen = listener(message, {}, resolve);
    assert.equal(keepsChannelOpen, true);
  });
}

async function beginTransaction(browser, listener, windowId = 5) {
  const response = await sendMessage(listener, {
    type: "BEGIN_DUPLICATE_CLEANUP",
    windowId,
  });
  assert.equal(response.ok, true);
  return response.transaction;
}

async function beginOperation(handler, operation, data, windowId = 5) {
  const response = await handler({
    type: "BEGIN_UNDO_OPERATION",
    operation,
    windowId,
    data,
  });
  assert.equal(response.transaction.operation, operation);
  return response.transaction;
}

async function closeTabs(browser, listener, transactionId, tabs) {
  return sendMessage(listener, {
    type: "CLOSE_CLEANUP_TABS",
    transactionId,
    tabs,
  });
}

async function createClosedTransaction(browser, handler, snapshots) {
  const transaction = await handler({
    type: "BEGIN_DUPLICATE_CLEANUP",
    windowId: snapshots[0].windowId,
  });
  await handler({
    type: "CLOSE_CLEANUP_TABS",
    transactionId: transaction.transaction.id,
    tabs: snapshots.map((snapshot) => ({
      id: snapshot.originalTabId,
      windowId: snapshot.windowId,
      index: snapshot.index,
      url: snapshot.url,
      pinned: snapshot.pinned,
      incognito: snapshot.incognito,
    })),
  });
  return transaction.transaction.id;
}

function snapshot(id, index = 0, options = {}) {
  return {
    originalTabId: id,
    windowId: 5,
    index,
    url: `https://example.test/${id}`,
    pinned: false,
    incognito: false,
    ...options,
  };
}

function summarizeCleanupCalls(browser, startAt = 0) {
  return browser.calls
    .slice(startAt)
    .filter(([name]) =>
      ["getRecentlyClosed", "removeTab", "setSessionValue"].includes(name),
    )
    .map(([name, value, transaction]) => {
      if (name === "removeTab") {
        return [name, value];
      }

      if (name === "setSessionValue") {
        return [
          name,
          transaction.tabs.map(
            (tab) => `${tab.originalTabId}:${tab.state}`,
          ),
        ];
      }

      return [name];
    });
}

test("dispatches messages with success and error response envelopes", async () => {
  const browser = createFakeBrowser();
  const listener = createBackgroundMessageListener(browser);

  const success = await beginTransaction(browser, listener);
  assert.deepEqual(success, {
    id: "transaction-1",
    count: 0,
    createdAt: success.createdAt,
  });

  const unknown = await sendMessage(listener, { type: "UNKNOWN" });
  assert.deepEqual(unknown, {
    ok: false,
    error: "Unknown Tab Control message.",
  });
});

test("closes and records every requested tab in order", async () => {
  const browser = createFakeBrowser();
  const listener = createBackgroundMessageListener(browser);
  const transaction = await beginTransaction(browser, listener);
  browser.recentlyClosed = [];
  const cleanupStart = browser.calls.length;

  const response = await closeTabs(browser, listener, transaction.id, [
    { id: 12, windowId: 5, index: 1, url: "https://example.test/12" },
    { id: 13, windowId: 5, index: 2, url: "https://example.test/13" },
  ]);

  assert.equal(response.ok, true);
  assert.equal(response.closedNow, 2);
  assert.equal(response.failed, 0);
  assert.deepEqual(
    browser.storedTransaction.tabs.map((tab) => tab.originalTabId),
    [12, 13],
  );
  assert.deepEqual(
    summarizeCleanupCalls(browser, cleanupStart),
    [
      ["setSessionValue", ["12:pending", "13:pending"]],
      ["getRecentlyClosed"],
      ["removeTab", 12],
      ["getRecentlyClosed"],
      ["setSessionValue", ["12:closed", "13:pending"]],
      ["getRecentlyClosed"],
      ["removeTab", 13],
      ["getRecentlyClosed"],
      ["setSessionValue", ["12:closed", "13:closed"]],
    ],
  );
});

test("discards a tab when closing it fails and continues", async () => {
  const browser = createFakeBrowser();
  const listener = createBackgroundMessageListener(browser);
  const transaction = await beginTransaction(browser, listener);
  const cleanupStart = browser.calls.length;
  browser.removeTabImpl = async (tabId) => {
    if (tabId === 12) {
      throw new Error("Tab already closed.");
    }
  };

  const response = await closeTabs(browser, listener, transaction.id, [
    { id: 12, windowId: 5, index: 1, url: "https://example.test/12" },
    { id: 13, windowId: 5, index: 2, url: "https://example.test/13" },
  ]);

  assert.equal(response.closedNow, 1);
  assert.equal(response.failed, 1);
  assert.deepEqual(
    browser.storedTransaction.tabs.map((tab) => tab.originalTabId),
    [13],
  );
  assert.deepEqual(
    summarizeCleanupCalls(browser, cleanupStart),
    [
      ["setSessionValue", ["12:pending", "13:pending"]],
      ["getRecentlyClosed"],
      ["removeTab", 12],
      ["setSessionValue", ["13:pending"]],
      ["getRecentlyClosed"],
      ["removeTab", 13],
      ["getRecentlyClosed"],
      ["setSessionValue", ["13:closed"]],
    ],
  );
});

test("stops closing tabs when the transaction is superseded mid-loop", async () => {
  const browser = createFakeBrowser();
  const listener = createBackgroundMessageListener(browser);
  const transaction = await beginTransaction(browser, listener);
  let saves = 0;
  browser.onSet = () => {
    saves += 1;
    if (saves === 2) {
      browser.storedTransaction = {
        id: "newer-transaction",
        windowId: 5,
        state: "open",
        tabs: [],
      };
    }
  };

  const response = await closeTabs(browser, listener, transaction.id, [
    { id: 12, windowId: 5, index: 1, url: "https://example.test/12" },
    { id: 13, windowId: 5, index: 2, url: "https://example.test/13" },
  ]);

  assert.deepEqual(response, {
    ok: false,
    error: "This cleanup transaction is no longer available.",
  });
  assert.deepEqual(
    browser.calls.filter(([name]) => name === "removeTab"),
    [["removeTab", 12]],
  );
});

test("reuses a matching original normal window", async () => {
  const browser = createFakeBrowser();
  const handler = createBackgroundMessageHandler(browser);
  const transactionId = await createClosedTransaction(browser, handler, [
    snapshot(12),
  ]);
  browser.getWindowImpl = async () => ({
    id: 5,
    type: "normal",
    incognito: false,
  });
  browser.queryWindowTabsImpl = async () => [{ id: 1 }];

  const result = await handler({
    type: "RESTORE_DUPLICATE_CLEANUP",
    transactionId,
  });

  assert.equal(result.outcome.status, "restored");
  assert.equal(
    browser.calls.some(([name]) => name === "getNormalWindows"),
    false,
  );
  assert.equal(browser.calls.at(-1)[0], "removeSessionValue");
});

test("falls back for incognito mismatch and non-normal windows", async () => {
  for (const originalWindow of [
    { id: 5, type: "normal", incognito: true },
    { id: 5, type: "popup", incognito: false },
  ]) {
    const browser = createFakeBrowser();
    const handler = createBackgroundMessageHandler(browser);
    const transactionId = await createClosedTransaction(browser, handler, [
      snapshot(12),
    ]);
    browser.getWindowImpl = async () => originalWindow;
    browser.getNormalWindowsImpl = async () => [
      { id: 9, type: "normal", incognito: false },
    ];
    browser.queryWindowTabsImpl = async () => [];

    const result = await handler({
      type: "RESTORE_DUPLICATE_CLEANUP",
      transactionId,
    });

    assert.equal(result.outcome.status, "restored");
    assert.deepEqual(
      browser.calls.filter(([name]) => name === "createTab")[0][1].windowId,
      9,
    );
  }
});

test("swallows a missing original window and uses a compatible fallback", async () => {
  const browser = createFakeBrowser();
  const handler = createBackgroundMessageHandler(browser);
  const transactionId = await createClosedTransaction(browser, handler, [
    snapshot(12),
  ]);
  browser.getWindowImpl = async () => {
    throw new Error("No window with id: 5.");
  };
  browser.getNormalWindowsImpl = async () => [
    { id: 9, type: "normal", incognito: false },
  ];
  browser.queryWindowTabsImpl = async () => [];

  const result = await handler({
    type: "RESTORE_DUPLICATE_CLEANUP",
    transactionId,
  });

  assert.equal(result.outcome.status, "restored");
  assert.equal(
    browser.calls.some(([name]) => name === "getNormalWindows"),
    true,
  );
});

test("reports no-compatible-window failures", async () => {
  const browser = createFakeBrowser();
  const handler = createBackgroundMessageHandler(browser);
  const transactionId = await createClosedTransaction(browser, handler, [
    snapshot(12),
  ]);
  browser.getWindowImpl = async () => ({
    id: 5,
    type: "popup",
    incognito: false,
  });
  browser.getNormalWindowsImpl = async () => [
    { id: 9, type: "normal", incognito: true },
  ];

  const result = await handler({
    type: "RESTORE_DUPLICATE_CLEANUP",
    transactionId,
  });

  assert.equal(result.outcome.status, "failed");
  assert.match(result.outcome.error, /No compatible browser window/);
});

test("clamps negative and out-of-range restore indices", async () => {
  const browser = createFakeBrowser();
  const handler = createBackgroundMessageHandler(browser);
  const transactionId = await createClosedTransaction(browser, handler, [
    snapshot(12, -1),
    snapshot(13, 99),
  ]);
  browser.queryWindowTabsImpl = async () => [{ id: 1 }, { id: 2 }];

  const result = await handler({
    type: "RESTORE_DUPLICATE_CLEANUP",
    transactionId,
  });

  assert.equal(result.outcome.status, "restored");
  assert.deepEqual(
    browser.calls
      .filter(([name]) => name === "createTab")
      .map(([, options]) => options.index),
    [2, 2],
  );
});

test("reopens a fully failed restoration for retry", async () => {
  const browser = createFakeBrowser();
  const handler = createBackgroundMessageHandler(browser);
  const transactionId = await createClosedTransaction(browser, handler, [
    snapshot(12),
  ]);
  browser.getWindowImpl = async () => ({
    id: 5,
    type: "popup",
    incognito: false,
  });
  browser.getNormalWindowsImpl = async () => [];

  const result = await handler({
    type: "RESTORE_DUPLICATE_CLEANUP",
    transactionId,
  });

  assert.equal(result.outcome.status, "failed");
  assert.equal(result.transaction.count, 1);
  assert.equal(browser.storedTransaction.state, "open");
});

test("does not reopen a partially failed restoration", async () => {
  const browser = createFakeBrowser();
  const handler = createBackgroundMessageHandler(browser);
  const transactionId = await createClosedTransaction(browser, handler, [
    snapshot(12),
    snapshot(13),
  ]);
  let creates = 0;
  browser.createTabImpl = async () => {
    creates += 1;
    if (creates === 2) {
      throw new Error("Cannot create tab.");
    }
    return { id: 120 };
  };
  browser.queryWindowTabsImpl = async () => [];

  const result = await handler({
    type: "RESTORE_DUPLICATE_CLEANUP",
    transactionId,
  });

  assert.equal(result.outcome.status, "partial");
  assert.equal(result.transaction, null);
  assert.equal(browser.storedTransaction, null);
});

test("restores a sorted tab arrangement from its captured indices", async () => {
  const browser = createFakeBrowser();
  const handler = createBackgroundMessageHandler(browser);
  const transaction = await beginOperation(handler, "sort-by-domain", {
    tabs: [
      { tabId: 1, windowId: 5, index: 0, pinned: false },
      { tabId: 2, windowId: 5, index: 1, pinned: false },
      { tabId: 3, windowId: 5, index: 2, pinned: false },
    ],
  });
  const tabs = [
    { id: 2, windowId: 5, index: 0, pinned: false },
    { id: 3, windowId: 5, index: 1, pinned: false },
    { id: 1, windowId: 5, index: 2, pinned: false },
  ];
  browser.getNormalWindowsImpl = async () => [{ id: 5, type: "normal", tabs }];
  browser.moveTabsImpl = async ([tabId], index) => {
    const moved = tabs.splice(tabs.findIndex((tab) => tab.id === tabId), 1)[0];
    tabs.splice(Math.min(index, tabs.length), 0, moved);
    tabs.forEach((tab, tabIndex) => {
      tab.index = tabIndex;
    });
  };

  const result = await handler({
    type: "RESTORE_UNDO_TRANSACTION",
    transactionId: transaction.id,
  });

  assert.equal(result.outcome.status, "restored");
  assert.deepEqual(tabs.map((tab) => tab.id), [1, 2, 3]);
  assert.deepEqual(
    browser.calls.filter(([name]) => name === "moveTabs"),
    [
      ["moveTabs", [1], 0],
      ["moveTabs", [2], 1],
      ["moveTabs", [3], 2],
    ],
  );
});

test("reports a partial gather undo when a source window is gone", async () => {
  const browser = createFakeBrowser();
  const handler = createBackgroundMessageHandler(browser);
  const transaction = await beginOperation(handler, "gather-tabs-here", {
    tabs: [{ tabId: 9, sourceWindowId: 7, index: 2 }],
  });
  await handler({
    type: "UPDATE_UNDO_OPERATION",
    transactionId: transaction.id,
    data: {
      tabs: [
        {
          tabId: 9,
          sourceWindowId: 7,
          index: 2,
          state: "moved",
        },
      ],
    },
  });
  const tabs = [{ id: 9, windowId: 5, index: 0 }];
  browser.getNormalWindowsImpl = async () => [
    { id: 5, type: "normal", incognito: false, tabs },
  ];
  browser.moveTabsToWindowImpl = async () => {};
  browser.moveTabsImpl = async () => {};

  const result = await handler({
    type: "RESTORE_UNDO_TRANSACTION",
    transactionId: transaction.id,
  });

  assert.equal(result.outcome.status, "partial");
  assert.equal(result.outcome.restored, 1);
  assert.match(result.outcome.failures[0], /Source window 7 was closed/);
  assert.equal(
    browser.calls.some(([name]) => name === "createWindow"),
    false,
  );
});

test("ungroups the tabs created by a grouping operation", async () => {
  const browser = createFakeBrowser();
  const handler = createBackgroundMessageHandler(browser);
  const transaction = await beginOperation(handler, "group-tabs", {
    groups: [{ groupId: 12, tabIds: [1, 2] }],
  });
  browser.getNormalWindowsImpl = async () => [
    {
      id: 5,
      type: "normal",
      tabs: [
        { id: 1, windowId: 5 },
        { id: 2, windowId: 5 },
      ],
    },
  ];

  const result = await handler({
    type: "RESTORE_UNDO_TRANSACTION",
    transactionId: transaction.id,
  });

  assert.equal(result.outcome.status, "restored");
  assert.deepEqual(
    browser.calls.filter(([name]) => name === "ungroupTabs"),
    [["ungroupTabs", [1, 2]]],
  );
});

test("recreates dissolved groups with their captured appearance", async () => {
  const browser = createFakeBrowser();
  const handler = createBackgroundMessageHandler(browser);
  const transaction = await beginOperation(handler, "ungroup-tabs", {
    groups: [
      {
        groupId: 12,
        title: "example.com",
        color: "blue",
        collapsed: true,
        tabIds: [1, 2],
      },
    ],
  });
  browser.getNormalWindowsImpl = async () => [
    {
      id: 5,
      type: "normal",
      tabs: [
        { id: 1, windowId: 5 },
        { id: 2, windowId: 5 },
      ],
    },
  ];
  browser.groupTabsImpl = async () => 21;

  const result = await handler({
    type: "RESTORE_UNDO_TRANSACTION",
    transactionId: transaction.id,
  });

  assert.equal(result.outcome.status, "restored");
  assert.deepEqual(
    browser.calls.filter(([name]) => name === "updateTabGroup"),
    [["updateTabGroup", 21, {
      title: "example.com",
      color: "blue",
      collapsed: true,
    }]],
  );
});
