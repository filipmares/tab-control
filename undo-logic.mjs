export const UNDO_TRANSACTION_STATE = Object.freeze({
  OPEN: "open",
  RESTORING: "restoring",
});

export const UNDO_TAB_STATE = Object.freeze({
  PENDING: "pending",
  CLOSED: "closed",
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

export function markTabClosed(transaction, originalTabId) {
  return updateTransactionTab(transaction, originalTabId, (tab) => ({
    ...tab,
    state: UNDO_TAB_STATE.CLOSED,
  }));
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
) {
  return updateTransactionTab(transaction, originalTabId, (tab) => ({
    ...tab,
    restoredTabId,
  }));
}

export function reopenUndoTransaction(transaction) {
  if (transaction.tabs.some((tab) => Number.isInteger(tab.restoredTabId))) {
    throw new Error("A partially restored transaction cannot be retried.");
  }

  return {
    ...transaction,
    state: UNDO_TRANSACTION_STATE.OPEN,
  };
}

export function getRestorationOutcome(transaction, errors = []) {
  const total = transaction.tabs.length;
  const restored = transaction.tabs.filter((tab) =>
    Number.isInteger(tab.restoredTabId),
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
