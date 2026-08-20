import {
  claimUndoTransaction,
  createUndoTransaction,
  discardQueuedTab,
  findClosedTabSessionId,
  getClosedTabSessionIds,
  getRestorationOutcome,
  getUndoTransactionSummary,
  markTabClosed,
  markTabRestored,
  queueClosedTabs,
  reopenUndoTransaction,
  UNDO_RESTORATION_METHOD,
  UNDO_TRANSACTION_STATE,
} from "./undo-logic.mjs";

const STORAGE_KEY = "latestDuplicateCleanup";
const RECENT_SESSION_CAPTURE_LIMIT = 25;

export function createBackgroundMessageListener(browser) {
  const handleMessage = createBackgroundMessageHandler(browser);

  return (message, _sender, sendResponse) => {
    handleMessage(message).then(
      (result) => sendResponse({ ok: true, ...result }),
      (error) =>
        sendResponse({
          ok: false,
          error: getErrorMessage(error),
        }),
    );

    return true;
  };
}

export function createBackgroundMessageHandler(browser) {
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
      id: browser.generateId(),
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
      const previousSessions = await readRecentlyClosedSessions();

      try {
        await browser.removeTab(tab.originalTabId);
      } catch {
        transaction = discardQueuedTab(transaction, tab.originalTabId);
        failed += 1;
        await saveTransaction(transaction);
        continue;
      }

      const sessionId = await captureClosedTabSessionId(
        tab,
        previousSessions,
      );
      transaction = markTabClosed(
        transaction,
        tab.originalTabId,
        sessionId,
      );
      closedNow += 1;
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
        const restoration = await restoreTab(tab);
        claimedTransaction = markTabRestored(
          claimedTransaction,
          tab.originalTabId,
          restoration.restoredTabId,
          restoration.method,
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

  async function restoreTab(snapshot) {
    if (!snapshot.sessionId) {
      return {
        restoredTabId: (await createRestoredTab(snapshot)).id,
        method: UNDO_RESTORATION_METHOD.URL,
      };
    }

    try {
      const session = await browser.restoreSession(snapshot.sessionId);

      return {
        restoredTabId: session?.tab?.id,
        method: UNDO_RESTORATION_METHOD.SESSION,
      };
    } catch (sessionError) {
      try {
        return {
          restoredTabId: (await createRestoredTab(snapshot)).id,
          method: UNDO_RESTORATION_METHOD.URL,
        };
      } catch (createError) {
        throw new Error(
          `Chrome could not restore the saved tab session (${getErrorMessage(sessionError)}) or recreate its address (${getErrorMessage(createError)}).`,
        );
      }
    }
  }

  async function createRestoredTab(snapshot) {
    const windowId = await findRestoreWindow(snapshot);
    const windowTabs = await browser.queryWindowTabs(windowId);
    const index =
      snapshot.index < 0
        ? windowTabs.length
        : Math.min(snapshot.index, windowTabs.length);

    return browser.createTab({
      windowId,
      index,
      url: snapshot.url,
      pinned: snapshot.pinned,
      active: false,
    });
  }

  async function captureClosedTabSessionId(snapshot, previousSessions) {
    if (!previousSessions) {
      return null;
    }

    const currentSessions = await readRecentlyClosedSessions();

    if (!currentSessions) {
      return null;
    }

    return findClosedTabSessionId(
      currentSessions,
      snapshot,
      getClosedTabSessionIds(previousSessions),
    );
  }

  async function readRecentlyClosedSessions() {
    try {
      return await browser.getRecentlyClosed(RECENT_SESSION_CAPTURE_LIMIT);
    } catch (error) {
      console.warn(
        `Tab Control could not capture a closed tab's session history: ${getErrorMessage(error)}`,
      );
      return null;
    }
  }

  async function findRestoreWindow(snapshot) {
    try {
      const originalWindow = await browser.getWindow(snapshot.windowId);

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

    const windows = await browser.getAllWindows({ windowTypes: ["normal"] });
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
    return (await browser.getSessionValue(STORAGE_KEY)) || null;
  }

  function saveTransaction(transaction) {
    return browser.setSessionValue(STORAGE_KEY, transaction);
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
      await browser.removeSessionValue(STORAGE_KEY);
    }
  }

  return handleMessage;
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
