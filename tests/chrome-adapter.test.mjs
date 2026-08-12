import assert from "node:assert/strict";
import test from "node:test";

import {
  createChromeAdapter,
  LIVE_SUMMARY_TAB_EVENTS,
} from "../chrome-adapter.mjs";

function createFakeEvent() {
  return {
    listeners: new Set(),
    addListener(listener) {
      this.listeners.add(listener);
    },
    removeListener(listener) {
      this.listeners.delete(listener);
    },
  };
}

function createFakeChrome(overrides = {}) {
  const calls = [];
  const record = (name) => (...args) => {
    calls.push([name, ...args]);
    return Promise.resolve(`${name}-result`);
  };
  const tabEvents = Object.fromEntries(
    LIVE_SUMMARY_TAB_EVENTS.map((name) => [name, createFakeEvent()]),
  );

  return {
    calls,
    tabEvents,
    api: {
      tabs: {
        ...tabEvents,
        query: record("tabs.query"),
        move: record("tabs.move"),
        group: record("tabs.group"),
        ungroup: record("tabs.ungroup"),
        create: record("tabs.create"),
      },
      tabGroups: { update: record("tabGroups.update") },
      windows: {
        getCurrent: record("windows.getCurrent"),
        getAll: record("windows.getAll"),
      },
      runtime: { sendMessage: record("runtime.sendMessage") },
      sessions: {
        getRecentlyClosed: record("sessions.getRecentlyClosed"),
        restore: record("sessions.restore"),
        onChanged: createFakeEvent(),
      },
      ...overrides,
    },
  };
}

test("reads tabs and windows with the popup's query shapes", async () => {
  const chrome = createFakeChrome();
  const adapter = createChromeAdapter(chrome.api);

  await adapter.queryCurrentWindowTabs();
  await adapter.getCurrentWindow();
  await adapter.getNormalWindows();

  assert.deepEqual(chrome.calls, [
    ["tabs.query", { currentWindow: true }],
    ["windows.getCurrent"],
    ["windows.getAll", { populate: true, windowTypes: ["normal"] }],
  ]);
});

test("reuses populated tabs when reading the current window snapshot", async () => {
  const chrome = createFakeChrome();
  const currentWindow = { id: 1, type: "normal" };
  const tabs = [{ id: 10 }, { id: 11 }];
  const windows = [
    { ...currentWindow, tabs },
    { id: 2, type: "normal", tabs: [{ id: 20 }] },
  ];
  chrome.api.windows.getCurrent = () => {
    chrome.calls.push(["windows.getCurrent"]);
    return Promise.resolve(currentWindow);
  };
  chrome.api.windows.getAll = (...args) => {
    chrome.calls.push(["windows.getAll", ...args]);
    return Promise.resolve(windows);
  };

  const snapshot = await createChromeAdapter(
    chrome.api,
  ).getCurrentWindowSnapshot();

  assert.deepEqual(snapshot, { tabs, currentWindow, windows });
  assert.deepEqual(chrome.calls, [
    ["windows.getCurrent"],
    ["windows.getAll", { populate: true, windowTypes: ["normal"] }],
  ]);
});

test("queries tabs when the current window is not a normal window", async () => {
  const chrome = createFakeChrome();
  const currentWindow = { id: 3, type: "popup" };
  const tabs = [{ id: 30 }];
  const windows = [{ id: 1, type: "normal", tabs: [{ id: 10 }] }];
  chrome.api.windows.getCurrent = () => {
    chrome.calls.push(["windows.getCurrent"]);
    return Promise.resolve(currentWindow);
  };
  chrome.api.windows.getAll = (...args) => {
    chrome.calls.push(["windows.getAll", ...args]);
    return Promise.resolve(windows);
  };
  chrome.api.tabs.query = (...args) => {
    chrome.calls.push(["tabs.query", ...args]);
    return Promise.resolve(tabs);
  };

  const snapshot = await createChromeAdapter(
    chrome.api,
  ).getCurrentWindowSnapshot();

  assert.deepEqual(snapshot, { tabs, currentWindow, windows });
  assert.deepEqual(chrome.calls, [
    ["windows.getCurrent"],
    ["windows.getAll", { populate: true, windowTypes: ["normal"] }],
    ["tabs.query", { currentWindow: true }],
  ]);
});

test("edits tabs and groups through the Chrome surface", async () => {
  const chrome = createFakeChrome();
  const adapter = createChromeAdapter(chrome.api);

  await adapter.moveTab(7, 2);
  await adapter.moveTabsToWindow([7, 8], 3);
  await adapter.groupTabs([7, 8]);
  await adapter.updateTabGroup(4, { title: "example.com" });
  await adapter.ungroupTabs([7, 8]);
  await adapter.createTab("https://example.test/");

  assert.deepEqual(chrome.calls, [
    ["tabs.move", 7, { index: 2 }],
    ["tabs.move", [7, 8], { windowId: 3, index: -1 }],
    ["tabs.group", { tabIds: [7, 8] }],
    ["tabGroups.update", 4, { title: "example.com" }],
    ["tabs.ungroup", [7, 8]],
    ["tabs.create", { url: "https://example.test/" }],
  ]);
});

test("unwraps a successful background response", async () => {
  const response = { ok: true, transaction: { id: "t" } };
  const adapter = createChromeAdapter({
    runtime: { sendMessage: () => Promise.resolve(response) },
  });

  assert.equal(
    await adapter.sendBackgroundMessage({ type: "GET_DUPLICATE_CLEANUP_UNDO" }),
    response,
  );
});

test("throws the reported error when the background rejects a message", async () => {
  const adapter = createChromeAdapter({
    runtime: { sendMessage: () => Promise.resolve({ ok: false, error: "Nope." }) },
  });

  await assert.rejects(adapter.sendBackgroundMessage({ type: "X" }), /Nope\./);
});

test("throws a fallback error when the background does not respond", async () => {
  const adapter = createChromeAdapter({
    runtime: { sendMessage: () => Promise.resolve(undefined) },
  });

  await assert.rejects(
    adapter.sendBackgroundMessage({ type: "X" }),
    /The extension did not respond\./,
  );
});

test("detects whether Chrome exposes recently closed sessions", () => {
  const chrome = createFakeChrome();

  assert.equal(createChromeAdapter(chrome.api).isRecentlyClosedAvailable(), true);
  assert.equal(createChromeAdapter({}).isRecentlyClosedAvailable(), false);
  assert.equal(
    createChromeAdapter({ sessions: {} }).isRecentlyClosedAvailable(),
    false,
  );
});

test("reads and restores recently closed sessions", async () => {
  const chrome = createFakeChrome();
  const adapter = createChromeAdapter(chrome.api);

  await adapter.getRecentlyClosed(10);
  await adapter.restoreSession("session-1");

  assert.deepEqual(chrome.calls, [
    ["sessions.getRecentlyClosed", { maxResults: 10 }],
    ["sessions.restore", "session-1"],
  ]);
});

test("subscribes to session changes only when Chrome supports them", () => {
  const chrome = createFakeChrome();
  const listener = () => {};

  createChromeAdapter(chrome.api).onSessionsChanged(listener);
  assert.equal(chrome.api.sessions.onChanged.listeners.has(listener), true);

  assert.doesNotThrow(() => createChromeAdapter({}).onSessionsChanged(listener));
  assert.doesNotThrow(() =>
    createChromeAdapter({ sessions: {} }).onSessionsChanged(listener),
  );
});

test("subscribes to exactly the seven live summary tab events", () => {
  assert.deepEqual(LIVE_SUMMARY_TAB_EVENTS, [
    "onCreated",
    "onUpdated",
    "onMoved",
    "onAttached",
    "onDetached",
    "onRemoved",
    "onReplaced",
  ]);
});

test("registers and releases every live summary tab event", () => {
  const chrome = createFakeChrome();
  const adapter = createChromeAdapter(chrome.api);
  const listener = () => {};

  const stopListening = adapter.onTabsChanged(listener);

  for (const name of LIVE_SUMMARY_TAB_EVENTS) {
    assert.equal(chrome.tabEvents[name].listeners.has(listener), true, name);
  }

  stopListening();

  for (const name of LIVE_SUMMARY_TAB_EVENTS) {
    assert.equal(chrome.tabEvents[name].listeners.size, 0, name);
  }
});
