export const UNDO_TRANSACTION_STATE = Object.freeze({
  OPEN: "open",
  RESTORING: "restoring",
});

export const UNDO_TAB_STATE = Object.freeze({
  PENDING: "pending",
  CLOSED: "closed",
});

export const UNDO_RESTORATION_METHOD = Object.freeze({
  SESSION: "session",
  URL: "url",
});

export function createUndoTransaction({
  id,
  windowId,
  createdAt = Date.now(),
}) {
  if (!id || !Number.isInteger(windowId)) {
    throw new TypeError("Undo transactions require an id and window id.");
  }

  return {
    id,
    windowId,
    createdAt,
    state: UNDO_TRANSACTION_STATE.OPEN,
    tabs: [],
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
  if (!transaction || transaction.state !== UNDO_TRANSACTION_STATE.OPEN) {
    return [];
  }

  return transaction.tabs
    .filter((tab) => tab.state === UNDO_TAB_STATE.CLOSED)
    .sort(compareTabSnapshots);
}

export function getUndoTransactionSummary(transaction) {
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

export function claimUndoTransaction(transaction) {
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
  if (transaction.tabs.some(isTabRestored)) {
    throw new Error("A partially restored transaction cannot be retried.");
  }

  return {
    ...transaction,
    state: UNDO_TRANSACTION_STATE.OPEN,
  };
}

export function getRestorationOutcome(transaction, errors = []) {
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

function isTabRestored(tab) {
  return tab.restored === true || Number.isInteger(tab.restoredTabId);
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
