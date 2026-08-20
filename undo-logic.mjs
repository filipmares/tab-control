export const UNDO_TRANSACTION_STATE = Object.freeze({
  OPEN: "open",
  RESTORING: "restoring",
});

export const UNDO_TAB_STATE = Object.freeze({
  PENDING: "pending",
  CLOSED: "closed",
});

export const UNDO_OPERATION = Object.freeze({
  DUPLICATE_CLEANUP: "duplicate-cleanup",
  SORT_BY_DOMAIN: "sort-by-domain",
  GROUP_TABS: "group-tabs",
  UNGROUP_TABS: "ungroup-tabs",
  GATHER_TABS_HERE: "gather-tabs-here",
});

export const UNDO_RESTORATION_METHOD = Object.freeze({
  SESSION: "session",
  URL: "url",
});

export function createUndoTransaction({
  id,
  windowId,
  operation = UNDO_OPERATION.DUPLICATE_CLEANUP,
  data = {},
  createdAt = Date.now(),
}) {
  if (!id || !Number.isInteger(windowId)) {
    throw new TypeError("Undo transactions require an id and window id.");
  }

  return {
    id,
    windowId,
    operation,
    createdAt,
    state: UNDO_TRANSACTION_STATE.OPEN,
    tabs: [],
    ...(operation === UNDO_OPERATION.DUPLICATE_CLEANUP
      ? {}
      : { data: normalizeOperationData(operation, data) }),
  };
}

export function queueClosedTabs(transaction, tabs) {
  const existingIds = new Set(
    transaction.tabs.map((tab) => tab.originalTabId),
  );
  const queuedTabs = [];

  for (const tab of tabs) {
    const snapshot = createTabSnapshot(tab);

    if (!snapshot || existingIds.has(snapshot.originalTabId)) {
      continue;
    }

    existingIds.add(snapshot.originalTabId);
    queuedTabs.push(snapshot);
  }

  return {
    ...transaction,
    tabs: [...transaction.tabs, ...queuedTabs],
  };
}

export function queueSortedTabs(transaction, tabs) {
  return updateOperationData(transaction, {
    tabs: tabs
      .map((tab) => ({
        tabId: getTabId(tab),
        windowId: tab.windowId,
        index: tab.index,
        pinned: Boolean(tab.pinned),
        state: "pending",
      }))
      .filter(
        (tab) =>
          Number.isInteger(tab.tabId) &&
          Number.isInteger(tab.windowId) &&
          Number.isInteger(tab.index),
      ),
  });
}

export function queueGroupedTabs(transaction, groups) {
  return updateOperationData(transaction, {
    groups: groups.map((group) => ({
      groupId: Number.isInteger(group.groupId) ? group.groupId : null,
      tabIds: getTabIds(group.tabIds),
      state: Number.isInteger(group.groupId) ? "created" : "planned",
      restoredTabIds: [],
      failedTabIds: [],
      failure: null,
    })),
  });
}

export function queueUngroupedTabs(transaction, groups) {
  return updateOperationData(transaction, {
    groups: groups.map((group) => ({
      groupId: group.groupId,
      title: typeof group.title === "string" ? group.title : "",
      color: group.color || "grey",
      collapsed: Boolean(group.collapsed),
      tabIds: getTabIds(group.tabIds),
      state: "captured",
      restoredTabIds: [],
      failedTabIds: [],
      failure: null,
    })),
  });
}

export function queueGatheredTabs(transaction, tabs) {
  return updateOperationData(transaction, {
    tabs: tabs
      .map((tab) => ({
        tabId: getTabId(tab),
        sourceWindowId: Number.isInteger(tab.sourceWindowId)
          ? tab.sourceWindowId
          : tab.windowId,
        index: tab.index,
        incognito: Boolean(tab.incognito),
        state: "pending",
        warning: null,
      }))
      .filter(
        (tab) =>
          Number.isInteger(tab.tabId) &&
          Number.isInteger(tab.sourceWindowId) &&
          Number.isInteger(tab.index),
      ),
  });
}

export function updateOperationData(transaction, data) {
  return updateOperationDataInternal(transaction, data);
}

export function markTabClosed(transaction, originalTabId, sessionId = null) {
  return updateTransactionTab(transaction, originalTabId, (tab) => ({
    ...tab,
    sessionId: typeof sessionId === "string" && sessionId ? sessionId : null,
    state: UNDO_TAB_STATE.CLOSED,
  }));
}

export function findClosedTabSessionId(
  sessions,
  snapshot,
  previousSessionIds = [],
) {
  if (!Array.isArray(sessions) || !snapshot) {
    return null;
  }

  const previousIds = new Set(previousSessionIds);
  const candidates = sessions
    .map((session) => session?.tab)
    .filter(
      (tab) =>
        typeof tab?.sessionId === "string" &&
        tab.sessionId &&
        !previousIds.has(tab.sessionId),
    );
  const matchingTab = candidates.find(
    (tab) =>
      tab.url === snapshot.url &&
      (!Number.isInteger(tab.windowId) ||
        tab.windowId === snapshot.windowId),
  );

  if (matchingTab) {
    return matchingTab.sessionId;
  }

  return candidates.length === 1 ? candidates[0].sessionId : null;
}

export function getClosedTabSessionIds(sessions) {
  if (!Array.isArray(sessions)) {
    return [];
  }

  return sessions
    .map((session) => session?.tab?.sessionId)
    .filter((sessionId) => typeof sessionId === "string" && sessionId);
}

export function discardQueuedTab(transaction, originalTabId) {
  return {
    ...transaction,
    tabs: transaction.tabs.filter(
      (tab) => tab.originalTabId !== originalTabId,
    ),
  };
}

export function getRecoverableTabs(transaction) {
  if (
    !transaction ||
    transaction.operation !== UNDO_OPERATION.DUPLICATE_CLEANUP ||
    transaction.state !== UNDO_TRANSACTION_STATE.OPEN
  ) {
    return [];
  }

  return transaction.tabs
    .filter((tab) => tab.state === UNDO_TAB_STATE.CLOSED)
    .sort(compareTabSnapshots);
}

export function getUndoTransactionSummary(transaction) {
  if (!transaction || transaction.state !== UNDO_TRANSACTION_STATE.OPEN) {
    return null;
  }

  if (getOperation(transaction) === UNDO_OPERATION.DUPLICATE_CLEANUP) {
    const recoverableTabs = getRecoverableTabs(transaction);

    if (recoverableTabs.length === 0) {
      return null;
    }

    return {
      id: transaction.id,
      count: recoverableTabs.length,
      createdAt: transaction.createdAt,
    };
  }

  const summary = getOperationSummary(transaction);

  return summary.count > 0 ? summary : null;
}

export function claimUndoTransaction(transaction) {
  if (!transaction || transaction.state !== UNDO_TRANSACTION_STATE.OPEN) {
    return null;
  }

  if (getOperation(transaction) === UNDO_OPERATION.DUPLICATE_CLEANUP) {
    const recoverableTabs = getRecoverableTabs(transaction);

    if (recoverableTabs.length === 0) {
      return null;
    }

    return {
      ...transaction,
      state: UNDO_TRANSACTION_STATE.RESTORING,
      tabs: recoverableTabs,
    };
  }

  return getUndoTransactionSummary(transaction)
    ? { ...transaction, state: UNDO_TRANSACTION_STATE.RESTORING }
    : null;
}

export function markTabRestored(
  transaction,
  originalTabId,
  restoredTabId,
  restorationMethod = UNDO_RESTORATION_METHOD.URL,
) {
  return updateTransactionTab(transaction, originalTabId, (tab) => ({
    ...tab,
    restored: true,
    restoredTabId: Number.isInteger(restoredTabId) ? restoredTabId : null,
    restorationMethod,
  }));
}

export function reopenUndoTransaction(transaction) {
  if (hasRestoredOperationItems(transaction)) {
    throw new Error("A partially restored transaction cannot be retried.");
  }

  return {
    ...transaction,
    state: UNDO_TRANSACTION_STATE.OPEN,
  };
}

export function getRestorationOutcome(transaction, errors = []) {
  if (getOperation(transaction) === UNDO_OPERATION.DUPLICATE_CLEANUP) {
    return getClosedTabRestorationOutcome(transaction, errors);
  }

  const stats = getOperationRestorationStats(transaction);
  const failureDetails = [
    ...stats.failures,
    ...(stats.warnings.length > 0 ? stats.warnings : []),
  ];
  const restored = stats.restored;
  const failed = stats.failed;

  return {
    operation: getOperation(transaction),
    status:
      restored === stats.total && failed === 0 && stats.warnings.length === 0
        ? "restored"
        : restored > 0
          ? "partial"
          : "failed",
    total: stats.total,
    restored,
    failed,
    ...(getOperation(transaction) === UNDO_OPERATION.GROUP_TABS ||
    getOperation(transaction) === UNDO_OPERATION.UNGROUP_TABS
      ? { groupCount: transaction.data?.groups?.length || 0 }
      : {}),
    ...(getOperation(transaction) === UNDO_OPERATION.GATHER_TABS_HERE
      ? {
          windowCount: new Set(
            (transaction.data?.tabs || []).map(
              (tab) => tab.sourceWindowId,
            ),
          ).size,
        }
      : {}),
    failures: failureDetails,
    error: errors[0] || null,
  };
}

export function getOperationRestorationStats(transaction) {
  const operation = getOperation(transaction);
  const data = transaction?.data || {};

  if (operation === UNDO_OPERATION.SORT_BY_DOMAIN) {
    return getItemStats(data.tabs, (tab) => tab.state === "restored");
  }

  if (
    operation === UNDO_OPERATION.GROUP_TABS ||
    operation === UNDO_OPERATION.UNGROUP_TABS
  ) {
    const groups = (Array.isArray(data.groups) ? data.groups : []).filter(
      (group) => group.state !== "planned",
    );
    const total = groups.reduce((count, group) => count + group.tabIds.length, 0);
    const restored = groups.reduce(
      (count, group) => count + group.restoredTabIds.length,
      0,
    );
    const failed = total - restored;
    const failures = groups
      .map((group) => group.failure)
      .filter((failure) => typeof failure === "string" && failure);

    return {
      total,
      restored,
      failed,
      failures,
      warnings: Array.isArray(data.warnings) ? data.warnings : [],
    };
  }

  if (operation === UNDO_OPERATION.GATHER_TABS_HERE) {
    const tabs = Array.isArray(data.tabs) ? data.tabs : [];
    const restored = tabs.filter((tab) => tab.state === "restored").length;
    const failed = tabs.filter((tab) => tab.state === "failed").length;

    return {
      total: tabs.filter((tab) => tab.state !== "pending").length,
      restored,
      failed,
      failures: tabs
        .map((tab) => tab.failure)
        .filter((failure) => typeof failure === "string" && failure),
      warnings: tabs
        .map((tab) => tab.warning)
        .filter((warning) => typeof warning === "string" && warning),
    };
  }

  return { total: 0, restored: 0, failed: 0, failures: [], warnings: [] };
}

function getClosedTabRestorationOutcome(transaction, errors) {
  const total = transaction.tabs.length;
  const restored = transaction.tabs.filter(isTabRestored).length;
  const historyRestored = transaction.tabs.filter(
    (tab) =>
      isTabRestored(tab) &&
      tab.restorationMethod === UNDO_RESTORATION_METHOD.SESSION,
  ).length;
  const failed = total - restored;

  return {
    status:
      restored === total
        ? "restored"
        : restored > 0
          ? "partial"
          : "failed",
    total,
    restored,
    historyRestored,
    recreated: restored - historyRestored,
    failed,
    error: errors[0] || null,
  };
}

function getOperationSummary(transaction) {
  const operation = getOperation(transaction);
  const data = transaction.data || {};
  let count = 0;
  const summary = {
    id: transaction.id,
    count: 0,
    createdAt: transaction.createdAt,
    operation,
  };

  if (operation === UNDO_OPERATION.SORT_BY_DOMAIN) {
    count = Array.isArray(data.tabs) ? data.tabs.length : 0;
  } else if (
    operation === UNDO_OPERATION.GROUP_TABS ||
    operation === UNDO_OPERATION.UNGROUP_TABS
  ) {
    const groups = (
      Array.isArray(data.groups) ? data.groups : []
    ).filter(
      (group) =>
        operation === UNDO_OPERATION.UNGROUP_TABS ||
        Number.isInteger(group.groupId),
    );
    count = groups.reduce(
      (total, group) => total + group.tabIds.length,
      0,
    );
    summary.groupCount = groups.length;
  } else if (operation === UNDO_OPERATION.GATHER_TABS_HERE) {
    const tabs = Array.isArray(data.tabs) ? data.tabs : [];
    count = tabs.filter((tab) => tab.state === "moved").length;
    summary.windowCount = new Set(
      tabs
        .filter((tab) => tab.state === "moved")
        .map((tab) => tab.sourceWindowId),
    ).size;
  }

  return { ...summary, count };
}

function getOperation(transaction) {
  return transaction?.operation || UNDO_OPERATION.DUPLICATE_CLEANUP;
}

function normalizeOperationData(operation, data) {
  if (operation === UNDO_OPERATION.SORT_BY_DOMAIN) {
    return queueSortedTabs(
      { operation, data: {} },
      data.tabs || [],
    ).data;
  }

  if (operation === UNDO_OPERATION.GROUP_TABS) {
    return queueGroupedTabs(
      { operation, data: {} },
      data.groups || [],
    ).data;
  }

  if (operation === UNDO_OPERATION.UNGROUP_TABS) {
    return queueUngroupedTabs(
      { operation, data: {} },
      data.groups || [],
    ).data;
  }

  if (operation === UNDO_OPERATION.GATHER_TABS_HERE) {
    return queueGatheredTabs(
      { operation, data: {} },
      data.tabs || [],
    ).data;
  }

  return { ...data };
}

function updateOperationDataInternal(transaction, data) {
  return {
    ...transaction,
    data: {
      ...(transaction.data || {}),
      ...data,
    },
  };
}

function getItemStats(items, isRestored) {
  const values = Array.isArray(items) ? items : [];

  return {
    total: values.length,
    restored: values.filter(isRestored).length,
    failed: values.filter((item) => item.state === "failed").length,
    failures: values
      .map((item) => item.failure)
      .filter((failure) => typeof failure === "string" && failure),
    warnings: values
      .map((item) => item.warning)
      .filter((warning) => typeof warning === "string" && warning),
  };
}

function hasRestoredOperationItems(transaction) {
  if (getOperation(transaction) === UNDO_OPERATION.DUPLICATE_CLEANUP) {
    return transaction.tabs.some(isTabRestored);
  }

  return getOperationRestorationStats(transaction).restored > 0;
}

function createTabSnapshot(tab) {
  const url = tab.pendingUrl || tab.url || "";

  if (
    !Number.isInteger(tab.id) ||
    !Number.isInteger(tab.windowId) ||
    !url
  ) {
    return null;
  }

  return {
    originalTabId: tab.id,
    windowId: tab.windowId,
    index: Number.isInteger(tab.index) ? tab.index : -1,
    url,
    pinned: Boolean(tab.pinned),
    incognito: Boolean(tab.incognito),
    sessionId: null,
    state: UNDO_TAB_STATE.PENDING,
  };
}

function updateTransactionTab(transaction, originalTabId, update) {
  return {
    ...transaction,
    tabs: transaction.tabs.map((tab) =>
      tab.originalTabId === originalTabId ? update(tab) : tab,
    ),
  };
}

function getTabId(tab) {
  return Number.isInteger(tab?.tabId) ? tab.tabId : tab?.id;
}

function getTabIds(tabIds) {
  return Array.isArray(tabIds)
    ? tabIds.filter((tabId) => Number.isInteger(tabId))
    : [];
}

function compareTabSnapshots(left, right) {
  if (left.windowId !== right.windowId) {
    return left.windowId - right.windowId;
  }

  const leftIndex =
    left.index < 0 ? Number.MAX_SAFE_INTEGER : left.index;
  const rightIndex =
    right.index < 0 ? Number.MAX_SAFE_INTEGER : right.index;

  if (leftIndex !== rightIndex) {
    return leftIndex - rightIndex;
  }

  return left.originalTabId - right.originalTabId;
}

function isTabRestored(tab) {
  return tab.restored === true || Number.isInteger(tab.restoredTabId);
}
