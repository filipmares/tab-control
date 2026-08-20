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
    update() {
      return Promise.resolve();
    },
    create() {},
  },
  tabGroups: {
    get(groupId) {
      return Promise.resolve(groupTitles.get(groupId) || {});
    },
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
    case "GET_UNDO_TRANSACTION":
    case "GET_DUPLICATE_CLEANUP_UNDO":
      return {
        ok: true,
        transaction: transaction?.operation
          ? summarizeUndoTransaction()
          : transaction,
      };
    case "BEGIN_UNDO_OPERATION":
      transaction = {
        id: "operation-1",
        operation: message.operation,
        data: normalizeUndoData(message.operation, message.data),
      };
      return { ok: true, transaction: summarizeUndoTransaction() };
    case "UPDATE_UNDO_OPERATION":
      transaction = {
        ...transaction,
        data: {
          ...transaction.data,
          ...message.data,
        },
      };
      return { ok: true, transaction: summarizeUndoTransaction() };
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

function normalizeUndoData(operation, data = {}) {
  if (operation === "group-tabs") {
    return {
      groups: (data.groups || []).map((group) => ({
        ...group,
        groupId: Number.isInteger(group.groupId) ? group.groupId : null,
        state: group.state || "planned",
      })),
    };
  }

  if (operation === "gather-tabs-here") {
    return {
      tabs: (data.tabs || []).map((tab) => ({
        ...tab,
        state: tab.state || "pending",
      })),
    };
  }

  return { ...data };
}

function summarizeUndoTransaction() {
  const data = transaction.data || {};
  let count = 0;
  const summary = {
    id: transaction.id,
    count: 0,
    operation: transaction.operation,
  };

  if (transaction.operation === "sort-by-domain") {
    count = (data.tabs || []).length;
  } else if (transaction.operation === "group-tabs") {
    const groups = (data.groups || []).filter((group) =>
      Number.isInteger(group.groupId),
    );
    count = groups.reduce((total, group) => total + group.tabIds.length, 0);
    summary.groupCount = groups.length;
  } else if (transaction.operation === "ungroup-tabs") {
    const groups = data.groups || [];
    count = groups.reduce((total, group) => total + group.tabIds.length, 0);
    summary.groupCount = groups.length;
  } else if (transaction.operation === "gather-tabs-here") {
    const tabs = (data.tabs || []).filter((tab) => tab.state === "moved");
    count = tabs.length;
    summary.windowCount = new Set(
      tabs.map((tab) => tab.sourceWindowId),
    ).size;
  }

  return { ...summary, count };
}

// The popup moves focus when views change, which paints focus rings that imply
// a keyboard selection the reader did not make. Captures emulate mouse-driven
// use, so programmatic focus is disabled for the harness only.
HTMLElement.prototype.focus = function noopFocus() {};

if (scenario.drive) {
  window.addEventListener("load", () => {
    setTimeout(() => {
      document.getElementById(scenario.drive)?.click();
      setTimeout(() => document.activeElement?.blur(), 200);
    }, 120);
  });
}

// The build reads this with --dump-dom to size a tightly cropped capture.
// documentElement.scrollHeight would report the viewport height, so measure the
// popup element itself.
window.addEventListener("load", () => {
  for (const delay of [300, 900, 1800, 3000, 4200]) {
    setTimeout(() => {
      const popup = document.querySelector(".popup");

      if (popup) {
        document.documentElement.dataset.popupHeight = String(
          Math.ceil(popup.getBoundingClientRect().height),
        );
      }
    }, delay);
  }
});
