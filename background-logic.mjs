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
  UNDO_OPERATION,
  UNDO_RESTORATION_METHOD,
  UNDO_TRANSACTION_STATE,
  updateOperationData,
} from "./undo-logic.mjs";

const STORAGE_KEY = "latestUndoOperation";
const RECENT_SESSION_CAPTURE_LIMIT = 25;
const OPERATION_KINDS = new Set(Object.values(UNDO_OPERATION));

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
        return beginUndoOperation(
          UNDO_OPERATION.DUPLICATE_CLEANUP,
          message.windowId,
        );
      case "CLOSE_CLEANUP_TABS":
        return closeCleanupTabs(message.transactionId, message.tabs);
      case "BEGIN_UNDO_OPERATION":
        return beginUndoOperation(
          message.operation,
          message.windowId,
          message.data,
        );
      case "UPDATE_UNDO_OPERATION":
        return updateUndoOperation(message.transactionId, message.data);
      case "GET_DUPLICATE_CLEANUP_UNDO":
      case "GET_UNDO_TRANSACTION":
        return { transaction: getUndoTransactionSummary(await readTransaction()) };
      case "RESTORE_DUPLICATE_CLEANUP":
      case "RESTORE_UNDO_TRANSACTION":
        return restoreUndoTransaction(message.transactionId);
      default:
        throw new Error("Unknown Tab Control message.");
    }
  }

  async function beginUndoOperation(operation, windowId, data = {}) {
    if (!OPERATION_KINDS.has(operation)) {
      throw new Error("Unknown undo operation.");
    }

    const transaction = createUndoTransaction({
      id: browser.generateId(),
      windowId,
      operation,
      data,
    });
    await saveTransaction(transaction);

    return { transaction: getClientTransaction(transaction) };
  }

  async function updateUndoOperation(transactionId, data = {}) {
    const transaction = await getOpenTransaction(transactionId);
    const updated = updateOperationData(transaction, data);
    await saveTransaction(updated);

    return { transaction: getClientTransaction(updated) };
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

  async function restoreUndoTransaction(transactionId) {
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

    if (getOperation(claimedTransaction) === UNDO_OPERATION.DUPLICATE_CLEANUP) {
      claimedTransaction = await restoreClosedTabs(
        claimedTransaction,
        errors,
      );
    } else {
      claimedTransaction = await restoreOperation(
        claimedTransaction,
        errors,
      );
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

  async function restoreClosedTabs(transaction, errors) {
    let current = transaction;

    for (const tab of current.tabs) {
      try {
        const restoration = await restoreTab(tab);
        current = markTabRestored(
          current,
          tab.originalTabId,
          restoration.restoredTabId,
          restoration.method,
        );
        await saveTransaction(current);
      } catch (error) {
        errors.push(getErrorMessage(error));
      }
    }

    return current;
  }

  async function restoreOperation(transaction, errors) {
    switch (getOperation(transaction)) {
      case UNDO_OPERATION.SORT_BY_DOMAIN:
        return restoreSortedTabs(transaction);
      case UNDO_OPERATION.GROUP_TABS:
        return restoreCreatedGroups(transaction);
      case UNDO_OPERATION.UNGROUP_TABS:
        return restoreDissolvedGroups(transaction);
      case UNDO_OPERATION.GATHER_TABS_HERE:
        return restoreGatheredTabs(transaction);
      default:
        errors.push("Unknown undo operation.");
        return transaction;
    }
  }

  async function restoreSortedTabs(transaction) {
    let current = transaction;
    const tabs = [...(current.data?.tabs || [])].sort(
      (left, right) => left.index - right.index,
    );

    for (const captured of tabs) {
      let windows;
      try {
        windows = await browser.getNormalWindows();
      } catch (error) {
        current = markOperationTabFailed(
          current,
          captured.tabId,
          `Could not inspect windows while restoring tab ${captured.tabId}: ${getErrorMessage(error)}`,
        );
        await saveTransaction(current);
        continue;
      }
      const currentTab = findTab(windows, captured.tabId);
      const targetWindow = windows.find(
        (window) => window.id === captured.windowId,
      );

      if (!currentTab) {
        current = markOperationTabFailed(
          current,
          captured.tabId,
          `Tab ${captured.tabId} is no longer open.`,
        );
        await saveTransaction(current);
        continue;
      }

      if (!targetWindow) {
        current = markOperationTabFailed(
          current,
          captured.tabId,
          `Window ${captured.windowId} is no longer available.`,
        );
        await saveTransaction(current);
        continue;
      }

      try {
        if (currentTab.windowId !== targetWindow.id) {
          await browser.moveTabsToWindow([captured.tabId], targetWindow.id);
        }

        if (Boolean(currentTab.pinned) !== captured.pinned) {
          await browser.setTabPinned(captured.tabId, captured.pinned);
        }

        await browser.moveTabs([captured.tabId], captured.index);
        current = markOperationTabRestored(current, captured.tabId);
      } catch (error) {
        current = markOperationTabFailed(
          current,
          captured.tabId,
          `Tab ${captured.tabId}: ${getErrorMessage(error)}`,
        );
      }

      await saveTransaction(current);
    }

    return current;
  }

  async function restoreCreatedGroups(transaction) {
    let current = transaction;

    for (const [groupIndex, group] of (current.data?.groups || []).entries()) {
      if (!Number.isInteger(group.groupId)) {
        continue;
      }

      let windows;
      try {
        windows = await browser.getNormalWindows();
      } catch (error) {
        current = markGroupResult(
          current,
          groupIndex,
          [],
          group.tabIds,
          `Could not inspect windows while restoring the domain group: ${getErrorMessage(error)}`,
        );
        await saveTransaction(current);
        continue;
      }
      const currentTabs = new Map(
        group.tabIds.map((tabId) => [tabId, findTab(windows, tabId)]),
      );
      const missingTabIds = group.tabIds.filter(
        (tabId) => !currentTabs.get(tabId),
      );
      const alreadyUngroupedTabIds = group.tabIds.filter((tabId) => {
        const tab = currentTabs.get(tabId);
        return tab && (!Number.isInteger(tab.groupId) || tab.groupId < 0);
      });
      const capturedGroupTabIds = group.tabIds.filter((tabId) => {
        const tab = currentTabs.get(tabId);
        return tab && tab.groupId === group.groupId;
      });
      const conflictingTabIds = group.tabIds.filter((tabId) => {
        const tab = currentTabs.get(tabId);
        return (
          tab &&
          Number.isInteger(tab.groupId) &&
          tab.groupId >= 0 &&
          tab.groupId !== group.groupId
        );
      });
      const failedTabIds = [...missingTabIds, ...conflictingTabIds];

      try {
        if (capturedGroupTabIds.length > 0) {
          await browser.ungroupTabs(capturedGroupTabIds);
        }
        current = markGroupResult(
          current,
          groupIndex,
          [...alreadyUngroupedTabIds, ...capturedGroupTabIds],
          failedTabIds,
          failedTabIds.length > 0
            ? `Tabs ${failedTabIds.join(", ")} could not be safely ungrouped.`
            : null,
        );
      } catch (error) {
        current = markGroupResult(
          current,
          groupIndex,
          alreadyUngroupedTabIds,
          [...failedTabIds, ...capturedGroupTabIds],
          `Could not ungroup the created domain group: ${getErrorMessage(error)}`,
        );
      }

      await saveTransaction(current);
    }

    return current;
  }

  async function restoreDissolvedGroups(transaction) {
    let current = transaction;

    for (const [groupIndex, group] of (current.data?.groups || []).entries()) {
      let windows;
      try {
        windows = await browser.getNormalWindows();
      } catch (error) {
        current = markGroupResult(
          current,
          groupIndex,
          [],
          group.tabIds,
          `Could not inspect windows while recreating the domain group: ${getErrorMessage(error)}`,
        );
        await saveTransaction(current);
        continue;
      }
      const presentTabIds = group.tabIds.filter((tabId) =>
        Boolean(findTab(windows, tabId)),
      );
      const missingTabIds = group.tabIds.filter(
        (tabId) => !presentTabIds.includes(tabId),
      );

      try {
        if (presentTabIds.length === 0) {
          throw new Error("No members of the dissolved group are still open.");
        }

        const groupId = await browser.groupTabs(presentTabIds);
        await browser.updateTabGroup(groupId, {
          title: group.title,
          color: group.color,
          collapsed: group.collapsed,
        });
        current = markGroupResult(
          current,
          groupIndex,
          presentTabIds,
          missingTabIds,
          missingTabIds.length > 0
            ? `Tabs ${missingTabIds.join(", ")} are no longer open.`
            : null,
        );
      } catch (error) {
        current = markGroupResult(
          current,
          groupIndex,
          [],
          group.tabIds,
          `Could not recreate the dissolved domain group: ${getErrorMessage(error)}`,
        );
      }

      await saveTransaction(current);
    }

    return current;
  }

  async function restoreGatheredTabs(transaction) {
    let current = transaction;

    for (const captured of current.data?.tabs || []) {
      if (captured.state !== "moved") {
        continue;
      }

      let windows;
      try {
        windows = await browser.getNormalWindows();
      } catch (error) {
        current = markOperationTabFailed(
          current,
          captured.tabId,
          `Could not inspect windows while restoring tab ${captured.tabId}: ${getErrorMessage(error)}`,
        );
        await saveTransaction(current);
        continue;
      }
      const currentTab = findTab(windows, captured.tabId);
      const sourceWindow = windows.find(
        (window) => window.id === captured.sourceWindowId,
      );
      const destinationWindow =
        sourceWindow ||
        chooseGatherFallbackWindow(
          windows,
          current.windowId,
          captured.incognito,
        );

      if (!currentTab) {
        current = markOperationTabFailed(
          current,
          captured.tabId,
          `Tab ${captured.tabId} is no longer open.`,
        );
        await saveTransaction(current);
        continue;
      }

      if (!destinationWindow) {
        current = markOperationTabFailed(
          current,
          captured.tabId,
          `Source window ${captured.sourceWindowId} is gone and no normal window remains.`,
        );
        await saveTransaction(current);
        continue;
      }

      try {
        await browser.moveTabsToWindow([captured.tabId], destinationWindow.id);
        await browser.moveTabs([captured.tabId], captured.index);
        current = markOperationTabRestored(
          current,
          captured.tabId,
          sourceWindow
            ? null
            : `Source window ${captured.sourceWindowId} was closed; moved tab ${captured.tabId} to surviving window ${destinationWindow.id}.`,
        );
      } catch (error) {
        current = markOperationTabFailed(
          current,
          captured.tabId,
          `Tab ${captured.tabId}: ${getErrorMessage(error)}`,
        );
      }

      await saveTransaction(current);
    }

    return current;
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

    const windows = await browser.getNormalWindows();
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

  function saveTransaction(transaction) {
    return browser.setSessionValue(STORAGE_KEY, transaction);
  }

  async function readTransaction() {
    return (await browser.getSessionValue(STORAGE_KEY)) || null;
  }

  function getClientTransaction(transaction) {
    return (
      getUndoTransactionSummary(transaction) || {
        id: transaction.id,
        count: 0,
        createdAt: transaction.createdAt,
        ...(getOperation(transaction) === UNDO_OPERATION.DUPLICATE_CLEANUP
          ? {}
          : { operation: getOperation(transaction) }),
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

function markOperationTabRestored(transaction, tabId, warning = null) {
  return updateOperationData(transaction, {
    tabs: transaction.data.tabs.map((tab) =>
      tab.tabId === tabId
        ? { ...tab, state: "restored", warning }
        : tab,
    ),
  });
}

function markOperationTabFailed(transaction, tabId, failure) {
  return updateOperationData(transaction, {
    tabs: transaction.data.tabs.map((tab) =>
      tab.tabId === tabId ? { ...tab, state: "failed", failure } : tab,
    ),
  });
}

function markGroupResult(
  transaction,
  groupIndex,
  restoredTabIds,
  failedTabIds,
  failure,
) {
  return updateOperationData(transaction, {
    groups: transaction.data.groups.map((group, index) =>
      index === groupIndex
        ? {
            ...group,
            restoredTabIds,
            failedTabIds,
            failure,
          }
        : group,
    ),
  });
}

function chooseGatherFallbackWindow(windows, targetWindowId, incognito) {
  const compatibleWindows = windows.filter(
    (window) => Boolean(window.incognito) === Boolean(incognito),
  );

  return (
    compatibleWindows.find((window) => window.id === targetWindowId) ||
    [...compatibleWindows].sort((left, right) => {
      const leftDistance = Math.abs(left.id - targetWindowId);
      const rightDistance = Math.abs(right.id - targetWindowId);
      return leftDistance - rightDistance;
    })[0] ||
    null
  );
}

function findTab(windows, tabId) {
  for (const window of windows) {
    const tab = (window.tabs || []).find((candidate) => candidate.id === tabId);

    if (tab) {
      return { ...tab, windowId: window.id };
    }
  }

  return null;
}

function getOperation(transaction) {
  return transaction?.operation || UNDO_OPERATION.DUPLICATE_CLEANUP;
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
