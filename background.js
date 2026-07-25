import {
  claimUndoTransaction,
  createUndoTransaction,
  discardQueuedTab,
  getRestorationOutcome,
  getUndoTransactionSummary,
  markTabClosed,
  markTabRestored,
  queueClosedTabs,
  reopenUndoTransaction,
  UNDO_TRANSACTION_STATE,
} from "./undo-logic.mjs";
import {
  buildOrganizationRestorationPlan,
  claimOrganizationUndoTransaction,
  commitOrganizationUndoTransaction,
  createOrganizationUndoTransaction,
  getOrganizationUndoSummary,
  reopenOrganizationUndoTransaction,
} from "./organization-undo.mjs";

const DUPLICATE_STORAGE_KEY = "latestDuplicateCleanup";
const ORGANIZATION_STORAGE_KEY = "latestOrganizationAction";
const PENDING_ORGANIZATION_STORAGE_KEY = "pendingOrganizationAction";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(
    (result) => sendResponse({ ok: true, ...result }),
    (error) =>
      sendResponse({
        ok: false,
        error: getErrorMessage(error),
      }),
  );

  return true;
});

async function handleMessage(message) {
  switch (message?.type) {
    case "BEGIN_DUPLICATE_CLEANUP":
      return beginDuplicateCleanup(message.windowId);
    case "CLOSE_CLEANUP_TABS":
      return closeCleanupTabs(message.transactionId, message.tabs);
    case "GET_DUPLICATE_CLEANUP_UNDO":
      return {
        transaction: getUndoTransactionSummary(await readTransaction()),
      };
    case "RESTORE_DUPLICATE_CLEANUP":
      return restoreDuplicateCleanup(message.transactionId);
    case "RUN_ORGANIZATION_ACTION":
      return runOrganizationAction(message);
    case "GET_ORGANIZATION_UNDO":
      return {
        transaction: getOrganizationUndoSummary(
          await readOrganizationTransaction(),
        ),
      };
    case "RESTORE_ORGANIZATION_ACTION":
      return restoreOrganizationAction(message.transactionId);
    default:
      throw new Error("Unknown Tab Control message.");
  }
}

async function beginDuplicateCleanup(windowId) {
  const transaction = createUndoTransaction({
    id: crypto.randomUUID(),
    windowId,
  });
  await saveTransaction(transaction);

  return {
    transaction: getClientTransaction(transaction),
  };
}

async function closeCleanupTabs(transactionId, tabs = []) {
  let transaction = await getOpenTransaction(transactionId);
  transaction = queueClosedTabs(transaction, tabs);
  await saveTransaction(transaction);

  const requestedIds = new Set(
    tabs.filter((tab) => Number.isInteger(tab?.id)).map((tab) => tab.id),
  );
  const queuedTabs = transaction.tabs.filter(
    (tab) =>
      requestedIds.has(tab.originalTabId) && tab.state === "pending",
  );
  let closedNow = 0;
  let failed = 0;

  for (const tab of queuedTabs) {
    transaction = await getOpenTransaction(transactionId);

    try {
      await chrome.tabs.remove(tab.originalTabId);
      transaction = markTabClosed(transaction, tab.originalTabId);
      closedNow += 1;
    } catch {
      transaction = discardQueuedTab(transaction, tab.originalTabId);
      failed += 1;
    }

    await saveTransaction(transaction);
  }

  return {
    transaction: getClientTransaction(transaction),
    closedNow,
    failed,
  };
}

async function restoreDuplicateCleanup(transactionId) {
  const transaction = await readTransaction();

  if (
    !transaction ||
    transaction.id !== transactionId ||
    transaction.state !== UNDO_TRANSACTION_STATE.OPEN
  ) {
    return {
      outcome: { status: "expired" },
      transaction: null,
    };
  }

  let claimedTransaction = claimUndoTransaction(transaction);

  if (!claimedTransaction) {
    await removeTransaction(transactionId);
    return {
      outcome: { status: "expired" },
      transaction: null,
    };
  }

  await saveTransaction(claimedTransaction);
  const errors = [];

  for (const tab of claimedTransaction.tabs) {
    try {
      const restoredTab = await createRestoredTab(tab);
      claimedTransaction = markTabRestored(
        claimedTransaction,
        tab.originalTabId,
        restoredTab.id,
      );
      await saveTransaction(claimedTransaction);
    } catch (error) {
      errors.push(getErrorMessage(error));
    }
  }

  const outcome = getRestorationOutcome(claimedTransaction, errors);

  if (outcome.status === "failed") {
    const retryableTransaction = reopenUndoTransaction(claimedTransaction);
    await saveTransaction(retryableTransaction);

    return {
      outcome,
      transaction: getClientTransaction(retryableTransaction),
    };
  }

  await removeTransaction(transactionId);

  return {
    outcome,
    transaction: null,
  };
}

async function beginOrganizationAction({
  action,
  label,
  count,
  windowIds = [],
}) {
  const uniqueWindowIds = [...new Set(windowIds)];
  const windows = await Promise.all(
    uniqueWindowIds.map((windowId) =>
      chrome.windows.get(windowId, { populate: true }),
    ),
  );
  const groupIds = new Set(
    windows.flatMap((window) =>
      (window.tabs || [])
        .filter((tab) => Number.isInteger(tab.groupId) && tab.groupId >= 0)
        .map((tab) => tab.groupId),
    ),
  );
  const groups = await Promise.all(
    [...groupIds].map((groupId) => chrome.tabGroups.get(groupId)),
  );
  const transaction = createOrganizationUndoTransaction({
    id: crypto.randomUUID(),
    action,
    label,
    count,
    windows,
    groups,
  });

  await savePendingOrganizationTransaction(transaction);

  return transaction;
}

async function commitOrganizationAction(pending) {
  const transaction = commitOrganizationUndoTransaction(pending);
  await saveOrganizationTransaction(transaction);
  await removePendingOrganizationTransaction(transaction.id);

  return getOrganizationUndoSummary(transaction);
}

async function runOrganizationAction(message) {
  const transaction = await beginOrganizationAction(message);
  const progress = { changedCount: 0 };

  try {
    await applyOrganizationAction(transaction, message.operation, progress);

    return {
      status: "completed",
      changedCount: progress.changedCount,
      transaction: await commitOrganizationAction(transaction),
    };
  } catch (error) {
    if (progress.changedCount === 0) {
      await removePendingOrganizationTransaction(transaction.id);
      return {
        status: "failed",
        changedCount: 0,
        transaction: null,
        error: getErrorMessage(error),
      };
    }

    const partialTransaction = {
      ...transaction,
      count: progress.changedCount,
      label: formatOrganizationActionLabel(
        transaction.action,
        progress.changedCount,
      ),
    };

    return {
      status: "partial",
      changedCount: progress.changedCount,
      transaction: await commitOrganizationAction(partialTransaction),
      error: getErrorMessage(error),
    };
  }
}

async function applyOrganizationAction(
  transaction,
  operation = {},
  progress,
) {
  switch (transaction.action) {
    case "sort": {
      const [window] = transaction.windows;
      const currentIds = window.tabs.map((tab) => tab.id);

      for (const [index, tabId] of (operation.tabIds || []).entries()) {
        await runWithTabEditRetry(() => chrome.tabs.move(tabId, { index }));

        if (currentIds[index] !== tabId) {
          progress.changedCount += 1;
        }
      }
      break;
    }
    case "group":
      for (const group of operation.groups || []) {
        const groupId = await runWithTabEditRetry(() =>
          chrome.tabs.group({ tabIds: group.tabIds }),
        );
        progress.changedCount += group.tabIds.length;
        await chrome.tabGroups.update(groupId, {
          title: group.title,
          color: group.color,
          collapsed: false,
        });
      }
      break;
    case "ungroup":
      await runWithTabEditRetry(() => chrome.tabs.ungroup(operation.tabIds));
      progress.changedCount = operation.tabIds.length;
      break;
    case "gather":
      for (const source of operation.sources || []) {
        await runWithTabEditRetry(() =>
          chrome.tabs.move(source.tabIds, {
            windowId: operation.targetWindowId,
            index: -1,
          }),
        );
        progress.changedCount += source.tabIds.length;
      }
      break;
    default:
      throw new Error("Unknown organization action.");
  }
}

function formatOrganizationActionLabel(action, count) {
  const verbs = {
    sort: "Sorted",
    group: "Grouped",
    ungroup: "Ungrouped",
    gather: "Gathered",
  };
  const verb = verbs[action] || "Changed";
  return `${verb} ${count} ${count === 1 ? "tab" : "tabs"}`;
}

async function restoreOrganizationAction(transactionId) {
  const transaction = await readOrganizationTransaction();

  if (!transaction || transaction.id !== transactionId) {
    return {
      outcome: { status: "expired" },
      transaction: null,
    };
  }

  let claimedTransaction = claimOrganizationUndoTransaction(transaction);

  if (!claimedTransaction) {
    return {
      outcome: { status: "expired" },
      transaction: null,
    };
  }

  await saveOrganizationTransaction(claimedTransaction);

  let plan;

  try {
    const [liveTabs, liveWindows] = await Promise.all([
      chrome.tabs.query({}),
      chrome.windows.getAll({ windowTypes: ["normal"] }),
    ]);
    plan = buildOrganizationRestorationPlan(
      claimedTransaction,
      liveTabs,
      liveWindows.map((window) => window.id),
    );
  } catch (error) {
    claimedTransaction = reopenOrganizationUndoTransaction(claimedTransaction);
    await saveOrganizationTransaction(claimedTransaction);

    return {
      outcome: {
        status: "failed",
        error: getErrorMessage(error),
      },
      transaction: getOrganizationUndoSummary(claimedTransaction),
    };
  }

  const result = await applyOrganizationRestoration(plan);

  if (result.status === "failed") {
    claimedTransaction = reopenOrganizationUndoTransaction(claimedTransaction);
    await saveOrganizationTransaction(claimedTransaction);

    return {
      outcome: result,
      transaction: getOrganizationUndoSummary(claimedTransaction),
    };
  }

  await removeOrganizationTransaction(transactionId);

  return {
    outcome: result,
    transaction: null,
  };
}

async function applyOrganizationRestoration(plan) {
  const windowIds = new Map();
  const placeholderTabIds = new Map();
  const createdWindowIds = [];
  const errors = [];
  let changed = false;

  for (const window of plan.windows) {
    if (window.exists) {
      windowIds.set(window.id, window.id);
      continue;
    }

    try {
      const restoredWindow = await chrome.windows.create(
        getRestoredWindowOptions(window),
      );
      const [placeholderTab] = restoredWindow.tabs?.length
        ? restoredWindow.tabs
        : await chrome.tabs.query({ windowId: restoredWindow.id });

      if (!Number.isInteger(placeholderTab?.id)) {
        throw new Error("Chrome did not create a restorable browser window.");
      }

      windowIds.set(window.id, restoredWindow.id);
      placeholderTabIds.set(window.id, placeholderTab.id);
      createdWindowIds.push(restoredWindow.id);
    } catch (error) {
      errors.push(getErrorMessage(error));
    }
  }

  if (errors.length > 0) {
    for (const windowId of createdWindowIds) {
      try {
        await chrome.windows.remove(windowId);
      } catch (error) {
        errors.push(getErrorMessage(error));
      }
    }

    return getOrganizationRestorationOutcome(false, errors);
  }

  const snapshotTabIds = new Set(
    plan.windows.flatMap((window) => window.tabs.map((tab) => tab.id)),
  );

  try {
    const liveTabs = await chrome.tabs.query({});
    const groupedTabsByWindow = new Map();

    for (const tab of liveTabs) {
      if (!snapshotTabIds.has(tab.id) || tab.groupId < 0) {
        continue;
      }

      const tabIds = groupedTabsByWindow.get(tab.windowId) || [];
      tabIds.push(tab.id);
      groupedTabsByWindow.set(tab.windowId, tabIds);
    }

    for (const tabIds of groupedTabsByWindow.values()) {
      await runWithTabEditRetry(() => chrome.tabs.ungroup(tabIds));
      changed = true;
    }
  } catch (error) {
    errors.push(getErrorMessage(error));
  }

  for (const window of plan.windows) {
    const restoredWindowId = windowIds.get(window.id);

    for (const tab of window.tabs) {
      try {
        await chrome.tabs.update(tab.id, { pinned: tab.pinned });
        await runWithTabEditRetry(() =>
          chrome.tabs.move(tab.id, {
            windowId: restoredWindowId,
            index: tab.index,
          }),
        );
        changed = true;

        if (tab.id === window.createWithTabId) {
          const placeholderTabId = placeholderTabIds.get(window.id);

          if (Number.isInteger(placeholderTabId)) {
            await chrome.tabs.remove(placeholderTabId);
          }
        }
      } catch (error) {
        errors.push(getErrorMessage(error));
      }
    }
  }

  for (const group of plan.groups) {
    if (group.tabIds.length === 0) {
      continue;
    }

    try {
      const groupId = await runWithTabEditRetry(() =>
        chrome.tabs.group({ tabIds: group.tabIds }),
      );
      await chrome.tabGroups.update(groupId, {
        title: group.title,
        color: group.color,
        collapsed: group.collapsed,
      });
      changed = true;
    } catch (error) {
      errors.push(getErrorMessage(error));
    }
  }

  for (const window of plan.windows) {
    if (!Number.isInteger(window.activeTabId)) {
      continue;
    }

    try {
      await chrome.tabs.update(window.activeTabId, { active: true });
      changed = true;
    } catch (error) {
      errors.push(getErrorMessage(error));
    }
  }

  const focusedWindow = plan.windows.find((window) => window.focused);

  if (focusedWindow) {
    try {
      await chrome.windows.update(windowIds.get(focusedWindow.id), {
        focused: true,
      });
      changed = true;
    } catch (error) {
      errors.push(getErrorMessage(error));
    }
  }

  return getOrganizationRestorationOutcome(changed, errors);
}

function getRestoredWindowOptions(window) {
  const options = {
    url: "about:blank",
    incognito: window.incognito,
    focused: false,
  };

  if (window.state !== "normal") {
    options.state = window.state;
    return options;
  }

  for (const property of ["left", "top", "width", "height"]) {
    if (Number.isInteger(window[property])) {
      options[property] = window[property];
    }
  }

  return options;
}

function getOrganizationRestorationOutcome(changed, errors) {
  if (errors.length === 0) {
    return { status: "restored", error: null };
  }

  return {
    status: changed ? "partial" : "failed",
    error: errors[0],
  };
}

async function createRestoredTab(snapshot) {
  const windowId = await findRestoreWindow(snapshot);
  const windowTabs = await chrome.tabs.query({ windowId });
  const index =
    snapshot.index < 0
      ? windowTabs.length
      : Math.min(snapshot.index, windowTabs.length);

  return chrome.tabs.create({
    windowId,
    index,
    url: snapshot.url,
    pinned: snapshot.pinned,
    active: false,
  });
}

async function findRestoreWindow(snapshot) {
  try {
    const originalWindow = await chrome.windows.get(snapshot.windowId);

    if (
      originalWindow.type === "normal" &&
      Boolean(originalWindow.incognito) === snapshot.incognito
    ) {
      return originalWindow.id;
    }
  } catch (error) {
    if (!getErrorMessage(error).includes("No window with id")) {
      throw error;
    }
  }

  const windows = await chrome.windows.getAll({
    windowTypes: ["normal"],
  });
  const fallbackWindow = windows.find(
    (window) => Boolean(window.incognito) === snapshot.incognito,
  );

  if (!Number.isInteger(fallbackWindow?.id)) {
    throw new Error("No compatible browser window is available.");
  }

  return fallbackWindow.id;
}

async function getOpenTransaction(transactionId) {
  const transaction = await readTransaction();

  if (
    !transaction ||
    transaction.id !== transactionId ||
    transaction.state !== UNDO_TRANSACTION_STATE.OPEN
  ) {
    throw new Error("This cleanup transaction is no longer available.");
  }

  return transaction;
}

async function readTransaction() {
  const stored = await chrome.storage.session.get(DUPLICATE_STORAGE_KEY);
  return stored[DUPLICATE_STORAGE_KEY] || null;
}

function saveTransaction(transaction) {
  return chrome.storage.session.set({
    [DUPLICATE_STORAGE_KEY]: transaction,
  });
}

function getClientTransaction(transaction) {
  return (
    getUndoTransactionSummary(transaction) || {
      id: transaction.id,
      count: 0,
      createdAt: transaction.createdAt,
    }
  );
}

async function removeTransaction(transactionId) {
  const transaction = await readTransaction();

  if (transaction?.id === transactionId) {
    await chrome.storage.session.remove(DUPLICATE_STORAGE_KEY);
  }
}

async function readOrganizationTransaction() {
  const stored = await chrome.storage.session.get(ORGANIZATION_STORAGE_KEY);
  return stored[ORGANIZATION_STORAGE_KEY] || null;
}

function saveOrganizationTransaction(transaction) {
  return chrome.storage.session.set({
    [ORGANIZATION_STORAGE_KEY]: transaction,
  });
}

async function removeOrganizationTransaction(transactionId) {
  const transaction = await readOrganizationTransaction();

  if (transaction?.id === transactionId) {
    await chrome.storage.session.remove(ORGANIZATION_STORAGE_KEY);
  }
}

async function readPendingOrganizationTransaction() {
  const stored = await chrome.storage.session.get(
    PENDING_ORGANIZATION_STORAGE_KEY,
  );
  return stored[PENDING_ORGANIZATION_STORAGE_KEY] || null;
}

function savePendingOrganizationTransaction(transaction) {
  return chrome.storage.session.set({
    [PENDING_ORGANIZATION_STORAGE_KEY]: transaction,
  });
}

async function removePendingOrganizationTransaction(transactionId) {
  const transaction = await readPendingOrganizationTransaction();

  if (transaction?.id === transactionId) {
    await chrome.storage.session.remove(PENDING_ORGANIZATION_STORAGE_KEY);
  }
}

async function runWithTabEditRetry(operation) {
  const retryLimit = 3;

  for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const isTemporaryEditLock = getErrorMessage(error).includes(
        "Tabs cannot be edited right now",
      );

      if (!isTemporaryEditLock || attempt === retryLimit) {
        throw error;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, 60 * (attempt + 1));
      });
    }
  }
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
