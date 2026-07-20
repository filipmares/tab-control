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

const STORAGE_KEY = "latestDuplicateCleanup";

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
  const stored = await chrome.storage.session.get(STORAGE_KEY);
  return stored[STORAGE_KEY] || null;
}

function saveTransaction(transaction) {
  return chrome.storage.session.set({
    [STORAGE_KEY]: transaction,
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
    await chrome.storage.session.remove(STORAGE_KEY);
  }
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
