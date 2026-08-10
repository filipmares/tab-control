import { scenarios } from "./scenarios.mjs";

const params = new URLSearchParams(location.search);
const scenarioName = params.get("scenario") || "actions";
const scenario = scenarios[scenarioName] || scenarios.actions;
const world = scenario.world();

let nextGroupId = 900;
const groupTitles = new Map();

function allTabs() {
  return world.windows.flatMap((window) => window.tabs);
}

function reindex() {
  for (const window of world.windows) {
    window.tabs.forEach((tab, index) => {
      tab.index = index;
      tab.windowId = window.id;
    });
  }
}

reindex();

function withDefaults(tab) {
  return {
    groupId: -1,
    pinned: false,
    active: false,
    ...tab,
  };
}

globalThis.chrome = {
  runtime: {
    sendMessage(message) {
      return Promise.resolve(handleBackgroundMessage(message));
    },
  },
  windows: {
    getCurrent() {
      const current = world.windows.find(
        (window) => window.id === world.currentWindowId,
      );
      return Promise.resolve({ ...current, tabs: undefined });
    },
    getAll() {
      return Promise.resolve(
        world.windows.map((window) => ({
          ...window,
          tabs: window.tabs.map(withDefaults),
        })),
      );
    },
  },
  tabs: {
    query() {
      const current = world.windows.find(
        (window) => window.id === world.currentWindowId,
      );
      return Promise.resolve(current.tabs.map(withDefaults));
    },
    group({ tabIds }) {
      const groupId = (nextGroupId += 1);
      for (const tab of allTabs()) {
        if (tabIds.includes(tab.id)) {
          tab.groupId = groupId;
        }
      }
      return Promise.resolve(groupId);
    },
    ungroup(tabIds) {
      for (const tab of allTabs()) {
        if (tabIds.includes(tab.id)) {
          tab.groupId = -1;
        }
      }
      return Promise.resolve();
    },
    move() {
      return Promise.resolve();
    },
    create() {},
  },
  tabGroups: {
    update(groupId, properties) {
      groupTitles.set(groupId, properties);
      return Promise.resolve();
    },
  },
  sessions: {
    getRecentlyClosed({ maxResults }) {
      return Promise.resolve(world.recentlyClosed.slice(0, maxResults));
    },
    restore() {
      return Promise.resolve();
    },
    onChanged: { addListener() {} },
  },
};

let transaction = null;

function handleBackgroundMessage(message) {
  switch (message.type) {
    case "GET_DUPLICATE_CLEANUP_UNDO":
      return { ok: true, transaction };
    case "BEGIN_DUPLICATE_CLEANUP":
      transaction = { id: "cleanup-1", count: 0 };
      return { ok: true, transaction };
    case "CLOSE_CLEANUP_TABS": {
      const closedIds = new Set(message.tabs.map((tab) => tab.id));
      for (const window of world.windows) {
        window.tabs = window.tabs.filter((tab) => !closedIds.has(tab.id));
      }
      reindex();
      transaction = {
        id: "cleanup-1",
        count: transaction.count + closedIds.size,
      };
      return {
        ok: true,
        transaction,
        closedNow: closedIds.size,
        failed: 0,
      };
    }
    default:
      return { ok: true, transaction };
  }
}

if (scenario.drive) {
  window.addEventListener("load", () => {
    setTimeout(() => {
      document.getElementById(scenario.drive)?.click();

      // The popup focuses controls as views change, so keep clearing focus
      // until the capture settles to keep screenshots deterministic.
      for (const delay of [200, 600, 1200, 2000, 3000, 4000]) {
        setTimeout(() => document.activeElement?.blur(), delay);
      }
    }, 120);
  });
}
