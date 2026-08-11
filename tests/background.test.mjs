import assert from "node:assert/strict";
import test from "node:test";

let messageHandler;
let stored = {};
let recentlyClosed = [];
let removeTab;
let restoreSession;
let createTab;

globalThis.chrome = {
  runtime: {
    onMessage: {
      addListener(listener) {
        messageHandler = listener;
      },
    },
  },
  sessions: {
    async getRecentlyClosed() {
      return recentlyClosed;
    },
    async restore(sessionId) {
      return restoreSession(sessionId);
    },
  },
  storage: {
    session: {
      async get(key) {
        return { [key]: stored[key] };
      },
      async set(values) {
        Object.assign(stored, values);
      },
      async remove(key) {
        delete stored[key];
      },
    },
  },
  tabs: {
    async remove(tabId) {
      return removeTab(tabId);
    },
    async query() {
      return [];
    },
    async create(options) {
      return createTab(options);
    },
  },
  windows: {
    async get(windowId) {
      return {
        id: windowId,
        type: "normal",
        incognito: false,
      };
    },
    async getAll() {
      return [];
    },
  },
};

await import("../background.js");

test.beforeEach(() => {
  stored = {};
  recentlyClosed = [];
  removeTab = async () => {};
  restoreSession = async () => {
    throw new Error("Session restore was not expected.");
  };
  createTab = async () => {
    throw new Error("Tab creation was not expected.");
  };
});

test("undo restores the Chrome session captured after closing a tab", async () => {
  removeTab = async (tabId) => {
    recentlyClosed = [
      {
        tab: {
          id: tabId,
          sessionId: "closed-session-12",
          windowId: 5,
          url: "https://example.com/deep/page",
        },
      },
    ];
  };
  const restoredSessionIds = [];
  restoreSession = async (sessionId) => {
    restoredSessionIds.push(sessionId);
    return {};
  };

  const transaction = await beginTransaction();
  await closeTabs(transaction.id, [
    {
      id: 12,
      windowId: 5,
      index: 3,
      url: "https://example.com/deep/page",
    },
  ]);

  const savedTransaction = stored.latestDuplicateCleanup;
  assert.equal(savedTransaction.tabs[0].sessionId, "closed-session-12");

  const result = await sendMessage({
    type: "RESTORE_DUPLICATE_CLEANUP",
    transactionId: transaction.id,
  });

  assert.deepEqual(restoredSessionIds, ["closed-session-12"]);
  assert.deepEqual(result.outcome, {
    status: "restored",
    total: 1,
    restored: 1,
    historyRestored: 1,
    recreated: 0,
    failed: 0,
    error: null,
  });
  assert.equal(stored.latestDuplicateCleanup, undefined);
});

test("undo recreates the address when Chrome has no closed session", async () => {
  const createdOptions = [];
  createTab = async (options) => {
    createdOptions.push(options);
    return { id: 120 };
  };

  const transaction = await beginTransaction();
  await closeTabs(transaction.id, [
    {
      id: 20,
      windowId: 5,
      index: 2,
      url: "https://example.com/fallback",
      pinned: true,
    },
  ]);
  const result = await sendMessage({
    type: "RESTORE_DUPLICATE_CLEANUP",
    transactionId: transaction.id,
  });

  assert.deepEqual(createdOptions, [
    {
      windowId: 5,
      index: 0,
      url: "https://example.com/fallback",
      pinned: true,
      active: false,
    },
  ]);
  assert.equal(result.outcome.historyRestored, 0);
  assert.equal(result.outcome.recreated, 1);
});

test("undo falls back to the saved address when session restore expires", async () => {
  removeTab = async (tabId) => {
    recentlyClosed = [
      {
        tab: {
          id: tabId,
          sessionId: "expired-session",
          windowId: 5,
          url: "https://example.com/expired",
        },
      },
    ];
  };
  restoreSession = async () => {
    throw new Error("The session is unavailable.");
  };
  createTab = async () => ({ id: 130 });

  const transaction = await beginTransaction();
  await closeTabs(transaction.id, [
    {
      id: 30,
      windowId: 5,
      index: 0,
      url: "https://example.com/expired",
    },
  ]);
  const result = await sendMessage({
    type: "RESTORE_DUPLICATE_CLEANUP",
    transactionId: transaction.id,
  });

  assert.equal(result.outcome.status, "restored");
  assert.equal(result.outcome.historyRestored, 0);
  assert.equal(result.outcome.recreated, 1);
});

async function beginTransaction() {
  const result = await sendMessage({
    type: "BEGIN_DUPLICATE_CLEANUP",
    windowId: 5,
  });
  return result.transaction;
}

function closeTabs(transactionId, tabs) {
  return sendMessage({
    type: "CLOSE_CLEANUP_TABS",
    transactionId,
    tabs,
  });
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    const keepsChannelOpen = messageHandler(
      message,
      {},
      (response) => {
        if (response.ok) {
          resolve(response);
        } else {
          reject(new Error(response.error));
        }
      },
    );

    assert.equal(keepsChannelOpen, true);
  });
}
